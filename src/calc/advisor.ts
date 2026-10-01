// Design Advisor (CLAUDE.md Addition 3): recommend a complete gearbox for the given loads and materials.
//
// Speed comes from scaling laws: ring-contact unit values depend only on (Zp, D, e, rr), so they are
// computed once per candidate geometry at E* = 1, L = 1, T = 1 and rescaled (p0 ~ sqrt(E*/L),
// forces independent of L and E*). Inner-pin forces are closed form; the bearing load reuses the
// per-theta ring force sums with a closed-form inner-pin table. The search runs on a coarse
// resolution; the pick and every alternative are re-verified with the full SPEC.md resolution.

import {
  BEARINGS,
  ADVISOR_D_MAX,
  ADVISOR_D_MIN,
  ADVISOR_K1_MAX,
  ADVISOR_K1_MIN,
  ADVISOR_K1_STEP,
  DISC_STOCK_METAL,
  DISC_STOCK_POLYMER,
  INNER_PIN_OPTIONS,
  OUTER_PIN_OPTIONS,
  ZP_OPTIONS,
  ZW_OPTIONS,
} from './catalog';
import { bearingUnitLoad, CUSP_RHO, innerForceTable, ringUnit } from './kernel';
import {
  checkGearbox,
  contactLimits,
  validateGearboxInputs,
  DEFAULT_NPF,
  DEFAULT_NTH,
} from './gearbox';
import {
  effectiveModulus,
  innerPinBendingLimit,
  innerPinSectionModulus,
  outerPinBendingLimit,
  outerPinSectionModulus,
} from './materials';
import { now, runAsync, runSync, SLICE_MS, type RunHooks } from './runner';
import type { GearboxInputs, GearboxResult } from './types';

export interface AdvisorOptions {
  /** Utilization every check must stay under. Default 0.85 (green), clamped to 0.7..1.0. */
  target?: number;
  /** Let Zp vary over {12,...,26} instead of keeping the current ratio. Default false. */
  ratioVary?: boolean;
  Dmin?: number;
  Dmax?: number;
  /** Also search this many mm of housing OD beyond the best for "lightest" and "most margin". Default 15. */
  altWindowMm?: number;
  /** Extra housing-OD range searched for the best 1-disc / 2-disc when one of them is missing. Default 40. */
  discAltWindowMm?: number;
  /** Search resolution (coarse). Defaults 1500 / 120. */
  npfCoarse?: number;
  nthCoarse?: number;
  /** Verification resolution. Defaults to the SPEC.md 6000 / 240. */
  npfFull?: number;
  nthFull?: number;
  /** Minimum edge-to-edge clearance between neighbouring outer pins, mm. Default 1. */
  minPinClearance?: number;
}

export interface AdvisorProgress {
  phase: 'search' | 'verify';
  /** 0..1, monotonic */
  fraction: number;
  /** Candidate designs evaluated so far */
  evaluated: number;
  /** Smallest housing OD found so far, mm (null until a feasible design exists) */
  bestHousingOD: number | null;
  /** D being searched, mm */
  D: number;
}

export type AdvisorSlot = 'best' | 'oneDisc' | 'twoDisc' | 'lightest' | 'mostMargin';

export interface AdvisorDesign {
  slot: AdvisorSlot;
  /** Complete inputs: pass to checkGearbox / the gearbox tab ("Apply to inputs") */
  inputs: GearboxInputs;
  /** Full-resolution SPEC.md check of `inputs` */
  result: GearboxResult;
  Zp: number;
  ratio: number;
  D: number;
  /** D + 2 rr + 2 wall, mm */
  housingOD: number;
  e: number;
  K1: number;
  /** Outer pin / bushing OD, mm */
  outerPinOD: number;
  /** Bolt size label (bolt+bushing construction only) */
  outerBolt: string | null;
  /** Bolt shank diameter, mm (bolt+bushing only) */
  shankDia: number | null;
  innerPinOD: number;
  innerPinBore: number | null;
  innerThread: string | null;
  Zw: number;
  Rw: number;
  L: number;
  discs: number;
  bearingName: string;
  bearingOD: number;
  massTotal_g: number;
  /** Max utilization at full SPEC resolution */
  maxUtilization: number;
  /** Max utilization the coarse search saw (diagnostic; should be within ~3% of maxUtilization) */
  coarseMaxUtilization: number;
  governingLabel: string;
  /** True if this slot holds the same design as `best` */
  sameAsBest: boolean;
}

export interface AdvisorResult {
  valid: boolean;
  cancelled: boolean;
  errors: string[];
  warnings: string[];
  target: number;
  /** The recommended design (smallest housing OD), or null if no design meets the target */
  best: AdvisorDesign | null;
  alternatives: {
    /** Smallest design with one disc */
    oneDisc: AdvisorDesign | null;
    /** Smallest design with two discs */
    twoDisc: AdvisorDesign | null;
    /** Lowest disc mass within the search window */
    lightest: AdvisorDesign | null;
    /** Lowest maximum utilization within the search window */
    mostMargin: AdvisorDesign | null;
  };
  /** Candidate designs evaluated at coarse resolution */
  evaluated: number;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

interface Cand {
  od: number; mass: number; discs: number; util: number;
  Zp: number; D: number; K1: number; e: number;
  pinIdx: number; inIdx: number; Zw: number; L: number; brgIdx: number; Rw: number;
}

const newCand = (): Cand => ({
  od: 0, mass: 0, discs: 0, util: 0, Zp: 0, D: 0, K1: 0, e: 0, pinIdx: 0, inIdx: 0, Zw: 0, L: 0, brgIdx: 0, Rw: 0,
});

const TOL = 1e-9;
function cmpNum(a: number, b: number): number {
  return a < b - TOL ? -1 : a > b + TOL ? 1 : 0;
}
const cmpBest = (a: Cand, b: Cand) =>
  cmpNum(a.od, b.od) || cmpNum(a.mass, b.mass) || a.discs - b.discs || cmpNum(a.util, b.util);
const cmpLight = (a: Cand, b: Cand) =>
  cmpNum(a.mass, b.mass) || cmpNum(a.od, b.od) || a.discs - b.discs || cmpNum(a.util, b.util);
const cmpMargin = (a: Cand, b: Cand) =>
  cmpNum(a.util, b.util) || cmpNum(a.od, b.od) || cmpNum(a.mass, b.mass) || a.discs - b.discs;

class TopK {
  items: Cand[] = [];
  constructor(private cmp: (a: Cand, b: Cand) => number, private k: number) {}
  /** Insert a copy of `c` if it ranks within the top k. */
  add(c: Cand) {
    const n = this.items.length;
    if (n >= this.k && this.cmp(c, this.items[n - 1]) >= 0) return;
    let i = n;
    while (i > 0 && this.cmp(c, this.items[i - 1]) < 0) i--;
    this.items.splice(i, 0, { ...c });
    if (this.items.length > this.k) this.items.pop();
  }
}

const TOPK = 8;

function clampTarget(t: number | undefined): number {
  const v = t != null && Number.isFinite(t) ? t : 0.85;
  return Math.min(1.0, Math.max(0.7, v));
}

function buildInputs(base: GearboxInputs, c: Cand): GearboxInputs {
  const outer = OUTER_PIN_OPTIONS[c.pinIdx];
  const inner = INNER_PIN_OPTIONS[c.inIdx];
  const brg = BEARINGS[c.brgIdx];
  return {
    ...base,
    Zp: c.Zp, Zw: c.Zw, D: c.D, e: c.e, L: c.L, rr: outer.od / 2, rw: inner.od / 2, Db: brg.OD,
    discs: c.discs, RwOverride: null, discShare: null,
    outerPin: {
      ...base.outerPin,
      shankDia: base.outerPin.construction === 'boltBushing' ? outer.shank : base.outerPin.shankDia,
    },
    innerPin: {
      ...base.innerPin,
      od: base.innerPin.construction === 'standoff' ? inner.od : base.innerPin.od,
      bore: base.innerPin.construction === 'standoff' ? inner.bore : base.innerPin.bore,
    },
    bearing: { name: brg.name, C: brg.C, C0: brg.C0 },
  };
}

function makeDesign(slot: AdvisorSlot, base: GearboxInputs, c: Cand, result: GearboxResult): AdvisorDesign {
  const outer = OUTER_PIN_OPTIONS[c.pinIdx];
  const inner = INNER_PIN_OPTIONS[c.inIdx];
  const brg = BEARINGS[c.brgIdx];
  const inputs = buildInputs(base, c);
  const bolt = base.outerPin.construction === 'boltBushing';
  const standoff = base.innerPin.construction === 'standoff';
  return {
    slot,
    inputs,
    result,
    Zp: c.Zp,
    ratio: c.Zp - 1,
    D: c.D,
    housingOD: result.derived.housingOD,
    e: c.e,
    K1: result.derived.K1,
    outerPinOD: outer.od,
    outerBolt: bolt ? outer.bolt : null,
    shankDia: bolt ? outer.shank : null,
    innerPinOD: inner.od,
    innerPinBore: standoff ? inner.bore : null,
    innerThread: standoff ? inner.thread : null,
    Zw: c.Zw,
    Rw: result.derived.Rw,
    L: c.L,
    discs: c.discs,
    bearingName: brg.name,
    bearingOD: brg.OD,
    massTotal_g: result.mass.total_g,
    maxUtilization: result.maxUtilization,
    coarseMaxUtilization: c.util,
    governingLabel: result.governing?.label ?? '',
    sameAsBest: false,
  };
}

function sameCand(a: Cand, b: Cand): boolean {
  return a.Zp === b.Zp && a.D === b.D && a.K1 === b.K1 && a.pinIdx === b.pinIdx && a.inIdx === b.inIdx &&
    a.Zw === b.Zw && a.L === b.L && a.brgIdx === b.brgIdx && a.discs === b.discs;
}

interface Group { Zp: number; D: number; pinIdx: number; od: number }

export function invalidAdvisor(errors: string[], target: number): AdvisorResult {
  return {
    valid: false, cancelled: false, errors, warnings: [], target, best: null,
    alternatives: { oneDisc: null, twoDisc: null, lightest: null, mostMargin: null },
    evaluated: 0, elapsedMs: 0,
  };
}

interface SearchOutcome {
  best: TopK; one: TopK; two: TopK; light: TopK; margin: TopK;
  evaluated: number;
}

// ---------------------------------------------------------------------------
// The coarse search (generator so it can report progress and be cancelled)
// ---------------------------------------------------------------------------

function* searchGen(
  base: GearboxInputs, o: Required<AdvisorOptions>, target: number, progressBase: { v: number },
): Generator<AdvisorProgress, SearchOutcome, void> {
  const best = new TopK(cmpBest, TOPK), one = new TopK(cmpBest, TOPK), two = new TopK(cmpBest, TOPK);
  const light = new TopK(cmpLight, TOPK), margin = new TopK(cmpMargin, TOPK);

  const Kc = base.Kc, Tdes = base.Tdes, Treq = base.Treq, KcLife = base.KcLife;
  const disc = base.discMaterial;
  const EsRing = effectiveModulus(base.outerPin.material, disc);
  const EsIn = effectiveModulus(base.innerPin.material, disc);
  const limRing = contactLimits(disc, base.outerPin.material);
  const limIn = contactLimits(disc, base.innerPin.material);
  const boltLim = outerPinBendingLimit(base.outerPin);
  const soLim = innerPinBendingLimit(base.innerPin);
  const stock = disc.kind === 'polymer' ? DISC_STOCK_POLYMER : DISC_STOCK_METAL;
  const tMin = base.tMin, gap = base.gap, wall = base.wall;
  const rho = disc.density;
  const ligReq = tMin / target;
  const Zps = o.ratioVary ? ZP_OPTIONS : [base.Zp];

  const K1s: number[] = [];
  for (let k = 0; ADVISOR_K1_MIN + k * ADVISOR_K1_STEP <= ADVISOR_K1_MAX + 1e-9; k++) {
    K1s.push(Math.round((ADVISOR_K1_MIN + k * ADVISOR_K1_STEP) * 1e6) / 1e6);
  }

  // Per-option precomputation
  const outerRr = OUTER_PIN_OPTIONS.map((p) => p.od / 2);
  const outerZ = OUTER_PIN_OPTIONS.map((p) =>
    outerPinSectionModulus({ ...base.outerPin, shankDia: p.shank }, p.od / 2));
  const innerRw = INNER_PIN_OPTIONS.map((p) => p.od / 2);
  const innerZ = INNER_PIN_OPTIONS.map((p) =>
    innerPinSectionModulus({ ...base.innerPin, od: p.od, bore: p.bore }, p.od / 2));

  // Groups sorted by housing OD (then Zp, D, pin) so the search can stop early and deterministically.
  const groups: Group[] = [];
  for (const Zp of Zps) {
    for (let D = Math.ceil(o.Dmin); D <= o.Dmax; D++) {
      const Rp = D / 2;
      for (let pi = 0; pi < OUTER_PIN_OPTIONS.length; pi++) {
        const rr = outerRr[pi];
        if (2 * Rp * Math.sin(Math.PI / Zp) - 2 * rr < o.minPinClearance) continue;
        groups.push({ Zp, D, pinIdx: pi, od: D + 2 * rr + 2 * wall });
      }
    }
  }
  groups.sort((a, b) => a.od - b.od || a.Zp - b.Zp || a.D - b.D || a.pinIdx - b.pinIdx);

  let evaluated = 0;
  let bestOD = Infinity;     // housing OD of the best design found
  let oneOD = Infinity, twoOD = Infinity;
  let lastYield = now();
  const cur = newCand();

  let planned = groups.length;
  for (let gi = 0; gi < groups.length; gi++) {
    const grp = groups[gi];
    const od = grp.od;
    // What does this group still have to contribute?
    const inWindow = od <= bestOD + o.altWindowMm + TOL;
    const inDiscWindow = od <= bestOD + o.discAltWindowMm + TOL;
    const wantOne = bestOD === Infinity || inWindow || (oneOD === Infinity && inDiscWindow) || od <= oneOD + TOL;
    const wantTwo = bestOD === Infinity || inWindow || (twoOD === Infinity && inDiscWindow) || od <= twoOD + TOL;
    if (!wantOne && !wantTwo) {
      if (od > bestOD + o.discAltWindowMm) { planned = gi; break; }
      continue;
    }
    if (bestOD < Infinity && planned === groups.length) {
      // first time we know bestOD: estimate how many groups remain in range
      const lim = bestOD + (oneOD === Infinity || twoOD === Infinity ? o.discAltWindowMm : o.altWindowMm);
      let k = gi;
      while (k < groups.length && groups[k].od <= lim) k++;
      planned = k;
    }

    const { Zp, D, pinIdx } = grp;
    const Rp = D / 2;
    const rr = outerRr[pinIdx];
    const Zo = outerZ[pinIdx];

    for (const K1 of K1s) {
      const e = (K1 * Rp) / Zp;
      const Rroot = Rp - e - rr;
      if (!(Rroot > 0)) continue;

      // Cheap geometric pre-scan: is there any inner pin / Zw / bearing that fits at all?
      let anyGeo = false;
      for (let ii = 0; ii < INNER_PIN_OPTIONS.length && !anyGeo; ii++) {
        const dh = 2 * innerRw[ii] + 2 * e;
        const Rw = Rroot - dh / 2 - tMin;
        if (!(Rw > 0)) continue;
        for (let bi = 0; bi < BEARINGS.length && !anyGeo; bi++) {
          if (Rw - dh / 2 - BEARINGS[bi].OD / 2 < ligReq - TOL) continue;
          for (const Zw of ZW_OPTIONS) {
            if (2 * Rw * Math.sin(Math.PI / Zw) - dh >= ligReq - TOL) { anyGeo = true; break; }
          }
        }
      }
      if (!anyGeo) continue;

      const u = ringUnit(Zp, D, e, rr, o.npfCoarse, o.nthCoarse);
      if (u.cusp || u.undercut) continue;
      const cuspUtil = Number.isFinite(u.rhoMinConvex) ? CUSP_RHO / u.rhoMinConvex : 0;
      if (cuspUtil > target) continue;

      for (let di = 1; di <= 2; di++) {
        if (di === 1 ? !wantOne : !wantTwo) continue;
        const s = di === 2 ? 0.55 : 1.0;
        const sStr = Math.sqrt(Kc * Tdes * s);
        const sLife = Math.sqrt(KcLife * Treq * s);
        const Fpk = u.F * Kc * Tdes * s;
        const Fstr = Kc * Tdes * s;
        for (const L of stock) {
          const p0 = u.P1 * Math.sqrt(EsRing / L);
          const uRS = (p0 * sStr) / limRing.strength;
          const uRL = (p0 * sLife) / limRing.life;
          if (uRS > target || uRL > target) continue;
          const span = di * L + (di + 1) * gap;
          const uBolt = (Fpk * span / 4 / Zo) / boltLim;
          if (uBolt > target) continue;
          const standoffArm = gap + (di - 1) * (L + gap) + L / 2;
          const base1 = Math.max(uRS, uRL, uBolt, cuspUtil);

          for (let ii = 0; ii < INNER_PIN_OPTIONS.length; ii++) {
            const rw = innerRw[ii];
            const dh = 2 * rw + 2 * e;
            const Rw = Rroot - dh / 2 - tMin;
            if (!(Rw > 0)) continue;
            const invRin = 1 / rw - 1 / (dh / 2);
            const Zi = innerZ[ii];
            for (const Zw of ZW_OPTIONS) {
              const ligH = 2 * Rw * Math.sin(Math.PI / Zw) - dh;
              const uLH = ligH > 0 ? tMin / ligH : 99;
              if (uLH > target) continue;
              const FIn = 4000 / (Zw * Rw);
              const p0In = Math.sqrt((FIn * EsIn * invRin) / (Math.PI * L));
              const uIS = (p0In * sStr) / limIn.strength;
              const uIL = (p0In * sLife) / limIn.life;
              if (uIS > target || uIL > target) continue;
              const uSO = ((FIn * Fstr * standoffArm) / Zi / 2) / soLim;
              if (uSO > target) continue;
              const base2 = Math.max(base1, uLH, uIS, uIL, uSO);

              const g = innerForceTable(Zw, Zp, o.nthCoarse);
              const Fb = bearingUnitLoad(u.sweep, g, Rw);
              const peak = Fb * Tdes * s;
              const working = Fb * Treq * s;
              const netBase = u.area - Zw * Math.PI * (dh / 2) * (dh / 2);

              for (let bi = 0; bi < BEARINGS.length; bi++) {
                const brg = BEARINGS[bi];
                const ligB = Rw - dh / 2 - brg.OD / 2;
                const uLB = ligB > 0 ? tMin / ligB : 99;
                if (uLB > target) continue;
                const uBS = peak / brg.C0;
                if (uBS > target) continue;
                let uBL = 0;
                if (working > 0 && base.reqLifeH > 0) {
                  const L10h = (Math.pow(brg.C / working, 3) * 1e6) / (60 * base.rpm);
                  uBL = base.reqLifeH / L10h;
                }
                if (uBL > target) continue;
                evaluated++;
                cur.util = Math.max(base2, uLB, uBS, uBL);
                const net = netBase - Math.PI * (brg.OD / 2) * (brg.OD / 2);
                cur.mass = (Math.max(0, net) * L * rho / 1000) * di;
                cur.od = od; cur.discs = di;
                cur.Zp = Zp; cur.D = D; cur.K1 = K1; cur.e = e;
                cur.pinIdx = pinIdx; cur.inIdx = ii; cur.Zw = Zw; cur.L = L; cur.brgIdx = bi; cur.Rw = Rw;
                best.add(cur);
                (di === 1 ? one : two).add(cur);
                if (od <= bestOD + o.altWindowMm + TOL || bestOD === Infinity) {
                  light.add(cur);
                  margin.add(cur);
                }
                if (od < bestOD) bestOD = od;
                if (di === 1 && od < oneOD) oneOD = od;
                if (di === 2 && od < twoOD) twoOD = od;
              }
            }
          }
        }
      }
    }

    if (now() - lastYield > SLICE_MS) {
      lastYield = now();
      const frac = Math.min(0.9, Math.max(progressBase.v, (gi + 1) / Math.max(planned, 1) * 0.9));
      progressBase.v = frac;
      yield {
        phase: 'search', fraction: frac, evaluated,
        bestHousingOD: bestOD < Infinity ? bestOD : null, D,
      };
    }
  }
  // Keep the window semantics of light/margin: drop entries beyond the final window
  const limit = bestOD + o.altWindowMm + TOL;
  light.items = light.items.filter((c) => c.od <= limit);
  margin.items = margin.items.filter((c) => c.od <= limit);
  return { best, one, two, light, margin, evaluated };
}

// ---------------------------------------------------------------------------
// Main generator: search, then verify at full resolution
// ---------------------------------------------------------------------------

function* adviseGen(inputs: GearboxInputs, opts: AdvisorOptions): Generator<AdvisorProgress, AdvisorResult, void> {
  const t0 = now();
  const target = clampTarget(opts.target);
  const v = validateGearboxInputsForAdvisor(inputs);
  if (v.errors.length) return invalidAdvisor(v.errors, target);

  const o: Required<AdvisorOptions> = {
    target,
    ratioVary: opts.ratioVary ?? false,
    Dmin: opts.Dmin ?? ADVISOR_D_MIN,
    Dmax: opts.Dmax ?? ADVISOR_D_MAX,
    altWindowMm: opts.altWindowMm ?? 15,
    discAltWindowMm: opts.discAltWindowMm ?? 40,
    npfCoarse: opts.npfCoarse ?? 1500,
    nthCoarse: opts.nthCoarse ?? 120,
    npfFull: opts.npfFull ?? DEFAULT_NPF,
    nthFull: opts.nthFull ?? DEFAULT_NTH,
    minPinClearance: opts.minPinClearance ?? 1,
  };
  const warnings: string[] = [...v.warnings];
  const progress = { v: 0 };
  let evaluated = 0;

  const fullCheck = (c: Cand): GearboxResult =>
    checkGearbox(buildInputs(inputs, c), { npf: o.npfFull, nth: o.nthFull });
  const passes = (r: GearboxResult, tgt: number) => r.valid && r.maxUtilization <= tgt + 1e-9;

  let outcome: SearchOutcome | null = null;
  let verified: {
    best?: { c: Cand; r: GearboxResult };
    one?: { c: Cand; r: GearboxResult };
    two?: { c: Cand; r: GearboxResult };
    light?: { c: Cand; r: GearboxResult };
    margin?: { c: Cand; r: GearboxResult };
  } = {};

  // Attempt 0 uses the requested target; if no coarse pick survives full-resolution
  // verification the search is repeated with a slightly tighter coarse target.
  for (let attempt = 0; attempt < 3; attempt++) {
    const coarseTarget = Math.max(0.5, target - 0.01 * attempt);
    outcome = yield* searchGen(inputs, o, coarseTarget, progress);
    evaluated += outcome.evaluated;
    verified = {};
    const pickFirst = (list: TopK): { c: Cand; r: GearboxResult } | undefined => {
      for (const c of list.items) {
        const r = fullCheck(c);
        if (passes(r, target)) return { c, r };
      }
      return undefined;
    };
    const lists: [keyof typeof verified, TopK][] = [
      ['best', outcome.best], ['one', outcome.one], ['two', outcome.two],
      ['light', outcome.light], ['margin', outcome.margin],
    ];
    let done = 0;
    for (const [key, list] of lists) {
      verified[key] = pickFirst(list);
      done++;
      progress.v = Math.max(progress.v, 0.9 + (0.1 * done) / lists.length);
      yield {
        phase: 'verify', fraction: Math.min(0.999, progress.v), evaluated,
        bestHousingOD: outcome.best.items[0]?.od ?? null, D: outcome.best.items[0]?.D ?? 0,
      };
    }
    if (verified.best || outcome.best.items.length === 0) break;
    warnings.push(`Coarse pick failed full-resolution verification; retried with target ${coarseTarget - 0.01}.`);
  }

  const res: AdvisorResult = {
    valid: true, cancelled: false, errors: [], warnings, target, best: null,
    alternatives: { oneDisc: null, twoDisc: null, lightest: null, mostMargin: null },
    evaluated, elapsedMs: 0,
  };
  const bestV = verified.best;
  if (bestV) res.best = makeDesign('best', inputs, bestV.c, bestV.r);
  const mk = (slot: AdvisorSlot, x?: { c: Cand; r: GearboxResult }): AdvisorDesign | null => {
    if (!x) return null;
    const d = makeDesign(slot, inputs, x.c, x.r);
    d.sameAsBest = !!bestV && sameCand(x.c, bestV.c);
    return d;
  };
  res.alternatives.oneDisc = mk('oneDisc', verified.one);
  res.alternatives.twoDisc = mk('twoDisc', verified.two);
  res.alternatives.lightest = mk('lightest', verified.light);
  res.alternatives.mostMargin = mk('mostMargin', verified.margin);
  if (!res.best) {
    warnings.push(
      `No design up to D = ${o.Dmax} mm meets the target utilization ${target.toFixed(2)}. ` +
      'Try a higher target, lower loads, a stronger disc material or allow the ratio to vary.',
    );
  }
  if (inputs.discShare != null) {
    warnings.push('A manual disc share is ignored by the advisor: it uses 1.0 for one disc and 0.55 for two.');
  }
  res.elapsedMs = now() - t0;
  return res;
}

function validateGearboxInputsForAdvisor(inp: GearboxInputs): { errors: string[]; warnings: string[] } {
  try {
    const v = validateGearboxInputs({ ...inp, D: 400, e: 0.5, RwOverride: null });
    return { errors: v.errors, warnings: [] };
  } catch (err) {
    return { errors: [`Input could not be read: ${err instanceof Error ? err.message : String(err)}`], warnings: [] };
  }
}

/** A result object meaning "the job was cancelled". */
export function cancelledAdvisorResult(target: number): AdvisorResult {
  return { ...invalidAdvisor([], target), cancelled: true };
}

/** Synchronous advisor (tests, small jobs). Never throws. */
export function adviseDesign(
  inputs: GearboxInputs, opts: AdvisorOptions = {}, hooks?: RunHooks<AdvisorProgress>,
): AdvisorResult {
  try {
    return runSync(adviseGen(inputs, opts), hooks) ?? cancelledAdvisorResult(clampTarget(opts.target));
  } catch (err) {
    return invalidAdvisor([`Advisor failed: ${err instanceof Error ? err.message : String(err)}`], clampTarget(opts.target));
  }
}

/** Async advisor: yields to the event loop between slices so it can be cancelled. Never throws. */
export async function adviseDesignAsync(
  inputs: GearboxInputs, opts: AdvisorOptions = {}, hooks?: RunHooks<AdvisorProgress>,
): Promise<AdvisorResult> {
  try {
    return (await runAsync(adviseGen(inputs, opts), hooks)) ?? cancelledAdvisorResult(clampTarget(opts.target));
  } catch (err) {
    return invalidAdvisor([`Advisor failed: ${err instanceof Error ? err.message : String(err)}`], clampTarget(opts.target));
  }
}
