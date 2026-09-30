import { useMemo } from 'react';
import type { DiscPin, SweepData } from '../../calc';
import { num } from '../format';
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
  const [ref, W] = useWidth<HTMLDivElement>(560);
  const H = 210;
  const m = { l: 44, r: 10, t: 12, b: 28 };
  const scale = useMemo(() => niceScale(Math.max(peak, ...(pins?.map((p) => p.force) ?? [0])) * 1.02, 4), [peak, pins]);
  if (!pins || pins.length === 0) return <div ref={ref} className="chart-empty">No pin data for these inputs.</div>;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const n = pins.length;
  const slot = iw / n;
  const bw = Math.max(2, Math.min(28, slot * 0.72));
  const y = (v: number) => m.t + ih - (v / scale.top) * ih;
  const every = slot >= 22 ? 1 : slot >= 13 ? 2 : slot >= 8 ? 3 : 5;
  const loaded = pins.filter((p) => p.loaded);
  const maxNow = Math.max(0, ...pins.map((p) => p.force));
  const desc = `Force on each of ${n} outer pins at input angle ${num(thetaDeg, 0)} degrees. ${loaded.length} pins are loaded, the largest force is ${num(maxNow, 0)} newtons.`;
  return (
    <div ref={ref} className="chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={desc}>
        <title>{desc}</title>
        {scale.ticks.map((t) => (
          <g key={t}>
            <line className="ch-grid" x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} />
            <text className="ch-axis" x={m.l - 6} y={y(t) + 4} textAnchor="end">{num(t, 0)}</text>
          </g>
        ))}
        <text className="ch-axis" x={m.l} y={8} textAnchor="start">N</text>
        {pins.map((p, i) => {
          const cx = m.l + slot * i + slot / 2;
          const h = p.loaded ? Math.max(1.5, (p.force / scale.top) * ih) : 2;
          return (
            <g key={p.index}>
              <rect
                x={cx - bw / 2}
                y={m.t + ih - h}
                width={bw}
                height={h}
                rx={Math.min(3, bw / 3)}
                className={p.loaded ? 'ch-bar' : 'ch-bar is-unloaded'}
                style={p.loaded ? { fill: forceColor(peak > 0 ? p.force / peak : 0, theme) } : undefined}
              >
                <title>{`Pin ${p.index + 1}: ${p.loaded ? `${num(p.force, 1)} N` : 'unloaded'}`}</title>
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
  const [ref, W] = useWidth<HTMLDivElement>(560);
  const H = 260;
  const m = { l: 48, r: 12, t: 14, b: 34 };
  const n = sweep.thetaDeg.length;
  const maxData = Math.max(0, ...sweep.p0Strength, ...sweep.p0Life);
  const scale = useMemo(
    () => niceScale(Math.max(maxData, sweep.limitStrength, sweep.limitLife) * 1.05, 5),
    [maxData, sweep.limitStrength, sweep.limitLife],
  );
  if (n < 2) return <div ref={ref} className="chart-empty">No sweep data for these inputs.</div>;
  const iw = W - m.l - m.r;
  const ih = H - m.t - m.b;
  const x = (deg: number) => m.l + (deg / 360) * iw;
  const y = (v: number) => m.t + ih - (Math.min(v, scale.top) / scale.top) * ih;
  const line = (arr: number[]) => {
    let d = '';
    for (let i = 0; i < n; i++) d += `${i ? 'L' : 'M'}${x(sweep.thetaDeg[i]).toFixed(1)} ${y(arr[i]).toFixed(1)}`;
    // close the loop back to 360 deg (same as 0 deg)
    d += `L${x(360).toFixed(1)} ${y(arr[0]).toFixed(1)}`;
    return d;
  };
  const idx = Math.min(n - 1, Math.max(0, Math.round((thetaDeg / 360) * n) % n));
  const cur = { s: sweep.p0Strength[idx], l: sweep.p0Life[idx] };
  const desc = `Peak ring contact pressure against input angle over one revolution. At ${num(thetaDeg, 0)} degrees: strength case ${num(cur.s, 0)} MPa against a limit of ${num(sweep.limitStrength, 0)}, life case ${num(cur.l, 0)} MPa against ${num(sweep.limitLife, 0)}.`;

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
            <text className="ch-axis" x={m.l - 6} y={y(t) + 4} textAnchor="end">{num(t, 0)}</text>
          </g>
        ))}
        {xticks.map((t) => (
          <g key={t}>
            <line className="ch-tick" x1={x(t)} x2={x(t)} y1={m.t + ih} y2={m.t + ih + 4} />
            <text className="ch-axis" x={x(t)} y={H - 14} textAnchor="middle">{t}{'°'}</text>
          </g>
        ))}
        <text className="ch-axis" x={m.l} y={9} textAnchor="start">MPa</text>
        <text className="ch-axis" x={m.l + iw / 2} y={H - 1} textAnchor="middle">input angle {'θ'}</text>

        {/* limit lines */}
        <line className="ch-limit is-strength" x1={m.l} x2={W - m.r} y1={y(sweep.limitStrength)} y2={y(sweep.limitStrength)} />
        <line className="ch-limit is-life" x1={m.l} x2={W - m.r} y1={y(sweep.limitLife)} y2={y(sweep.limitLife)} />
        <text className="ch-limit-label is-strength" x={W - m.r - 4} y={y(sweep.limitStrength) - 5} textAnchor="end">
          strength limit {num(sweep.limitStrength, 0)}
        </text>
        <text className="ch-limit-label is-life" x={W - m.r - 4} y={y(sweep.limitLife) - 5} textAnchor="end">
          life limit {num(sweep.limitLife, 0)}
        </text>

        {/* curves */}
        <path className="ch-line is-life" d={line(sweep.p0Life)} />
        <path className="ch-line is-strength" d={line(sweep.p0Strength)} />

        {/* current theta */}
        <line className="ch-cursor" x1={x(thetaDeg)} x2={x(thetaDeg)} y1={m.t} y2={m.t + ih} />
        <circle className="ch-dot is-strength" cx={x(thetaDeg)} cy={y(cur.s)} r={4.5} />
        <circle className="ch-dot is-life" cx={x(thetaDeg)} cy={y(cur.l)} r={4.5} />
      </svg>
      <div className="ch-legend">
        <span><i className="ch-swatch is-strength" /> strength case (T_des)</span>
        <span><i className="ch-swatch is-life" /> life case (T_req)</span>
        <span className="ch-legend-now">
          at {num(thetaDeg, 0)}{'°'}: {num(cur.s, 0)} / {num(cur.l, 0)} MPa
        </span>
      </div>
    </div>
  );
}
