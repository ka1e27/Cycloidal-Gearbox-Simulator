// SPEC.md minimum-size solver: sweep D (30..120 mm, 1 mm) and K1 (0.40..0.85, 0.025; e = K1*Rp/Zp),
// skip geometrically infeasible or cusp cases, score = max utilization of the four contact checks.
// Reports the smallest D with score <= 1, its best e, and the geometric floor.

import { computeProfile, ringUnit } from './kernel';
import { contactLimits, deriveGeometry, discShareOf, validateGearboxInputs, DEFAULT_NPF, DEFAULT_NTH } from './gearbox';
import { effectiveModulus } from './materials';
import { now, runAsync, runSync, SLICE_MS, type RunHooks } from './runner';
import type { GearboxInputs } from './types';

export interface SolverOptions {
  Dmin?: number;
  Dmax?: number;
  Dstep?: number;
  K1min?: number;
  K1max?: number;
  K1step?: number;
  /** Screening resolution (fast). The accepted D is always re-verified at the full resolution. */
  npfScreen?: number;
  nthScreen?: number;
  npfFull?: number;
  nthFull?: number;
}

export interface SolverProgress {
  phase: 'solve';
  /** 0..1 */
  fraction: number;
  /** Current D being evaluated, mm */
  D: number;
}

export interface SolverRow {
  D: number;
  /** Any K1 geometrically feasible (ligaments + no cusp) */
  feasible: boolean;
  /** Best (lowest) contact score over the feasible K1, null if none */
  bestScore: number | null;
  bestK1: number | null;
  bestE: number | null;
}

export interface SolverResult {
  valid: boolean;
  cancelled: boolean;
  errors: string[];
  warnings: string[];
  /** Smallest D with contact score <= 1, mm. null if none up to Dmax. */
  minD: number | null;
  bestE: number | null;
  bestK1: number | null;
  /** Contact score at (minD, bestE), full resolution */
  bestScore: number | null;
  /** Smallest D that is geometrically feasible regardless of load, mm */
  floorD: number | null;
  floorK1: number | null;
  /** True if nothing up to Dmax has score <= 1 */
  noSolution: boolean;
  Dmax: number;
  /** Per-D summary over the swept range (up to and including minD when one is found) */
  rows: SolverRow[];
  /** Score grid for a heat map: D values x K1 values, null = infeasible / cusp / not evaluated */
  grid: { D: number[]; K1: number[]; score: (number | null)[][] };
  /** Load the current inputs apply to (for the read-out) */
  elapsedMs: number;
}

/** Copy of the inputs with D and e replaced (Rw override dropped so Rw follows the new geometry). */
export function applySolverSolution(inputs: GearboxInputs, D: number, e: number): GearboxInputs {
  return { ...inputs, D, e, RwOverride: null };
}

const EPS = 1e-9;

interface Ctx {
  inp: GearboxInputs;
  EsRing: number;
  EsIn: number;
  limRing: { strength: number; life: number };
  limIn: { strength: number; life: number };
  sStr: number;
  sLife: number;
}

function makeCtx(inp: GearboxInputs): Ctx {
  const s = discShareOf(inp.discs, inp.discShare);
  return {
    inp,
    EsRing: effectiveModulus(inp.outerPin.material, inp.discMaterial),
    EsIn: effectiveModulus(inp.innerPin.material, inp.discMaterial),
    limRing: contactLimits(inp.discMaterial, inp.outerPin.material, inp.outerPin.construction === 'solid'),
    limIn: contactLimits(inp.discMaterial, inp.innerPin.material, inp.innerPin.construction === 'solid'),
    sStr: Math.sqrt(inp.Kc * inp.Tdes * s),
    sLife: Math.sqrt(inp.KcLife * inp.Treq * s),
  };
}

interface PointEval {
  geoOk: boolean;
  cusp: boolean;
  score: number;
}

/** Geometry + cusp + contact score at one (D, e), ignoring any Rw override. */
function evalPoint(c: Ctx, D: number, e: number, npf: number, nth: number, needScore: boolean): PointEval {
  const inp = c.inp;
  const g = deriveGeometry({ ...inp, D, e, RwOverride: null });
  const geoOk = g.Rroot > 0 && g.Rw > 0 && g.ligBore >= inp.tMin - EPS && g.ligHoles >= inp.tMin - EPS;
  if (!geoOk) return { geoOk: false, cusp: false, score: Infinity };
  if (!needScore) {
    const p = computeProfile(inp.Zp, g.Rp, e, inp.rr, npf);
    return { geoOk: true, cusp: p.cusp, score: 0 };
  }
  const u = ringUnit(inp.Zp, D, e, inp.rr, npf, nth);
  if (u.cusp) return { geoOk: true, cusp: true, score: Infinity };
  const kE = Math.sqrt(c.EsRing / inp.L);
  const p0 = u.P1 * kE;
  const FIn = 4000 / (inp.Zw * g.Rw);
  const p0In = Math.sqrt((FIn * c.EsIn * (1 / inp.rw - 1 / (g.dh / 2))) / (Math.PI * inp.L));
  const score = Math.max(
    (p0 * c.sStr) / c.limRing.strength,
    (p0 * c.sLife) / c.limRing.life,
    (p0In * c.sStr) / c.limIn.strength,
    (p0In * c.sLife) / c.limIn.life,
  );
  return { geoOk: true, cusp: false, score };
}

function* solveGen(inputs: GearboxInputs, o: SolverOptions): Generator<SolverProgress, SolverResult, void> {
  const t0 = now();
  const v = validateGearboxInputsForSolver(inputs);
  const Dmin = o.Dmin ?? 30, Dmax = o.Dmax ?? 120, Dstep = o.Dstep ?? 1;
  const K1min = o.K1min ?? 0.4, K1max = o.K1max ?? 0.85, K1step = o.K1step ?? 0.025;
  const base: SolverResult = {
    valid: false, cancelled: false, errors: v.errors, warnings: v.warnings,
    minD: null, bestE: null, bestK1: null, bestScore: null, floorD: null, floorK1: null,
    noSolution: false, Dmax, rows: [], grid: { D: [], K1: [], score: [] }, elapsedMs: 0,
  };
  if (v.errors.length) return base;

  const npfS = o.npfScreen ?? 1500, nthS = o.nthScreen ?? 120;
  const npfF = o.npfFull ?? DEFAULT_NPF, nthF = o.nthFull ?? DEFAULT_NTH;
  const ctx = makeCtx(inputs);
  const Zp = inputs.Zp;

  const K1s: number[] = [];
  for (let k = 0; K1min + k * K1step <= K1max + 1e-9; k++) K1s.push(Math.round((K1min + k * K1step) * 1e9) / 1e9);
  const Ds: number[] = [];
  for (let d = 0; Dmin + d * Dstep <= Dmax + 1e-9; d++) Ds.push(Math.round((Dmin + d * Dstep) * 1e9) / 1e9);
  base.grid.K1 = K1s;

  let lastYield = now();
  let floorFound = false;
  let solved = false;

  for (let di = 0; di < Ds.length; di++) {
    const D = Ds[di];
    const Rp = D / 2;
    const row: SolverRow = { D, feasible: false, bestScore: null, bestK1: null, bestE: null };
    const scores: (number | null)[] = [];
    const needScore = !solved; // after the answer is known only the floor matters
    for (const K1 of K1s) {
      const e = (K1 * Rp) / Zp;
      if (!needScore) { scores.push(null); continue; }
      const pe = evalPoint(ctx, D, e, npfS, nthS, true);
      if (!pe.geoOk || pe.cusp) { scores.push(null); continue; }
      scores.push(pe.score);
    }
    base.grid.D.push(D);
    base.grid.score.push(scores);

    // Geometric floor: first D with any geometrically feasible, cusp-free K1 (cusp at full profile resolution)
    if (!floorFound) {
      for (const K1 of K1s) {
        const e = (K1 * Rp) / Zp;
        const pe = evalPoint(ctx, D, e, npfF, nthF, false);
        if (pe.geoOk && !pe.cusp) { floorFound = true; base.floorD = D; base.floorK1 = K1; break; }
      }
    }

    // Screening: any K1 with a (coarse) score close enough to 1 -> verify at full resolution
    let minCoarse = Infinity;
    for (const s of scores) if (s !== null && s < minCoarse) minCoarse = s;
    row.feasible = scores.some((s) => s !== null);
    if (minCoarse <= 1.1) {
      let bestS = Infinity, bestI = -1;
      for (let i = 0; i < K1s.length; i++) {
        const s = scores[i];
        if (s === null || s > 1.25) continue;
        const e = (K1s[i] * Rp) / Zp;
        const pe = evalPoint(ctx, D, e, npfF, nthF, true);
        if (!pe.geoOk || pe.cusp) { scores[i] = null; continue; }
        scores[i] = pe.score;
        if (pe.score < bestS) { bestS = pe.score; bestI = i; }
      }
      if (bestI >= 0) {
        row.bestScore = bestS; row.bestK1 = K1s[bestI]; row.bestE = (K1s[bestI] * Rp) / Zp;
        if (bestS <= 1 + EPS && !solved) {
          solved = true;
          base.minD = D; base.bestE = row.bestE; base.bestK1 = row.bestK1; base.bestScore = bestS;
        }
      }
    } else if (minCoarse < Infinity) {
      const i = scores.indexOf(minCoarse);
      row.bestScore = minCoarse; row.bestK1 = K1s[i]; row.bestE = (K1s[i] * Rp) / Zp;
    }
    base.rows.push(row);

    if (solved && floorFound) break; // everything requested is known
    if (now() - lastYield > SLICE_MS) {
      lastYield = now();
      yield { phase: 'solve', fraction: (di + 1) / Ds.length, D };
    }
  }
  base.valid = true;
  base.noSolution = base.minD === null;
  if (base.noSolution && base.floorD !== null) {
    base.warnings.push(`No solution up to D = ${Dmax} mm with the current loads and materials.`);
  }
  base.elapsedMs = now() - t0;
  return base;
}

function validateGearboxInputsForSolver(inp: GearboxInputs): { errors: string[]; warnings: string[] } {
  // The solver varies D and e, so validate with a safe D / e and ignore any Rw override.
  try {
    const probe = { ...inp, D: 400, e: 0.5, RwOverride: null };
    const v = validateGearboxInputs(probe);
    return { errors: v.errors, warnings: [] };
  } catch (err) {
    return { errors: [`Input could not be read: ${err instanceof Error ? err.message : String(err)}`], warnings: [] };
  }
}

/** A result object meaning "the job was cancelled" (or failed, with errors filled in). */
export function cancelledResult(Dmax: number): SolverResult {
  return {
    valid: false, cancelled: true, errors: [], warnings: [], minD: null, bestE: null, bestK1: null,
    bestScore: null, floorD: null, floorK1: null, noSolution: false, Dmax, rows: [],
    grid: { D: [], K1: [], score: [] }, elapsedMs: 0,
  };
}

/** Synchronous solve (tests, small jobs). Never throws. */
export function solveMinimumSize(
  inputs: GearboxInputs, opts: SolverOptions = {}, hooks?: RunHooks<SolverProgress>,
): SolverResult {
  try {
    return runSync(solveGen(inputs, opts), hooks) ?? cancelledResult(opts.Dmax ?? 120);
  } catch (err) {
    const r = cancelledResult(opts.Dmax ?? 120);
    return { ...r, cancelled: false, errors: [`Solver failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}

/** Async solve: yields to the event loop between slices so it can be cancelled. Never throws. */
export async function solveMinimumSizeAsync(
  inputs: GearboxInputs, opts: SolverOptions = {}, hooks?: RunHooks<SolverProgress>,
): Promise<SolverResult> {
  try {
    return (await runAsync(solveGen(inputs, opts), hooks)) ?? cancelledResult(opts.Dmax ?? 120);
  } catch (err) {
    const r = cancelledResult(opts.Dmax ?? 120);
    return { ...r, cancelled: false, errors: [`Solver failed: ${err instanceof Error ? err.message : String(err)}`] };
  }
}
