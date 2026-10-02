import { useId } from 'react';
import { jointLabel, type ArmInputs } from '../../calc';
import { Segmented } from '../components/primitives';
import { HELP } from '../help';
import { useStore } from '../store';

import { hit, layoutArm, placeLabels, type Box, type LabelRequest, type PoseMode } from './armLayout';
import { PitchJoint, RollSymbol, YawBack, YawFront } from './armSymbols';
import { useWidth } from './useWidth';

/** Drawing input: finite, non-negative, and capped so absurd values (an invalid arm) still give a finite picture. */
const clean = (x: number) => (Number.isFinite(x) && x > 0 ? Math.min(x, 1e7) : 0);
const A = 5; // arrowhead length
const CHAR_W = 6.4; // IBM Plex Mono advance at 10.5 px, for label collision checks
const textW = (s: string) => s.length * CHAR_W;
const LINK_HALF = 4.5; // half the drawn link thickness
const trunc = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

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

const POSES: { value: PoseMode; label: string; title: string }[] = [
  { value: 'ready', label: 'Ready pose', title: 'Shoulder on the base, elbow above it, later links out' },
  { value: 'worst', label: 'Worst case (straight out)', title: 'The pose every torque is computed for' },
];

/** Live side view of the arm, drawn to scale from the joint list. Drafting style. Any chain of 1 to 8 joints. */
export function ArmDiagram({ arm }: { arm: ArmInputs }) {
  const [ref, W] = useWidth<HTMLDivElement>(640);
  const { state, dispatch, u } = useStore();
  const mode = state.armPose;
  const setMode = (m: PoseMode) => dispatch({ type: 'pose', pose: m });
  const hatchId = useId().replace(/:/g, '');
  const joints = Array.isArray(arm?.joints) ? arm.joints : [];
  const n = joints.length;

  const len_ = (mm: number) => u.fu('length', mm, { dp: 1, trim: true });
  const mass_ = (g: number) => u.fu('mass', g, { dp: 1, trim: true });
  const poseSwitch = (
    <div className="armfig-tools">
      <Segmented<PoseMode> value={mode} onChange={setMode} label="Drawing pose" size="sm" options={POSES} help={HELP.drawingPose} />
    </div>
  );
  if (n === 0) return <div ref={ref} className="armfig">{poseSwitch}<p className="armfig-cap">Add a joint to see the arm.</p></div>;

  const L = joints.map((j) => clean(j.length_mm));
  const jm = joints.map((j) => clean(j.mass_g));
  const lm = joints.map((j) => clean(j.linkMass_g));
  const payload = clean(arm.payload_g);
  const geo = layoutArm(joints.map((j, i) => ({ motion: j.motion, length_mm: L[i] })), mode);
  const { points, dirs, vertical } = geo;
  const modelW = geo.bbox.maxX - geo.bbox.minX;
  const modelH = geo.bbox.maxY - geo.bbox.minY;
  const nHoriz = vertical.filter((v) => !v).length;
  const nVert = vertical.filter((v) => v).length;
  const first = joints.findIndex((j) => j.motion === 'pitch');
  const reachMm = first < 0 ? 0 : L.slice(first).reduce((s, x) => s + x, 0);
  const showReach = mode === 'worst' && reachMm > 0;

  // symbol sizes: grow a little with joint mass, shrink where links are short
  const maxMass = Math.max(1, ...jm);
  const small = W < 520;
  const rightM = small ? 46 : 64;
  const baseR = 10 + 7 * Math.sqrt(jm[0] / maxMass);
  const yawBase = joints[0].motion === 'yaw';
  const pw = 12 + baseR; // turntable half width
  const bw = pw + 7; // fixed base plate half width
  const vTextW = Math.max(0, ...joints.map((_, i) => (vertical[i] ? Math.max(textW(len_(L[i])), textW(mass_(lm[i]))) : 0)));
  const leftM = nVert > 0 ? Math.max(small ? 84 : 96, Math.ceil(bw + 12 + 6 + vTextW + 6)) : Math.ceil(bw + 14);
  const levels = Math.min(3, Math.max(1, nHoriz)) + (showReach ? 1 : 0);
  const tipUp = dirs[n - 1].y > 0.5; // the payload sits on top of a vertical tool
  const topM = 14 + (tipUp ? 32 : 0) + (nHoriz > 0 ? 34 * levels + 8 : 0);
  const bottomM = 64;
  const innerW = Math.max(60, W - leftM - rightM);
  const innerH = 300;
  const scale = Math.max(1e-9, Math.min(modelW > 0 ? innerW / modelW : 99, modelH > 0 ? innerH / modelH : 99, 1.15));
  const H = Math.ceil(topM + modelH * scale + bottomM);

  const shiftX = Math.max(0, Math.min(90, (innerW - modelW * scale) / 2));
  const px = (p: { x: number; y: number }) => ({ x: leftM + shiftX + (p.x - geo.bbox.minX) * scale, y: topM + (geo.bbox.maxY - p.y) * scale });
  const P = points.map(px);
  const linkPx = L.map((l) => l * scale);
  const rMass = jm.map((m) => 10 + 7 * Math.sqrt(m / maxMass));
  const rJ = rMass.map((r, i) => {
    let cap = Infinity;
    for (const k of [i - 1, i]) if (k >= 0 && k < n && linkPx[k] >= 6) cap = Math.min(cap, linkPx[k] * 0.46);
    return Math.max(4.5, Math.min(r, cap));
  });
  const rollRy = (i: number) => Math.max(10, Math.min(15, rJ[i] + 3));

  // base: turntable (yaw) or a plain block under the first joint
  let baseY = P[0].y;
  if (yawBase && n > 1 && vertical[0]) baseY = Math.max(baseY, P[1].y + rJ[1] + 3); // a short column: the shoulder sits right on the platform
  if (!yawBase) baseY = P[0].y + (joints[0].motion === 'roll' ? rollRy(0) : rJ[0]) + 2;
  const x0 = P[0].x;
  const yGround = baseY + 20;
  const totalMass = jm.reduce((s, x) => s + x, 0) + lm.reduce((s, x) => s + x, 0) + payload;

  const obstacles: Box[] = [];
  const addBox = (x1: number, y1: number, x2: number, y2: number) => obstacles.push({ x1: Math.min(x1, x2), x2: Math.max(x1, x2), y1: Math.min(y1, y2), y2: Math.max(y1, y2) });
  addBox(x0 - bw - 8, baseY - 12, x0 + bw + 8, yGround + 9); // base, turntable arrow and ground
  P.slice(0, n).forEach((p, i) => {
    const rr = joints[i].motion === 'roll' ? rollRy(i) : joints[i].motion === 'yaw' && i > 0 ? rJ[i] + 8 : rJ[i] + 5;
    addBox(p.x - rr, p.y - rr, p.x + rr, p.y + rr);
  });
  const linkPoly: [number, number][][] = [];
  for (let i = 0; i < n; i++) {
    const a = P[i];
    const b = P[i + 1];
    const d = dirs[i];
    const nx = d.y; // screen direction is (dx, -dy), so its normal is (dy, dx)
    const ny = d.x;
    const quad: [number, number][] = [
      [a.x + nx * LINK_HALF, a.y + ny * LINK_HALF], [b.x + nx * LINK_HALF, b.y + ny * LINK_HALF],
      [b.x - nx * LINK_HALF, b.y - ny * LINK_HALF], [a.x - nx * LINK_HALF, a.y - ny * LINK_HALF],
    ];
    linkPoly.push(quad);
    addBox(a.x - LINK_HALF, a.y - LINK_HALF, b.x + LINK_HALF, b.y + LINK_HALF);
  }

  // ---- dimensions: horizontal links get a dimension line above, vertical links one on the left ----
  const dimTexts: Box[] = [];
  const dimEls: React.ReactNode[] = [];
  const extLines: React.ReactNode[] = [];
  const clearBox = (b: Box) => !dimTexts.some((t) => hit(b, t, 2));
  const ext = (key: string, x1: number, y1: number, x2: number, y2: number) => {
    extLines.push(<line key={key} x1={x1} x2={x2} y1={y1} y2={y2} />);
    addBox(x1 - 1, y1, x2 + 1, y2);
  };
  const vDimX = x0 - bw - 12;
  for (let i = 0; i < n; i++) {
    if (linkPx[i] < 16) continue;
    const a = P[i];
    const b = P[i + 1];
    const top = len_(L[i]);
    const sub = mass_(lm[i]);
    if (!vertical[i]) {
      const xa = a.x;
      const xb = b.x;
      const wide = xb - xa >= 112;
      const tw = Math.max(textW(top) + (wide ? textW(sub) + 14 : 0), wide ? 0 : textW(sub));
      let level = 0;
      for (; level < 3; level++) {
        const y = a.y - 22 - level * 34;
        const box: Box = { x1: (xa + xb) / 2 - tw / 2, x2: (xa + xb) / 2 + tw / 2, y1: y - (wide ? 16 : 28), y2: y };
        if (clearBox(box) || level === 2) { dimTexts.push(box); break; }
      }
      const y = a.y - 22 - level * 34;
      obstacles.push({ ...dimTexts[dimTexts.length - 1], text: true });
      ext(`e${i}a`, xa, a.y - rJ[i] - 2, xa, y - 4);
      ext(`e${i}b`, xb, b.y - (i + 1 < n ? rJ[i + 1] : 6) - 2, xb, y - 4);
      const mid = (xa + xb) / 2;
      dimEls.push(
        <g className="dr-dim" key={`d${i}`}>
          <line x1={xa + A} x2={xb - A} y1={y} y2={y} />
          <path d={`M${xa} ${y} l${A} -2 v4 z`} className="dr-arrow" />
          <path d={`M${xb} ${y} l${-A} -2 v4 z`} className="dr-arrow" />
          {wide ? (
            <text x={mid} y={y - 5} textAnchor="middle" className="dr-text">{top}<tspan className="dr-sub">{'  '}{sub}</tspan></text>
          ) : (
            <>
              <text x={mid} y={y - 5} textAnchor="middle" className="dr-text">{top}</text>
              <text x={mid} y={y - 17} textAnchor="middle" className="dr-text dr-sub">{sub}</text>
            </>
          )}
        </g>,
      );
    } else {
      const ya = b.y; // top end (model y is up, screen y is down)
      const yb = a.y;
      const mid = (ya + yb) / 2;
      const two = yb - ya >= 30;
      let ty = mid;
      const th = two ? 24 : 12;
      let box: Box = { x1: vDimX - 6 - Math.max(textW(top), two ? textW(sub) : 0), x2: vDimX - 6, y1: ty - th / 2 - 2, y2: ty + th / 2 + 2 };
      let guard = 0;
      while (!clearBox(box) && guard++ < 6) { ty += 14; box = { ...box, y1: ty - th / 2 - 2, y2: ty + th / 2 + 2 }; }
      dimTexts.push(box);
      obstacles.push({ ...box, text: true });
      ext(`e${i}a`, vDimX - 6, yb, a.x - rJ[i] - 2, yb);
      ext(`e${i}b`, vDimX - 6, ya, b.x - (i + 1 < n ? rJ[i + 1] : 6) - 2, ya);
      dimEls.push(
        <g className="dr-dim" key={`d${i}`}>
          <line x1={vDimX} x2={vDimX} y1={ya + A} y2={yb - A} />
          <path d={`M${vDimX} ${ya} l-2 ${A} h4 z`} className="dr-arrow" />
          <path d={`M${vDimX} ${yb} l-2 ${-A} h4 z`} className="dr-arrow" />
          {two ? (
            <>
              <text x={vDimX - 6} y={ty - 1} textAnchor="end" className="dr-text">{top}</text>
              <text x={vDimX - 6} y={ty + 11} textAnchor="end" className="dr-text dr-sub">{sub}</text>
            </>
          ) : (
            <text x={vDimX - 6} y={ty + 4} textAnchor="end" className="dr-text">{top}</text>
          )}
        </g>,
      );
    }
  }
  // reach dimension (worst case only): from the first pitch joint to the tip
  let reachEl: React.ReactNode = null;
  if (showReach && first >= 0) {
    const xa = P[first].x;
    const xb = P[n].x;
    const y = P[first].y - 22 - (levels - 1) * 34;
    const txt = `REACH ${len_(reachMm)}`;
    obstacles.push({ x1: (xa + xb) / 2 - textW(txt) / 2, x2: (xa + xb) / 2 + textW(txt) / 2, y1: y - 16, y2: y, text: true });
    ext('re-a', xa, P[first].y - rJ[first] - 2, xa, y - 4);
    ext('re-b', xb, P[n].y - 6, xb, y - 4);
    reachEl = (
      <g className="dr-dim">
        <line x1={xa + A} x2={xb - A} y1={y} y2={y} />
        <path d={`M${xa} ${y} l${A} -2 v4 z`} className="dr-arrow" />
        <path d={`M${xb} ${y} l${-A} -2 v4 z`} className="dr-arrow" />
        <text x={(xa + xb) / 2} y={y - 5} textAnchor="middle" className="dr-text">{txt}</text>
      </g>
    );
  }

  // ---- payload at the tip ----
  const tip = P[n];
  const lastDir = dirs[n - 1];
  const payloadText = mass_(payload);
  let payloadEl: React.ReactNode;
  if (lastDir.y > 0.5) {
    // tool pointing up: the payload sits on the end of the tool, the label beside it
    payloadEl = (
      <g className="dr-payload">
        <line x1={tip.x} x2={tip.x} y1={tip.y} y2={tip.y - 12} />
        <rect x={tip.x - 8} y={tip.y - 28} width={16} height={16} />
        <text x={tip.x + 13} y={tip.y - 16} textAnchor="start" className="dr-text">{payloadText}</text>
      </g>
    );
    addBox(tip.x - 8, tip.y - 28, tip.x + 14 + textW(payloadText), tip.y);
  } else {
    payloadEl = (
      <g className="dr-payload">
        <line x1={tip.x} x2={tip.x} y1={tip.y} y2={tip.y + 16} />
        <rect x={tip.x - 8} y={tip.y + 16} width={16} height={16} />
        <path d={`M${tip.x} ${tip.y + 46} l-3.5 -7 h7 z`} className="dr-arrow" />
        <text x={tip.x} y={tip.y + 62} textAnchor="middle" className="dr-text">{payloadText}</text>
      </g>
    );
    const ph = Math.max(10, textW(payloadText) / 2 + 2);
    addBox(tip.x - 10, tip.y, tip.x + 10, tip.y + 48);
    addBox(tip.x - ph, tip.y + 50, tip.x + ph, tip.y + 68);
  }

  // ---- joint labels, placed clear of everything else ----
  const reqs: LabelRequest[] = joints.map((j, i) => {
    const l1 = trunc(jointLabel(j, i), 19);
    const bracket = i === 0 && yawBase && vertical[0] && linkPx[0] < 16 && lm[0] > 0 ? ` + ${mass_(lm[0])} bracket` : '';
    const l2 = `${mass_(jm[i])}${bracket}${j.drive === 'servo' ? ' · servo' : ''}`;
    const w = Math.max(textW(l1), textW(l2));
    const rr = j.motion === 'roll' ? rollRy(i) : j.motion === 'yaw' && i > 0 ? rJ[i] + 8 : rJ[i];
    const base = i === 0 && yawBase;
    const vert = vertical[i] || (i > 0 && vertical[i - 1] && !vertical[i]) ? 'v' : 'h';
    const prefer = base ? ['S' as const] : vert === 'v' ? ['E' as const, 'W' as const, 'N' as const] : ['S' as const, 'N' as const, 'SE' as const, 'SW' as const];
    return { key: i, ax: base ? x0 : P[i].x, ay: base ? yGround : P[i].y, r: base ? 2 : rr, w, h: 24, prefer, l1, l2 } as LabelRequest & { l1: string; l2: string };
  });
  const placedLabels = placeLabels(reqs, obstacles, { W, H });
  const labelText = reqs as (LabelRequest & { l1: string; l2: string })[];

  const label = mode === 'ready'
    ? `Arm side view to scale in the ready pose: ${n} joint${n > 1 ? 's' : ''}, total mass ${u.fu('mass', totalMass, { dp: 1, trim: true })}. The torques use the worst case, arm straight out.`
    : `Arm side view to scale, worst-case pose with the arm straight out: ${n} joint${n > 1 ? 's' : ''}, reach ${len_(reachMm)}, total mass ${u.fu('mass', totalMass, { dp: 1, trim: true })}.`;

  const hatchLines: number[] = [];
  for (let dx = -bw + 2; dx <= bw + 4; dx += 10) hatchLines.push(dx);
  const chainPts = P.map((p) => `${p.x},${p.y}`).join(' ');

  return (
    <div ref={ref} className="armfig">
      {poseSwitch}
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <title>{label}</title>
        <defs>
          <pattern id={`${hatchId}-body`} width={6} height={6} patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect className="dr-hatch-bg" width={6} height={6} />
            <line className="dr-hatch-ln" x1={0} x2={0} y1={0} y2={6} />
          </pattern>
        </defs>

        {/* ground and the fixed base */}
        <g className="dr-ground">
          <line x1={x0 - bw - 8} x2={x0 + bw + 8} y1={yGround} y2={yGround} />
          {hatchLines.map((dx) => (
            <line key={dx} x1={x0 + dx + 8} x2={x0 + dx + 1} y1={yGround} y2={yGround + 7} />
          ))}
        </g>
        <rect className="dr-bar" x={x0 - (yawBase ? bw : Math.max(18, rJ[0] + 12))} y={baseY + 11} width={2 * (yawBase ? bw : Math.max(18, rJ[0] + 12))} height={9} />

        {/* a plain base (first joint is not a yaw): a pedestal from the joint down to the plate */}
        {!yawBase && <rect className="dr-bar" x={x0 - 9} y={P[0].y} width={18} height={baseY + 11 - P[0].y} />}

        {/* extension lines up to the dimension rows */}
        <g className="dr-ext">{extLines}</g>

        {/* base yaw: arrow, back half */}
        {yawBase && <YawBack cx={x0} cy={baseY - 3} rx={pw + 7} ry={5.5} />}

        {/* rotating platform of a base yaw */}
        {yawBase && (
          <g className="dr-body">
            <path d={`M${x0 - pw} ${baseY + 8} V${baseY} H${x0 + pw} V${baseY + 8} Z`} fill={`url(#${hatchId}-body)`} />
            <rect className="dr-bearing" x={x0 - pw + 4} y={baseY + 8} width={2 * pw - 8} height={3} />
          </g>
        )}
        {yawBase && <line className="dr-axis" x1={x0} x2={x0} y1={Math.min(P[0].y, baseY) - 2} y2={yGround + 6} />}

        {/* links */}
        <g className="dr-links">
          {linkPoly.map((q, i) => (
            linkPx[i] > 0.3 ? (
              <polygon key={i} className="dr-bar" points={q.map((p) => p.join(',')).join(' ')}
                style={i === 0 && yawBase && vertical[0] ? { fill: `url(#${hatchId}-body)` } : undefined} />
            ) : null
          ))}
          <polyline className="dr-center" points={chainPts} fill="none" />
        </g>
        {yawBase && baseY > P[0].y && <rect className="dr-bar" style={{ fill: `url(#${hatchId}-body)` }} x={x0 - LINK_HALF} y={P[0].y} width={2 * LINK_HALF} height={baseY - P[0].y} />}

        {/* yaw joints further along the chain: back half behind the joint */}
        {joints.map((j, i) => (j.motion === 'yaw' && i > 0 ? <YawBack key={`yb${i}`} cx={P[i].x} cy={P[i].y} rx={rJ[i] + 8} ry={4.5} /> : null))}

        {/* joints */}
        {joints.map((j, i) => {
          const p = P[i];
          if (j.motion === 'pitch') return <PitchJoint key={i} cx={p.x} cy={p.y} r={rJ[i]} />;
          if (j.motion === 'roll') {
            return (
              <RollSymbol key={i} cx={p.x} cy={p.y} ry={rollRy(i)} rx={Math.min(9, rollRy(i) * 0.7)} angle={dirs[i].y > 0.5 ? 90 : 0} />
            );
          }
          if (i === 0) return <YawFront key={i} cx={x0} cy={baseY - 3} rx={pw + 7} ry={5.5} />;
          return (
            <g key={i}>
              <line className="dr-axis" x1={p.x} x2={p.x} y1={p.y - rJ[i] - 12} y2={p.y + rJ[i] + 12} />
              <g className="dr-joint"><circle cx={p.x} cy={p.y} r={rJ[i]} /></g>
              <YawFront cx={p.x} cy={p.y} rx={rJ[i] + 8} ry={4.5} />
            </g>
          );
        })}

        {/* payload */}
        {payloadEl}

        {/* dimensions */}
        {dimEls}
        {reachEl}

        {/* joint labels */}
        <g className="dr-labels">
          {placedLabels.map((p, k) => {
            const t = labelText[k];
            const cx = (p.box.x1 + p.box.x2) / 2;
            const anchorLeft = p.box.x1 > reqs[k].ax + 4;
            const anchorRight = p.box.x2 < reqs[k].ax - 4;
            const x = anchorLeft ? p.box.x1 : anchorRight ? p.box.x2 : cx;
            const ta = anchorLeft ? 'start' : anchorRight ? 'end' : 'middle';
            return (
              <g key={p.key}>
                {p.lead && <line className="dr-lead" x1={p.lead[0]} y1={p.lead[1]} x2={p.lead[2]} y2={p.lead[3]} />}
                <text x={x} y={p.box.y1 + 10} textAnchor={ta} className="dr-joint-name">{t.l1}</text>
                <text x={x} y={p.box.y1 + 22} textAnchor={ta} className="dr-text">{t.l2}</text>
              </g>
            );
          })}
        </g>
      </svg>
      <Legend />
      <p className="armfig-cap">
        {mode === 'ready'
          ? 'Ready pose, to scale. The shoulder (first pitch) sits on the base, the upper arm points up so the elbow is above it, and later links point out. '
          : 'Worst-case pose, to scale: the base column is vertical and every link from the first pitch joint on is straight out. '}
        <strong>The torques and bearing loads below always use the worst case (arm straight out)</strong>, whichever pose is drawn.
        Symbols grow a little with joint mass.
      </p>
    </div>
  );
}
