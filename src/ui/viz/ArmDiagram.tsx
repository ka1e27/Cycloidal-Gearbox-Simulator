import { useId } from 'react';
import type { ArmInputs } from '../../calc';
import { useU } from '../store';
import { useWidth } from './useWidth';

const clean = (x: number) => (Number.isFinite(x) && x > 0 ? x : 0);
const RAD = Math.PI / 180;
const A = 5; // arrowhead length
const CHAR_W = 6.4; // IBM Plex Mono advance at 10.5 px, for label collision checks
const textW = (s: string) => s.length * CHAR_W;

/* ---- motion symbols (kinematic-diagram conventions), shared by the drawing and the legend ---- */

/** Small curved arrow beside a pitch joint circle (axis into the page). */
function PitchArrow({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  const R = r + 5;
  const a0 = -18 * RAD;
  const a1 = -68 * RAD;
  const [xa, ya] = [cx + R * Math.cos(a0), cy + R * Math.sin(a0)];
  const [xb, yb] = [cx + R * Math.cos(a1), cy + R * Math.sin(a1)];
  const deg = Math.atan2(-Math.cos(a1), Math.sin(a1)) / RAD; // tangent direction at the end, angle decreasing
  return (
    <g>
      <path className="dr-motion" d={`M${xa} ${ya} A${R} ${R} 0 0 0 ${xb} ${yb}`} />
      <path className="dr-motion-head" d="M0 0 L-7 -3 L-7 3 Z" transform={`translate(${xb} ${yb}) rotate(${deg})`} />
    </g>
  );
}

/** Pitch joint: circle with an axis-into-page cross, plus the curved arrow. */
function PitchJoint({ cx, cy, r }: { cx: number; cy: number; r: number }) {
  return (
    <g className="dr-joint">
      <circle cx={cx} cy={cy} r={r} />
      <path className="dr-cross" d={`M${cx - 3.5} ${cy - 3.5} l7 7 m0 -7 l-7 7`} />
      <PitchArrow cx={cx} cy={cy} r={r} />
    </g>
  );
}

/** Yaw: an ellipse seen in perspective around the vertical axis. Back half dashed, front half solid with a head. */
function YawBack({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return <path className="dr-motion dr-motion-back" d={`M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`} />;
}
function YawFront({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return (
    <g>
      <path className="dr-motion" d={`M${cx - rx} ${cy} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`} />
      <path className="dr-motion-head" d={`M${cx + rx} ${cy - 2.5} l-3 6.5 h6 z`} />
    </g>
  );
}

/** Roll: a collar across the link plus an elliptical arrow around the link axis (axis runs left to right). */
function RollSymbol({ cx, cy, ry, rx = 9 }: { cx: number; cy: number; ry: number; rx?: number }) {
  const ch = Math.min(ry - 4, 9); // collar half-height, a little proud of the 9 px link
  return (
    <g className="dr-roll">
      <path className="dr-motion dr-motion-back" d={`M${cx} ${cy - ry} A${rx} ${ry} 0 0 0 ${cx} ${cy + ry}`} />
      <rect className="dr-collar" x={cx - 3.5} y={cy - ch} width={7} height={2 * ch} />
      <path className="dr-motion" d={`M${cx} ${cy - ry} A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}`} />
      <path className="dr-motion-head" d={`M${cx - 2} ${cy + ry} l8 -3.6 v7.2 z`} />
    </g>
  );
}

/** Tiny SVG legend: what the three motion symbols mean. */
function Legend() {
  return (
    <ul className="armfig-legend" aria-label="Legend">
      <li>
        <svg width={30} height={26} viewBox="0 0 30 26" aria-hidden="true">
          <PitchJoint cx={13} cy={14} r={6} />
        </svg>
        pitch
      </li>
      <li>
        <svg width={44} height={26} viewBox="0 0 44 26" aria-hidden="true">
          <line className="dr-axis" x1={22} x2={22} y1={1} y2={25} />
          <YawBack cx={22} cy={13} rx={16} ry={4.5} />
          <YawFront cx={22} cy={13} rx={16} ry={4.5} />
        </svg>
        yaw (vertical axis)
      </li>
      <li>
        <svg width={44} height={26} viewBox="0 0 44 26" aria-hidden="true">
          <line className="dr-axis" x1={1} x2={43} y1={13} y2={13} />
          <RollSymbol cx={20} cy={13} ry={10} />
        </svg>
        roll (axis along link)
      </li>
    </ul>
  );
}

interface Box { x1: number; x2: number; y1: number; y2: number }
const hit = (a: Box, b: Box, pad = 3) => a.x1 < b.x2 + pad && a.x2 > b.x1 - pad && a.y1 < b.y2 + pad && a.y2 > b.y1 - pad;

/** Live side view of the arm, drawn to scale from the lengths (straight out, worst gravity pose). Drafting style. */
export function ArmDiagram({ arm }: { arm: ArmInputs }) {
  const u = useU();
  const [ref, W] = useWidth<HTMLDivElement>(640);
  const hatchId = useId().replace(/:/g, '');

  const len = arm.barLength_mm.map(clean);
  const jm = arm.jointMass_g.map(clean);
  const bm = arm.barMass_g.map(clean);
  const payload = clean(arm.payload_g);
  const column = len[0]; // base column, J1 to J2 (rotates with J1)
  const horiz = len.slice(1);
  const reach = horiz.reduce((s, x) => s + x, 0);

  const rightM = W < 520 ? 46 : 64;
  const topM = 4 + 3 * 34; // three dimension rows
  const len_ = (mm: number) => u.fu('length', mm, { dp: 1, trim: true });
  const mass_ = (g: number) => u.fu('mass', g, { dp: 1, trim: true });
  const maxMass = Math.max(1, ...jm);
  const rJ = jm.map((m) => 10 + 7 * Math.sqrt(m / maxMass));

  const pw = 14 + rJ[0]; // J1 rotating platform half width
  const bw = pw + 7; // fixed base plate half width
  const cw = 8; // base column half width
  // room on the left for the base column dimension text (length, mass, "column")
  const colText = Math.max(textW(len_(column)), textW(mass_(bm[0])), textW('column'));
  const j2Left = Math.ceil(rJ[1] + 6 + textW('J2 shoulder') + 4); // J2 label sits up and to the left of its circle
  const leftM = Math.max(W < 520 ? 84 : 96, Math.ceil(bw + 12 + 6 + colText + 4), j2Left);
  const scaleW = reach > 0 ? (W - leftM - rightM) / reach : 1;
  const scale = Math.max(0.05, Math.min(scaleW, 1.1, column > 0 ? 210 / column : 99));

  const x0 = leftM;
  const xs = [x0];
  for (const l of horiz) xs.push(xs[xs.length - 1] + l * scale); // J2, J3, J4, J5, tip
  const y0 = topM + 18; // J2 axis (arm plane)
  const columnPx = column * scale;
  const yP = y0 + columnPx; // top of the turntable platform

  // turntable geometry (J1)
  const yGround = yP + 20;

  const jointX = [x0, xs[0], xs[1], xs[2], xs[3]]; // J1 (on the axis of the column), J2..J5
  const rollRy = Math.max(15, rJ[3] + 3);
  const halfH = [0, rJ[1], rJ[2], rollRy, rJ[4]]; // half height of each joint symbol
  const tipX = xs[4];

  const totalMass = jm.reduce((s, x) => s + x, 0) + bm.reduce((s, x) => s + x, 0) + payload;
  const label = `Arm side view to scale: reach ${len_(reach)}, base column ${len_(column)}, total mass ${u.fu('mass', totalMass, { dp: 1, trim: true })}. J1 turns the whole arm about a vertical axis; J2 pitches bar A.`;

  const dimY = (level: number) => y0 - 34 * (level + 1) + 10;
  const dims: { k: number; level: number }[] = [
    { k: 0, level: 0 }, { k: 1, level: 1 }, { k: 2, level: 0 }, { k: 3, level: 1 },
  ];
  const mid = (a: number, b: number) => (a + b) / 2;
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


  /* ---- joint labels: name + mass, placed below the arm in the first free slot ---- */
  const NAMES = ['J1 base yaw', 'J2 shoulder', 'J3 elbow', 'J4 roll', 'J5 wrist'];
  const ROW = 28;
  const payloadHalf = Math.max(10, textW(mass_(payload)) / 2 + 2);
  const obstacles: Box[] = [
    { x1: x0 - cw - 1, x2: x0 + cw + 1, y1: y0, y2: yP }, // column
    { x1: x0 - bw - 10, x2: x0 + bw + 10, y1: yP - 20, y2: yGround + 10 }, // turntable, yaw arrow and ground
    { x1: x0 - bw - 14 - 64, x2: x0 - bw - 6, y1: y0 - 4, y2: yP + 2 }, // column dimension text
    { x1: tipX - 10, x2: tipX + 10, y1: y0, y2: y0 + 48 }, // payload box and arrow
    { x1: tipX - payloadHalf, x2: tipX + payloadHalf, y1: y0 + 50, y2: y0 + 68 }, // payload mass
  ];
  const j1w = Math.max(textW(NAMES[0]), textW(mass_(jm[0])));
  const j1Top = yGround + 14;
  const j1Box: Box = { x1: x0 - j1w / 2, x2: x0 + j1w / 2, y1: j1Top - 1, y2: j1Top + 26 };
  obstacles.push(j1Box);

  interface Placed { box: Box; x: number; top: number; i: number; lead: [number, number, number, number] | null }
  // J2: name and mass up and to the left of the circle, clear of the column dimension; lifted when a short column
  // brings the yaw arrow up beside it
  const j2X = x0 - rJ[1] - 6;
  const j2Y = y0 - 6 - (columnPx < 26 ? 14 : 0);
  // J3..J5: every slot (row below the arm x horizontal shift) that clears the fixed parts, then the cheapest
  // combination in which no label or leader line crosses another (small depth-first search).
  const leadBox = (l: [number, number, number, number]): Box => ({ x1: Math.min(l[0], l[2]) - 1, x2: Math.max(l[0], l[2]) + 1, y1: l[1], y2: l[3] });
  const options = [2, 3, 4].map((i) => {
    const jx = jointX[i];
    const w = Math.max(textW(NAMES[i]), textW(mass_(jm[i])));
    const shifts = [-w / 2, -w + 12, -12, -w - 2, 2]; // x1 relative to the joint
    const out: (Placed & { cost: number })[] = [];
    for (let k = 0; k < 6; k++) {
      const top = y0 + halfH[i] + 8 + k * ROW;
      shifts.forEach((sh, si) => {
        const x1 = Math.min(Math.max(jx + sh, 2), W - 2 - w);
        const box: Box = { x1, x2: x1 + w, y1: top - 1, y2: top + 26 };
        if (obstacles.some((o) => hit(box, o))) return;
        const cx = Math.min(Math.max(jx, box.x1 + 2), box.x2 - 2);
        const lead: [number, number, number, number] | null = k > 0 || Math.abs(cx - jx) > 3 ? [jx, y0 + halfH[i], cx, top - 2] : null;
        if (lead && hit(leadBox(lead), j1Box, 1)) return;
        out.push({ box, x: x1 + w / 2, top, i, lead, cost: k * 12 + si * 3 });
      });
    }
    return out;
  });
  const clash = (a: Placed, b: Placed) =>
    hit(a.box, b.box) || (!!a.lead && hit(leadBox(a.lead), b.box, 1)) || (!!b.lead && hit(leadBox(b.lead), a.box, 1));
  let best: Placed[] | null = null;
  let bestCost = Infinity;
  const walk = (n: number, acc: (Placed & { cost: number })[], cost: number) => {
    if (cost >= bestCost) return;
    if (n === options.length) { best = acc.slice(); bestCost = cost; return; }
    for (const o of options[n]) {
      if (acc.some((p) => clash(p, o))) continue;
      acc.push(o);
      walk(n + 1, acc, cost + o.cost);
      acc.pop();
    }
  };
  walk(0, [], 0);
  const placed: Placed[] = best ?? [2, 3, 4].map((i) => {
    const w = Math.max(textW(NAMES[i]), textW(mass_(jm[i])));
    const top = y0 + halfH[i] + 8 + (i - 2) * ROW;
    return { box: { x1: jointX[i] - w / 2, x2: jointX[i] + w / 2, y1: top - 1, y2: top + 26 }, x: jointX[i], top, i, lead: null };
  });

  const H = Math.ceil(Math.max(j1Box.y2, y0 + 72, ...placed.map((p) => p.box.y2)) + 8);
  const hatchLines = [-bw + 2, -bw + 12, -bw + 22, -bw + 32, -bw + 42, -bw + 52, -bw + 62, -bw + 72].filter((dx) => dx <= bw + 4);

  return (
    <div ref={ref} className="armfig">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <title>{label}</title>
        <defs>
          <pattern id={`${hatchId}-body`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect className="dr-hatch-bg" width={6} height={6} />
            <line className="dr-hatch-ln" x1={0} x2={0} y1={0} y2={6} />
          </pattern>
        </defs>

        {/* ground and fixed base plate */}
        <g className="dr-ground">
          <line x1={x0 - bw - 8} x2={x0 + bw + 8} y1={yGround} y2={yGround} />
          {hatchLines.map((dx) => (
            <line key={dx} x1={x0 + dx + 8} x2={x0 + dx + 1} y1={yGround} y2={yGround + 7} />
          ))}
        </g>
        <rect className="dr-bar" x={x0 - bw} y={yP + 11} width={2 * bw} height={9} />

        {/* extension lines from the joints up to the dimension rows */}
        <g className="dr-ext">
          {xs.map((x, i) => (
            <line key={i} x1={x} x2={x} y1={y0 - (i === 4 ? 6 : halfH[i + 1]) - 2} y2={dimY(i === 0 || i === 4 ? 2 : 1) - 4} />
          ))}
        </g>

        {/* yaw arrow, back half (behind the column) */}
        <YawBack cx={x0} cy={yP - 12} rx={pw + 7} ry={5.5} />

        {/* rotating body: platform + base column, one piece that turns with J1 */}
        <g className="dr-body">
          <path
            d={`M${x0 - pw} ${yP + 8} V${yP} H${x0 - cw} V${y0} H${x0 + cw} V${yP} H${x0 + pw} V${yP + 8} Z`}
            fill={`url(#${hatchId}-body)`}
          />
          {/* turntable bearing between the platform and the base plate */}
          <rect className="dr-bearing" x={x0 - pw + 4} y={yP + 8} width={2 * pw - 8} height={3} />
        </g>

        {/* J1 axis, vertical dash-dot through the whole base */}
        <line className="dr-axis" x1={x0} x2={x0} y1={y0 + rJ[1]} y2={yGround + 6} />

        {/* yaw arrow, front half */}
        <YawFront cx={x0} cy={yP - 12} rx={pw + 7} ry={5.5} />

        {/* driven links: bars A to D */}
        <g className="dr-links">
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

        {/* base column dimension on the left: J2 axis down to the turntable top */}
        {(() => {
          const dx = x0 - bw - 12;
          const ty = Math.max(mid(y0, yP), y0 + 22); // keep the text below the J2 label when the column is short
          return (
            <g className="dr-dim">
              <line x1={dx} x2={dx} y1={y0 + A} y2={yP - A} />
              <path d={`M${dx} ${y0} l-2 ${A} h4 z`} className="dr-arrow" />
              <path d={`M${dx} ${yP} l-2 ${-A} h4 z`} className="dr-arrow" />
              <line x1={dx - 6} x2={x0 - rJ[1] - 2} y1={y0} y2={y0} className="dr-ext-line" />
              <line x1={dx - 6} x2={x0 - pw - 2} y1={yP} y2={yP} className="dr-ext-line" />
              <text x={dx - 6} y={ty - 12} textAnchor="end" className="dr-text dr-sub">column</text>
              <text x={dx - 6} y={ty - 1} textAnchor="end" className="dr-text">{len_(column)}</text>
              <text x={dx - 6} y={ty + 11} textAnchor="end" className="dr-text dr-sub">{mass_(bm[0])}</text>
            </g>
          );
        })()}

        {/* joints */}
        <PitchJoint cx={jointX[1]} cy={y0} r={rJ[1]} />
        <PitchJoint cx={jointX[2]} cy={y0} r={rJ[2]} />
        <RollSymbol cx={jointX[3]} cy={y0} ry={rollRy} />
        <PitchJoint cx={jointX[4]} cy={y0} r={rJ[4]} />

        {/* joint labels */}
        <g className="dr-labels">
          <text x={x0} y={j1Top + 9} textAnchor="middle" className="dr-joint-name">{NAMES[0]}</text>
          <text x={x0} y={j1Top + 21} textAnchor="middle" className="dr-text">{mass_(jm[0])}</text>
          <text x={j2X} y={j2Y - 12} textAnchor="end" className="dr-joint-name">{NAMES[1]}</text>
          <text x={j2X} y={j2Y} textAnchor="end" className="dr-text">{mass_(jm[1])}</text>
          {placed.map((p) => (
            <g key={p.i}>
              {p.lead && <line className="dr-lead" x1={p.lead[0]} y1={p.lead[1]} x2={p.lead[2]} y2={p.lead[3]} />}
              <text x={p.x} y={p.top + 9} textAnchor="middle" className="dr-joint-name">{NAMES[p.i]}</text>
              <text x={p.x} y={p.top + 21} textAnchor="middle" className="dr-text">{mass_(jm[p.i])}</text>
            </g>
          ))}
        </g>
      </svg>
      <Legend />
      <p className="armfig-cap">
        Side view, to scale, arm straight out (worst gravity pose). J1 turns the whole arm, base column included, about the
        vertical axis; J2 pitches bar A, the first link. Symbols grow a little with joint mass.
      </p>
    </div>
  );
}

