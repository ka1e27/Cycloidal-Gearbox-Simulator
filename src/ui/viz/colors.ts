// Sequential colour ramp for pin force (low -> high), one per theme.

const LIGHT = ['#f8e3a3', '#f08a24', '#b3241c'];
const DARK = ['#6b5a1c', '#e58a25', '#ff5b4d'];

function hex(h: string): [number, number, number] {
  return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
}

export function forceStops(theme: 'light' | 'dark'): string[] {
  return theme === 'dark' ? DARK : LIGHT;
}

/** t in 0..1 */
export function forceColor(t: number, theme: 'light' | 'dark'): string {
  const s = forceStops(theme).map(hex);
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0)) * (s.length - 1);
  const i = Math.min(s.length - 2, Math.floor(x));
  const f = x - i;
  const c = s[i].map((v, k) => Math.round(v + (s[i + 1][k] - v) * f));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

/** Round a maximum up to a "nice" axis limit and return ticks. */
export function niceScale(max: number, count = 4): { top: number; ticks: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { top: 1, ticks: [0, 1] };
  const raw = max / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const norm = raw / mag;
  const step = (norm <= 1 ? 1 : norm <= 2 ? 2 : norm <= 2.5 ? 2.5 : norm <= 5 ? 5 : 10) * mag;
  const top = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let v = 0; v <= top + step * 1e-6; v += step) ticks.push(Number(v.toPrecision(10)));
  return { top, ticks };
}
