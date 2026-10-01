// Display units. The engine and the stored session are always SI-ish:
//   length mm, mass g, force N, torque N*m, stress MPa.
// Conversion happens only at the display / input boundary. Pure TypeScript (no React, no DOM).

export type Quantity = 'length' | 'mass' | 'force' | 'torque' | 'stress';

export type LengthUnit = 'mm' | 'in';
export type MassUnit = 'g' | 'kg' | 'oz' | 'lb';
export type ForceUnit = 'N' | 'lbf';
export type TorqueUnit = 'N·m' | 'lbf·in' | 'lbf·ft';
export type StressUnit = 'MPa' | 'ksi' | 'psi';

export interface UnitPrefs {
  length: LengthUnit;
  mass: MassUnit;
  force: ForceUnit;
  torque: TorqueUnit;
  stress: StressUnit;
}

/** Exact factors: how many SI base units (mm, g, N, N*m, MPa) one display unit is worth. */
export const IN_MM = 25.4;
export const OZ_G = 28.349523125;
export const LB_G = 453.59237;
export const LBF_N = 4.4482216152605;
export const LBF_IN_NM = LBF_N * 0.0254; // 0.11298482902761...
export const LBF_FT_NM = LBF_IN_NM * 12; // 1.3558179483314...
export const KSI_MPA = 6.894757293168361;
export const PSI_MPA = KSI_MPA / 1000;

export const FACTORS: { [Q in Quantity]: Record<string, number> } = {
  length: { mm: 1, in: IN_MM },
  mass: { g: 1, kg: 1000, oz: OZ_G, lb: LB_G },
  force: { N: 1, lbf: LBF_N },
  torque: { 'N·m': 1, 'lbf·in': LBF_IN_NM, 'lbf·ft': LBF_FT_NM },
  stress: { MPa: 1, ksi: KSI_MPA, psi: PSI_MPA },
};

export const UNIT_OPTIONS: { [Q in Quantity]: string[] } = {
  length: ['mm', 'in'],
  mass: ['g', 'kg', 'oz', 'lb'],
  force: ['N', 'lbf'],
  torque: ['N·m', 'lbf·in', 'lbf·ft'],
  stress: ['MPa', 'ksi', 'psi'],
};

export const QUANTITIES: Quantity[] = ['length', 'mass', 'force', 'torque', 'stress'];

export const METRIC: UnitPrefs = { length: 'mm', mass: 'g', force: 'N', torque: 'N·m', stress: 'MPa' };
export const IMPERIAL: UnitPrefs = { length: 'in', mass: 'oz', force: 'lbf', torque: 'lbf·in', stress: 'ksi' };

export type UnitSystem = 'metric' | 'imperial' | 'custom';

export function systemOf(p: UnitPrefs): UnitSystem {
  if (QUANTITIES.every((q) => p[q] === METRIC[q])) return 'metric';
  if (QUANTITIES.every((q) => p[q] === IMPERIAL[q])) return 'imperial';
  return 'custom';
}

/** Build a safe UnitPrefs from anything (saved session, imported file). Unknown values fall back to metric. */
export function normalizeUnits(raw: unknown): UnitPrefs {
  const out: UnitPrefs = { ...METRIC };
  if (!raw || typeof raw !== 'object') return out;
  const r = raw as Record<string, unknown>;
  for (const q of QUANTITIES) {
    const v = r[q];
    if (typeof v === 'string' && UNIT_OPTIONS[q].includes(v)) (out as unknown as Record<string, string>)[q] = v;
  }
  return out;
}

export function factor(q: Quantity, p: UnitPrefs): number {
  return FACTORS[q][p[q]];
}

export function symbol(q: Quantity, p: UnitPrefs): string {
  return p[q];
}

/** SI value -> value in the chosen display unit. */
export function toDisplay(q: Quantity, si: number, p: UnitPrefs): number {
  return si / factor(q, p);
}

/** Value typed in the chosen display unit -> SI value. */
export function fromDisplay(q: Quantity, shown: number, p: UnitPrefs): number {
  return shown * factor(q, p);
}

// ---------------------------------------------------------------------------
// Precision
// ---------------------------------------------------------------------------

/** Decimals the metric unit normally shows. Other units get extra decimals in proportion to their size. */
const BASE_DP: Record<Quantity, number> = { length: 2, mass: 1, force: 1, torque: 2, stress: 0 };

/**
 * Decimals for a display unit: mm 2, in 3, g 1, oz 2, N 1, lbf 2, N*m 2, lbf*in 2, MPa 0, ksi 1.
 * `base` (decimals a caller would use in the metric unit) scales the same way.
 */
export function decimals(q: Quantity, p: UnitPrefs, base: number = BASE_DP[q]): number {
  const f = factor(q, p);
  return base + Math.max(0, Math.round(Math.log10(f)));
}

/** Decimals for a concrete value: small numbers get extra decimals so they keep about 3 significant figures. */
export function decimalsFor(q: Quantity, shown: number, p: UnitPrefs, base?: number): number {
  const dp = decimals(q, p, base);
  const a = Math.abs(shown);
  if (!Number.isFinite(a) || a === 0 || a >= 1) return dp;
  const need = 2 - Math.floor(Math.log10(a)); // decimals needed for 3 significant figures
  return Math.min(Math.max(dp, need), dp + 4);
}

const fmtCache = new Map<string, Intl.NumberFormat>();
function intl(dp: number, fixed: boolean): Intl.NumberFormat {
  const key = `${dp}|${fixed}`;
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: fixed ? dp : 0, maximumFractionDigits: dp });
    fmtCache.set(key, f);
  }
  return f;
}

export interface FormatOptions {
  /** Decimals the caller would use in the metric unit (defaults per quantity) */
  dp?: number;
  /** Exactly the unit's decimals, without the extra decimals small values normally get (table columns) */
  fixed?: boolean;
  /** Append the unit symbol */
  unit?: boolean;
  /**
   * Read-outs keep trailing zeros ("1.30", "98.0") so the printed precision is honest. Pass `trim` for
   * prose and echoes of typed values ("85", "80.5") to drop them. Inch lengths never trim: a machinist
   * reads 1.300 in, not 1.3 in.
   */
  trim?: boolean;
}

export const DASH = '—';

/**
 * Decimals for an inch length: always 3 (0.001 in = 0.0254 mm), and 4 below 0.1 in so small values
 * keep three significant figures (0.0787 in, not 0.079). A caller that wants more than that
 * (eccentricity, dp 3 in mm) gets one more decimal than it asked for in mm.
 */
export function inchLengthDecimals(inchValue: number, base: number): number {
  const dp = Math.max(3, base + 1);
  const a = Math.abs(inchValue);
  return a > 0 && a < 0.1 ? Math.max(dp, 4) : dp;
}

/** Format an SI value in the display unit. Non-finite values give an em dash. */
export function formatQty(q: Quantity, si: number | null | undefined, p: UnitPrefs, o: FormatOptions = {}): string {
  if (si == null || !Number.isFinite(si)) return DASH;
  const raw = toDisplay(q, si, p);
  const d = Math.abs(raw) < 1e-9 ? 0 : raw; // float noise (-1e-17) prints as a plain 0, never "0.000000"
  const inch = q === 'length' && p.length === 'in';
  const base = o.dp ?? BASE_DP[q];
  if (Math.abs(d) >= 1e12) {
    // absurd magnitudes (a typed 1e308) read as 1.00e+308, never as a 309-digit string
    const e = d.toExponential(2);
    return o.unit ? `${e} ${symbol(q, p)}` : e;
  }
  const dp = inch ? inchLengthDecimals(d, base) : o.fixed ? decimals(q, p, o.dp) : decimalsFor(q, d, p, o.dp);
  const shown = Math.abs(d) < 0.5 * Math.pow(10, -dp) ? 0 : d;
  const s = intl(dp, inch || !o.trim).format(shown);
  return o.unit ? `${s} ${symbol(q, p)}` : s;
}

/** Significant digits of a number written with at most 9 digits (trailing zeros do not count). */
function sigDigits(x: number): number {
  if (x === 0) return 1;
  const mant = x.toExponential(8).split('e')[0].replace('-', '').replace('.', '').replace(/0+$/, '');
  return Math.max(1, mant.length);
}

/**
 * Text for an input box. A value that is "clean" in the display unit (what a person typed: 276.5, 0.0513,
 * 85) is shown exactly, so the box never hides digits of the stored value. A value that only looks long
 * because of the unit conversion (85 mm = 3.34645669... in) shows a tidy rounded view. Either way it is
 * never used to overwrite the stored SI value: only typing does that.
 */
export function inputText(q: Quantity, si: number | null | undefined, p: UnitPrefs): string {
  if (si == null || !Number.isFinite(si)) return '';
  const d = toDisplay(q, si, p);
  const clean = parseFloat(d.toPrecision(9));
  if (Math.abs(clean) >= 1e-6 || clean === 0) {
    if (sigDigits(clean) <= 6) return String(clean);
  }
  const dp = q === 'length' ? decimalsFor(q, d, p, p.length === 'in' ? 2 : 3) : decimalsFor(q, d, p);
  return String(parseFloat(d.toFixed(Math.min(dp, 12))));
}

/** A tidy arrow-key step in the display unit for a step given in SI units (1, 2 or 5 times a power of ten). */
export function niceStep(q: Quantity, siStep: number, p: UnitPrefs): number {
  const raw = siStep / factor(q, p);
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  if (factor(q, p) === 1) return siStep;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const n = raw / mag;
  const pick = [1, 2, 5, 10].reduce((best, c) => (Math.abs(Math.log(c / n)) < Math.abs(Math.log(best / n)) ? c : best), 1);
  return Number((pick * mag).toPrecision(6));
}

// ---------------------------------------------------------------------------
// Fractions (stock thickness in inch mode)
// ---------------------------------------------------------------------------

/** 3.175 mm -> `1/8"`; values that are not a simple fraction give the decimal inch value. */
export function inchFraction(mm: number): string {
  const inch = mm / IN_MM;
  for (const den of [2, 4, 8, 16, 32]) {
    const n = Math.round(inch * den);
    if (n > 0 && Math.abs(inch - n / den) < 0.0005) {
      let a = n;
      let b = den;
      while (a % 2 === 0 && b % 2 === 0) { a /= 2; b /= 2; }
      return b === 1 ? `${a}"` : `${a}/${b}"`;
    }
  }
  return `${inch.toFixed(3)}"`;
}

// ---------------------------------------------------------------------------
// Text localisation: "must be > 0 mm", "about 2.5 mm", "5.85 N*m" ... inside messages and tooltips
// ---------------------------------------------------------------------------

const NUM = String.raw`\d[\d,]*(?:\.\d+)?`;
const UNIT_RE = new RegExp(
  String.raw`(${NUM})(?:(\s*(?:to|–|-)\s*)(${NUM}))?(\s*)(mm|MPa|GPa|N\*m|N·m|N|g)(?![\w/²³·*])`,
  'g',
);
const QTY_OF: Record<string, Quantity> = { mm: 'length', MPa: 'stress', GPa: 'stress', 'N*m': 'torque', 'N·m': 'torque', N: 'force', g: 'mass' };
/** Written unit -> SI base units (GPa is 1000 MPa). */
const TEXT_SCALE: Record<string, number> = { GPa: 1000 };

/** Convert "number + metric unit" occurrences in a sentence to the chosen units. Metric prefs leave the text alone. */
export function localizeText(text: string, p: UnitPrefs): string {
  if (!text) return text;
  // engine messages can quote a non-finite number ("K1 = ... = Infinity"): the screen shows the app's dash instead
  text = text.replace(/-?\bInfinity\b|\bNaN\b/g, DASH);
  return text.replace(UNIT_RE, (whole, a: string, mid: string | undefined, b: string | undefined, sp: string, u: string) => {
    const q = QTY_OF[u];
    if (!q) return whole;
    const target = p[q];
    const natural = u === 'N*m' ? 'N·m' : u === 'GPa' ? 'MPa' : u;
    if (target === natural) return whole;
    const k = TEXT_SCALE[u] ?? 1;
    const conv = (s: string) => formatQty(q, Number(s.replace(/,/g, '')) * k, p, { trim: true });
    return `${conv(a)}${mid ?? ''}${b ? conv(b) : ''}${sp}${target}`;
  });
}

// ---------------------------------------------------------------------------
// Bound helper for components
// ---------------------------------------------------------------------------

export interface U {
  prefs: UnitPrefs;
  sym(q: Quantity): string;
  /** formatted number in the display unit */
  f(q: Quantity, si: number | null | undefined, o?: FormatOptions): string;
  /** formatted number with unit */
  fu(q: Quantity, si: number | null | undefined, o?: FormatOptions): string;
  toDisplay(q: Quantity, si: number): number;
  fromDisplay(q: Quantity, shown: number): number;
  text(s: string): string;
}

export function makeU(p: UnitPrefs): U {
  return {
    prefs: p,
    sym: (q) => symbol(q, p),
    f: (q, si, o) => formatQty(q, si, p, o),
    fu: (q, si, o) => formatQty(q, si, p, { ...o, unit: true }),
    toDisplay: (q, si) => toDisplay(q, si, p),
    fromDisplay: (q, shown) => fromDisplay(q, shown, p),
    text: (s) => localizeText(s, p),
  };
}
