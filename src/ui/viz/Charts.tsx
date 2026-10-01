import { useMemo } from 'react';
import type { DiscPin, SweepData } from '../../calc';
import { num } from '../format';
import { useU } from '../store';
import { forceColor, niceScale } from './colors';
import { useWidth } from './useWidth';

// ---------------------------------------------------------------------------
// Per-pin force bar chart at the current theta
// ---------------------------------------------------------------------------

export function PinForceChart({
  pins,
  peak,
  theme,
  thetaDeg,
}: {
  pins: DiscPin[] | null;
  peak: number;
  theme: 'light' | 'dark';
  thetaDeg: number;
}) {
  const u = useU();
  const [ref, W] = useWidth<HTMLDivElement>(560);
  const H = 210;
  const m = { l: 48, r: 10, t: 14, b: 28 };
  const dispPeak = u.toDisplay('force', peak);
  const scale = useMemo(
    () => niceScale(Math.max(dispPeak, ...(pins?.map((p) => u.toDisplay('force', p.force)) ?? [0])) * 1.02, 4),
    [dispPeak, pins, u],
  );
  if (!pins || pins.length === 0) return <div ref={ref} className="chart-empty">No pin data for these inputs.</div>;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = pins.length;
  const slot = iw / n;
  const bw = Math.max(2, Math.min(26, slot * 0.7));
  const y = (v: number) => m.t + ih - (v / scale.top) * ih;
  const every = slot >= 22 ? 1 : slot >= 13 ? 2 : slot >= 8 ? 3 : 5;
  const loaded = pins.filter((p) => p.loaded);
  const maxNow = Math.max(0, ...pins.map((p) => p.force));
  const desc = `Force on each of ${n} outer pins at input angle ${num(thetaDeg, 0)} degrees. ${loaded.length} pins are loaded, the largest force is ${u.fu('force', maxNow, { dp: 0 })}.`;
  return (
    <div ref={ref} className="chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc}>
        <title>{desc}</title>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
            <text className="ch-axis" x={m.l - 6} y={y(t) + 3.5} textAnchor="end">{num(t, t < 10 ? 1 : 0)}</text>
          </g>
        ))}
        <text className="ch-axis ch-unit" x={m.l} y={9} textAnchor="start">{u.sym('force')}</text>
        <line className="ch-base" x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} />
        {pins.map((p, i) => {
          const cx = m.l + slot * i + slot / 2;
          const h = p.loaded ? Math.max(1.5, (u.toDisplay('force', p.force) / scale.top) * ih) : 2;
          return (
            <g key={p.index}>
              <rect
                x={cx - bw / 2}
                y={m.t + ih - h}
                width={bw}
                height={h}
                className={p.loaded ? 'ch-bar' : 'ch-bar is-unloaded'}
                style={p.loaded ? { fill: forceColor(peak > 0 ? p.force / peak : 0, theme) } : undefined}
              >
                <title>{`Pin ${p.index + 1}: ${p.loaded ? u.fu('force', p.force, { dp: 1 }) : 'unloaded'}`}</title>
              </rect>
              {i % every === 0 && (
                <text className="ch-axis" x={cx} y={H - 10} textAnchor="middle">{p.index + 1}</text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Max ring p0 vs theta
// ---------------------------------------------------------------------------

export function SweepChart({
  sweep,
  thetaDeg,
  onTheta,
}: {
  sweep: SweepData;
  thetaDeg: number;
  onTheta: (deg: number) => void;
}) {
  const u = useU();
  const [ref, W] = useWidth<HTMLDivElement>(560);
  const H = 260;
  const m = { l: 52, r: 12, t: 16, b: 34 };
  const n = sweep.thetaDeg.length;
  const conv = (x: number) => u.toDisplay('stress', x);
  const sStr = useMemo(() => sweep.p0Strength.map(conv), [sweep.p0Strength, u]); // eslint-disable-line react-hooks/exhaustive-deps
  const sLife = useMemo(() => sweep.p0Life.map(conv), [sweep.p0Life, u]); // eslint-disable-line react-hooks/exhaustive-deps
  const limS = conv(sweep.limitStrength);
  const limL = conv(sweep.limitLife);
  const maxData = Math.max(0, ...sStr, ...sLife);
  const scale = useMemo(() => niceScale(Math.max(maxData, limS, limL) * 1.05, 5), [maxData, limS, limL]);
  if (n < 2) return <div ref={ref} className="chart-empty">No sweep data for these inputs.</div>;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (deg: number) => m.l + (deg / 360) * iw;
  const y = (v: number) => m.t + ih - (Math.min(v, scale.top) / scale.top) * ih;
  const line = (arr: number[]) => {
    let d = '';
    for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${x(sweep.thetaDeg[i]).toFixed(1)} ${y(arr[i]).toFixed(1)}`;
    d += `L${x(360).toFixed(1)} ${y(arr[0]).toFixed(1)}`;
    return d;
  };
  const idx = Math.min(n - 1, Math.max(0, Math.round((thetaDeg / 360) * n) % n));
  const cur = { s: sStr[idx], l: sLife[idx] };
  const f0 = (v: number) => num(v, v < 10 ? 1 : 0);
  const desc = `Peak ring contact pressure against input angle over one revolution. At ${num(thetaDeg, 0)} degrees: strength case ${f0(cur.s)} ${u.sym('stress')} against a limit of ${f0(limS)}, life case ${f0(cur.l)} ${u.sym('stress')} against ${f0(limL)}.`;

  const setFromEvent = (e: React.PointerEvent<SVGSVGElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left;
    const deg = ((px - m.l) / iw) * 360;
    onTheta(Math.min(360, Math.max(0, deg)) % 360);
  };

  const xticks = [0, 60, 120, 180, 240, 300, 360];
  return (
    <div ref={ref} className="chart">
      <svg
        width={W}
        height={H}
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={desc}
        className="ch-interactive"
        onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); setFromEvent(e); }}
        onPointerMove={(e) => { if (e.buttons) setFromEvent(e); }}
      >
        <title>{desc}</title>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
            <text className="ch-axis" x={m.l - 6} y={y(t) + 3.5} textAnchor="end">{num(t, t < 10 ? 1 : 0)}</text>
          </g>
        ))}
        {xticks.map((t) => (
          <g key={t}>
            <line className="ch-tick" x1={x(t)} x2={x(t)} y1={m.t + ih} y2={m.t + ih + 4} />
            <text className="ch-axis" x={x(t)} y={H - 14} textAnchor="middle">{t}°</text>
          </g>
        ))}
        <line className="ch-base" x1={m.l} x2={W - m.r} y1={m.t + ih} y2={m.t + ih} />
        <text className="ch-axis ch-unit" x={m.l} y={9} textAnchor="start">{u.sym('stress')}</text>
        <text className="ch-axis" x={m.l + iw / 2} y={H - 1} textAnchor="middle">input angle θ</text>

        {/* limit lines */}
        <line className="ch-limit is-strength" x1={m.l} x2={W - m.r} y1={y(limS)} y2={y(limS)} />
        <line className="ch-limit is-life" x1={m.l} x2={W - m.r} y1={y(limL)} y2={y(limL)} />
        <text className="ch-limit-label" x={W - m.r - 4} y={y(limS) - 5} textAnchor="end">strength limit {f0(limS)}</text>
        <text className="ch-limit-label" x={W - m.r - 4} y={y(limL) - 5} textAnchor="end">life limit {f0(limL)}</text>

        {/* curves */}
        <path className="ch-line is-life" d={line(sLife)} />
        <path className="ch-line is-strength" d={line(sStr)} />

        {/* current theta */}
        <line className="ch-cursor" x1={x(thetaDeg)} x2={x(thetaDeg)} y1={m.t} y2={m.t + ih} />
        <circle className="ch-dot" cx={x(thetaDeg)} cy={y(cur.s)} r={4} />
        <circle className="ch-dot is-life" cx={x(thetaDeg)} cy={y(cur.l)} r={4} />
      </svg>
      <div className="ch-legend">
        <span><i className="ch-swatch is-strength" /> strength case (T_des)</span>
        <span><i className="ch-swatch is-life" /> life case (T_req)</span>
        <span className="ch-legend-now">
          at {num(thetaDeg, 0)}°: {f0(cur.s)} / {f0(cur.l)} {u.sym('stress')}
        </span>
      </div>
    </div>
  );
}
