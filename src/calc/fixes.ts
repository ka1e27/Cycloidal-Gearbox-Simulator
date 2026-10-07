// "How to fix it": for a design with any check above the target (default 0.85), try changing ONE design variable at a
// time, everything else kept, and find the smallest change that brings every check to <= the target. Pure TypeScript,
// never throws; the UI runs it in the calc worker (see workerClient.fixes).
//
// Search rules (one variable at a time):
//   D up            0.5 mm grid on (D, min(2D, Dmax)] (2D when D >= Dmax), e scaled with D to keep K1 (clamped 0.40..0.85):
//                   coarse scan, bisection to the first passing value
//   e up / down     0.01 mm grid inside K1 0.40..0.85: K1 scan (0.025 steps) each way, bisection next to the first pass
//   L up            stock list of the disc's stock form (plate or printed) plus the exact minimum on a 0.05 mm grid
//   discs           1 -> 2
//   outer / inner pin size up, catalog sizes above the current one (a pin-size change also sets rr / the bolt shank,
//                   rw / the standoff OD and bore, like the pickers)
//   Zw              4..10 both ways (nearest first), skipped when the geometry is no longer valid
//   bearing         every catalog bearing (67xx, 618xx, 60xx); sets Db = bearing OD
//   disc material   every library material at least as strong (Sy and sigma_f) and stronger in one of them
//   inner pin support cantilever -> pinned tie ring -> bolted tie ring
//   pin / standoff material, bolt grade: only when the governing check is a pin bending or a pin contact check
//                   (steel pins only, plus plastics for a plastic disc)
//   integral ring   tooth radius rr up and down (0.25 mm grid), housing material (stronger library materials, when a
//                   ring contact or the tooth root governs), tool radius (standard end mills below the current one, when the
//                   tool fillet check fails)
//   ratio           never as a gearbox fix; only "use the recommended ratio" (e rescaled to keep K1) when a motor is
//                   given and the motor check is above the target
// Searches run at the coarse resolution; every reported fix is re-checked at full SPEC resolution (newMaxUtil,
// governing, statuses), and monotone searches are adjusted at full resolution so the next value down fails.

import { BEARINGS, INNER_PIN_OPTIONS, OUTER_PIN_OPTIONS, ADVISOR_D_MAX, ZW_OPTIONS, shoulderBoltFor, shoulderBoltsOf } from './catalog';
import { checkGearbox, GREEN_LIMIT, innerPinSupportOf, UTIL_CAP } from './gearbox';
import {
  MATERIALS, SPEC_STEEL, discStockFor, materialProps, sameMaterialProps, type MaterialProps,
} from './materials';
import { END_MILL_RADII, integralSpecOf } from './integral';
import { checkMotor, K1_MAX, K1_MIN, recommendRatio, rescaleEForZp, type MotorSpec } from './motor';
import { now, runAsync, runSync, type RunHooks } from './runner';
import { REAMED_HOLE_PLAY, analyzeTolerance, fitClearances, matchProcess, processPreset, processSpec, ringTolOf, tighterProcesses, toleranceOf } from './tolerance';
import { resolveKc, withResolvedKc } from './toleranceKc';
import type { CheckId, CheckStatus, GearboxInputs, GearboxResult, InnerPinSupport } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Input paths a fix can change (the UI highlights the matching field). */
export type FixField =
  | 'D' | 'e' | 'L' | 'discs' | 'rr' | 'rw' | 'Zw' | 'bearing' | 'discMaterial' | 'innerPinSupport'
  | 'outerPin.material' | 'outerPin.boltYield' | 'innerPin.material' | 'Zp'
  | 'outerPin.housingMaterial' | 'outerPin.toolRadius'
  /** A tighter machining process (only with "use tolerance Kc" on): the tolerance spec of the next better preset */
  | 'tolerance';

export const FIX_FIELDS: readonly FixField[] = [
  'D', 'e', 'L', 'discs', 'rr', 'rw', 'Zw', 'bearing', 'discMaterial', 'innerPinSupport',
  'outerPin.material', 'outerPin.boltYield', 'innerPin.material', 'Zp',
  'outerPin.housingMaterial', 'outerPin.toolRadius', 'tolerance',
];

/** A gearbox check, or 'motor' (the motor torque / speed through the gearbox ratio). */
export type FixCheckId = CheckId | 'motor';

export interface FixOptions {
  /** Every check must end at or under this utilization. Default 0.85 (green), clamped to 0.5..1.0. */
  target?: number;
  /** Motor of a cycloidal joint: adds the motor check and the "use the recommended ratio" fix. */
  motor?: MotorSpec | null;
  /** Largest pin circle the D search goes to (when D is below it). Default 150 mm (the advisor's Dmax). */
  Dmax?: number;
  /** Search resolution. Defaults 1500 / 120 (the advisor's). */
  npfCoarse?: number;
  nthCoarse?: number;
  /** Verification resolution. Defaults 6000 / 240 (SPEC). */
  npfFull?: number;
  nthFull?: number;
  /**
   * Tolerance Kc of the inputs when `useToleranceKc` is on (the worker client sends the main thread's cached value).
   * The search then runs with these factors held fixed; null / missing = the cache of this thread, else the typed Kc.
   */
  toleranceKc?: { Kc: number; KcLife: number } | null;
  /** Monte Carlo trials for the tighter-process fixes (default 200) */
  processTrials?: number;
}

export interface Fix {
  field: FixField;
  /** Name of the variable, e.g. "Pin circle D" */
  label: string;
  direction: 'up' | 'down' | 'change';
  /** Display values, metric (mm, N, MPa): the UI localizes them */
  from: string;
  to: string;
  /** Numeric values (mm) for D, e, L; the count for discs, Zw and Zp; null for a choice */
  fromValue: number | null;
  toValue: number | null;
  /** Short button text, e.g. "▲ D → 92 mm", "2 discs", "Disc → Aluminum 7075-T6" */
  short: string;
  /** Max utilization after the change, full resolution (the motor check included when a motor is given) */
  newMaxUtil: number;
  /** The check that governs after the change (label) and its id */
  governing: string;
  governingId: FixCheckId | null;
  passesTarget: boolean;
  /** Every check at or under 1.0 */
  passesLimit: boolean;
  /** Apply with `{ ...inputs, ...patch }`. Coupled fields are included (bearing -> Db, pin size -> rr + shank, ...). */
  patch: Partial<GearboxInputs>;
  /** Plain-language costs: "housing OD 98 → 106 mm", "+42 g disc mass", "K1 0.68 → 0.80" */
  sideEffects: string[];
  /** The checks above the target before the change that this change lowers */
  improves: FixCheckId[];
  /** Utilization after the change of every check that was above the target before it */
  checkUtils: Partial<Record<FixCheckId, number>>;
  /** Disc thickness only: the exact minimum thickness that passes, mm (null when none does) */
  exactMin?: number | null;
  /** Ranking cost (relative change + housing / width added + half the disc mass added); lower is better */
  cost: number;
}

export interface FixCheckEntry {
  id: FixCheckId;
  label: string;
  utilization: number;
  status: CheckStatus;
  /** Every field whose change lowered this check (also ones that do not fix everything) */
  fields: FixField[];
  /** Indices into `fixes` that lower this check, best first (passing fixes first, then by this check's new value) */
  fixes: number[];
}

export interface FixReport {
  valid: boolean;
  cancelled: boolean;
  errors: string[];
  target: number;
  /** Some check is above the target */
  needed: boolean;
  /** Current max utilization (full resolution, motor included) and what governs it */
  maxUtil: number;
  governing: string;
  governingId: FixCheckId | null;
  /** Motor check utilization (null without a usable motor) */
  motorUtil: number | null;
  /** Ranked: fixes that pass the target first (cheapest first), then the ones that only help (lowest result first) */
  fixes: Fix[];
  /** One entry per check above the target */
  byCheck: FixCheckEntry[];
  /** checkGearbox calls (coarse + full) */
  evaluated: number;
  elapsedMs: number;
}

export interface FixProgress { fraction: number; field: FixField | null }

export const MOTOR_CHECK_LABEL = 'Motor torque through the gearbox';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const EPS = 1e-9;
/** A change "helps" a check when it lowers it by at least this fraction. */
const HELP_REL = 0.005;

function trim(v: number, dp: number): string {
  if (!Number.isFinite(v)) return '—';
  return String(parseFloat(v.toFixed(dp)));
}
const mm = (v: number, dp = 2) => `${trim(v, dp)} mm`;
const util2 = (u: number) => (Number.isFinite(u) ? u.toFixed(2) : '—');

function statusOfUtil(u: number): CheckStatus {
  if (!(u <= 1 + EPS)) return 'fail';
  return u <= GREEN_LIMIT + EPS ? 'ok' : 'marginal';
}

const SUPPORT_ORDER: readonly InnerPinSupport[] = ['cantilever', 'ringPinned', 'ringClamped'];
const SUPPORT_NAME: Record<InnerPinSupport, string> = {
  cantilever: 'no tie ring (cantilever)',
  ringPinned: 'tie ring, pins free to rotate',
  ringClamped: 'bolted tie ring',
};
const BOLT_GRADES: readonly { grade: string; yield: number }[] = [
  { grade: '8.8', yield: 640 }, { grade: '10.9', yield: 900 }, { grade: '12.9', yield: 1080 },
];

function materialName(m: MaterialProps): string {
  if (sameMaterialProps(m, SPEC_STEEL)) return 'Steel, generic';
  return MATERIALS.find((x) => sameMaterialProps(m, x))?.name ?? `custom ${m.kind}`;
}

function bearingIndexOf(inp: GearboxInputs): number {
  return BEARINGS.findIndex((b) => b.name === inp.bearing.name && Math.abs(b.OD - inp.Db) < 1e-6);
}

function span(inp: GearboxInputs): number {
  return inp.discs * inp.L + (inp.discs + 1) * inp.gap;
}

interface Eval {
  /** Gearbox max utilization (UTIL_CAP when invalid) */
  gb: number;
  /** Combined with the motor check */
  all: number;
  result: GearboxResult;
  checks: Map<FixCheckId, number>;
}

function clampTarget(t: number | undefined): number {
  const v = fin(t) ? t : GREEN_LIMIT;
  return Math.min(1, Math.max(0.5, v));
}

interface Resolved {
  target: number;
  motor: MotorSpec | null;
  toleranceKc: { Kc: number; KcLife: number } | null | undefined;
  processTrials: number;
  Dmax: number;
  coarse: { npf: number; nth: number };
  full: { npf: number; nth: number };
}

function resolve(o: FixOptions | undefined): Resolved {
  return {
    target: clampTarget(o?.target),
    motor: o?.motor ?? null,
    toleranceKc: o?.toleranceKc,
    processTrials: fin(o?.processTrials) && o!.processTrials! >= 20 ? Math.floor(o!.processTrials!) : 200,
    Dmax: fin(o?.Dmax) && o!.Dmax! > 0 ? o!.Dmax! : ADVISOR_D_MAX,
    coarse: { npf: fin(o?.npfCoarse) ? o!.npfCoarse! : 1500, nth: fin(o?.nthCoarse) ? o!.nthCoarse! : 120 },
    full: { npf: fin(o?.npfFull) ? o!.npfFull! : 6000, nth: fin(o?.nthFull) ? o!.nthFull! : 240 },
  };
}

/** Motor check utilization at a Zp: max(T_des / peak capacity, T_req / continuous capacity); a speed shortfall counts as a fail. */
export function motorUtilization(inp: Pick<GearboxInputs, 'Treq' | 'Tdes'>, motor: MotorSpec | null | undefined, Zp: number): number | null {
  if (!motor) return null;
  const c = checkMotor({ Treq: inp.Treq, Tdes: inp.Tdes }, motor, 'cycloidal', Zp);
  if (c.status !== 'ok' && c.status !== 'short') return null;
  let u = Math.max(c.peakUtil ?? 0, c.contUtil ?? 0);
  if (c.speedOk === false) u = Math.max(u, 1.0001);
  return Number.isFinite(u) ? Math.min(u, UTIL_CAP) : UTIL_CAP;
}

// ---------------------------------------------------------------------------
// The search
// ---------------------------------------------------------------------------

interface Candidate {
  field: FixField;
  label: string;
  direction: Fix['direction'];
  from: string;
  to: string;
  fromValue: number | null;
  toValue: number | null;
  short: string;
  patch: Partial<GearboxInputs>;
  /** "change" part of the ranking cost */
  changeCost: number;
  exactMin?: number | null;
}

function* fixGen(inputsIn: GearboxInputs, o: Resolved): Generator<FixProgress, FixReport, void> {
  const t0 = now();
  // "use tolerance Kc": the search holds the tolerance factors of the current design fixed (patches never touch Kc)
  const kcSource = resolveKc(inputsIn, o.toleranceKc).source;
  const inputs = withResolvedKc(inputsIn, o.toleranceKc);
  let evaluated = 0;
  const target = o.target;
  const motor = o.motor;
  const motorAt = (Zp: number) => motorUtilization(inputs, motor, Zp);

  const evalAt = (inp: GearboxInputs, res: { npf: number; nth: number }): Eval => {
    evaluated++;
    const r = checkGearbox(inp, res);
    const checks = new Map<FixCheckId, number>();
    for (const c of r.checks) checks.set(c.id, c.utilization);
    const gb = r.valid ? r.maxUtilization : UTIL_CAP;
    const mu = motorAt(inp.Zp);
    if (mu != null) checks.set('motor', mu);
    return { gb, all: Math.max(gb, mu ?? 0), result: r, checks };
  };
  const coarse = (inp: GearboxInputs) => evalAt(inp, o.coarse);
  const full = (inp: GearboxInputs) => evalAt(inp, o.full);
  const passF = (inp: GearboxInputs) => full(inp).gb <= target + EPS;

  const base = full(inputs);
  const r0 = base.result;
  const motorUtil = motorAt(inputs.Zp);
  const empty = (errors: string[], valid: boolean): FixReport => ({
    valid, cancelled: false, errors, target, needed: false, maxUtil: valid ? base.all : UTIL_CAP,
    governing: '', governingId: null, motorUtil, fixes: [], byCheck: [], evaluated, elapsedMs: now() - t0,
  });
  if (!r0.valid) return empty(r0.errors.length ? r0.errors : ['The inputs cannot be computed.'], false);

  // current state: governing (motor included) and the failing checks
  const labels = new Map<FixCheckId, string>();
  for (const c of r0.checks) labels.set(c.id, c.label);
  labels.set('motor', MOTOR_CHECK_LABEL);
  let govId: FixCheckId | null = r0.governing?.id ?? null;
  if (motorUtil != null && motorUtil > r0.maxUtilization) govId = 'motor';
  const failing: FixCheckId[] = [];
  for (const [id, u] of base.checks) if (u > target + EPS) failing.push(id);
  failing.sort((a, b) => (base.checks.get(b)! - base.checks.get(a)!));
  const report: FixReport = {
    valid: true, cancelled: false, errors: [], target, needed: failing.length > 0, maxUtil: base.all,
    governing: govId ? labels.get(govId) ?? '' : '', governingId: govId, motorUtil, fixes: [], byCheck: [],
    evaluated, elapsedMs: 0,
  };
  if (!failing.length) { report.evaluated = evaluated; report.elapsedMs = now() - t0; return report; }

  const coarseBase = coarse(inputs);
  /** per field: the lowest coarse utilization seen for each failing check */
  const seen = new Map<FixField, Map<FixCheckId, number>>();
  const note = (field: FixField, e: Eval) => {
    let m = seen.get(field);
    if (!m) { m = new Map(); seen.set(field, m); }
    for (const id of failing) {
      const v = e.checks.get(id);
      if (v == null) continue;
      const prev = m.get(id);
      if (prev == null || v < prev) m.set(id, v);
    }
  };
  const fixes: Fix[] = [];

  const finish = (cand: Candidate, at: GearboxInputs): Fix | null => {
    const e = full(at);
    if (!e.result.valid) return null;
    const improves: FixCheckId[] = [];
    const checkUtils: Partial<Record<FixCheckId, number>> = {};
    for (const id of failing) {
      const before = base.checks.get(id)!;
      const after = e.checks.get(id);
      if (after == null) continue;
      checkUtils[id] = after;
      if (after < before * (1 - HELP_REL)) improves.push(id);
    }
    if (!(e.all < base.all * (1 - HELP_REL)) && !improves.length) return null;
    let gov: FixCheckId | null = e.result.governing?.id ?? null;
    const mu = e.checks.get('motor');
    if (mu != null && mu > e.result.maxUtilization) gov = 'motor';
    const d0 = r0.derived, d1 = e.result.derived;
    const side: string[] = [];
    if (Math.abs(d1.housingOD - d0.housingOD) > 0.05) side.push(`housing OD ${trim(d0.housingOD, 1)} → ${trim(d1.housingOD, 1)} mm`);
    const dm = e.result.mass.total_g - r0.mass.total_g;
    if (Math.abs(dm) >= 0.5) side.push(`${dm > 0 ? '+' : '−'}${trim(Math.abs(dm), 0)} g disc mass`);
    if (Math.abs(d1.K1 - d0.K1) > 0.005) side.push(`K1 ${d0.K1.toFixed(2)} → ${d1.K1.toFixed(2)}`);
    const s0 = span(inputs), s1 = span(at);
    if (Math.abs(s1 - s0) > 0.01) side.push(`disc stack ${trim(s0, 2)} → ${trim(s1, 2)} mm wide`);
    if (Math.abs(d1.Rw - d0.Rw) > 0.05 && (cand.field === 'rw' || cand.field === 'Zw' || cand.field === 'bearing')) {
      side.push(`inner pin circle radius ${trim(d0.Rw, 1)} → ${trim(d1.Rw, 1)} mm`);
    }
    if (at.discMaterial.kind === 'polymer' && inputs.discMaterial.kind !== 'polymer') side.push('polymer disc: creep and heat warnings apply');
    if (gov !== govId && gov) side.push(`now limited by ${(labels.get(gov) ?? '').toLowerCase()} (${util2(e.all)})`);
    const sizeCost = Math.max(0, d1.housingOD - d0.housingOD) / d0.housingOD + Math.max(0, s1 - s0) / s0;
    const massCost = r0.mass.total_g > 0 ? Math.max(0, dm) / r0.mass.total_g : 0;
    return {
      field: cand.field, label: cand.label, direction: cand.direction, from: cand.from, to: cand.to,
      fromValue: cand.fromValue, toValue: cand.toValue, short: cand.short,
      newMaxUtil: e.all, governing: gov ? labels.get(gov) ?? '' : '', governingId: gov,
      passesTarget: e.all <= target + EPS, passesLimit: e.all <= 1 + EPS,
      patch: cand.patch, sideEffects: side, improves, checkUtils,
      ...(cand.exactMin !== undefined ? { exactMin: cand.exactMin } : {}),
      cost: cand.changeCost + sizeCost + 0.5 * massCost,
    };
  };

  /** With no value under the target: the "helps" pick among scanned / listed utilizations (index order = size of change). */
  const helpPick = (pts: { k: number; u: number }[]): { k: number; passes: false } | null => {
    if (!pts.length) return null;
    const best = Math.min(...pts.map((p) => p.u));
    if (!(best < coarseBase.gb * (1 - HELP_REL))) return null;
    // the smallest change that gets every check to <= 1.0, else the smallest one with 75% of the best improvement
    const lim = pts.filter((p) => p.u <= 1 + EPS).sort((a, b) => a.k - b.k)[0];
    if (lim) return { k: lim.k, passes: false };
    const enough = coarseBase.gb - 0.75 * (coarseBase.gb - best);
    const k = pts.filter((p) => p.u <= enough + EPS).sort((a, b) => a.k - b.k)[0]?.k;
    return k == null ? null : { k, passes: false };
  };

  /** Bisect an ordered grid for the first index whose coarse utilization is <= thr, between lo (fails, or -1) and hi (passes). */
  const bisect = (lo: number, hi: number, at: (k: number) => GearboxInputs, thr: number): number => {
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (coarse(at(mid)).gb <= thr + EPS) hi = mid; else lo = mid;
    }
    return hi;
  };

  /**
   * Smallest index on an ordered grid of candidates (0 = closest to the current value) that passes the target.
   * The grid is scanned at `stride`, then bisected between the last failing scan point and the first passing one
   * (coarse), then adjusted at full resolution so that the chosen value passes and the one before it fails.
   * With no passing point: the smallest change that gets under 1.0 (bisected the same way), else see helpPick.
   */
  const gridSearch = (n: number, at: (k: number) => GearboxInputs, field: FixField, stride: number): { k: number; passes: boolean } | null => {
    if (n <= 0) return null;
    const scan: number[] = [];
    for (let k = stride - 1; k < n; k += stride) scan.push(k);
    if (scan[scan.length - 1] !== n - 1) scan.push(n - 1);
    let firstPass = -1, prevFail = -1;
    const pts: { k: number; u: number }[] = [];
    for (const k of scan) {
      const e = coarse(at(k));
      note(field, e);
      pts.push({ k, u: e.gb });
      if (e.gb <= target + EPS) { firstPass = k; break; }
      prevFail = k;
    }
    if (firstPass >= 0) {
      let k = bisect(prevFail, firstPass, at, target);
      let steps = 0;
      while (!passF(at(k)) && k < n - 1 && steps < 12) { k++; steps++; }
      if (passF(at(k))) {
        while (k > 0 && passF(at(k - 1))) k--;
        return { k, passes: true };
      }
    }
    const h = helpPick(pts);
    if (h && pts.find((p) => p.k === h.k)!.u <= 1 + EPS) {
      // refine the "gets under 1.0" point the same way (coarse only: it is reported as helping, not as a fix)
      const i = pts.findIndex((p) => p.k === h.k);
      return { k: bisect(i > 0 ? pts[i - 1].k : -1, h.k, at, 1), passes: false };
    }
    return h;
  };

  /** First candidate of an ordered list that passes (coarse, then confirmed at full resolution and walked back). */
  const listSearch = (cands: GearboxInputs[], field: FixField): { k: number; passes: boolean } | null => {
    if (!cands.length) return null;
    const pts: { k: number; u: number }[] = [];
    let first = -1;
    for (let k = 0; k < cands.length; k++) {
      const e = coarse(cands[k]);
      note(field, e);
      pts.push({ k, u: e.gb });
      if (first < 0 && e.gb <= target + EPS) first = k;
    }
    if (first >= 0) {
      let k = first;
      while (k < cands.length && !passF(cands[k])) k++;
      if (k < cands.length) {
        while (k > 0 && passF(cands[k - 1])) k--;
        return { k, passes: true };
      }
    }
    return helpPick(pts);
  };

  /** Unordered alternatives: evaluate all, take the cheapest passing one (by `rank`), else see helpPick (in rank order). */
  const pickSearch = (cands: GearboxInputs[], field: FixField, rank: (k: number) => number): { k: number; passes: boolean } | null => {
    if (!cands.length) return null;
    const utils = cands.map((c) => { const e = coarse(c); note(field, e); return e.gb; });
    const order = cands.map((_, k) => k).sort((a, b) => rank(a) - rank(b) || utils[a] - utils[b] || a - b);
    for (const k of order) if (utils[k] <= target + EPS && passF(cands[k])) return { k, passes: true };
    const h = helpPick(order.map((k, i) => ({ k: i, u: utils[k] })));
    return h ? { k: order[h.k], passes: false } : null;
  };

  const push = (f: Fix | null) => { if (f) fixes.push(f); };
  const gbFails = r0.maxUtilization > target + EPS;
  const steps = 14;
  let step = 0;
  const progress = (field: FixField | null): FixProgress => ({ fraction: Math.min(1, ++step / steps), field });

  if (gbFails) {
    // ---------------------------------------------------------------- D up (0.5 mm grid)
    {
      const D = inputs.D;
      const hi = D < o.Dmax ? Math.min(2 * D, o.Dmax) : 2 * D;
      const k0 = Math.floor(D / 0.5 + 1e-9) + 1;
      const n = Math.max(0, Math.floor(hi / 0.5 + 1e-9) - k0 + 1);
      // e grows with D so the lobe shape (K1) stays: e = K1 * (D / 2) / Zp, K1 clamped to 0.40..0.85 (as rescaleEForZp)
      const K1now = (inputs.e * inputs.Zp) / (D / 2);
      const K1 = Math.min(K1_MAX, Math.max(K1_MIN, Number.isFinite(K1now) ? K1now : K1_MIN));
      const eFor = (Dv: number) => Math.round(((K1 * Dv) / 2 / inputs.Zp) * 1e4) / 1e4;
      const at = (k: number) => ({ ...inputs, D: (k0 + k) * 0.5, e: eFor((k0 + k) * 0.5) });
      const r = gridSearch(n, at, 'D', Math.max(1, Math.ceil(n / 16)));
      if (r) {
        const v = (k0 + r.k) * 0.5;
        const ev = eFor(v);
        const f = finish({
          field: 'D', label: 'Pin circle D', direction: 'up', from: mm(D, 2), to: mm(v, 1), fromValue: D, toValue: v,
          short: `▲ D → ${mm(v, 1)}`, patch: { D: v, e: ev }, changeCost: 0.5 * (v - D) / D,
        }, at(r.k));
        if (f) {
          f.sideEffects.unshift(`D ${trim(D, 2)} → ${trim(v, 1)} mm, e ${trim(inputs.e, 3)} → ${trim(ev, 3)} mm to keep K1 ${K1.toFixed(2)}`);
          push(f);
        }
      }
    }
    yield progress('D');

    // ---------------------------------------------------------------- e both ways (0.01 mm grid inside K1 0.40..0.85)
    {
      const e = inputs.e, Rp = inputs.D / 2, Zp = inputs.Zp;
      const eMin = Math.ceil((K1_MIN * Rp) / Zp / 0.01 - 1e-9) * 0.01;
      const eMax = Math.floor((K1_MAX * Rp) / Zp / 0.01 + 1e-9) * 0.01;
      const strideE = Math.max(1, Math.round((0.025 * Rp) / Zp / 0.01));
      const r2 = (x: number) => Math.round(x * 100) / 100;
      const found: Fix[] = [];
      for (const dir of [1, -1] as const) {
        let kStart: number, n: number;
        if (dir === 1) {
          kStart = Math.max(Math.floor(e / 0.01 + 1e-9) + 1, Math.round(eMin / 0.01));
          n = Math.max(0, Math.round(eMax / 0.01) - kStart + 1);
        } else {
          kStart = Math.min(Math.ceil(e / 0.01 - 1e-9) - 1, Math.round(eMax / 0.01));
          n = Math.max(0, kStart - Math.round(eMin / 0.01) + 1);
        }
        const val = (k: number) => r2((kStart + dir * k) * 0.01);
        const at = (k: number) => ({ ...inputs, e: val(k) });
        const r = gridSearch(n, at, 'e', strideE);
        if (!r) continue;
        const v = val(r.k);
        const f = finish({
          field: 'e', label: 'Eccentricity e', direction: dir === 1 ? 'up' : 'down', from: mm(e, 3), to: mm(v, 3),
          fromValue: e, toValue: v, short: `${dir === 1 ? '▲' : '▼'} e → ${mm(v, 2)}`, patch: { e: v },
          changeCost: 0.5 * Math.abs(v - e) / e,
        }, at(r.k));
        if (f) found.push(f);
      }
      // report the direction that works (the better one when both or neither pass)
      found.sort((a, b) => Number(b.passesTarget) - Number(a.passesTarget) || (a.passesTarget ? a.cost - b.cost : a.newMaxUtil - b.newMaxUtil));
      if (found.length) push(found[0]);
    }
    yield progress('e');

    // ---------------------------------------------------------------- L up: next stock size and the exact minimum
    {
      const L = inputs.L;
      const stock = discStockFor(inputs.discMaterial).filter((s) => s > L + 1e-9);
      const stockR = listSearch(stock.map((s) => ({ ...inputs, L: s })), 'L');
      // exact minimum on a 0.05 mm grid up to the passing stock size (or max(2L, largest stock) when none passes)
      const top = stockR?.passes ? stock[stockR.k] : Math.max(2 * L, ...discStockFor(inputs.discMaterial));
      const k0 = Math.floor(L / 0.05 + 1e-9) + 1;
      const n = Math.max(0, Math.floor(top / 0.05 + 1e-9) - k0 + 1);
      const valL = (k: number) => Math.round((k0 + k) * 0.05 * 100) / 100;
      const exact = gridSearch(n, (k) => ({ ...inputs, L: valL(k) }), 'L', Math.max(1, Math.ceil(n / 12)));
      const exactMin = exact?.passes ? valL(exact.k) : null;
      let v: number | null = null;
      if (stockR?.passes) v = stock[stockR.k];
      else if (exactMin != null) v = exactMin;
      else if (stockR) v = stock[stockR.k];
      else if (exact) v = valL(exact.k);
      if (v != null) {
        const isStock = stock.some((s) => Math.abs(s - v!) < 1e-9);
        push(finish({
          field: 'L', label: 'Disc thickness L', direction: 'up', from: mm(L, 3), to: mm(v, 3), fromValue: L, toValue: v,
          short: `▲ L → ${mm(v, 3)}${isStock ? '' : ' (custom)'}`, patch: { L: v }, changeCost: 0.5 * (v - L) / L, exactMin,
        }, { ...inputs, L: v }));
      }
    }
    yield progress('L');

    // ---------------------------------------------------------------- discs 1 -> 2
    if (inputs.discs === 1) {
      const at = { ...inputs, discs: 2 };
      note('discs', coarse(at));
      push(finish({
        field: 'discs', label: 'Number of discs', direction: 'up', from: '1', to: '2', fromValue: 1, toValue: 2,
        short: '2 discs', patch: { discs: 2 }, changeCost: 0.3,
      }, at));
    }
    yield progress('discs');

    // ---------------------------------------------------------------- integral ring: tooth radius both ways (0.25 mm grid)
    const integral = inputs.outerPin.construction === 'integral';
    if (integral) {
      const rr = inputs.rr;
      const found: Fix[] = [];
      for (const dir of [1, -1] as const) {
        const lo = 1, hi = Math.max(8, rr);
        const k0 = dir === 1 ? Math.floor(rr / 0.25 + 1e-9) + 1 : Math.ceil(rr / 0.25 - 1e-9) - 1;
        const n = dir === 1 ? Math.max(0, Math.floor(hi / 0.25 + 1e-9) - k0 + 1) : Math.max(0, k0 - Math.ceil(lo / 0.25 - 1e-9) + 1);
        const val = (k: number) => Math.round((k0 + dir * k) * 0.25 * 100) / 100;
        const at = (k: number) => ({ ...inputs, rr: val(k) });
        const r = gridSearch(n, at, 'rr', 2);
        if (!r) continue;
        const v = val(r.k);
        const f = finish({
          field: 'rr', label: 'Tooth radius rr', direction: dir === 1 ? 'up' : 'down', from: mm(rr, 2), to: mm(v, 2),
          fromValue: rr, toValue: v, short: `${dir === 1 ? '▲' : '▼'} teeth rr → ${mm(v, 2)}`, patch: { rr: v },
          changeCost: 0.25 * Math.abs(v - rr) / rr,
        }, at(r.k));
        if (f) found.push(f);
      }
      found.sort((a, b) => Number(b.passesTarget) - Number(a.passesTarget) || (a.passesTarget ? a.cost - b.cost : a.newMaxUtil - b.newMaxUtil));
      if (found.length) push(found[0]);
    }

    // ---------------------------------------------------------------- shoulder bolt size up (catalog, same unit system)
    const shoulder = inputs.outerPin.construction === 'shoulderBolt';
    if (shoulder) {
      const curSb = shoulderBoltFor(inputs.rr);
      const opts = shoulderBoltsOf(curSb?.system ?? 'metric').filter((p) => p.dia > 2 * inputs.rr + 1e-9);
      const r = listSearch(opts.map((p) => ({ ...inputs, rr: p.dia / 2 })), 'rr');
      if (r) {
        const p = opts[r.k];
        push(finish({
          field: 'rr', label: 'Shoulder bolt size', direction: 'up',
          from: curSb ? `${curSb.label} shoulder (${curSb.thread})` : `${mm(2 * inputs.rr)} shoulder`, to: `${p.label} shoulder (${p.thread})`,
          fromValue: 2 * inputs.rr, toValue: p.dia,
          short: `▲ shoulder bolts → ${p.label} (${p.thread})`, patch: { rr: p.dia / 2 },
          changeCost: 0.25 + 0.25 * (p.dia - 2 * inputs.rr) / (2 * inputs.rr),
        }, { ...inputs, rr: p.dia / 2 }));
      }
    }

    // ---------------------------------------------------------------- outer pin size up (catalog)
    if (!integral && !shoulder) {
      const opts = OUTER_PIN_OPTIONS.filter((p) => p.od > 2 * inputs.rr + 1e-9);
      const bolt = inputs.outerPin.construction === 'boltBushing';
      const patchOf = (p: (typeof OUTER_PIN_OPTIONS)[number]): Partial<GearboxInputs> => ({
        rr: p.od / 2, outerPin: { ...inputs.outerPin, shankDia: bolt ? p.shank : inputs.outerPin.shankDia },
      });
      const r = listSearch(opts.map((p) => ({ ...inputs, ...patchOf(p) })), 'rr');
      if (r) {
        const p = opts[r.k];
        const name = bolt ? `${p.bolt} bolt, ${p.od} mm bushing` : `${p.od} mm pin`;
        push(finish({
          field: 'rr', label: bolt ? 'Outer bolt and bushing' : 'Outer pin size', direction: 'up',
          from: bolt ? `${mm(2 * inputs.rr)} bushing` : mm(2 * inputs.rr), to: name, fromValue: 2 * inputs.rr, toValue: p.od,
          short: `▲ outer pins → ${bolt ? `${p.bolt} / ${p.od} mm` : `${p.od} mm`}`, patch: patchOf(p),
          changeCost: 0.25 + 0.25 * (p.od - 2 * inputs.rr) / (2 * inputs.rr),
        }, { ...inputs, ...patchOf(p) }));
      }
    }
    yield progress('rr');

    // ---------------------------------------------------------------- inner pin size up (catalog)
    {
      const opts = INNER_PIN_OPTIONS.filter((p) => p.od > 2 * inputs.rw + 1e-9);
      const so = inputs.innerPin.construction === 'standoff';
      const patchOf = (p: (typeof INNER_PIN_OPTIONS)[number]): Partial<GearboxInputs> => ({
        rw: p.od / 2,
        innerPin: { ...inputs.innerPin, od: so ? p.od : inputs.innerPin.od, bore: so ? p.bore : inputs.innerPin.bore },
      });
      const r = listSearch(opts.map((p) => ({ ...inputs, ...patchOf(p) })), 'rw');
      if (r) {
        const p = opts[r.k];
        const name = so ? `${p.thread} standoff, ${p.od} mm OD` : `${p.od} mm pin`;
        push(finish({
          field: 'rw', label: so ? 'Inner standoff size' : 'Inner pin size', direction: 'up',
          from: mm(2 * inputs.rw), to: name, fromValue: 2 * inputs.rw, toValue: p.od,
          short: `▲ inner pins → ${so ? `${p.thread} / ${p.od} mm` : `${p.od} mm`}`, patch: patchOf(p),
          changeCost: 0.25 + 0.25 * (p.od - 2 * inputs.rw) / (2 * inputs.rw),
        }, { ...inputs, ...patchOf(p) }));
      }
    }
    yield progress('rw');

    // ---------------------------------------------------------------- Zw both ways (nearest first)
    {
      const zws = ZW_OPTIONS.filter((z) => z !== inputs.Zw)
        .sort((a, b) => Math.abs(a - inputs.Zw) - Math.abs(b - inputs.Zw) || b - a);
      const cands = zws.map((z) => ({ ...inputs, Zw: z }));
      const r = pickSearch(cands, 'Zw', (k) => Math.abs(zws[k] - inputs.Zw) * 10 + (zws[k] < inputs.Zw ? 1 : 0));
      if (r) {
        const z = zws[r.k];
        push(finish({
          field: 'Zw', label: 'Inner pin count Zw', direction: z > inputs.Zw ? 'up' : 'down', from: String(inputs.Zw), to: String(z),
          fromValue: inputs.Zw, toValue: z, short: `${z > inputs.Zw ? '▲' : '▼'} Zw → ${z}`, patch: { Zw: z },
          changeCost: 0.15 * Math.abs(z - inputs.Zw),
        }, cands[r.k]));
      }
    }
    yield progress('Zw');

    // ---------------------------------------------------------------- bearing (every catalog entry)
    {
      const cur = bearingIndexOf(inputs);
      const idx = BEARINGS.map((_, i) => i).filter((i) => i !== cur);
      const patchOf = (i: number): Partial<GearboxInputs> => ({ bearing: { name: BEARINGS[i].name, C: BEARINGS[i].C, C0: BEARINGS[i].C0 }, Db: BEARINGS[i].OD });
      const cands = idx.map((i) => ({ ...inputs, ...patchOf(i) }));
      // smallest change of the centre bore first, then the smaller bearing
      const r = pickSearch(cands, 'bearing', (k) => Math.abs(BEARINGS[idx[k]].OD - inputs.Db) * 100 + BEARINGS[idx[k]].OD);
      if (r) {
        const b = BEARINGS[idx[r.k]];
        const dir: Fix['direction'] = b.OD > inputs.Db + 1e-9 ? 'up' : b.OD < inputs.Db - 1e-9 ? 'down' : 'change';
        push(finish({
          field: 'bearing', label: 'Eccentric bearing', direction: dir, from: inputs.bearing.name,
          to: `${b.name} (${b.bore}×${b.OD}×${b.width} mm)`, fromValue: inputs.Db, toValue: b.OD,
          short: `Bearing → ${b.name}`, patch: patchOf(idx[r.k]),
          changeCost: 0.25 + 0.5 * Math.abs(b.OD - inputs.Db) / Math.max(1, inputs.Db),
        }, cands[r.k]));
      }
    }
    yield progress('bearing');

    // ---------------------------------------------------------------- disc material (stronger library materials)
    {
      const m = inputs.discMaterial;
      const lib = MATERIALS.filter((x) => !sameMaterialProps(materialProps(x.id), m) &&
        x.Sy >= m.Sy && x.sigmaF >= m.sigmaF && (x.Sy > m.Sy || x.sigmaF > m.sigmaF));
      const cands = lib.map((x) => ({ ...inputs, discMaterial: materialProps(x.id) }));
      const r = pickSearch(cands, 'discMaterial', (k) => lib[k].density * 10 + lib[k].Sy / 1000);
      if (r) {
        const x = lib[r.k];
        push(finish({
          field: 'discMaterial', label: 'Disc material', direction: 'change', from: materialName(m), to: x.name,
          fromValue: null, toValue: null, short: `Disc → ${x.name}`, patch: { discMaterial: materialProps(x.id) },
          changeCost: 0.4,
        }, cands[r.k]));
      }
    }
    yield progress('discMaterial');

    // ---------------------------------------------------------------- inner pin support (stronger models)
    {
      const cur = innerPinSupportOf(inputs);
      const better = SUPPORT_ORDER.slice(SUPPORT_ORDER.indexOf(cur) + 1);
      const cands = better.map((s) => ({ ...inputs, innerPinSupport: s }));
      const r = listSearch(cands, 'innerPinSupport');
      if (r) {
        const s = better[r.k];
        push(finish({
          field: 'innerPinSupport', label: 'Inner pin support', direction: 'change', from: SUPPORT_NAME[cur], to: SUPPORT_NAME[s],
          fromValue: null, toValue: null, short: `Support → ${SUPPORT_NAME[s]}`, patch: { innerPinSupport: s }, changeCost: 0.3,
        }, cands[r.k]));
      }
    }
    yield progress('innerPinSupport');

    // ---------------------------------------------------------------- pins: material / bolt grade (only for a pin check)
    const gov = r0.governing?.id;
    const outerGov = gov === 'boltBending' || gov === 'ringContactStrength' || gov === 'ringContactLife';
    const innerGov = gov === 'standoffBending' || gov === 'innerContactStrength' || gov === 'innerContactLife';
    const toothGov = gov === 'toothRoot' || gov === 'ringContactStrength' || gov === 'ringContactLife';
    if (integral && toothGov) {
      // a stronger housing (contact limits and the tooth root)
      const op = inputs.outerPin;
      const cur = integralSpecOf(op).housingMaterial;
      const lib = MATERIALS.filter((x) => !sameMaterialProps(materialProps(x.id), cur) &&
        x.Sy >= cur.Sy && x.sigmaF >= cur.sigmaF && (x.Sy > cur.Sy || x.sigmaF > cur.sigmaF));
      const cands = lib.map((x) => ({ ...inputs, outerPin: { ...op, housingMaterial: materialProps(x.id) } }));
      const r = pickSearch(cands, 'outerPin.housingMaterial', (k) => lib[k].density * 10 + lib[k].Sy / 1000);
      if (r) {
        const x = lib[r.k];
        push(finish({
          field: 'outerPin.housingMaterial', label: 'Housing material', direction: 'change', from: materialName(cur), to: x.name,
          fromValue: null, toValue: null, short: `Housing → ${x.name}`, patch: { outerPin: { ...op, housingMaterial: materialProps(x.id) } },
          changeCost: 0.4,
        }, cands[r.k]));
      }
    }
    if (integral && failing.includes('toolFillet')) {
      // a smaller end mill: standard radii below the current one (largest first), plus the largest radius that fits
      const op = inputs.outerPin;
      const rt = integralSpecOf(op).toolRadius;
      const maxFit = r0.derived.integral?.maxToolRadius;
      const radii = [...END_MILL_RADII, ...(maxFit != null && Number.isFinite(maxFit) && maxFit > 0.05 ? [maxFit] : [])]
        .filter((x) => x < rt - 1e-9).sort((a, b) => b - a);
      const cands = radii.map((x) => ({ ...inputs, outerPin: { ...op, toolRadius: x } }));
      const r = listSearch(cands, 'outerPin.toolRadius');
      if (r) {
        const x = radii[r.k];
        const std = END_MILL_RADII.some((s) => Math.abs(s - x) < 1e-9);
        push(finish({
          field: 'outerPin.toolRadius', label: 'Tool radius', direction: 'down', from: mm(rt, 3), to: `${mm(x, 3)}${std ? ` (${trim(2 * x, 2)} mm end mill)` : ''}`,
          fromValue: rt, toValue: x, short: `▼ tool → ${mm(x, 2)}`, patch: { outerPin: { ...op, toolRadius: x } },
          changeCost: 0.1,
        }, cands[r.k]));
      }
    }
    if (outerGov && !integral) {
      const op = inputs.outerPin;
      if (op.construction === 'boltBushing') {
        const grades = BOLT_GRADES.filter((g) => g.yield > op.boltYield + 1e-9);
        const cands = grades.map((g) => ({ ...inputs, outerPin: { ...op, boltYield: g.yield } }));
        const r = listSearch(cands, 'outerPin.boltYield');
        if (r) {
          const g = grades[r.k];
          const curG = BOLT_GRADES.find((x) => Math.abs(x.yield - op.boltYield) < 1e-9);
          push(finish({
            field: 'outerPin.boltYield', label: 'Bolt grade', direction: 'up',
            from: curG ? `class ${curG.grade}` : `${trim(op.boltYield, 0)} MPa yield`, to: `class ${g.grade} (${g.yield} MPa yield)`,
            fromValue: op.boltYield, toValue: g.yield, short: `Bolts → class ${g.grade}`, patch: { outerPin: { ...op, boltYield: g.yield } },
            changeCost: 0.2,
          }, cands[r.k]));
        }
      }
      // bushing (contact only) or solid pin (contact + bending) material; plastic pins only for a plastic disc.
      // A shoulder bolt's steel is fixed: no material fix.
      const plasticOk = inputs.discMaterial.kind === 'polymer';
      const lib = op.construction === 'shoulderBolt' ? [] : [SPEC_STEEL, ...MATERIALS.map((x) => materialProps(x.id))]
        .filter((x) => !sameMaterialProps(x, op.material) && (plasticOk || x.E >= 150000));
      const cands = lib.map((x) => ({ ...inputs, outerPin: { ...op, material: x } }));
      const r = pickSearch(cands, 'outerPin.material', (k) => lib[k].Sy);
      if (r) {
        const x = lib[r.k];
        push(finish({
          field: 'outerPin.material', label: op.construction === 'solid' ? 'Outer pin material' : 'Bushing material', direction: 'change',
          from: materialName(op.material), to: materialName(x), fromValue: null, toValue: null,
          short: `${op.construction === 'solid' ? 'Outer pins' : 'Bushings'} → ${materialName(x)}`, patch: { outerPin: { ...op, material: x } },
          changeCost: 0.25,
        }, cands[r.k]));
      }
    }
    if (innerGov) {
      const ip = inputs.innerPin;
      let lib: { props: MaterialProps; yieldTo: number | null }[];
      if (ip.construction === 'standoff') {
        // a standoff of a stronger steel: its yield (bending) and its contact props
        lib = (['steel-1018', 'steel-4140'] as const).map((id) => materialProps(id))
          .filter((x) => x.Sy > ip.standoffYield + 1e-9).map((props) => ({ props, yieldTo: props.Sy }));
      } else {
        const plasticOk = inputs.discMaterial.kind === 'polymer';
        lib = MATERIALS.map((x) => materialProps(x.id)).filter((x) => !sameMaterialProps(x, ip.material) && (plasticOk || x.E >= 150000))
          .map((props) => ({ props, yieldTo: null }));
      }
      const patchOf = (k: number): Partial<GearboxInputs> => ({
        innerPin: { ...ip, material: lib[k].props, ...(lib[k].yieldTo != null ? { standoffYield: lib[k].yieldTo! } : {}) },
      });
      const cands = lib.map((_, k) => ({ ...inputs, ...patchOf(k) }));
      const r = pickSearch(cands, 'innerPin.material', (k) => lib[k].props.Sy);
      if (r) {
        const x = lib[r.k];
        const so = ip.construction === 'standoff';
        push(finish({
          field: 'innerPin.material', label: so ? 'Standoff material' : 'Inner pin material', direction: 'change',
          from: so ? `${trim(ip.standoffYield, 0)} MPa yield` : materialName(ip.material),
          to: so ? `${materialName(x.props)} (${trim(x.props.Sy, 0)} MPa yield)` : materialName(x.props),
          fromValue: null, toValue: null, short: `${so ? 'Standoffs' : 'Inner pins'} → ${materialName(x.props)}`, patch: patchOf(r.k),
          changeCost: 0.25,
        }, cands[r.k]));
      }
    }
    yield progress('outerPin.material');

    // ---------------------------------------------------------------- tighter machining process (tolerance Kc only)
    // The next better process presets, nearest first: each candidate's Kc is its own Monte Carlo p95 (the hole play the
    // user chose is kept). Offered only when the checks run on the tolerance Kc.
    if (kcSource === 'tolerance') {
      const cur = toleranceOf(inputsIn);
      const integralRing = ringTolOf(inputsIn);
      const presets = tighterProcesses(cur);
      // each with its own fitted clearances, keeping the user's hole fit (reamed or not)
      const specs = presets.map((pp) => fitClearances(inputsIn, processSpec(pp.id, { integral: integralRing, holePlay: cur.holePlay, keep: cur })));
      const cands: GearboxInputs[] = [];
      const keep: number[] = [];
      specs.forEach((t, k) => {
        const tr = analyzeTolerance({ ...inputsIn, tolerance: t }, { trials: o.processTrials, sensitivity: false });
        if (!tr.valid || !(tr.kc.strength.p95 > 0) || !(tr.kc.life.p95 > 0)) return;
        cands.push({ ...inputs, tolerance: t, Kc: tr.kc.strength.p95, KcLife: tr.kc.life.p95 });
        keep.push(k);
      });
      const r = listSearch(cands, 'tolerance');
      if (r) {
        const pp = presets[keep[r.k]];
        const curId = matchProcess(cur, integralRing);
        const f = finish({
          field: 'tolerance', label: 'Machining process', direction: 'change',
          from: curId ? processPreset(curId).label : 'custom tolerances', to: pp.label, fromValue: null, toValue: null,
          short: `Process → ${pp.label}`, patch: { tolerance: specs[keep[r.k]] }, changeCost: 0.5,
        }, cands[r.k]);
        if (f) {
          f.sideEffects.unshift(`tolerance Kc ${inputs.Kc.toFixed(2)} → ${cands[r.k].Kc.toFixed(2)} (p95)`);
          push(f);
        }
      }
      // reamed / dowel-fit outer pin holes (the hole play usually dominates the spread of the pin gaps)
      if (inputsIn.outerPin.construction !== 'integral' && cur.holePlay > REAMED_HOLE_PLAY + 1e-9) {
        // a preset's clearances are re-fitted to the smaller stack; custom clearances are kept
        const pid = matchProcess(cur, integralRing, cur.fitMode === 'statistical' ? fitClearances(inputsIn, cur) : null);
        const t = pid ? fitClearances(inputsIn, processSpec(pid, { integral: integralRing, holePlay: REAMED_HOLE_PLAY, keep: cur })) : { ...cur, holePlay: REAMED_HOLE_PLAY };
        const tr = analyzeTolerance({ ...inputsIn, tolerance: t }, { trials: o.processTrials, sensitivity: false });
        if (tr.valid && tr.kc.strength.p95 > 0 && tr.kc.life.p95 > 0) {
          const at = { ...inputs, tolerance: t, Kc: tr.kc.strength.p95, KcLife: tr.kc.life.p95 };
          note('tolerance', coarse(at));
          const f = finish({
            field: 'tolerance', label: 'Outer pin holes', direction: 'change', from: `${trim(cur.holePlay, 3)} mm hole play`,
            to: 'reamed / dowel fit (0.005 mm)', fromValue: cur.holePlay, toValue: REAMED_HOLE_PLAY,
            short: 'Ream the outer pin holes', patch: { tolerance: t }, changeCost: 0.3,
          }, at);
          if (f) {
            f.sideEffects.unshift(`tolerance Kc ${inputs.Kc.toFixed(2)} → ${at.Kc.toFixed(2)} (p95)`, 'DXF pin holes + 0.01 mm: ream them to size');
            push(f);
          }
        }
      }
    }
  } else {
    step = steps - 1;
  }

  // ---------------------------------------------------------------- ratio: only to fix the motor check
  // The recommended ratio (smallest Zp whose capacity covers the torques, e rescaled to keep K1). It usually leaves the
  // motor between 0.85 and 1.0, so when a slightly higher Zp (inside the motor's speed limit) gets the motor under the
  // target, that one is offered instead, saying how it relates to the recommendation.
  if (motor && motorUtil != null && motorUtil > target + EPS) {
    const rec = recommendRatio({ Treq: inputs.Treq, Tdes: inputs.Tdes }, motor);
    if (rec.Zp != null) {
      let Zp = rec.Zp;
      const zMax = Math.min(60, rec.ratioMax != null ? Math.floor(rec.ratioMax + 1e-9) + 1 : 60);
      for (let z = rec.Zp; z <= zMax; z++) {
        const mu = motorAt(z);
        if (mu != null && mu <= target + EPS) { Zp = z; break; }
      }
      if (Zp !== inputs.Zp) {
        const isRec = Zp === rec.Zp;
        const resc = rescaleEForZp(inputs, Zp);
        const patch: Partial<GearboxInputs> = { Zp, ...(resc && !resc.unchanged ? { e: resc.e } : {}) };
        const at = { ...inputs, ...patch };
        note('Zp', coarse(at));
        const f = finish({
          field: 'Zp', label: 'Gear ratio', direction: Zp > inputs.Zp ? 'up' : 'down',
          from: `${inputs.Zp - 1}:1 (Zp ${inputs.Zp})`, to: `${Zp - 1}:1 (Zp ${Zp})`, fromValue: inputs.Zp, toValue: Zp,
          short: isRec ? `Use the recommended ratio ${Zp - 1}:1` : `Ratio ${Zp - 1}:1 (recommended ${rec.Zp - 1}:1 + margin)`,
          patch, changeCost: 0.3,
        }, at);
        if (f) {
          f.sideEffects.unshift(
            isRec
              ? 'the motor’s recommended ratio; the joint gets slower'
              : `past the motor's recommended ${rec.Zp - 1}:1 so the motor keeps ${Math.round((1 - (motorAt(Zp) ?? 1)) * 100)}% torque margin; the joint gets slower`,
            ...(resc && !resc.unchanged ? [`e ${trim(inputs.e, 3)} → ${trim(resc.e, 3)} mm to keep K1`] : []),
          );
          fixes.push(f);
        }
      }
    }
  }
  yield progress('Zp');

  // ---------------------------------------------------------------- rank, per-check map
  fixes.sort((a, b) => Number(b.passesTarget) - Number(a.passesTarget) ||
    (a.passesTarget ? a.cost - b.cost || a.newMaxUtil - b.newMaxUtil : a.newMaxUtil - b.newMaxUtil || a.cost - b.cost) ||
    FIX_FIELDS.indexOf(a.field) - FIX_FIELDS.indexOf(b.field));
  report.fixes = fixes;
  report.byCheck = failing.map((id) => {
    const before = coarseBase.checks.get(id) ?? base.checks.get(id)!;
    const fields: FixField[] = [];
    for (const f of FIX_FIELDS) {
      const v = seen.get(f)?.get(id);
      if (v != null && v < before * (1 - HELP_REL)) fields.push(f);
    }
    const idx = fixes.map((_, i) => i).filter((i) => fixes[i].improves.includes(id))
      .sort((a, b) => Number(fixes[b].passesTarget) - Number(fixes[a].passesTarget) ||
        (fixes[a].checkUtils[id] ?? 99) - (fixes[b].checkUtils[id] ?? 99) || a - b);
    for (const i of idx) if (!fields.includes(fixes[i].field)) fields.push(fixes[i].field);
    const u = base.checks.get(id)!;
    return { id, label: labels.get(id) ?? id, utilization: u, status: statusOfUtil(u), fields, fixes: idx };
  });
  report.evaluated = evaluated;
  report.elapsedMs = now() - t0;
  return report;
}

function invalidFixReport(errors: string[], target: number): FixReport {
  return {
    valid: false, cancelled: false, errors, target, needed: false, maxUtil: UTIL_CAP, governing: '', governingId: null,
    motorUtil: null, fixes: [], byCheck: [], evaluated: 0, elapsedMs: 0,
  };
}

/** A cancelled run (the worker client resolves a cancelled job with this). */
export function cancelledFixReport(target = GREEN_LIMIT): FixReport {
  return { ...invalidFixReport([], target), cancelled: true };
}

/** Find the smallest single-variable changes that bring every check to <= the target. Never throws. */
export function suggestFixes(inputs: GearboxInputs, opts?: FixOptions, hooks?: RunHooks<FixProgress>): FixReport {
  const o = resolve(opts);
  try {
    return runSync(fixGen(inputs, o), hooks) ?? cancelledFixReport(o.target);
  } catch (err) {
    return invalidFixReport([`Could not search for fixes: ${err instanceof Error ? err.message : String(err)}`], o.target);
  }
}

/** Same, yielding to the event loop between variables (cancellable from the worker). */
export async function suggestFixesAsync(inputs: GearboxInputs, opts?: FixOptions, hooks?: RunHooks<FixProgress>): Promise<FixReport> {
  const o = resolve(opts);
  try {
    return (await runAsync(fixGen(inputs, o), hooks)) ?? cancelledFixReport(o.target);
  } catch (err) {
    return invalidFixReport([`Could not search for fixes: ${err instanceof Error ? err.message : String(err)}`], o.target);
  }
}

/** Apply a fix's patch to a set of inputs (nested pin objects are replaced whole, as the patch holds them complete). */
export function applyFix(inputs: GearboxInputs, fix: Pick<Fix, 'patch'>): GearboxInputs {
  return { ...inputs, ...fix.patch };
}
