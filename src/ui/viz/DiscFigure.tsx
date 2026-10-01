import { useMemo } from 'react';
import type { DiscDrawing } from '../../calc';
import { useU } from '../store';
import { forceColor, forceStops } from './colors';

/** The disc in the ring frame. Outer pins are coloured by force; hover / focus a pin for its number. */
export function DiscSvg({
  drawing,
  peak,
  theme,
  Rp,
  rr,
  size = 440,
  label,
}: {
  drawing: DiscDrawing | null;
  /** Force (N) that maps to the top of the colour scale */
  peak: number;
  theme: 'light' | 'dark';
  Rp: number;
  rr: number;
  size?: number | string;
  label?: string;
}) {
  const u = useU();
  const R = Rp + rr + Math.max(2, rr * 0.8);
  const path = useMemo(() => {
    if (!drawing) return '';
    const p = drawing.profile;
    let d = '';
    for (let i = 0; i < p.length; i++) d += `${i ? 'L' : 'M'}${p[i].x.toFixed(3)} ${(-p[i].y).toFixed(3)}`;
    return d + 'Z';
  }, [drawing]);
  if (!drawing) {
    return <div className="disc-empty" style={{ width: size, maxWidth: '100%' }}>No drawing for these inputs</div>;
  }
  const c = drawing.center;
  const cross = Math.max(1.2, rr * 0.5);
  return (
    <svg
      className="discsvg"
      viewBox={`${-R} ${-R} ${2 * R} ${2 * R}`}
      width={size}
      style={{ maxWidth: '100%', height: 'auto', aspectRatio: '1 / 1' }}
      role="img"
      aria-label={label ?? 'Cycloidal disc drawing with outer pins coloured by force'}
    >
      <circle className="disc-housing" cx={0} cy={0} r={Rp} />
      <path className="disc-profile" d={path} vectorEffect="non-scaling-stroke" />
      {drawing.innerHoles.map((h, i) => (
        <circle key={`h${i}`} className="disc-hole" cx={h.x} cy={-h.y} r={h.r} vectorEffect="non-scaling-stroke" />
      ))}
      <circle className="disc-hole" cx={drawing.bore.x} cy={-drawing.bore.y} r={drawing.bore.r} vectorEffect="non-scaling-stroke" />
      {drawing.outerPins.map((p) => (
        <circle
          key={p.index}
          className={p.loaded ? 'disc-pin is-loaded' : 'disc-pin'}
          cx={p.x}
          cy={-p.y}
          r={p.r}
          style={p.loaded ? { fill: forceColor(peak > 0 ? p.force / peak : 0, theme) } : undefined}
          vectorEffect="non-scaling-stroke"
        >
          <title>{`Pin ${p.index + 1}: ${p.loaded ? u.fu('force', p.force, { dp: 0 }) : 'unloaded'}`}</title>
        </circle>
      ))}
      {drawing.innerPins.map((p, i) => (
        <circle key={`ip${i}`} className="disc-inner-pin" cx={p.x} cy={-p.y} r={p.r} vectorEffect="non-scaling-stroke" />
      ))}
      <g className="disc-cross">
        <line x1={-cross} x2={cross} y1={0} y2={0} vectorEffect="non-scaling-stroke" />
        <line x1={0} x2={0} y1={-cross} y2={cross} vectorEffect="non-scaling-stroke" />
      </g>
      <g className="disc-cross is-disc">
        <line x1={c.x - cross} x2={c.x + cross} y1={-c.y} y2={-c.y} vectorEffect="non-scaling-stroke" />
        <line x1={c.x} x2={c.x} y1={-c.y - cross} y2={-c.y + cross} vectorEffect="non-scaling-stroke" />
      </g>
    </svg>
  );
}

export function ForceLegend({ peak, theme }: { peak: number; theme: 'light' | 'dark' }) {
  const u = useU();
  const [a, b, c] = forceStops(theme);
  return (
    <div className="legend" aria-label="Force colour scale">
      <div className="legend-row">
        <span className="legend-swatch is-unloaded" aria-hidden="true" />
        <span>unloaded</span>
      </div>
      <div className="legend-ramp">
        <span>0 {u.sym('force')}</span>
        <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${a}, ${b}, ${c})` }} aria-hidden="true" />
        <span>{u.fu('force', peak, { dp: 0 })}</span>
      </div>
      <div className="legend-note">Loaded pins, coloured by force at the design torque (peak over a revolution).</div>
    </div>
  );
}
