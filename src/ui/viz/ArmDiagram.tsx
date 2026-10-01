import type { ArmInputs } from '../../calc';
import { useU } from '../store';
import { useWidth } from './useWidth';

const clean = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

/** Live side view of the arm, drawn to scale from the lengths (straight out, worst gravity pose). Drafting style. */
export function ArmDiagram({ arm }: { arm: ArmInputs }) {
  const u = useU();
  const [ref, W] = useWidth<HTMLDivElement>(640);

  const len = arm.barLength_mm.map(clean);
  const jm = arm.jointMass_g.map(clean);
  const bm = arm.barMass_g.map(clean);
  const payload = clean(arm.payload_g);
  const riser = len[0];
  const horiz = len.slice(1);
  const reach = horiz.reduce((s, x) => s + x, 0);

  const leftM = W < 520 ? 84 : 96;
  const rightM = W < 520 ? 46 : 64;
  const topM = 4 + 3 * 34; // three dimension rows
  const scaleW = reach > 0 ? (W - leftM - rightM) / reach : 1;
  const scale = Math.max(0.05, Math.min(scaleW, 1.1, riser > 0 ? 210 / riser : 99));

  const maxMass = Math.max(1, ...jm);
  const rJ = jm.map((m) => 10 + 7 * Math.sqrt(m / maxMass));

  const x0 = leftM;
  const xs = [x0];
  for (const l of horiz) xs.push(xs[xs.length - 1] + l * scale); // J2, J3, J4, J5, tip
  const y0 = topM + 18;
  const riserPx = riser * scale;
  const yJ1 = y0 + riserPx;
  const H = yJ1 + rJ[0] + 46;

  const dims: { k: number; level: number }[] = [
    { k: 0, level: 0 }, { k: 1, level: 1 }, { k: 2, level: 0 }, { k: 3, level: 1 },
  ];
  const dimY = (level: number) => y0 - 34 * (level + 1) + 10;
  const jointX = [x0, xs[0], xs[1], xs[2], xs[3]]; // J1 (on the riser axis), J2..J5
  const jointY = [yJ1, y0, y0, y0, y0];
  const tipX = xs[4];
  const lvl = [0, 0, 0, 0, 0];
  if (jointX[2] - jointX[1] < 90) lvl[2] = 1;
  for (let i = 3; i < 5; i++) if (jointX[i] - jointX[i - 1] < 56 && lvl[i - 1] === 0) lvl[i] = 1;
  const mid = (a: number, b: number) => (a + b) / 2;
  const totalMass = jm.reduce((s, x) => s + x, 0) + bm.reduce((s, x) => s + x, 0) + payload;
  const label = `Arm side view to scale: reach ${u.fu('length', reach, { dp: 1, trim: true })}, riser ${u.fu('length', riser, { dp: 1, trim: true })}, total mass ${u.fu('mass', totalMass, { dp: 1, trim: true })}.`;
  const len_ = (mm: number) => u.fu('length', mm, { dp: 1, trim: true });
  const mass_ = (g: number) => u.fu('mass', g, { dp: 1, trim: true });

  const A = 5; // arrowhead length
  const dimLine = (key: string, xa: number, xb: number, y: number, textTop: string, textSub?: string) => (
    <g className="dr-dim" key={key}>
      <line x1={xa + A} x2={xb - A} y1={y} y2={y} />
      <path d={`M${xa} ${y} l${A} -2 v4 z`} className="dr-arrow" />
      <path d={`M${xb} ${y} l${-A} -2 v4 z`} className="dr-arrow" />
      {textSub && xb - xa < 112 ? (
        <>
          <text x={mid(xa, xb)} y={y - 5} textAnchor="middle" className="dr-text">{textTop}</text>
          <text x={mid(xa, xb)} y={y - 17} textAnchor="middle" className="dr-text dr-sub">{textSub}</text>
        </>
      ) : (
        <text x={mid(xa, xb)} y={y - 5} textAnchor="middle" className="dr-text">
          {textTop}
          {textSub && <tspan className="dr-sub">{'  '}{textSub}</tspan>}
        </text>
      )}
    </g>
  );

  return (
    <div ref={ref} className="armfig">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <title>{label}</title>

        {/* ground */}
        <g className="dr-ground">
          <line x1={x0 - 34} x2={x0 + 34} y1={yJ1 + rJ[0] + 10} y2={yJ1 + rJ[0] + 10} />
          {[-28, -18, -8, 2, 12, 22].map((dx) => (
            <line key={dx} x1={x0 + dx} x2={x0 + dx - 7} y1={yJ1 + rJ[0] + 10} y2={yJ1 + rJ[0] + 17} />
          ))}
          <line x1={x0} x2={x0} y1={yJ1 + rJ[0]} y2={yJ1 + rJ[0] + 10} />
        </g>

        {/* extension lines from the joints up to the dimension rows */}
        <g className="dr-ext">
          {xs.map((x, i) => (
            <line key={i} x1={x} x2={x} y1={y0 - (i === 4 ? 6 : rJ[i + 1]) - 2} y2={dimY(i === 0 || i === 4 ? 2 : 1) - 4} />
          ))}
        </g>

        {/* links */}
        <g className="dr-links">
          <rect className="dr-bar" x={x0 - 4.5} y={y0} width={9} height={Math.max(riserPx, 0.1)} />
          {horiz.map((_, i) => (
            <rect key={i} className="dr-bar" x={xs[i]} y={y0 - 4.5} width={Math.max(xs[i + 1] - xs[i], 0.1)} height={9} />
          ))}
          <line className="dr-center" x1={xs[0]} x2={tipX} y1={y0} y2={y0} />
        </g>

        {/* payload at the tip */}
        <g className="dr-payload">
          <line x1={tipX} x2={tipX} y1={y0} y2={y0 + 16} />
          <rect x={tipX - 8} y={y0 + 16} width={16} height={16} />
          <path d={`M${tipX} ${y0 + 46} l-3.5 -7 h7 z`} className="dr-arrow" />
          <text x={tipX} y={y0 + 62} textAnchor="middle" className="dr-text">{mass_(payload)}</text>
        </g>

        {/* dimensions */}
        {dims.map(({ k, level }) => dimLine(`d${k}`, xs[k], xs[k + 1], dimY(level), len_(horiz[k]), mass_(bm[k + 1])))}
        {dimLine('reach', xs[0], xs[4], dimY(2), `REACH ${len_(reach)}`)}

        {/* riser dimension on the left */}
        <g className="dr-dim">
          <line x1={x0 - 26} x2={x0 - 26} y1={y0 + A} y2={yJ1 - A} />
          <path d={`M${x0 - 26} ${y0} l-2 ${A} h4 z`} className="dr-arrow" />
          <path d={`M${x0 - 26} ${yJ1} l-2 ${-A} h4 z`} className="dr-arrow" />
          <line x1={x0 - 32} x2={x0 - 6} y1={y0} y2={y0} className="dr-ext-line" />
          <text x={x0 - 32} y={mid(y0, yJ1) - 1} textAnchor="end" className="dr-text">{len_(riser)}</text>
          <text x={x0 - 32} y={mid(y0, yJ1) + 11} textAnchor="end" className="dr-text dr-sub">{mass_(bm[0])}</text>
        </g>

        {/* joints */}
        {jointX.map((x, i) => (
          <g key={i} className="dr-joint">
            <circle cx={x} cy={jointY[i]} r={rJ[i]} />
            <text x={x} y={jointY[i] + 3.5} textAnchor="middle" className="dr-joint-name">{`J${i + 1}`}</text>
            <text
              x={i === 1 ? x + rJ[i] + 6 : x}
              y={i === 0 ? jointY[i] + rJ[i] + 38 : jointY[i] + rJ[i] + 14 + lvl[i] * 13}
              textAnchor={i === 1 ? 'start' : 'middle'}
              className="dr-text"
            >
              {mass_(jm[i])}
            </text>
          </g>
        ))}
      </svg>
      <p className="armfig-cap">
        Side view, to scale, arm straight out (worst gravity pose). Joint circles grow a little with mass; links show length and mass.
      </p>
    </div>
  );
}
