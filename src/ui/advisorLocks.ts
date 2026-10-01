// UI-side model of the Design Advisor locks (CLAUDE.md Addition 6). Pure TypeScript (no React), stored per joint in the
// session. A variable is either free (the advisor optimizes it) or locked to a value. Values live next to the toggle, so
// unlocking and re-locking keeps what the user typed. A `null` value means "the current Gearbox value".

import {
  ADVISOR_LOCK_KEYS,
  BEARINGS,
  INNER_PIN_OPTIONS,
  OUTER_PIN_OPTIONS,
  validateAdvisorLocks,
  type AdvisorLockKey,
  type AdvisorLocks,
  type BearingLock,
  type GearboxInputs,
  type InnerPinLock,
  type OuterPinLock,
} from '../calc';

export type LockVarKey = AdvisorLockKey;
export const LOCK_VAR_KEYS: readonly LockVarKey[] = ADVISOR_LOCK_KEYS;

export interface AdvisorLockValues {
  Zp: number | null;
  D: number | null;
  e: number | null;
  outerPin: OuterPinLock | null;
  innerPin: InnerPinLock | null;
  Zw: number | null;
  L: number | null;
  discs: 1 | 2 | null;
  bearing: BearingLock | null;
  /** Housing OD limit, mm (used when `limitOn`) */
  maxHousingOD: number;
}

/** How the ratio row is driven: a locked Zp, free (the advisor tries Zp 12..26), or restricted to what the motor can do. */
export type RatioMode = 'locked' | 'free' | 'motor';

export interface AdvisorLockState {
  on: Record<LockVarKey, boolean>;
  /**
   * "Ratio from motor" (CLAUDE.md Addition 8). null = automatic: used whenever the joint has usable motor data.
   * true = chosen; false = the user picked Locked or Free, so the motor is ignored. Without motor data it has no effect.
   */
  ratioMotor: boolean | null;
  /** The housing OD constraint is active */
  limitOn: boolean;
  values: AdvisorLockValues;
}

export const DEFAULT_MAX_HOUSING_MM = 100;

export function defaultLockState(): AdvisorLockState {
  const on = {} as Record<LockVarKey, boolean>;
  for (const k of LOCK_VAR_KEYS) on[k] = k === 'Zp';
  return {
    on,
    ratioMotor: null,
    limitOn: false,
    values: {
      Zp: null, D: null, e: null, outerPin: null, innerPin: null, Zw: null, L: null, discs: null, bearing: null,
      maxHousingOD: DEFAULT_MAX_HOUSING_MM,
    },
  };
}

// ---------------------------------------------------------------------------
// Catalog <-> Gearbox inputs
// ---------------------------------------------------------------------------

const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;

/** The lock value equal to what the Gearbox page currently has for the outer pin. */
export function outerPinFromInputs(g: GearboxInputs): OuterPinLock {
  const od = 2 * g.rr;
  const bolt = g.outerPin.construction === 'boltBushing';
  const i = OUTER_PIN_OPTIONS.findIndex((p) => near(p.od, od) && (!bolt || near(p.shank, g.outerPin.shankDia)));
  return i >= 0 ? { kind: 'catalog', index: i } : { kind: 'custom', od, shank: g.outerPin.shankDia };
}

export function innerPinFromInputs(g: GearboxInputs): InnerPinLock {
  const od = 2 * g.rw;
  const standoff = g.innerPin.construction === 'standoff';
  const i = INNER_PIN_OPTIONS.findIndex((p) => near(p.od, od) && (!standoff || near(p.bore, g.innerPin.bore)));
  return i >= 0 ? { kind: 'catalog', index: i } : { kind: 'custom', od, bore: standoff ? g.innerPin.bore : 0 };
}

export function bearingFromInputs(g: GearboxInputs): BearingLock {
  const i = BEARINGS.findIndex((b) => b.name === g.bearing.name && near(b.OD, g.Db) && near(b.C, g.bearing.C) && near(b.C0, g.bearing.C0));
  return i >= 0
    ? { kind: 'catalog', index: i }
    : { kind: 'custom', name: g.bearing.name, OD: g.Db, C: g.bearing.C, C0: g.bearing.C0 };
}

/** Concrete value of every variable: the stored one, or the current Gearbox value when none is stored. */
export interface ResolvedLockValues {
  Zp: number; D: number; e: number; outerPin: OuterPinLock; innerPin: InnerPinLock; Zw: number; L: number;
  discs: 1 | 2; bearing: BearingLock; maxHousingOD: number;
}

export function resolveLockValues(s: AdvisorLockState, g: GearboxInputs): ResolvedLockValues {
  const v = s.values;
  return {
    Zp: v.Zp ?? g.Zp,
    D: v.D ?? g.D,
    e: v.e ?? g.e,
    outerPin: v.outerPin ?? outerPinFromInputs(g),
    innerPin: v.innerPin ?? innerPinFromInputs(g),
    Zw: v.Zw ?? g.Zw,
    L: v.L ?? g.L,
    discs: v.discs ?? (g.discs === 2 ? 2 : 1),
    bearing: v.bearing ?? bearingFromInputs(g),
    maxHousingOD: v.maxHousingOD,
  };
}

/** The ratio mode of a joint: "from motor" when it has usable motor data (unless the user chose otherwise). */
export function ratioModeOf(s: AdvisorLockState, motorUsable: boolean): RatioMode {
  if (motorUsable && s.ratioMotor !== false) return 'motor';
  return s.on.Zp ? 'locked' : 'free';
}

/**
 * Engine options for a lock state. The ratio is free exactly when its lock is off (then the advisor tries Zp 12..26).
 * `motorZps` (ratio mode "from motor", see motorUi.ratioPlanFor) replaces the ratio lock: the advisor searches only those Zp.
 */
export function toEngineLocks(
  s: AdvisorLockState, g: GearboxInputs, motorZps?: readonly number[] | null,
): { locks: AdvisorLocks; ratioVary: boolean; zpSet?: number[] } {
  const r = resolveLockValues(s, g);
  const locks: AdvisorLocks = {};
  const fromMotor = !!motorZps && motorZps.length > 0;
  if (s.on.Zp && !fromMotor) locks.Zp = r.Zp;
  if (s.on.D) locks.D = r.D;
  if (s.on.e) locks.e = r.e;
  if (s.on.outerPin) locks.outerPin = r.outerPin;
  if (s.on.innerPin) locks.innerPin = r.innerPin;
  if (s.on.Zw) locks.Zw = r.Zw;
  if (s.on.L) locks.L = r.L;
  if (s.on.discs) locks.discs = r.discs;
  if (s.on.bearing) locks.bearing = r.bearing;
  if (s.limitOn) locks.maxHousingOD = r.maxHousingOD;
  if (fromMotor) return { locks, ratioVary: false, zpSet: [...(motorZps as readonly number[])] };
  return { locks, ratioVary: !s.on.Zp };
}

/** "Lock all to current Gearbox values": every variable locked, values copied from the Gearbox inputs. */
export function lockAllToInputs(s: AdvisorLockState, g: GearboxInputs): AdvisorLockState {
  const on = {} as Record<LockVarKey, boolean>;
  for (const k of LOCK_VAR_KEYS) on[k] = true;
  return {
    ...s,
    on,
    ratioMotor: false,
    values: {
      ...s.values,
      Zp: g.Zp, D: g.D, e: g.e, outerPin: outerPinFromInputs(g), innerPin: innerPinFromInputs(g), Zw: g.Zw, L: g.L,
      discs: g.discs === 2 ? 2 : 1, bearing: bearingFromInputs(g),
    },
  };
}

/** "Unlock all": every variable free, values kept (they come back if a variable is locked again). The housing limit stays. */
export function unlockAll(s: AdvisorLockState): AdvisorLockState {
  const on = {} as Record<LockVarKey, boolean>;
  for (const k of LOCK_VAR_KEYS) on[k] = false;
  return { ...s, on, ratioMotor: false };
}

/** Number of locked variables. With a `mode`, the ratio counts only when that mode is 'locked'. */
export function lockedCount(s: AdvisorLockState, mode?: RatioMode): number {
  return LOCK_VAR_KEYS.filter((k) => (k === 'Zp' && mode !== undefined ? mode === 'locked' : s.on[k])).length;
}

// ---------------------------------------------------------------------------
// Validation (inline messages)
// ---------------------------------------------------------------------------

/** Message for one locked row, or null. Uses the engine's own rules so the screen and the run always agree. */
export function lockRowError(key: LockVarKey | 'maxHousingOD', s: AdvisorLockState, g: GearboxInputs, mode?: RatioMode): string | null {
  const active = key === 'maxHousingOD' ? s.limitOn : key === 'Zp' && mode !== undefined ? mode === 'locked' : s.on[key];
  if (!active) return null;
  const r = resolveLockValues(s, g);
  const one: AdvisorLocks = {};
  switch (key) {
    case 'Zp': one.Zp = r.Zp; break;
    case 'D': one.D = r.D; break;
    case 'e': one.e = r.e; break;
    case 'outerPin': one.outerPin = r.outerPin; break;
    case 'innerPin': one.innerPin = r.innerPin; break;
    case 'Zw': one.Zw = r.Zw; break;
    case 'L': one.L = r.L; break;
    case 'discs': one.discs = r.discs; break;
    case 'bearing': one.bearing = r.bearing; break;
    case 'maxHousingOD': one.maxHousingOD = r.maxHousingOD; break;
  }
  const errs = validateAdvisorLocks(g, one);
  if (errs.length) return errs[0].replace(/^Locked /, '').replace(/^./, (c) => c.toUpperCase());
  if (key === 'e' && s.on.D) {
    const K1 = (r.e * (s.on.Zp && mode !== 'motor' ? r.Zp : g.Zp)) / (r.D / 2);
    if (K1 >= 1) return `K1 = e·Zp / Rp = ${K1.toFixed(2)} must be below 1 with D and e both locked`;
  }
  return null;
}

/** Soft note for a locked row (does not block the run), or null. */
export function lockRowWarning(key: LockVarKey, s: AdvisorLockState, g: GearboxInputs): string | null {
  if (!s.on[key]) return null;
  const r = resolveLockValues(s, g);
  if (key === 'e' && s.on.D) {
    const K1 = (r.e * (s.on.Zp ? r.Zp : g.Zp)) / (r.D / 2);
    if (K1 < 0.4 || K1 > 0.85) return `K1 = ${K1.toFixed(2)} is outside the usual 0.40 to 0.85 range.`;
  }
  return null;
}

/** Every locked-value error, to block the Run button. */
export function lockErrors(s: AdvisorLockState, g: GearboxInputs, mode?: RatioMode): string[] {
  const out: string[] = [];
  for (const k of [...LOCK_VAR_KEYS, 'maxHousingOD' as const]) {
    const m = lockRowError(k, s, g, mode);
    if (m) out.push(m);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Normalization (localStorage, imported JSON). Old sessions have no locks: they get the defaults.
// ---------------------------------------------------------------------------

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const num = (x: unknown): number | null => (typeof x === 'number' && Number.isFinite(x) ? x : null);
const idx = (x: unknown, n: number): number | null => (typeof x === 'number' && Number.isInteger(x) && x >= 0 && x < n ? x : null);

function normOuter(x: unknown): OuterPinLock | null {
  if (!isObj(x)) return null;
  if (x.kind === 'catalog') { const i = idx(x.index, OUTER_PIN_OPTIONS.length); return i === null ? null : { kind: 'catalog', index: i }; }
  if (x.kind === 'custom') {
    const od = num(x.od), shank = num(x.shank);
    return od === null ? null : { kind: 'custom', od, shank: shank ?? od * 0.6 };
  }
  return null;
}
function normInner(x: unknown): InnerPinLock | null {
  if (!isObj(x)) return null;
  if (x.kind === 'catalog') { const i = idx(x.index, INNER_PIN_OPTIONS.length); return i === null ? null : { kind: 'catalog', index: i }; }
  if (x.kind === 'custom') {
    const od = num(x.od), bore = num(x.bore);
    return od === null ? null : { kind: 'custom', od, bore: bore ?? 0 };
  }
  return null;
}
function normBearing(x: unknown): BearingLock | null {
  if (!isObj(x)) return null;
  if (x.kind === 'catalog') { const i = idx(x.index, BEARINGS.length); return i === null ? null : { kind: 'catalog', index: i }; }
  if (x.kind === 'custom') {
    const OD = num(x.OD), C = num(x.C), C0 = num(x.C0);
    if (OD === null || C === null || C0 === null) return null;
    const bore = num(x.bore);
    return { kind: 'custom', name: typeof x.name === 'string' ? x.name.slice(0, 40) : undefined, bore: bore ?? undefined, OD, C, C0 };
  }
  return null;
}

/** Build a safe lock state from anything. Missing or garbled parts fall back to `base` (the defaults). */
export function normalizeLockState(raw: unknown, base: AdvisorLockState = defaultLockState()): AdvisorLockState {
  if (!isObj(raw)) return base;
  const out: AdvisorLockState = { on: { ...base.on }, ratioMotor: base.ratioMotor ?? null, limitOn: base.limitOn, values: { ...base.values } };
  try {
    if (typeof raw.ratioMotor === 'boolean' || raw.ratioMotor === null) out.ratioMotor = raw.ratioMotor;
    if (isObj(raw.on)) for (const k of LOCK_VAR_KEYS) if (typeof raw.on[k] === 'boolean') out.on[k] = raw.on[k] as boolean;
    if (typeof raw.limitOn === 'boolean') out.limitOn = raw.limitOn;
    if (isObj(raw.values)) {
      const v = raw.values;
      const zp = num(v.Zp); if (zp !== null || v.Zp === null) out.values.Zp = zp;
      for (const k of ['D', 'e', 'Zw', 'L'] as const) {
        const n = num(v[k]);
        if (n !== null || v[k] === null) out.values[k] = n;
      }
      if (v.discs === 1 || v.discs === 2 || v.discs === null) out.values.discs = v.discs;
      if (v.outerPin === null) out.values.outerPin = null; else { const o = normOuter(v.outerPin); if (o) out.values.outerPin = o; }
      if (v.innerPin === null) out.values.innerPin = null; else { const o = normInner(v.innerPin); if (o) out.values.innerPin = o; }
      if (v.bearing === null) out.values.bearing = null; else { const o = normBearing(v.bearing); if (o) out.values.bearing = o; }
      const m = num(v.maxHousingOD); if (m !== null) out.values.maxHousingOD = m;
    }
  } catch {
    return base;
  }
  return out;
}
