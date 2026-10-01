// Motion symbols (kinematic-diagram conventions), shared by the arm drawing, its legend and the joint editor.
// Pitch: a circle with an axis-into-page cross and a curved arrow. Yaw: an ellipse seen in perspective around a
// vertical axis (back half dashed, front half solid with an arrowhead). Roll: a collar across the link plus an
// elliptical arrow around the link axis.
import type { MotionType } from '../../calc';

const RAD = Math.PI / 180;

/** Small curved arrow beside a pitch joint circle (axis into the page). */
export function PitchArrow({ cx, cy, r }: { cx: number; cy: number; r: number }) {
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
export function PitchJoint({ cx, cy, r, arrow = true }: { cx: number; cy: number; r: number; arrow?: boolean }) {
  const c = Math.min(3.5, r * 0.5);
  return (
    <g className="dr-joint">
      <circle cx={cx} cy={cy} r={r} />
      <path className="dr-cross" d={`M${cx - c} ${cy - c} l${2 * c} ${2 * c} m0 ${-2 * c} l${-2 * c} ${2 * c}`} />
      {arrow && <PitchArrow cx={cx} cy={cy} r={r} />}
    </g>
  );
}

/** Yaw ellipse, back half (draw it behind the body). */
export function YawBack({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return <path className="dr-motion dr-motion-back" d={`M${cx - rx} ${cy} A${rx} ${ry} 0 0 1 ${cx + rx} ${cy}`} />;
}
/** Yaw ellipse, front half with the arrowhead (draw it in front of the body). */
export function YawFront({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return (
    <g>
      <path className="dr-motion" d={`M${cx - rx} ${cy} A${rx} ${ry} 0 0 0 ${cx + rx} ${cy}`} />
      <path className="dr-motion-head" d={`M${cx + rx} ${cy - 2.5} l-3 6.5 h6 z`} />
    </g>
  );
}

/**
 * Roll: a collar across the link plus an elliptical arrow around the link axis. Drawn for an axis pointing right;
 * `angle` (degrees, counter-clockwise on screen) turns it to follow a link that points up.
 */
export function RollSymbol({ cx, cy, ry, rx = 9, angle = 0, collarHalf }: { cx: number; cy: number; ry: number; rx?: number; angle?: number; collarHalf?: number }) {
  const ch = collarHalf ?? Math.min(ry - 4, 9); // collar half-height, a little proud of the 9 px link
  return (
    <g className="dr-roll" transform={angle ? `rotate(${-angle} ${cx} ${cy})` : undefined}>
      <path className="dr-motion dr-motion-back" d={`M${cx} ${cy - ry} A${rx} ${ry} 0 0 0 ${cx} ${cy + ry}`} />
      <rect className="dr-collar" x={cx - 3.5} y={cy - ch} width={7} height={2 * ch} />
      <path className="dr-motion" d={`M${cx} ${cy - ry} A${rx} ${ry} 0 0 1 ${cx} ${cy + ry}`} />
      <path className="dr-motion-head" d={`M${cx - 2} ${cy + ry} l8 -3.6 v7.2 z`} />
    </g>
  );
}

/** A small icon of a motion type for buttons, chips and table rows. 20 x 16 box. */
export function MotionIcon({ motion, size = 20, title }: { motion: MotionType; size?: number; title?: string }) {
  const h = Math.round((size * 16) / 20);
  return (
    <svg className="motion-icon" width={size} height={h} viewBox="0 0 20 16" role={title ? 'img' : undefined} aria-hidden={title ? undefined : true} aria-label={title} focusable="false">
      {motion === 'pitch' && <PitchJoint cx={9} cy={8.5} r={5} />}
      {motion === 'yaw' && (
        <g>
          <line className="dr-axis" x1={10} x2={10} y1={0.5} y2={15.5} />
          <YawBack cx={10} cy={8} rx={8.5} ry={3.6} />
          <YawFront cx={10} cy={8} rx={8.5} ry={3.6} />
        </g>
      )}
      {motion === 'roll' && (
        <g>
          <line className="dr-axis" x1={0.5} x2={19.5} y1={8} y2={8} />
          <RollSymbol cx={8.5} cy={8} ry={6.5} rx={5.5} collarHalf={4.5} />
        </g>
      )}
    </svg>
  );
}
