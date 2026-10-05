// Design Advisor (CLAUDE.md Addition 3 and Addition 6): recommend a complete gearbox for the given loads and
// materials, optimizing only the variables that are not locked.
//
// Speed comes from scaling laws: ring-contact unit values depend only on (Zp, D, e, rr), so they are
// computed once per candidate geometry at E* = 1, L = 1, T = 1 and rescaled (p0 ~ sqrt(E*/L),
// forces independent of L and E*). Inner-pin forces are closed form; the bearing load reuses the
// per-theta ring force sums with a closed-form inner-pin table. The search runs on a coarse
// resolution; the pick and every alternative are re-verified with the full SPEC.md resolution.
//
// Locks (Addition 6): any variable can be fixed to a value. A locked variable collapses its search
// dimension to one value (returned exactly as given); free variables use the usual ranges. When the locks
// make the target unreachable the advisor returns the `closest` design (lowest maximum utilization within
// the locks) and `relaxHints`: for each lock, the result of re-running the search with only that lock released.

import {
  BEARINGS,
  ADVISOR_D_MAX,
  ADVISOR_D_MIN,
  ADVISOR_K1_MAX,
  ADVISOR_K1_MIN,
  ADVISOR_K1_STEP,
  INNER_PIN_OPTIONS,
  OUTER_PIN_OPTIONS,
  ZP_OPTIONS,
  ZW_OPTIONS,
} from './catalog';
import { bearingUnitLoad, CUSP_RHO, innerForceTable, ringUnit, standoffRingUnit } from './kernel';
import {
  checkGearbox,
  contactLimits,
  validateGearboxInputs,
  DEFAULT_NPF,
  DEFAULT_NTH,
  GEARBOX_MAX,
  innerPinSupportOf,
  UTIL_CAP,
} from './gearbox';
import {
  discStockFor,
  effectiveModulus,
  innerPinBendingLimit,
  innerPinSectionModulus,
  outerPinBendingLimit,
  outerPinSectionModulus,
} from './materials';
import { now, runAsync, runSync, SLICE_MS, type RunHooks } from './runner';
import type { GearboxInputs, GearboxResult } from './types';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** Design variables that can be locked. `Zp` is the gear ratio (ratio = Zp - 1). */
export type AdvisorLockKey = 'Zp' | 'D' | 'e' | 'outerPin' | 'innerPin' | 'Zw' | 'L' | 'discs' | 'bearing';

export const ADVISOR_LOCK_KEYS: readonly AdvisorLockKey[] = [
  'Zp', 'D', 'e', 'outerPin', 'innerPin', 'Zw', 'L', 'discs', 'bearing',
];

/** Outer pin: a catalog entry (index into OUTER_PIN_OPTIONS) or a custom OD (+ bolt shank for bolt + bushing). */
export type OuterPinLock =
  | { kind: 'catalog'; index: number }
  | { kind: 'custom'; od: number; shank: number };

/** Inner pin: a catalog entry (index into INNER_PIN_OPTIONS) or a custom OD / bore (bore used by standoffs only). */
export type InnerPinLock =
  | { kind: 'catalog'; index: number }
  | { kind: 'custom'; od: number; bore: number };

/** Eccentric bearing: a catalog entry (index into BEARINGS) or custom ratings. `bore` (ID) is informational. */
export type BearingLock =
  | { kind: 'catalog'; index: number }
  | { kind: 'custom'; name?: string; bore?: number; OD: number; C: number; C0: number };

/** Every field is optional: present = locked to that value (mm, N), absent = free. */
export interface AdvisorLocks {
  /** Zp (ratio = Zp - 1) */
  Zp?: number;
  /** Pin circle diameter, mm (any value) */
  D?: number;
  /** Eccentricity, mm. With D free, K1 = e*Zp/Rp simply follows D. */
  e?: number;
  outerPin?: OuterPinLock;
  innerPin?: InnerPinLock;
  Zw?: number;
  /** Disc thickness, mm (any value) */
  L?: number;
  discs?: 1 | 2;
  bearing?: BearingLock;
  /** Constraint, not a variable: housing OD (D + 2 rr + 2 wall) must not exceed this, mm */
  maxHousingOD?: number;
}

export interface AdvisorOptions {
  /** Utilization every check must stay under. Default 0.85 (green), clamped to 0.7..1.0. */
  target?: number;
  /** Let Zp vary over {12,...,26} instead of keeping the current ratio. Default false. Ignored when `locks.Zp` is set. */
  ratioVary?: boolean;
  /**
   * Restrict the searched Zp to exactly these integers ("ratio from motor", CLAUDE.md Addition 8; the UI builds the list
   * with motorZpSet). Takes the place of `ratioVary` (and its 12..26 even grid) but is itself not a lock: Zp counts as
   * optimized. Ignored when `locks.Zp` is set. Values must be integers from 8 to 200; others are dropped. An empty list
   * is ignored.
   */
  zpSet?: number[];
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
  /** Variables fixed to user values, plus the optional maximum housing OD. Default: nothing locked. */
  locks?: AdvisorLocks;
  /** When nothing meets the target, search for the closest design. Default true. */
  closest?: boolean;
  /** When nothing meets the target, compute the relax hints (one re-run per released lock). Default true. */
  hints?: boolean;
}

export interface AdvisorProgress {
  phase: 'search' | 'verify' | 'closest' | 'hints';
  /** 0..1, monotonic */
  fraction: number;
  /** Candidate designs evaluated so far */
  evaluated: number;
  /** Smallest housing OD found so far, mm (null until a feasible design exists) */
  bestHousingOD: number | null;
  /** D being searched, mm */
  D: number;
}

export type AdvisorSlot = 'best' | 'oneDisc' | 'twoDisc' | 'lightest' | 'mostMargin' | 'closest';

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
  /** Bolt size label (bolt+bushing construction, catalog bolt only) */
  outerBolt: string | null;
  /** Bolt shank diameter, mm (bolt+bushing only) */
  shankDia: number | null;
  /** True when the outer pin size is a custom value, not a catalog entry */
  outerCustom: boolean;
  innerPinOD: number;
  innerPinBore: number | null;
  innerThread: string | null;
  innerCustom: boolean;
  Zw: number;
  Rw: number;
  L: number;
  discs: number;
  bearingName: string;
  bearingOD: number;
  /** Bearing ID, mm (null for a custom bearing entered without one) */
  bearingBore: number | null;
  bearingCustom: boolean;
  massTotal_g: number;
  /** Max utilization at full SPEC resolution */
  maxUtilization: number;
  /** Max utilization the coarse search saw (diagnostic; should be within ~3% of maxUtilization) */
  coarseMaxUtilization: number;
  governingLabel: string;
  /** True if this slot holds the same design as `best` */
  sameAsBest: boolean;
}

/**
 * "If you release this lock, a design that meets the target exists." `design` is a verified full-resolution
 * result of a real search with only this lock released (the other free variables are re-optimized), so the
 * statement is never a guess.
 */
export interface RelaxHint {
  /** The lock to release, or 'maxHousingOD' for the housing limit */
  key: AdvisorLockKey | 'maxHousingOD';
  /** Short name of the variable, e.g. "pin circle D" */
  name: string;
  /** The value the passing design uses for it, e.g. "52 mm" */
  value: string;
  /** Complete sentence in mm, e.g. "Unlock D: a 52 mm pin circle passes (housing 61 mm, max utilization 0.83)." */
  text: string;
  /** The passing design found with this lock released */
  design: AdvisorDesign;
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
  /** Variables that were fixed for this run (explicit locks, plus the ratio when it was not allowed to vary) */
  locked: AdvisorLockKey[];
  /** The housing OD limit used, mm, or null */
  maxHousingOD: number | null;
  /** The Zp values that were searched when the ratio was restricted with `zpSet`, else null */
  zpSearched: number[] | null;
  /** When `best` is null: the design with the lowest max utilization within the locks (null if none is even geometrically valid) */
  closest: AdvisorDesign | null;
  /** When `best` is null: which single lock to release for a passing design (empty if no single release helps) */
  relaxHints: RelaxHint[];
  /** Candidate designs evaluated at coarse resolution */
  evaluated: number;
  elapsedMs: number;
}

// ---------------------------------------------------------------------------
// Search space
// ---------------------------------------------------------------------------

interface OuterOpt { od: number; shank: number; bolt: string | null; custom: boolean }
interface InnerOpt { od: number; bore: number; thread: string | null; custom: boolean }
interface BrgOpt { name: string; bore: number | null; OD: number; C: number; C0: number; custom: boolean }

interface Space {
  Zps: number[];
  /** Locked D (single value) or null for the grid */
  Dfixed: number | null;
  /** Locked e or null (K1 grid) */
  eFixed: number | null;
  outer: OuterOpt[];
  inner: InnerOpt[];
  Zws: number[];
  /** Locked L or null (stock thicknesses) */
  Lfixed: number | null;
  discs: number[];
  brgs: BrgOpt[];
  maxOD: number;
  locked: AdvisorLockKey[];
  allLocked: boolean;
}

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
  constructor(private cmp: (a: Cand, b: Cand) => number, private k: number, private key?: (c: Cand) => string) {}
  /** Insert a copy of `c` if it ranks within the top k (and, with a key, only the best entry per key is kept). */
  add(c: Cand) {
    const n = this.items.length;
    if (n >= this.k && this.cmp(c, this.items[n - 1]) >= 0) return;
    if (this.key) {
      const kc = this.key(c);
      const idx = this.items.findIndex((x) => this.key!(x) === kc);
      if (idx >= 0) {
        if (this.cmp(c, this.items[idx]) >= 0) return;
        this.items.splice(idx, 1);
      }
    }
    let i = this.items.length;
    while (i > 0 && this.cmp(c, this.items[i - 1]) < 0) i--;
    this.items.splice(i, 0, { ...c });
    if (this.items.length > this.k) this.items.pop();
  }
}

const TOPK = 8;
const CLOSEST_K = 24;
/** Utilization above this is "not a design" (ligament <= 0, undercut): the closest search ignores it. */
const CLOSEST_CAP = UTIL_CAP - 1;

function clampTarget(t: number | undefined): number {
  const v = t != null && Number.isFinite(t) ? t : 0.85;
  return Math.min(1.0, Math.max(0.7, v));
}

const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

const catalogOuter = (i: number): OuterOpt => ({
  od: OUTER_PIN_OPTIONS[i].od, shank: OUTER_PIN_OPTIONS[i].shank, bolt: OUTER_PIN_OPTIONS[i].bolt, custom: false,
});
const catalogInner = (i: number): InnerOpt => ({
  od: INNER_PIN_OPTIONS[i].od, bore: INNER_PIN_OPTIONS[i].bore, thread: INNER_PIN_OPTIONS[i].thread, custom: false,
});
const catalogBearing = (i: number): BrgOpt => ({
  name: BEARINGS[i].name, bore: BEARINGS[i].bore, OD: BEARINGS[i].OD, C: BEARINGS[i].C, C0: BEARINGS[i].C0, custom: false,
});

/** Messages are plain text in mm / N so the UI can localize them. */
export function validateAdvisorLocks(inputs: GearboxInputs, locks: AdvisorLocks | undefined): string[] {
  const errors: string[] = [];
  if (!locks) return errors;
  const M = GEARBOX_MAX;
  const intIn = (v: unknown, name: string, lo: number, hi: number) => {
    if (!finite(v) || !Number.isInteger(v) || v < lo || v > hi) errors.push(`Locked ${name} must be an integer from ${lo} to ${hi}`);
  };
  const posIn = (v: unknown, name: string, max: number, unit: string) => {
    if (!finite(v) || v <= 0) errors.push(`Locked ${name} must be > 0 ${unit}`);
    else if (v > max) errors.push(`Locked ${name} must be at most ${max} ${unit}`);
  };
  if (locks.Zp !== undefined) intIn(locks.Zp, 'Zp', 8, 200);
  if (locks.D !== undefined) posIn(locks.D, 'D', M.D, 'mm');
  if (locks.e !== undefined) posIn(locks.e, 'e', M.e, 'mm');
  if (locks.L !== undefined) posIn(locks.L, 'L', M.L, 'mm');
  if (locks.Zw !== undefined) intIn(locks.Zw, 'Zw', 3, 60);
  if (locks.discs !== undefined && locks.discs !== 1 && locks.discs !== 2) errors.push('Locked disc count must be 1 or 2');
  if (locks.maxHousingOD !== undefined) posIn(locks.maxHousingOD, 'housing OD limit', M.D, 'mm');
  const o = locks.outerPin;
  if (o) {
    if (o.kind === 'catalog') {
      if (!Number.isInteger(o.index) || o.index < 0 || o.index >= OUTER_PIN_OPTIONS.length) errors.push('Locked outer pin is not in the catalog');
    } else {
      posIn(o.od, 'outer pin OD', 2 * M.rr, 'mm');
      if (inputs.outerPin?.construction === 'boltBushing') {
        posIn(o.shank, 'bolt shank diameter', M.pinDia, 'mm');
      }
    }
  }
  const n = locks.innerPin;
  if (n) {
    if (n.kind === 'catalog') {
      if (!Number.isInteger(n.index) || n.index < 0 || n.index >= INNER_PIN_OPTIONS.length) errors.push('Locked inner pin is not in the catalog');
    } else {
      posIn(n.od, 'inner pin OD', 2 * M.rw, 'mm');
      if (inputs.innerPin?.construction === 'standoff') {
        if (!finite(n.bore) || n.bore < 0) errors.push('Locked standoff bore must be >= 0 mm');
        else if (finite(n.od) && n.bore >= n.od) errors.push('Locked standoff bore must be smaller than its OD');
      }
    }
  }
  const b = locks.bearing;
  if (b) {
    if (b.kind === 'catalog') {
      if (!Number.isInteger(b.index) || b.index < 0 || b.index >= BEARINGS.length) errors.push('Locked bearing is not in the catalog');
    } else {
      posIn(b.OD, 'bearing OD', M.Db, 'mm');
      posIn(b.C, 'bearing C', M.bearingN, 'N');
      posIn(b.C0, 'bearing C0', M.bearingN, 'N');
      if (b.bore !== undefined && b.bore !== null) {
        if (!finite(b.bore) || b.bore <= 0) errors.push('Locked bearing ID must be > 0 mm');
        else if (finite(b.OD) && b.bore >= b.OD) errors.push('Locked bearing ID must be smaller than its OD');
      }
    }
  }
  return errors;
}

function buildSpace(inputs: GearboxInputs, o: ResolvedOptions): Space {
  const lk = o.locks;
  const locked: AdvisorLockKey[] = [];
  const mark = (k: AdvisorLockKey, on: boolean) => { if (on) locked.push(k); };

  let Zps: number[];
  const zpLocked = lk.Zp !== undefined || (!o.ratioVary && !o.zpSet);
  if (lk.Zp !== undefined) Zps = [lk.Zp];
  else if (o.zpSet) Zps = [...o.zpSet];
  else Zps = o.ratioVary ? [...ZP_OPTIONS] : [inputs.Zp];

  let outer: OuterOpt[];
  if (lk.outerPin) {
    outer = [lk.outerPin.kind === 'catalog'
      ? catalogOuter(lk.outerPin.index)
      : { od: lk.outerPin.od, shank: lk.outerPin.shank, bolt: null, custom: true }];
  } else outer = OUTER_PIN_OPTIONS.map((_, i) => catalogOuter(i));

  let inner: InnerOpt[];
  if (lk.innerPin) {
    inner = [lk.innerPin.kind === 'catalog'
      ? catalogInner(lk.innerPin.index)
      : { od: lk.innerPin.od, bore: lk.innerPin.bore, thread: null, custom: true }];
  } else inner = INNER_PIN_OPTIONS.map((_, i) => catalogInner(i));

  let brgs: BrgOpt[];
  if (lk.bearing) {
    brgs = [lk.bearing.kind === 'catalog'
      ? catalogBearing(lk.bearing.index)
      : {
        name: lk.bearing.name?.trim() || `Custom ${lk.bearing.OD} mm`,
        bore: finite(lk.bearing.bore) ? lk.bearing.bore : null,
        OD: lk.bearing.OD, C: lk.bearing.C, C0: lk.bearing.C0, custom: true,
      }];
  } else brgs = BEARINGS.map((_, i) => catalogBearing(i));

  const space: Space = {
    Zps,
    Dfixed: lk.D !== undefined ? lk.D : null,
    eFixed: lk.e !== undefined ? lk.e : null,
    outer, inner,
    Zws: lk.Zw !== undefined ? [lk.Zw] : [...ZW_OPTIONS],
    Lfixed: lk.L !== undefined ? lk.L : null,
    discs: lk.discs !== undefined ? [lk.discs] : [1, 2],
    brgs,
    maxOD: lk.maxHousingOD !== undefined ? lk.maxHousingOD : Infinity,
    locked,
    allLocked: false,
  };
  mark('Zp', zpLocked);
  mark('D', space.Dfixed !== null);
  mark('e', space.eFixed !== null);
  mark('outerPin', !!lk.outerPin);
  mark('innerPin', !!lk.innerPin);
  mark('Zw', lk.Zw !== undefined);
  mark('L', space.Lfixed !== null);
  mark('discs', lk.discs !== undefined);
  mark('bearing', !!lk.bearing);
  space.allLocked = locked.length === ADVISOR_LOCK_KEYS.length;
  return space;
}

function buildInputs(base: GearboxInputs, sp: Space, c: Cand): GearboxInputs {
  const outer = sp.outer[c.pinIdx];
  const inner = sp.inner[c.inIdx];
  const brg = sp.brgs[c.brgIdx];
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

function makeDesign(slot: AdvisorSlot, base: GearboxInputs, sp: Space, c: Cand, result: GearboxResult): AdvisorDesign {
  const outer = sp.outer[c.pinIdx];
  const inner = sp.inner[c.inIdx];
  const brg = sp.brgs[c.brgIdx];
  const inputs = buildInputs(base, sp, c);
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
    outerCustom: outer.custom,
    innerPinOD: inner.od,
    innerPinBore: standoff ? inner.bore : null,
    innerThread: standoff ? inner.thread : null,
    innerCustom: inner.custom,
    Zw: c.Zw,
    Rw: result.derived.Rw,
    L: c.L,
    discs: c.discs,
    bearingName: brg.name,
    bearingOD: brg.OD,
    bearingBore: brg.bore,
    bearingCustom: brg.custom,
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
    locked: [], maxHousingOD: null, zpSearched: null, closest: null, relaxHints: [],
    evaluated: 0, elapsedMs: 0,
  };
}

interface SearchOutcome {
  best: TopK; one: TopK; two: TopK; light: TopK; margin: TopK;
  evaluated: number;
}

interface ResolvedOptions {
  target: number;
  ratioVary: boolean;
  zpSet: number[] | null;
  Dmin: number; Dmax: number;
  altWindowMm: number; discAltWindowMm: number;
  npfCoarse: number; nthCoarse: number; npfFull: number; nthFull: number;
  minPinClearance: number;
  locks: AdvisorLocks;
  closest: boolean;
  hints: boolean;
}

/** Scales the fraction a searchGen reports into the part of the whole run it occupies. */
interface ProgressState { v: number; rings?: number; maxRings?: number; aborted?: boolean }

// ---------------------------------------------------------------------------
// The coarse search (generator so it can report progress and be cancelled).
//   mode 'target':  every check must be <= `target`; sorted by housing OD with early stop (the advisor proper)
//   mode 'closest': no target; branch-and-bound on the running k-th best max utilization
// ---------------------------------------------------------------------------

function* searchGen(
  base: GearboxInputs, sp: Space, o: ResolvedOptions, target: number, progressBase: ProgressState,
  mode: 'target' | 'closest' = 'target',
): Generator<AdvisorProgress, SearchOutcome, void> {
  const closestMode = mode === 'closest';
  const phase: AdvisorProgress['phase'] = closestMode ? 'closest' : 'search';
  const best = closestMode
    ? new TopK(cmpMargin, CLOSEST_K, (c) => `${c.Zp}|${c.D}|${c.K1}|${c.pinIdx}|${c.L}|${c.discs}`)
    : new TopK(cmpBest, TOPK);
  const one = new TopK(cmpBest, TOPK), two = new TopK(cmpBest, TOPK);
  const light = new TopK(cmpLight, TOPK), margin = new TopK(cmpMargin, TOPK);

  // thr: the utilization every partial result must stay under. Fixed in target mode, shrinking in closest mode.
  let thr = closestMode ? CLOSEST_CAP : target;

  const Kc = base.Kc, Tdes = base.Tdes, Treq = base.Treq, KcLife = base.KcLife;
  const disc = base.discMaterial;
  const EsRing = effectiveModulus(base.outerPin.material, disc);
  const EsIn = effectiveModulus(base.innerPin.material, disc);
  const limRing = contactLimits(disc, base.outerPin.material);
  const limIn = contactLimits(disc, base.innerPin.material);
  const boltLim = outerPinBendingLimit(base.outerPin);
  const soLim = innerPinBendingLimit(base.innerPin);
  // Inner pin bending model. The tied-ring moment per N*m is exactly M_hat(Zw, Zp, discs, L, gap) / Rw, so it is swept
  // once per (Zp, discs, L) for every Zw (at the coarse theta resolution) and rescaled by Rw inside the loops.
  const support = innerPinSupportOf(base);
  const ringHatCache = new Map<string, Float64Array>();
  const ringHat = (Zp: number, di: number, L: number): Float64Array => {
    const key = `${Zp}:${di}:${L}`;
    let h = ringHatCache.get(key);
    if (!h) {
      h = new Float64Array(64);
      for (const Zw of sp.Zws) {
        if (Zw < 0 || Zw >= 64) continue;
        const r = standoffRingUnit(Zw, Zp, o.nthCoarse, di, L, gap, 1);
        h[Zw] = support === 'ringPinned' ? r.pinned : r.clamped;
      }
      ringHatCache.set(key, h);
    }
    return h;
  };
  const stock = sp.Lfixed !== null
    ? [sp.Lfixed]
    : discStockFor(disc);
  const tMin = base.tMin, gap = base.gap, wall = base.wall;
  const rho = disc.density;
  let ligReq = tMin / thr;
  const Zps = sp.Zps;
  const allowOne = sp.discs.includes(1), allowTwo = sp.discs.includes(2);

  const K1s: number[] = [];
  for (let k = 0; ADVISOR_K1_MIN + k * ADVISOR_K1_STEP <= ADVISOR_K1_MAX + 1e-9; k++) {
    K1s.push(Math.round((ADVISOR_K1_MIN + k * ADVISOR_K1_STEP) * 1e6) / 1e6);
  }
  const nK = sp.eFixed !== null ? 1 : K1s.length;

  // Per-option precomputation
  const outerRr = sp.outer.map((p) => p.od / 2);
  const outerZ = sp.outer.map((p) =>
    outerPinSectionModulus({ ...base.outerPin, shankDia: p.shank }, p.od / 2));
  const innerRw = sp.inner.map((p) => p.od / 2);
  const innerZ = sp.inner.map((p) =>
    innerPinSectionModulus({ ...base.innerPin, od: p.od, bore: p.bore }, p.od / 2));

  // Groups sorted by housing OD (then Zp, D, pin) so the target search can stop early and deterministically.
  // The closest search visits large housings first: they have the lowest utilization, so the bound tightens fast.
  const groups: Group[] = [];
  const Ds: number[] = [];
  if (sp.Dfixed !== null) Ds.push(sp.Dfixed);
  else for (let D = Math.ceil(o.Dmin); D <= o.Dmax; D++) Ds.push(D);
  for (const Zp of Zps) {
    for (const D of Ds) {
      const Rp = D / 2;
      for (let pi = 0; pi < sp.outer.length; pi++) {
        const rr = outerRr[pi];
        if (2 * Rp * Math.sin(Math.PI / Zp) - 2 * rr < o.minPinClearance) continue;
        const od = D + 2 * rr + 2 * wall;
        if (od > sp.maxOD + TOL) continue;
        groups.push({ Zp, D, pinIdx: pi, od });
      }
    }
  }
  if (closestMode) groups.sort((a, b) => b.od - a.od || a.Zp - b.Zp || a.D - b.D || a.pinIdx - b.pinIdx);
  else groups.sort((a, b) => a.od - b.od || a.Zp - b.Zp || a.D - b.D || a.pinIdx - b.pinIdx);

  let evaluated = 0;
  let bestOD = Infinity;     // housing OD of the best design found (target mode)
  let oneOD = Infinity, twoOD = Infinity;
  let lastYield = now();
  const cur = newCand();

  let planned = groups.length;
  for (let gi = 0; gi < groups.length; gi++) {
    if (progressBase.maxRings !== undefined && (progressBase.rings ?? 0) > progressBase.maxRings) { progressBase.aborted = true; break; }
    const grp = groups[gi];
    const od = grp.od;
    let wantOne = true, wantTwo = true;
    if (!closestMode) {
      // What does this group still have to contribute?
      const inWindow = od <= bestOD + o.altWindowMm + TOL;
      const inDiscWindow = od <= bestOD + o.discAltWindowMm + TOL;
      wantOne = allowOne && (bestOD === Infinity || inWindow || (oneOD === Infinity && inDiscWindow) || od <= oneOD + TOL);
      wantTwo = allowTwo && (bestOD === Infinity || inWindow || (twoOD === Infinity && inDiscWindow) || od <= twoOD + TOL);
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
    } else {
      wantOne = allowOne; wantTwo = allowTwo;
    }

    const { Zp, D, pinIdx } = grp;
    const Rp = D / 2;
    const rr = outerRr[pinIdx];
    const Zo = outerZ[pinIdx];

    for (let ki = 0; ki < nK; ki++) {
      let K1: number, e: number;
      if (sp.eFixed !== null) {
        e = sp.eFixed;
        K1 = (e * Zp) / Rp;
        if (!(K1 < 1)) continue;
      } else {
        K1 = K1s[ki];
        e = (K1 * Rp) / Zp;
      }
      const Rroot = Rp - e - rr;
      if (!(Rroot > 0)) continue;

      // Cheap geometric pre-scan: is there any inner pin / Zw / bearing that fits at all?
      let anyGeo = false;
      for (let ii = 0; ii < sp.inner.length && !anyGeo; ii++) {
        const dh = 2 * innerRw[ii] + 2 * e;
        const Rw = Rroot - dh / 2 - tMin;
        if (!(Rw > 0)) continue;
        for (let bi = 0; bi < sp.brgs.length && !anyGeo; bi++) {
          if (Rw - dh / 2 - sp.brgs[bi].OD / 2 < ligReq - TOL) continue;
          for (const Zw of sp.Zws) {
            if (2 * Rw * Math.sin(Math.PI / Zw) - dh >= ligReq - TOL) { anyGeo = true; break; }
          }
        }
      }
      if (!anyGeo) continue;

      const u = ringUnit(Zp, D, e, rr, o.npfCoarse, o.nthCoarse);
      if (progressBase.rings !== undefined) progressBase.rings++;
      if (u.undercut) continue;
      const cuspUtil = Number.isFinite(u.rhoMinConvex)
        ? (u.cusp ? Math.max(CUSP_RHO / u.rhoMinConvex, 1.0001) : CUSP_RHO / u.rhoMinConvex)
        : (u.cusp ? 1.0001 : 0);
      if (cuspUtil > thr) continue;

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
          if (uRS > thr || uRL > thr) continue;
          const span = di * L + (di + 1) * gap;
          const uBolt = (Fpk * span / 4 / Zo) / boltLim;
          if (uBolt > thr) continue;
          const standoffArm = gap + (di - 1) * (L + gap) + L / 2;
          const hat = support === 'cantilever' ? null : ringHat(Zp, di, L);
          const base1 = Math.max(uRS, uRL, uBolt, cuspUtil);

          for (let ii = 0; ii < sp.inner.length; ii++) {
            const rw = innerRw[ii];
            const dh = 2 * rw + 2 * e;
            const Rw = Rroot - dh / 2 - tMin;
            if (!(Rw > 0)) continue;
            const invRin = 1 / rw - 1 / (dh / 2);
            const Zi = innerZ[ii];
            for (const Zw of sp.Zws) {
              const ligH = 2 * Rw * Math.sin(Math.PI / Zw) - dh;
              const uLH = ligH > 0 ? tMin / ligH : 99;
              if (uLH > thr) continue;
              const FIn = 4000 / (Zw * Rw);
              const p0In = Math.sqrt((FIn * EsIn * invRin) / (Math.PI * L));
              const uIS = (p0In * sStr) / limIn.strength;
              const uIL = (p0In * sLife) / limIn.life;
              if (uIS > thr || uIL > thr) continue;
              const uSO = (hat === null
                ? (FIn * Fstr * standoffArm) / Zi
                : ((Zw < 64 ? hat[Zw] : standoffRingUnit(Zw, Zp, o.nthCoarse, di, L, gap, 1)[support === 'ringPinned' ? 'pinned' : 'clamped'])
                  / Rw) * Fstr / Zi) / soLim;
              if (uSO > thr) continue;
              const base2 = Math.max(base1, uLH, uIS, uIL, uSO);

              const g = innerForceTable(Zw, Zp, o.nthCoarse);
              const Fb = bearingUnitLoad(u.sweep, g, Rw);
              const peak = Fb * Tdes * s;
              const working = Fb * Treq * s;
              const netBase = u.area - Zw * Math.PI * (dh / 2) * (dh / 2);

              for (let bi = 0; bi < sp.brgs.length; bi++) {
                const brg = sp.brgs[bi];
                const ligB = Rw - dh / 2 - brg.OD / 2;
                const uLB = ligB > 0 ? tMin / ligB : 99;
                if (uLB > thr) continue;
                const uBS = peak / brg.C0;
                if (uBS > thr) continue;
                let uBL = 0;
                if (working > 0 && base.reqLifeH > 0) {
                  const L10h = (Math.pow(brg.C / working, 3) * 1e6) / (60 * base.rpm);
                  uBL = base.reqLifeH / L10h;
                }
                if (uBL > thr) continue;
                evaluated++;
                cur.util = Math.max(base2, uLB, uBS, uBL);
                const net = netBase - Math.PI * (brg.OD / 2) * (brg.OD / 2);
                cur.mass = (Math.max(0, net) * L * rho / 1000) * di;
                cur.od = od; cur.discs = di;
                cur.Zp = Zp; cur.D = D; cur.K1 = K1; cur.e = e;
                cur.pinIdx = pinIdx; cur.inIdx = ii; cur.Zw = Zw; cur.L = L; cur.brgIdx = bi; cur.Rw = Rw;
                best.add(cur);
                if (closestMode) {
                  if (best.items.length >= CLOSEST_K) {
                    const t2 = best.items[CLOSEST_K - 1].util;
                    if (t2 < thr) { thr = t2; ligReq = tMin / thr; }
                  }
                  continue;
                }
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
      // The target search is about to be followed by the closest search and hints if nothing is found yet,
      // so it only claims the whole 0..0.9 range once a design exists.
      const scale = closestMode ? 1 : bestOD < Infinity ? 0.9 : 0.4;
      const frac = Math.min(0.9, Math.max(progressBase.v, (gi + 1) / Math.max(planned, 1) * scale));
      progressBase.v = frac;
      yield {
        phase, fraction: frac, evaluated,
        bestHousingOD: bestOD < Infinity ? bestOD : null, D,
      };
    }
  }
  if (!closestMode) {
    // Keep the window semantics of light/margin: drop entries beyond the final window
    const limit = bestOD + o.altWindowMm + TOL;
    light.items = light.items.filter((c) => c.od <= limit);
    margin.items = margin.items.filter((c) => c.od <= limit);
  }
  return { best, one, two, light, margin, evaluated };
}

// ---------------------------------------------------------------------------
// Target search + full-resolution verification
// ---------------------------------------------------------------------------

interface Verified { c: Cand; r: GearboxResult }

interface TargetOutcome {
  best?: Verified; one?: Verified; two?: Verified; light?: Verified; margin?: Verified;
  evaluated: number;
  warnings: string[];
}

function* targetPhase(
  inputs: GearboxInputs, sp: Space, o: ResolvedOptions, progress: ProgressState, bestOnly: boolean,
): Generator<AdvisorProgress, TargetOutcome, void> {
  const target = o.target;
  const fullCheck = (c: Cand): GearboxResult =>
    checkGearbox(buildInputs(inputs, sp, c), { npf: o.npfFull, nth: o.nthFull });
  const passes = (r: GearboxResult, tgt: number) => r.valid && r.maxUtilization <= tgt + 1e-9;

  let evaluated = 0;
  const warnings: string[] = [];
  let verified: Omit<TargetOutcome, 'evaluated' | 'warnings'> = {};

  // Attempt 0 uses the requested target; if no coarse pick survives full-resolution
  // verification the search is repeated with a slightly tighter coarse target.
  for (let attempt = 0; attempt < 3; attempt++) {
    const coarseTarget = Math.max(0.5, target - 0.01 * attempt);
    const outcome: SearchOutcome = yield* searchGen(inputs, sp, o, coarseTarget, progress);
    evaluated += outcome.evaluated;
    verified = {};
    const pickFirst = (list: TopK): Verified | undefined => {
      for (const c of list.items) {
        const r = fullCheck(c);
        if (passes(r, target)) return { c, r };
      }
      return undefined;
    };
    const lists: [keyof typeof verified, TopK][] = bestOnly
      ? [['best', outcome.best]]
      : [['best', outcome.best], ['one', outcome.one], ['two', outcome.two], ['light', outcome.light], ['margin', outcome.margin]];
    // an empty search is not worth reporting verification progress for
    const hasAny = outcome.best.items.length > 0;
    let done = 0;
    for (const [key, list] of lists) {
      verified[key] = pickFirst(list);
      done++;
      if (hasAny) {
        progress.v = Math.max(progress.v, 0.9 + (0.1 * done) / lists.length);
        yield {
          phase: 'verify', fraction: Math.min(0.999, progress.v), evaluated,
          bestHousingOD: outcome.best.items[0]?.od ?? null, D: outcome.best.items[0]?.D ?? 0,
        };
      }
    }
    if (verified.best || outcome.best.items.length === 0) break;
    warnings.push(`Coarse pick failed full-resolution verification; retried with target ${coarseTarget - 0.01}.`);
  }
  return { ...verified, evaluated, warnings };
}

/** Closest design within the locks: the lowest full-resolution max utilization among the best coarse candidates. */
function* closestPhase(
  inputs: GearboxInputs, sp: Space, o: ResolvedOptions, progress: ProgressState,
): Generator<AdvisorProgress, { v: Verified | null; evaluated: number }, void> {
  const outcome: SearchOutcome = yield* searchGen(inputs, sp, o, o.target, progress, 'closest');
  let pick: Verified | null = null;
  for (const c of outcome.best.items) {
    const r = checkGearbox(buildInputs(inputs, sp, c), { npf: o.npfFull, nth: o.nthFull });
    if (!r.valid) continue;
    const cand: Cand = { ...c, util: r.maxUtilization };
    if (!pick || cmpMargin(cand, { ...pick.c, util: pick.r.maxUtilization }) < 0) pick = { c, r };
  }
  return { v: pick, evaluated: outcome.evaluated };
}

// ---------------------------------------------------------------------------
// Relax hints
// ---------------------------------------------------------------------------

const LOCK_NAMES: Record<AdvisorLockKey | 'maxHousingOD', string> = {
  Zp: 'gear ratio', D: 'pin circle D', e: 'eccentricity e', outerPin: 'outer pin size', innerPin: 'inner pin size',
  Zw: 'inner pin count Zw', L: 'disc thickness L', discs: 'number of discs', bearing: 'eccentric bearing',
  maxHousingOD: 'housing OD limit',
};

const trimNum = (x: number, dp: number) => String(parseFloat(x.toFixed(dp)));

function hintFor(key: AdvisorLockKey | 'maxHousingOD', d: AdvisorDesign): { value: string; sentence: string } {
  const outer = d.inputs.outerPin.construction === 'solid'
    ? `${trimNum(d.outerPinOD, 2)} mm solid pins`
    : d.outerBolt ? `${trimNum(d.outerPinOD, 2)} mm bushings on ${d.outerBolt} bolts` : `${trimNum(d.outerPinOD, 2)} mm bushings`;
  const inner = d.inputs.innerPin.construction === 'solid'
    ? `${trimNum(d.innerPinOD, 2)} mm solid pins`
    : d.innerThread ? `${trimNum(d.innerPinOD, 2)} mm ${d.innerThread} standoffs` : `${trimNum(d.innerPinOD, 2)} mm standoffs`;
  switch (key) {
    case 'Zp': return { value: `${d.ratio}:1`, sentence: `a ${d.ratio}:1 ratio (Zp ${d.Zp}) passes` };
    case 'D': return { value: `${trimNum(d.D, 1)} mm`, sentence: `a ${trimNum(d.D, 1)} mm pin circle passes` };
    case 'e': return { value: `${trimNum(d.e, 3)} mm`, sentence: `e = ${trimNum(d.e, 3)} mm (K1 ${trimNum(d.K1, 3)}) passes` };
    case 'outerPin': return { value: outer, sentence: `${outer} pass` };
    case 'innerPin': return { value: inner, sentence: `${inner} pass` };
    case 'Zw': return { value: String(d.Zw), sentence: `${d.Zw} inner pins pass` };
    case 'L': return { value: `${trimNum(d.L, 3)} mm`, sentence: `${trimNum(d.L, 3)} mm passes` };
    case 'discs': return { value: String(d.discs), sentence: `${d.discs} disc${d.discs > 1 ? 's' : ''} pass${d.discs > 1 ? '' : 'es'}` };
    case 'bearing': return { value: d.bearingName, sentence: `the ${d.bearingName} bearing passes` };
    case 'maxHousingOD': return { value: `${trimNum(d.housingOD, 1)} mm`, sentence: `a ${trimNum(d.housingOD, 1)} mm housing passes` };
  }
}

function releasedOptions(o: ResolvedOptions, key: AdvisorLockKey | 'maxHousingOD'): ResolvedOptions {
  const locks: AdvisorLocks = { ...o.locks };
  let ratioVary = o.ratioVary;
  if (key === 'maxHousingOD') delete locks.maxHousingOD;
  else if (key === 'Zp') { delete locks.Zp; ratioVary = true; }
  else delete locks[key];
  const zpSet = key === 'Zp' ? null : o.zpSet;
  // alternatives are not needed for a hint: stop as soon as the best housing OD is settled
  // ...and the screening can be coarser (half resolution, about 4x faster): every hint is verified at full resolution
  return {
    ...o, locks, ratioVary, zpSet, altWindowMm: 0, discAltWindowMm: 0,
    npfCoarse: Math.max(200, Math.round(o.npfCoarse / 2)), nthCoarse: Math.max(24, Math.round(o.nthCoarse / 2)),
  };
}

/**
 * Work cap for all hint re-runs together, in ring-contact evaluations (the unit of search cost, about 15-30 us
 * each at the hint resolution). Deterministic, unlike a wall-clock limit. Roughly 3 s; a re-run that cannot finish
 * inside it is reported as skipped, never as "no hint".
 */
const HINT_RING_BUDGET = 150000;

function* hintsPhase(
  inputs: GearboxInputs, sp: Space, o: ResolvedOptions, progress: ProgressState,
): Generator<AdvisorProgress, { hints: RelaxHint[]; evaluated: number; skipped: (AdvisorLockKey | 'maxHousingOD')[] }, void> {
  // the ratio re-run is the most expensive (8 values of Zp), so it goes last and gets what is left of the budget
  const keys: (AdvisorLockKey | 'maxHousingOD')[] = sp.locked.filter((k) => k !== 'Zp');
  if (sp.maxOD < Infinity) keys.push('maxHousingOD');
  if (sp.locked.includes('Zp') || (o.zpSet && o.locks.Zp === undefined)) keys.push('Zp');
  const hints: RelaxHint[] = [];
  const skipped: (AdvisorLockKey | 'maxHousingOD')[] = [];
  let evaluated = 0;
  let ringsLeft = HINT_RING_BUDGET;
  const lo = progress.v;
  const span = Math.max(0, 0.999 - lo);
  for (let ki = 0; ki < keys.length; ki++) {
    const key = keys[ki];
    const ro = releasedOptions(o, key);
    const sp2 = buildSpace(inputs, ro);
    const sub: ProgressState = { v: 0, rings: 0, maxRings: ringsLeft };
    const gen = targetPhase(inputs, sp2, ro, sub, true);
    let out: TargetOutcome;
    for (;;) {
      const step = gen.next();
      if (step.done) { out = step.value; break; }
      const p = step.value;
      yield {
        ...p, phase: 'hints',
        fraction: Math.min(0.999, Math.max(progress.v, lo + span * ((ki + Math.min(1, p.fraction)) / keys.length))),
      };
      progress.v = Math.max(progress.v, lo + span * ((ki + Math.min(1, p.fraction)) / keys.length));
    }
    evaluated += out.evaluated;
    ringsLeft = Math.max(0, ringsLeft - (sub.rings ?? 0));
    if (sub.aborted && !out.best) skipped.push(key);
    if (out.best) {
      const d = makeDesign('best', inputs, sp2, out.best.c, out.best.r);
      const h = hintFor(key, d);
      const verb = key === 'maxHousingOD' ? 'Raise the housing limit' : `Unlock ${LOCK_NAMES[key]}`;
      hints.push({
        key,
        name: LOCK_NAMES[key],
        value: h.value,
        text: `${verb}: ${h.sentence} (housing ${trimNum(d.housingOD, 1)} mm, max utilization ${d.maxUtilization.toFixed(2)}).`,
        design: d,
      });
    }
    progress.v = Math.max(progress.v, lo + span * ((ki + 1) / keys.length));
  }
  hints.sort((a, b) => a.design.housingOD - b.design.housingOD || keys.indexOf(a.key) - keys.indexOf(b.key));
  return { hints, evaluated, skipped };
}

// ---------------------------------------------------------------------------
// Main generator
// ---------------------------------------------------------------------------

/** Sorted, unique integers from 8 to 200, or null when nothing usable was given. */
function cleanZpSet(v: unknown): number[] | null {
  if (!Array.isArray(v)) return null;
  const out = [...new Set(v.filter((z): z is number => finite(z) && Number.isInteger(z) && z >= 8 && z <= 200))].sort((a, b) => a - b);
  return out.length ? out : null;
}

function resolveOptions(opts: AdvisorOptions): ResolvedOptions {
  return {
    target: clampTarget(opts.target),
    ratioVary: opts.ratioVary ?? false,
    zpSet: cleanZpSet(opts.zpSet),
    Dmin: opts.Dmin ?? ADVISOR_D_MIN,
    Dmax: opts.Dmax ?? ADVISOR_D_MAX,
    altWindowMm: opts.altWindowMm ?? 15,
    discAltWindowMm: opts.discAltWindowMm ?? 40,
    npfCoarse: opts.npfCoarse ?? 1500,
    nthCoarse: opts.nthCoarse ?? 120,
    npfFull: opts.npfFull ?? DEFAULT_NPF,
    nthFull: opts.nthFull ?? DEFAULT_NTH,
    minPinClearance: opts.minPinClearance ?? 1,
    locks: { ...(opts.locks ?? {}) },
    closest: opts.closest ?? true,
    hints: opts.hints ?? true,
  };
}

/** The single candidate of a fully locked space. */
function onlyCand(inputs: GearboxInputs, sp: Space): Cand {
  const Zp = sp.Zps[0];
  const D = sp.Dfixed as number;
  const e = sp.eFixed as number;
  const c = newCand();
  c.Zp = Zp; c.D = D; c.e = e; c.K1 = (e * Zp) / (D / 2);
  c.pinIdx = 0; c.inIdx = 0; c.Zw = sp.Zws[0]; c.L = sp.Lfixed as number; c.brgIdx = 0; c.discs = sp.discs[0];
  c.od = D + sp.outer[0].od + 2 * inputs.wall;
  return c;
}

function* adviseGen(inputs: GearboxInputs, opts: AdvisorOptions): Generator<AdvisorProgress, AdvisorResult, void> {
  const t0 = now();
  const target = clampTarget(opts.target);
  const v = validateGearboxInputsForAdvisor(inputs);
  if (v.errors.length) return invalidAdvisor(v.errors, target);
  const lockErrors = validateAdvisorLocks(inputs, opts.locks);
  if (lockErrors.length) return invalidAdvisor(lockErrors, target);

  const o = resolveOptions(opts);
  const sp = buildSpace(inputs, o);
  const warnings: string[] = [...v.warnings];
  const progress: ProgressState = { v: 0 };
  let evaluated = 0;

  const res: AdvisorResult = {
    valid: true, cancelled: false, errors: [], warnings, target, best: null,
    alternatives: { oneDisc: null, twoDisc: null, lightest: null, mostMargin: null },
    locked: sp.locked, maxHousingOD: Number.isFinite(sp.maxOD) ? sp.maxOD : null,
    zpSearched: o.zpSet && o.locks.Zp === undefined ? [...o.zpSet] : null,
    closest: null, relaxHints: [], evaluated: 0, elapsedMs: 0,
  };
  const motorRatio = o.zpSet != null && o.locks.Zp === undefined;
  const anyLock = sp.locked.some((k) => k !== 'Zp') || o.locks.Zp !== undefined || Number.isFinite(sp.maxOD) || motorRatio;

  let tgt: TargetOutcome = { evaluated: 0, warnings: [] };
  let closestV: Verified | null = null;

  if (sp.allLocked) {
    // Everything is fixed: just evaluate that one design at full resolution.
    const c = onlyCand(inputs, sp);
    const r = checkGearbox(buildInputs(inputs, sp, c), { npf: o.npfFull, nth: o.nthFull });
    evaluated = 1;
    if (!r.valid) {
      warnings.push(`These locked values do not make a valid gearbox: ${r.errors[0] ?? 'check the inputs'}.`);
    } else if (r.derived.housingOD > sp.maxOD + TOL) {
      warnings.push(`The locked design has a housing OD of ${trimNum(r.derived.housingOD, 1)} mm, above the ${trimNum(sp.maxOD, 1)} mm limit.`);
    } else if (r.maxUtilization <= target + 1e-9) {
      tgt = { best: { c: { ...c, util: r.maxUtilization }, r }, evaluated: 1, warnings: [] };
    } else {
      closestV = { c: { ...c, util: r.maxUtilization }, r };
    }
  } else {
    tgt = yield* targetPhase(inputs, sp, o, progress, false);
    evaluated += tgt.evaluated;
    warnings.push(...tgt.warnings);
  }

  const bestV = tgt.best;
  if (bestV) res.best = makeDesign('best', inputs, sp, bestV.c, bestV.r);
  const mk = (slot: AdvisorSlot, x?: Verified): AdvisorDesign | null => {
    if (!x) return null;
    const d = makeDesign(slot, inputs, sp, x.c, x.r);
    d.sameAsBest = !!bestV && sameCand(x.c, bestV.c);
    return d;
  };
  if (sp.allLocked) {
    // one design: it is every alternative that applies
    if (bestV) {
      const only = (slot: AdvisorSlot): AdvisorDesign => ({ ...makeDesign(slot, inputs, sp, bestV.c, bestV.r), sameAsBest: true });
      res.alternatives.oneDisc = bestV.c.discs === 1 ? only('oneDisc') : null;
      res.alternatives.twoDisc = bestV.c.discs === 2 ? only('twoDisc') : null;
      res.alternatives.lightest = only('lightest');
      res.alternatives.mostMargin = only('mostMargin');
    }
  } else {
    res.alternatives.oneDisc = mk('oneDisc', tgt.one);
    res.alternatives.twoDisc = mk('twoDisc', tgt.two);
    res.alternatives.lightest = mk('lightest', tgt.light);
    res.alternatives.mostMargin = mk('mostMargin', tgt.margin);
  }

  if (!res.best) {
    // Nothing meets the target: find the closest design within the locks.
    if (!sp.allLocked && o.closest) {
      const cl = yield* closestPhase(inputs, sp, o, progress);
      evaluated += cl.evaluated;
      closestV = cl.v;
      // A coarse-resolution false negative: the closest design may actually pass at full resolution.
      if (closestV && closestV.r.maxUtilization <= target + 1e-9) {
        res.best = makeDesign('best', inputs, sp, closestV.c, closestV.r);
        closestV = null;
      }
    }
    if (closestV) res.closest = makeDesign('closest', inputs, sp, closestV.c, closestV.r);
  }

  if (!res.best) {
    warnings.push(
      anyLock
        ? `No design meets the target utilization ${target.toFixed(2)} with these locks.`
        : `No design up to D = ${o.Dmax} mm meets the target utilization ${target.toFixed(2)}. ` +
          'Try a higher target, lower loads, a stronger disc material or allow the ratio to vary.',
    );
    if (res.closest) {
      warnings.push(
        `The closest design reaches a maximum utilization of ${res.closest.maxUtilization.toFixed(2)}, governed by ${res.closest.governingLabel}.`,
      );
    } else if (!sp.allLocked) {
      warnings.push('No geometrically valid design exists within these locks.');
    }
    if (motorRatio) {
      const z = o.zpSet as number[];
      warnings.push(`The ratio was limited to Zp ${z.length > 1 ? `${z[0]} to ${z[z.length - 1]}` : z[0]} by the motor.`);
    }
    if (o.hints && sp.locked.length + (Number.isFinite(sp.maxOD) ? 1 : 0) + (motorRatio ? 1 : 0) > 0) {
      const h = yield* hintsPhase(inputs, sp, o, progress);
      evaluated += h.evaluated;
      res.relaxHints = h.hints;
      if (h.skipped.length) {
        warnings.push(`Too large to check quickly, so no hint was computed for: ${h.skipped.map((k) => LOCK_NAMES[k]).join(', ')}.`);
      }
    }
  }

  if (inputs.discShare != null) {
    warnings.push('A manual disc share is ignored by the advisor: it uses 1.0 for one disc and 0.55 for two.');
  }
  res.evaluated = evaluated;
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
