import type { ArmInputs } from '../../calc';
import { num } from '../format';
import { useWidth } from './useWidth';

const clean = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);

/** Live side view of the arm, drawn to scale from the lengths (straight out, worst gravity pose). */
export function ArmDiagram({ arm }: { arm: ArmInputs }) {
  const [ref, W] = useWidth<HTMLDivElement>(640);

  const len = arm.barLength_mm.map(clean);
  const jm = arm.jointMass_g.map(clean);
  const bm = arm.barMass_g.map(clean);
  const payload = clean(arm.payload_g);
  const riser = len[0];
  const horiz = len.slice(1);
  const reach = horiz.reduce((s, x) => s + x, 0);

  const leftM = W < 520 ? 82 : 92;
  const rightM = W < 520 ? 44 : 64;
  const topM = 4 + 3 * 34; // three dimension rows
  const scaleW = reach > 0 ? (W - leftM - rightM) / reach : 1;
  const scale = Math.max(0.05, Math.min(scaleW, 1.1, riser > 0 ? 210 / riser : 99));

  const maxMass = Math.max(1, ...jm);
  const rJ = jm.map((m) => 10 + 8 * Math.sqrt(m / maxMass));

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
  // stagger the mass labels of joints that sit close together
  const lvl = [0, 0, 0, 0, 0];
  if (jointX[2] - jointX[1] < 90) lvl[2] = 1;
  for (let i = 3; i < 5; i++) if (jointX[i] - jointX[i - 1] < 56 && lvl[i - 1] === 0) lvl[i] = 1;
  const mid = (a: number, b: number) => (a + b) / 2;
  const label = `Arm side view to scale: reach ${num(reach, 0)} millimetres, riser ${num(riser, 0)} millimetres, total mass ${num(jm.reduce((s, x) => s + x, 0) + bm.reduce((s, x) => s + x, 0) + payload, 0)} grams.`;

  const dimLine = (key: string, xa: number, xb: number, y: number, textTop: string, textSub?: string) => (
    <g className="arm-dim" key={key}>
      <line x1={xa} x2={xb} y1={y} y2={y} />
      <line x1={xa} x2={xa} y1={y - 4} y2={y + 4} />
      <line x1={xb} x2={xb} y1={y - 4} y2={y + 4} />
      {textSub && xb - xa < 104 ? (
        <>
          <text x={mid(xa, xb)} y={y - 6} textAnchor="middle" className="arm-dim-text">{textTop}</text>
          <text x={mid(xa, xb)} y={y - 18} textAnchor="middle" className="arm-dim-text arm-dim-sub">{textSub}</text>
        </>
      ) : (
        <text x={mid(xa, xb)} y={y - 6} textAnchor="middle" className="arm-dim-text">
          {textTop}
          {textSub && <tspan className="arm-dim-sub"> {'·'} {textSub}</tspan>}
        </text>
      )}
    </g>
  );

  return (
    <div ref={ref} className="armfig">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <title>{label}</title>

        {/* ground */}
        <g className="arm-ground">
          <line x1={x0 - 34} x2={x0 + 34} y1={yJ1 + rJ[0] + 10} y2={yJ1 + rJ[0] + 10} />
          {[-28, -18, -8, 2, 12, 22].map((dx) => (
            <line key={dx} x1={x0 + dx} x2={x0 + dx - 7} y1={yJ1 + rJ[0] + 10} y2={yJ1 + rJ[0] + 17} />
          ))}
          <line x1={x0} x2={x0} y1={yJ1 + rJ[0]} y2={yJ1 + rJ[0] + 10} />
        </g>

        {/* extension lines from the joints to the dimension rows */}
        <g className="arm-ext">
          {xs.map((x, i) => (
            <line key={i} x1={x} x2={x} y1={y0 - (i === 0 ? rJ[1] : i === 4 ? 6 : rJ[i + 1]) - 2} y2={dimY(i === 0 || i === 4 ? 2 : 1) - 0} />
          ))}
        </g>

        {/* links */}
        <g className="arm-links">
          <rect className="arm-bar" x={x0 - 4.5} y={y0} width={9} height={Math.max(riserPx, 0.1)} rx={4.5} />
          {horiz.map((_, i) => (
            <rect key={i} className="arm-bar" x={xs[i]} y={y0 - 4.5} width={Math.max(xs[i + 1] - xs[i], 0.1)} height={9} rx={4.5} />
          ))}
        </g>

        {/* payload at the tip */}
        <g className="arm-payload">
          <line x1={tipX} x2={tipX} y1={y0} y2={y0 + 18} />
          <rect x={tipX - 8} y={y0 + 18} width={16} height={16} rx={3} />
          <path d={`M${tipX} ${y0 + 46} l-4 -6 h8 z`} className="arm-arrow" />
          <text x={tipX} y={y0 + 62} textAnchor="middle" className="arm-mass">
            {num(payload, 0)} g
          </text>
        </g>

        {/* dimensions */}
        {dims.map(({ k, level }) =>
          dimLine(`d${k}`, xs[k], xs[k + 1], dimY(level), `${num(horiz[k], 0)} mm`, `${num(bm[k + 1], 0)} g`),
        )}
        {dimLine("reach", xs[0], xs[4], dimY(2), `Reach ${num(reach, 0)} mm`)}

        {/* riser dimension on the left */}
        <g className="arm-dim">
          <line x1={x0 - 26} x2={x0 - 26} y1={y0} y2={yJ1} />
          <line x1={x0 - 30} x2={x0 - 22} y1={y0} y2={y0} />
          <line x1={x0 - 30} x2={x0 - 22} y1={yJ1} y2={yJ1} />
          <text x={x0 - 32} y={mid(y0, yJ1) - 2} textAnchor="end" className="arm-dim-text">{num(riser, 0)} mm</text>
          <text x={x0 - 32} y={mid(y0, yJ1) + 11} textAnchor="end" className="arm-dim-text arm-dim-sub">{num(bm[0], 0)} g</text>
        </g>

        {/* joints */}
        {jointX.map((x, i) => (
          <g key={i} className="arm-joint">
            <circle cx={x} cy={jointY[i]} r={rJ[i]} />
            <text x={x} y={jointY[i] + 4} textAnchor="middle" className="arm-joint-name">{`J${i + 1}`}</text>
            <text
              x={i === 1 ? x + rJ[i] + 6 : x}
              y={i === 0 ? jointY[i] + rJ[i] + 38 : jointY[i] + rJ[i] + 14 + lvl[i] * 13}
              textAnchor={i === 1 ? 'start' : 'middle'}
              className="arm-mass"
            >
              {num(jm[i], 0)} g
            </text>
          </g>
        ))}
      </svg>
      <p className="armfig-cap">
        Side view, to scale, arm straight out (worst gravity pose). Circles are joints (size grows a little with mass),
        links show length and mass.
      </p>
    </div>
  );
}
