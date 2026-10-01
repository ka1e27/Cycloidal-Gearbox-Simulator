// Pose explorer engine (CLAUDE.md Addition 9): forward kinematics of the joint chain at user angles and the static
// gravity load at that pose. Display only: the gearbox checks keep using the worst case from arm.ts.
//
// Frames (world z up, mm on output, SI inside):
//   * joint 0 sits at the origin. At q = 0 the arm is in the Addition 7 worst-case pose: links before the first pitch
//     joint form a vertical column (+z) on the base axis; from the first pitch joint on, every link points along +x.
//     With no pitch joint at all, every link points up.
//   * rotation axis of each joint at q = 0 (right-handed, +q turns about it):
//       pitch: -y (horizontal, perpendicular to the link), so +q lifts the link (counter-clockwise in the side view
//              seen from -y);
//       yaw:   +z (vertical; for a yaw after a pitch this is the axis perpendicular to both its link and the pitch axis);
//       roll:  along its own link at q = 0 (+z in the column, +x after the first pitch).
//   * product of exponentials: joint i's rotation acts on everything outboard of it, about its axis as moved by the
//     joints inboard of it. R_i = R_{i-1} * Rot(a0_i, q_i) (Rodrigues), world axis a_i = R_{i-1} a0_i,
//     p_{i+1} = p_i + R_i (L_i d0_i).
//   * masses: joint i's lumped mass at p_i, link i's mass at its midpoint, the payload at the tip. A joint's own mass
//     does not load it (lever 0), but loads every joint inboard of it, as in arm.ts.
//   * tau_i = a_i . sum_{j outboard of i} (r_j - p_i) x (m_j g z): the torque joint i must supply to hold the pose,
//     positive in its +q direction. It equals a_i' . sum (r_j - p_i) x (-m_j g z) with a_i' = -a_i, i.e. exactly the
//     gravity moment about the +y-at-zero pitch axis, so at q = 0 a pitch joint reads +T_static.
//   * bending along each link: the moment of everything outboard of a cut, minus its component along the link
//     (torsion, reported separately). A uniform rod cut at fraction t keeps its outboard part (1 - t) as a point mass at
//     that part's centre.

import { ANGLE_RANGE, computeArm, G, normalizeJointLimits, type ArmInputs, type ArmResult, type DriveType, type JointLimits, type MotionType } from './arm';
import { GREEN_LIMIT } from './gearbox';

export type Vec3 = [number, number, number];
export type PoseStatus = 'ok' | 'marginal' | 'fail' | 'none';
export type PosePresetName = 'ready' | 'straight' | 'folded' | 'reachUp';

export interface PoseJoint {
  index: number;
  id: string;
  motion: MotionType;
  drive: DriveType;
  /** Angle used, degrees (sanitized: non-finite reads 0) */
  angleDeg: number;
  /** Joint centre, mm */
  pos_mm: Vec3;
  /** Unit rotation axis in the world at this pose (+q turns right-handed about it) */
  axis: Vec3;
  /** Holding torque about the axis at this pose, N*m, signed: + means the joint pushes in its +q direction */
  tau_Nm: number;
  absTau_Nm: number;
  /** Worst-case gravity torque from the arm model (computeArm TstaticModel), N*m */
  Tstatic_Nm: number;
  /** Design torque from the arm model (overrides included), N*m */
  Tdes_Nm: number;
  /** |tau| / T_des. null when T_des is 0 and the torque is not */
  util: number | null;
  status: PoseStatus;
}

export interface PoseLink {
  index: number;
  from_mm: Vec3;
  to_mm: Vec3;
  /** Unit direction of the link at this pose (defined even for a zero-length link) */
  dir: Vec3;
  length_mm: number;
  /** Bending moment magnitude just outboard of joint i (inboard end), at the midpoint, and at the outboard end, N*m */
  Mroot_Nm: number;
  Mmid_Nm: number;
  Mend_Nm: number;
  /** Torsion about the link axis at the inboard end, N*m (information) */
  torsionRoot_Nm: number;
}

export interface PoseMass {
  kind: 'joint' | 'link' | 'payload';
  /** Joint / link index; -1 for the payload */
  index: number;
  mass_g: number;
  pos_mm: Vec3;
  weight_N: number;
}

export interface PoseResult {
  joints: PoseJoint[];
  links: PoseLink[];
  /** Every mass element (zero masses included), in chain order: joint 0, link 0, joint 1, ..., payload */
  masses: PoseMass[];
  tip_mm: Vec3;
  /** Horizontal distance of the tip from the base axis (the vertical through joint 0), mm */
  reach_mm: number;
  /** Height of the tip above joint 0, mm */
  height_mm: number;
  /** Largest |tau|/T_des over the joints, null if none can be evaluated */
  maxUtil: number | null;
  /** Index of that joint, -1 if none */
  worstJoint: number;
  /** Largest bending moment along the links at this pose, N*m */
  Mmax_Nm: number;
  /** Largest bending moment along the links in the worst-case pose (q = 0): an upper bound at every pose, N*m */
  Mref_Nm: number;
  /** True when the arm model is valid (T_static / T_des are meaningful) */
  armValid: boolean;
}

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

type M3 = number[]; // row-major 3x3

const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: Vec3, k: number): Vec3 => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const norm = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
const I3: M3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
const mv = (m: M3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
  m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
  m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];
function mm3(a: M3, b: M3): M3 {
  const o = new Array<number>(9);
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c];
  return o;
}
/** Rodrigues: rotation by theta (rad) about the unit axis k. */
export function rodrigues(k: Vec3, theta: number): number[] {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  const t = 1 - c;
  const [x, y, z] = k;
  return [
    c + x * x * t, x * y * t - z * s, x * z * t + y * s,
    y * x * t + z * s, c + y * y * t, y * z * t - x * s,
    z * x * t - y * s, z * y * t + x * s, c + z * z * t,
  ];
}

const UP: Vec3 = [0, 0, 1];
const OUT: Vec3 = [1, 0, 0];
const PITCH_AXIS: Vec3 = [0, -1, 0];
const RAD = Math.PI / 180;

/** Finite, non-negative, capped (so absurd inputs still give finite numbers). */
const clean = (x: unknown, cap = 1e7) => (typeof x === 'number' && Number.isFinite(x) && x > 0 ? Math.min(x, cap) : 0);
/** Wrap degrees to (-180, 180]. Non-finite reads 0. */
export function wrapDeg(x: number): number {
  if (!Number.isFinite(x)) return 0;
  let y = ((x + 180) % 360 + 360) % 360 - 180;
  if (y === -180) y = 180;
  return y;
}

/** Link direction and joint axis of every joint at q = 0 (the worst-case pose). */
export function zeroPoseFrames(joints: readonly { motion: MotionType }[]): { dir0: Vec3[]; axis0: Vec3[] } {
  const p = joints.findIndex((j) => j.motion === 'pitch');
  const dir0 = joints.map((_, i): Vec3 => (p >= 0 && i >= p ? OUT : UP));
  const axis0 = joints.map((j, i): Vec3 => (j.motion === 'pitch' ? PITCH_AXIS : j.motion === 'yaw' ? UP : dir0[i]));
  return { dir0, axis0 };
}

interface El { m: number; r: Vec3; order: number }

/**
 * Forward kinematics and static gravity load at the given joint angles (degrees, one per joint; missing or non-finite
 * angles read 0). T_static / T_des come from `result` (computeArm of the same arm, computed here when omitted).
 * Never throws; every number is finite.
 */
export function computePose(arm: ArmInputs, anglesDeg: readonly number[], result?: ArmResult): PoseResult {
  const js = Array.isArray(arm?.joints) ? arm.joints : [];
  const res = result ?? computeArm(arm);
  const n = js.length;
  const { dir0, axis0 } = zeroPoseFrames(js);
  const L = js.map((j) => clean(j?.length_mm) / 1000);
  const mJ = js.map((j) => clean(j?.mass_g) / 1000);
  const mL = js.map((j) => clean(j?.linkMass_g) / 1000);
  const mP = clean(arm?.payload_g) / 1000;
  const q = js.map((_, i) => {
    const a = anglesDeg?.[i];
    return typeof a === 'number' && Number.isFinite(a) ? a : 0;
  });

  // forward kinematics
  const pos: Vec3[] = [[0, 0, 0]];
  const axis: Vec3[] = [];
  const dir: Vec3[] = [];
  let R: M3 = I3;
  for (let i = 0; i < n; i++) {
    const a = mv(R, axis0[i]);
    axis.push(a);
    R = mm3(R, rodrigues(axis0[i], q[i] * RAD));
    const d = mv(R, dir0[i]);
    dir.push(d);
    pos.push(add(pos[i], mul(d, L[i])));
  }

  // mass elements in chain order: joint i = 2i, link i = 2i + 1, payload = 2n
  const els: El[] = [];
  for (let i = 0; i < n; i++) {
    els.push({ m: mJ[i], r: pos[i], order: 2 * i });
    els.push({ m: mL[i], r: add(pos[i], mul(dir[i], L[i] / 2)), order: 2 * i + 1 });
  }
  els.push({ m: mP, r: pos[n], order: 2 * n });

  // gravity moment helper: sum (r - c) x (m g z) over a list
  const moment = (list: { m: number; r: Vec3 }[], c: Vec3): Vec3 => {
    let mx = 0, my = 0;
    for (const e of list) {
      if (e.m === 0) continue;
      const d = sub(e.r, c);
      const w = e.m * G;
      // d x (0, 0, w) = (d_y w, -d_x w, 0)
      mx += d[1] * w;
      my -= d[0] * w;
    }
    return [mx, my, 0];
  };

  const loads = res?.joints ?? [];
  const joints: PoseJoint[] = js.map((j, i) => {
    const out = els.filter((e) => e.order > 2 * i);
    const tau = dot(axis[i], moment(out, pos[i]));
    const absTau = Math.abs(tau);
    const ld = loads[i];
    const Tstatic = res?.valid && ld && Number.isFinite(ld.TstaticModel) ? ld.TstaticModel : 0;
    const Tdes = res?.valid && ld && Number.isFinite(ld.Tdes) ? ld.Tdes : 0;
    let util: number | null;
    if (!res?.valid) util = null;
    else if (Tdes > 0) util = absTau / Tdes;
    else util = absTau < 1e-12 ? 0 : null;
    const status: PoseStatus = util == null ? 'none' : util <= GREEN_LIMIT + 1e-9 ? 'ok' : util <= 1 + 1e-9 ? 'marginal' : 'fail';
    return {
      index: i, id: typeof j?.id === 'string' ? j.id : `J${i + 1}`, motion: j.motion, drive: j.drive,
      angleDeg: q[i], pos_mm: mul(pos[i], 1000), axis: axis[i],
      tau_Nm: tau === 0 ? 0 : tau, absTau_Nm: absTau, Tstatic_Nm: Tstatic, Tdes_Nm: Tdes, util, status,
    };
  });

  // bending along every link
  const bendingAt = (i: number, t: number, P: Vec3[], D: Vec3[], E: El[]): { bend: number; tors: number } => {
    const c = add(P[i], mul(D[i], L[i] * t));
    const list: { m: number; r: Vec3 }[] = E.filter((e) => e.order > 2 * i + 1);
    if (t < 1) list.push({ m: mL[i] * (1 - t), r: add(P[i], mul(D[i], L[i] * (1 + t) / 2)) });
    const M = moment(list, c);
    const tors = dot(M, D[i]);
    const b = sub(M, mul(D[i], tors));
    return { bend: norm(b), tors: Math.abs(tors) };
  };
  const links: PoseLink[] = js.map((_, i) => {
    const r0 = bendingAt(i, 0, pos, dir, els);
    return {
      index: i, from_mm: mul(pos[i], 1000), to_mm: mul(pos[i + 1], 1000), dir: dir[i], length_mm: L[i] * 1000,
      Mroot_Nm: r0.bend, Mmid_Nm: bendingAt(i, 0.5, pos, dir, els).bend, Mend_Nm: bendingAt(i, 1, pos, dir, els).bend,
      torsionRoot_Nm: r0.tors,
    };
  });

  // worst-case reference: the same cuts with every angle 0 (the bending at each cut there bounds it at any pose)
  const pos0: Vec3[] = [[0, 0, 0]];
  for (let i = 0; i < n; i++) pos0.push(add(pos0[i], mul(dir0[i], L[i])));
  const els0: El[] = [];
  for (let i = 0; i < n; i++) {
    els0.push({ m: mJ[i], r: pos0[i], order: 2 * i });
    els0.push({ m: mL[i], r: add(pos0[i], mul(dir0[i], L[i] / 2)), order: 2 * i + 1 });
  }
  els0.push({ m: mP, r: pos0[n], order: 2 * n });
  let Mref = 0;
  for (let i = 0; i < n; i++) for (const t of [0, 0.5, 1]) Mref = Math.max(Mref, bendingAt(i, t, pos0, dir0, els0).bend);

  const masses: PoseMass[] = els.map((e) => {
    const k = e.order;
    const kind: PoseMass['kind'] = k === 2 * n ? 'payload' : k % 2 === 0 ? 'joint' : 'link';
    return { kind, index: kind === 'payload' ? -1 : Math.floor(k / 2), mass_g: e.m * 1000, pos_mm: mul(e.r, 1000), weight_N: e.m * G };
  });

  let maxUtil: number | null = null;
  let worst = -1;
  joints.forEach((j) => {
    if (j.util != null && (maxUtil == null || j.util > maxUtil)) { maxUtil = j.util; worst = j.index; }
  });
  const tip = mul(pos[n], 1000);
  const Mmax = links.reduce((s, l) => Math.max(s, l.Mroot_Nm, l.Mmid_Nm, l.Mend_Nm), 0);
  return {
    joints, links, masses, tip_mm: tip, reach_mm: Math.hypot(tip[0], tip[1]), height_mm: tip[2],
    maxUtil, worstJoint: worst, Mmax_Nm: Mmax, Mref_Nm: Mref, armValid: !!res?.valid,
  };
}

// ---------------------------------------------------------------------------
// Pose presets
// ---------------------------------------------------------------------------

/**
 * Joint angles (degrees) of a named pose:
 *   straight: all 0, the worst case of Addition 7;
 *   ready:    the first pitch +90 (upper arm up), the second pitch -90 (forearm out), the rest 0, the same pose the
 *             side-view drawing calls "ready";
 *   folded:   pitches +80, -145, +65 (tucked in), the rest 0;
 *   reachUp:  the first pitch +90, the rest 0 (everything points up).
 */
export function posePreset(joints: readonly { motion: MotionType }[], name: PosePresetName): number[] {
  const table: Record<PosePresetName, number[]> = {
    straight: [],
    ready: [90, -90],
    folded: [80, -145, 65],
    reachUp: [90],
  };
  const seq = table[name] ?? [];
  let k = 0;
  return joints.map((j) => (j.motion === 'pitch' ? (seq[k++] ?? 0) : 0));
}

// ---------------------------------------------------------------------------
// Joint limits (display only)
// ---------------------------------------------------------------------------

/** A joint's angle limits, degrees: its own valid limits, else -180 / 180. */
export function jointLimits(j: { limits?: unknown } | undefined): JointLimits {
  return normalizeJointLimits(j?.limits) ?? { ...ANGLE_RANGE };
}
/** True when the joint has limits narrower than the full turn (then its angle does not wrap). */
export const hasLimits = (j: { limits?: unknown } | undefined) => normalizeJointLimits(j?.limits) !== undefined;

/** Clamp one angle (degrees) to a joint's limits. Full-range joints wrap to (-180, 180] instead. Non-finite reads 0 (then clamped). */
export function clampAngle(j: { limits?: unknown } | undefined, deg: number): number {
  const L = normalizeJointLimits(j?.limits);
  if (!L) return wrapDeg(deg);
  const x = Number.isFinite(deg) ? deg : 0;
  return Math.min(L.max, Math.max(L.min, x));
}

/** Clamp a pose to the joint limits. `clamped` lists the joint indices that moved (by more than 1e-9 deg). */
export function clampPose(joints: readonly { limits?: unknown }[], angles: readonly number[]): { angles: number[]; clamped: number[] } {
  const clamped: number[] = [];
  const out = joints.map((j, i) => {
    const a = angles[i] ?? 0;
    const c = clampAngle(j, a);
    if (hasLimits(j) && Math.abs(c - a) > 1e-9) clamped.push(i);
    return c;
  });
  return { angles: out, clamped };
}

/** A random but tidy pose: yaws within +-150, the first pitch 0..120, other pitches +-120, rolls +-180, whole degrees, always inside the joint limits. */
export function randomPose(joints: readonly { motion: MotionType; limits?: unknown }[], rnd: () => number = Math.random): number[] {
  let k = 0;
  return joints.map((j) => {
    let lo: number, hi: number;
    if (j.motion === 'yaw') { lo = -150; hi = 150; } else if (j.motion === 'roll') { lo = -180; hi = 180; } else if (k++ === 0) { lo = 0; hi = 120; } else { lo = -120; hi = 120; }
    // within the joint limits: the overlap with the tidy range, or the whole limit range when they do not overlap
    const L = jointLimits(j);
    let a = Math.max(lo, L.min);
    let b = Math.min(hi, L.max);
    if (a > b) { a = L.min; b = L.max; }
    const v = Math.round(a + (b - a) * rnd());
    return Math.min(L.max, Math.max(L.min, v)); // rounding can step just outside a fractional limit
  });
}

/** Shortest-path interpolation between two angles in degrees, t in 0..1. */
export function lerpAngle(a: number, b: number, t: number): number {
  const d = wrapDeg(b - a);
  return a + d * t;
}
