// Number formatting for the UI. Non-finite numbers never reach the screen as NaN / Infinity.

import type { Quantity, U } from './units';

export const DASH = '—';

const nf = new Map<number, Intl.NumberFormat>();
function fmtr(dp: number): Intl.NumberFormat {
  let f = nf.get(dp);
  if (!f) {
    f = new Intl.NumberFormat('en-US', { minimumFractionDigits: 0, maximumFractionDigits: dp });
    nf.set(dp, f);
  }
  return f;
}

/** Fixed maximum decimals, thousands separators; `—` for non-finite values. */
export function num(x: number | null | undefined, dp = 2): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const v = Math.abs(x) < 0.5 * Math.pow(10, -dp) ? 0 : x;
  return fmtr(dp).format(v);
}

/** Exactly `dp` decimals. */
export function fixed(x: number | null | undefined, dp = 2): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  return new Intl.NumberFormat('en-US', { minimumFractionDigits: dp, maximumFractionDigits: dp }).format(x);
}

/** Sensible digits by magnitude: 3 significant-ish figures for engineering read-outs. */
export function eng(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return DASH;
  const a = Math.abs(x);
  if (a === 0) return '0';
  if (a >= 1000) return num(x, 0);
  if (a >= 100) return num(x, 0);
  if (a >= 10) return num(x, 1);
  if (a >= 1) return num(x, 2);
  return num(x, 3);
}

/** Bearing life, h. Infinity and absurd values read as "> 10⁹ h". */
export function hours(h: number | null | undefined): string {
  if (h == null || Number.isNaN(h)) return DASH;
  if (!Number.isFinite(h) || h > 1e9) return '> 10⁹ h';
  if (h >= 1e6) return `${num(h / 1e6, 2)} M h`;
  return `${num(h, 0)} h`;
}

export function util(u: number | null | undefined): string {
  if (u == null || !Number.isFinite(u)) return DASH;
  if (u >= 99) return '> 99';
  return fixed(u, 2);
}

const QTY_OF_UNIT: Record<string, Quantity> = { MPa: 'stress', mm: 'length', N: 'force' };

function withUnit(value: number, unit: string, u?: U, dp?: number): string {
  if (!Number.isFinite(value)) return DASH;
  const q = QTY_OF_UNIT[unit];
  if (u && q) return u.fu(q, value, { dp: dp ?? (q === 'length' ? 2 : 0) });
  return `${num(value, unit === 'N' || unit === 'MPa' ? 0 : 2)} ${unit}`;
}

/** Text for a check value (display units when `u` is given), handling the Infinity cases of the engine. */
export function checkValue(id: string, value: number, unit: string, u?: U): string {
  if (id === 'bearingLife') return hours(value);
  if (id === 'cusp' && !Number.isFinite(value)) return 'no convex lobe';
  return withUnit(value, unit, u);
}

export function checkLimit(id: string, limit: number, unit: string, kind: 'max' | 'min', u?: U): string {
  const op = kind === 'max' ? '≤' : '≥';
  const v = id === 'bearingLife' ? `${num(limit, 0)} h` : withUnit(limit, unit, u);
  return `${op} ${v}`;
}

export function torque(x: number | null | undefined): string {
  return x == null || !Number.isFinite(x) ? DASH : fixed(x, 2);
}

/**
 * Disc thickness L. Stock plate sizes must read exactly (3.175, 4.76, 6.35, 9.525, 12.7 mm): up to 3 decimals in mm with
 * trailing zeros dropped, 3 decimals in inches (4 below 0.1 in, like every inch length).
 */
export function thickness(u: U, mm: number, withUnit = true): string {
  const o = { dp: u.prefs.length === 'in' ? 2 : 3, trim: true };
  return withUnit ? u.fu('length', mm, o) : u.f('length', mm, o);
}
