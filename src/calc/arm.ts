// Arm load model (CLAUDE.md Addition 1, generalized by Addition 7).
// The arm is an ordered list of 1 to 8 joints. Joint i carries its own lumped mass and the link that runs from it
// to joint i+1 (for the last joint that link is the tool, running to the tip). A payload sits at the tip.
// Masses in grams and lengths in mm on input; torques in N*m, weights in N, inertia in kg*m^2 on output.
//
// Worst-case pose used for every number (the drawing can also show a friendlier "ready pose"):
//   * everything up to the first pitch joint is a vertical column on the base axis (horizontal lever 0);
//   * from the first pitch joint on, every link points straight out horizontally.

import { normalizeMotor, type MotorSpec } from './motor';

export const G = 9.81; // m/s^2

export type MotionType = 'yaw' | 'pitch' | 'roll';
export type DriveType = 'cycloidal' | 'servo';
export const MOTION_TYPES: readonly MotionType[] = ['yaw', 'pitch', 'roll'];
export const DRIVE_TYPES: readonly DriveType[] = ['cycloidal', 'servo'];
/** Short names for the UI. */
export const MOTION_LABEL: Record<MotionType, string> = { yaw: 'Base yaw', pitch: 'Pitch', roll: 'Roll' };
export const DRIVE_LABEL: Record<DriveType, string> = { cycloidal: 'Cycloidal', servo: 'Servo' };

/** Not allowed as a joint id: the Custom gearbox slot uses it. */
export const RESERVED_JOINT_ID = 'custom';
export const MIN_JOINTS = 1;
export const MAX_JOINTS = 8;

export interface ArmOverride {
  /** Manual T_req, N*m. null = use the model. */
  Treq: number | null;
  /** Manual T_des, N*m. null = max(SF*T_req, floor). */
  Tdes: number | null;
}

export interface ArmJoint {
  /** Stable id (never changes when the joint is renamed or moved). Keys the gearbox, advisor state and toggles. */
  id: string;
  /** Free text shown after the position label: "J2 <name>". May be empty. */
  name: string;
  motion: MotionType;
  drive: DriveType;
  /** Lumped mass of the joint (motor + gearbox + housing), g */
  mass_g: number;
  /** Max angular acceleration, rad/s^2 */
  alpha: number;
  /**
   * Link offset from the output bearing along the joint axis, mm (pitch joints, and a yaw whose axis can tilt).
   * The radial load times this offset is the tilting moment on the bearing.
   */
  linkOffset_mm: number;
  /** Centre-to-centre length of the link from this joint to the next one, mm. For the last joint: the tool, joint to tip. */
  length_mm: number;
  /** Mass of that link (a uniform rod, COM at the midpoint), g */
  linkMass_g: number;
  /** Manual overrides of T_req / T_des for this joint */
  override: ArmOverride;
  /**
   * Optional motor (or servo) data for the ratio recommendation (CLAUDE.md Addition 8, src/calc/motor.ts). It does not
   * enter the load model: the arm result is the same with or without it. Absent = no motor data.
   */
  motor?: MotorSpec;
}

export interface ArmInputs {
  /** Ordered from the base to the tip, 1 to MAX_JOINTS entries */
  joints: ArmJoint[];
  /** Payload at the tool tip, g */
  payload_g: number;
  /** Service factor */
  SF: number;
  /** Minimum design torque, N*m */
  TdesFloor: number;
}

/** Default link offset from the output bearing along the joint axis, mm. */
export const DEFAULT_LINK_OFFSET_MM = 15;

/** Input ranges (SI units as entered: g, mm, rad/s^2, N*m). Anything outside is rejected with a message. */
export const ARM_LIMITS = {
  mass_g: [0, 1e6],
  length_mm: [0, 1e5],
  linkOffset_mm: [0, 1e4],
  alpha: [0, 1e4],
  SF: [0, 10],
  torque_Nm: [0, 1e6],
} as const;

const noOverride = (): ArmOverride => ({ Treq: null, Tdes: null });

/**
 * Default arm. These masses and lengths are PLACEHOLDERS until CAD masses exist; they are chosen so
 * the model gives roughly T_req = 5.85 N*m at J2 and 2.25 N*m at J3 (the SPEC.md presets).
 * Five joints: base yaw, shoulder pitch, elbow pitch, forearm roll (all cycloidal), wrist pitch (servo).
 */
export function defaultArmInputs(): ArmInputs {
  const mk = (
    id: string, name: string, motion: MotionType, drive: DriveType, mass_g: number, length_mm: number, linkMass_g: number,
  ): ArmJoint => ({
    id, name, motion, drive, mass_g, alpha: 3, linkOffset_mm: DEFAULT_LINK_OFFSET_MM, length_mm, linkMass_g, override: noOverride(),
  });
  return {
    joints: [
      mk('J1', 'base yaw', 'yaw', 'cycloidal', 450, 0, 80),
      mk('J2', 'shoulder pitch', 'pitch', 'cycloidal', 700, 230, 110),
      mk('J3', 'elbow pitch', 'pitch', 'cycloidal', 577, 200, 90),
      mk('J4', 'forearm roll', 'roll', 'cycloidal', 180, 80, 40),
      mk('J5', 'wrist pitch', 'pitch', 'servo', 120, 110, 70),
    ],
    payload_g: 250,
    SF: 1.5,
    TdesFloor: 1.0,
  };
}

/** "J3" for the joint at index 2. */
export const jointPos = (i: number): string => `J${i + 1}`;
/** "J3 elbow pitch" (or just "J3" when the name is empty). */
export function jointLabel(j: { name?: string }, i: number): string {
  const n = typeof j?.name === 'string' ? j.name.trim() : '';
  return n ? `${jointPos(i)} ${n}` : jointPos(i);
}

/** Next unused id: "J" + (largest number in use + 1). Ids of removed joints are never reused while any larger id exists. */
export function nextJointId(joints: readonly { id: string }[]): string {
  let max = 0;
  for (const j of joints) {
    const m = /^J(\d+)$/.exec(j.id);
    if (m) max = Math.max(max, Number(m[1]));
  }
  let n = Math.max(max + 1, joints.length + 1);
  while (joints.some((j) => j.id === `J${n}`)) n++;
  return `J${n}`;
}

/** Starting numbers for a freshly added joint of a given type (placeholders, like the default arm). */
const NEW_JOINT: Record<MotionType, { mass_g: number; length_mm: number; linkMass_g: number }> = {
  yaw: { mass_g: 300, length_mm: 100, linkMass_g: 60 },
  pitch: { mass_g: 400, length_mm: 150, linkMass_g: 70 },
  roll: { mass_g: 180, length_mm: 80, linkMass_g: 40 },
};

/** A new joint of the given type with an auto name (the type name) and a fresh id. */
export function makeJoint(existing: readonly { id: string }[], motion: MotionType, drive: DriveType = 'cycloidal'): ArmJoint {
  const d = NEW_JOINT[motion];
  return {
    id: nextJointId(existing), name: motion, motion, drive,
    mass_g: d.mass_g, alpha: 3, linkOffset_mm: DEFAULT_LINK_OFFSET_MM, length_mm: d.length_mm, linkMass_g: d.linkMass_g,
    override: noOverride(),
  };
}

/** Index of the first pitch joint, or -1. Everything from there on is horizontal in the worst-case pose. */
export function firstPitchIndex(joints: readonly { motion: MotionType }[]): number {
  return joints.findIndex((j) => j.motion === 'pitch');
}

/** True for a yaw that has a pitch joint upstream: its axis may be tilted horizontal, so gravity counts like a pitch. */
export function isTiltedYaw(joints: readonly { motion: MotionType }[], i: number): boolean {
  if (joints[i]?.motion !== 'yaw') return false;
  for (let k = 0; k < i; k++) if (joints[k].motion === 'pitch') return true;
  return false;
}

/** Index of the next joint downstream of a roll that is not a roll, or -1. */
export function nextNonRoll(joints: readonly { motion: MotionType }[], i: number): number {
  for (let k = i + 1; k < joints.length; k++) if (joints[k].motion !== 'roll') return k;
  return -1;
}

export interface ArmJointLoad {
  /** Stable joint id (ArmJoint.id) */
  joint: string;
  /** Position 0-based in the chain */
  index: number;
  name: string;
  motion: MotionType;
  drive: DriveType;
  /** Gravity torque about the joint axis, N*m (0 for a yaw whose axis stays vertical) */
  TstaticModel: number;
  /** Dynamic term alpha*I, N*m */
  TdynModel: number;
  /** Model T_req = static + dynamic, N*m */
  TreqModel: number;
  /** Inertia about the joint axis, kg*m^2 */
  inertia: number;
  /** T_req actually used (model or manual override), N*m */
  Treq: number;
  /** T_des actually used, N*m */
  Tdes: number;
  treqOverridden: boolean;
  tdesOverridden: boolean;
  /** Weight of everything outboard of the joint (excludes the joint's own lumped mass), N */
  outboardWeight_N: number;
  /**
   * Output-bearing loads of the joint (what its own output bearing / housing must carry, information only; 0 for a servo).
   * Radial: load perpendicular to the joint axis. Pitch and roll carry the outboard weight; a yaw carries none, unless
   * a pitch joint upstream can tilt its axis horizontal (then the worst case, the outboard weight, is counted).
   */
  bearingRadial_N: number;
  /** Axial (thrust) load along the joint axis. A yaw: the outboard weight acts along its vertical axis. */
  bearingAxial_N: number;
  /**
   * Tilting (overturning) moment on the output bearing, N*m, a different thing from the gravity torque
   * about the axis (TstaticModel), which goes through the gearbox.
   *  yaw: g * sum(m * horizontal reach from the axis) (the larger of that and radial x link offset if the axis can tilt).
   *  pitch: radial load x link offset from the bearing along the axis.
   *  roll: g * sum(m * axial distance along the roll axis from the bearing), arm straight out (worse than bent).
   *  servo: 0.
   */
  bearingTiltMoment_Nm: number;
  /** True for a yaw whose gravity torque is counted like a pitch (an upstream pitch can tilt its axis). */
  tiltedYaw: boolean;
  /** A modelling note for this joint, or null */
  note: string | null;
}

export interface ArmResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** One per joint, same order as ArmInputs.joints. A servo joint's Treq is its required torque, Tdes = SF*Treq (no floor). */
  joints: ArmJointLoad[];
  totalMass_g: number;
  /** Horizontal reach from the first pitch joint to the tool tip in the worst-case pose, mm (0 when there is no pitch joint) */
  reach_mm: number;
  /** Modelling notes (tilted yaw, roll with nothing off-axis), for display */
  notes: string[];
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateArmInputs(a: ArmInputs): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    /** Number in [min, max]; the lower-bound text is kept stable, an upper bound has its own message. */
    const one = (x: unknown, label: string, unit: string, [min, max]: readonly [number, number], minExclusive = false) => {
      if (!fin(x)) errors.push(`${label} is not a number`);
      else if (minExclusive ? x <= min : x < min) errors.push(`${label} must be ${minExclusive ? '>' : '>='} ${min}${unit ? ' ' + unit : ''}`);
      else if (x > max) errors.push(`${label} must be at most ${max}${unit ? ' ' + unit : ''}`);
    };
    const js = Array.isArray(a?.joints) ? a.joints : null;
    if (!js) {
      errors.push(`The arm needs ${MIN_JOINTS} to ${MAX_JOINTS} joints`);
    } else if (js.length < MIN_JOINTS || js.length > MAX_JOINTS) {
      errors.push(`The arm needs ${MIN_JOINTS} to ${MAX_JOINTS} joints (it has ${js.length})`);
    } else {
      const seen = new Set<string>();
      js.forEach((j, i) => {
        if (!j || typeof j !== 'object') { errors.push(`Joint ${i + 1} is missing`); return; }
        if (typeof j.id !== 'string' || !j.id) errors.push(`Joint ${i + 1} has no id`);
        else if (j.id === RESERVED_JOINT_ID || seen.has(j.id)) errors.push(`Joint ${i + 1} repeats the id ${j.id}`);
        else seen.add(j.id);
        if (!MOTION_TYPES.includes(j.motion)) errors.push(`Joint ${i + 1} has an unknown motion type`);
        if (!DRIVE_TYPES.includes(j.drive)) errors.push(`Joint ${i + 1} has an unknown drive type`);
      });
      if (!errors.length) {
        js.forEach((j, i) => one(j.mass_g, `Joint mass ${i + 1}`, 'g', ARM_LIMITS.mass_g));
        js.forEach((j, i) => one(j.linkMass_g, `Bar mass ${i + 1}`, 'g', ARM_LIMITS.mass_g));
        js.forEach((j, i) => one(j.length_mm, `Bar length ${i + 1}`, 'mm', ARM_LIMITS.length_mm));
        js.forEach((j, i) => one(j.alpha, `Angular acceleration ${i + 1}`, 'rad/s^2', ARM_LIMITS.alpha));
        js.forEach((j, i) => one(j.linkOffset_mm, `Link offset J${i + 1}`, 'mm', ARM_LIMITS.linkOffset_mm));
      }
    }
    one(a?.payload_g, 'Payload', 'g', ARM_LIMITS.mass_g);
    one(a?.SF, 'Service factor', '', ARM_LIMITS.SF, true);
    one(a?.TdesFloor, 'T_des floor', 'N*m', ARM_LIMITS.torque_Nm);
    if (js && js.length >= MIN_JOINTS && js.length <= MAX_JOINTS) {
      js.forEach((j, i) => {
        const o = j?.override;
        for (const k of ['Treq', 'Tdes'] as const) {
          const v = o?.[k];
          if (v != null) one(v, `Manual ${k === 'Treq' ? 'T_req' : 'T_des'} for J${i + 1}`, 'N*m', ARM_LIMITS.torque_Nm);
        }
      });
    }
    if (!errors.length && a.SF < 1) warnings.push('Service factor below 1.');
  } catch (err) {
    errors.push(`Arm input could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { errors, warnings };
}

/** One lumped or distributed mass in the chain. Positions in metres, mass in kg. */
interface Element {
  m: number;
  /** horizontal distance of the centre of mass from the first pitch axis (worst-case pose), m */
  x: number;
  /** horizontal extent of a rod for its own inertia, m (0 = point mass or a vertical rod) */
  lenH: number;
  /** distance of the centre of mass along the chain (straight), m */
  s: number;
  /** true rod length, m (0 = point mass) */
  len: number;
  /** chain order: joint i = 2i, link i = 2i + 1, payload = 2n. Outboard of joint j means order > 2j. */
  order: number;
}

function emptyJoint(j: Partial<ArmJoint> | undefined, i: number): ArmJointLoad {
  return {
    joint: typeof j?.id === 'string' ? j.id : `J${i + 1}`, index: i, name: typeof j?.name === 'string' ? j.name : '',
    motion: MOTION_TYPES.includes(j?.motion as MotionType) ? (j!.motion as MotionType) : 'pitch',
    drive: DRIVE_TYPES.includes(j?.drive as DriveType) ? (j!.drive as DriveType) : 'cycloidal',
    TstaticModel: 0, TdynModel: 0, TreqModel: 0, inertia: 0, Treq: 0, Tdes: 0,
    treqOverridden: false, tdesOverridden: false, outboardWeight_N: 0,
    bearingRadial_N: 0, bearingAxial_N: 0, bearingTiltMoment_Nm: 0, tiltedYaw: false, note: null,
  };
}

function invalidResult(a: unknown, errors: string[], warnings: string[]): ArmResult {
  const js = (a as ArmInputs | null)?.joints;
  const list: (Partial<ArmJoint> | undefined)[] =
    Array.isArray(js) && js.length >= MIN_JOINTS && js.length <= MAX_JOINTS ? js : defaultArmInputs().joints;
  return { valid: false, errors, warnings, joints: list.map((j, i) => emptyJoint(j, i)), totalMass_g: NaN, reach_mm: NaN, notes: [] };
}

/** Compute the torque each joint has to carry. Never throws. */
export function computeArm(a: ArmInputs): ArmResult {
  const v = validateArmInputs(a);
  if (v.errors.length) return invalidResult(a, v.errors, v.warnings);

  const js = a.joints;
  const n = js.length;
  const mJ = js.map((j) => j.mass_g / 1000);
  const mL = js.map((j) => j.linkMass_g / 1000);
  const L = js.map((j) => j.length_mm / 1000);
  const mP = a.payload_g / 1000;
  const p = firstPitchIndex(js);

  // Horizontal position of each joint (worst-case pose) and distance along the chain.
  // Up to and including the first pitch joint: x = 0 (vertical column on the base axis).
  const xJ: number[] = [];
  const sJ: number[] = [];
  for (let i = 0; i <= n; i++) {
    xJ.push(p < 0 || i <= p ? 0 : xJ[i - 1] + L[i - 1]);
    sJ.push(i === 0 ? 0 : sJ[i - 1] + L[i - 1]);
  }
  const xTip = xJ[n];

  const els: Element[] = [];
  for (let i = 0; i < n; i++) {
    els.push({ m: mJ[i], x: xJ[i], lenH: 0, s: sJ[i], len: 0, order: 2 * i });
    const horizontal = p >= 0 && i >= p;
    els.push({
      m: mL[i], x: horizontal ? xJ[i] + L[i] / 2 : 0, lenH: horizontal ? L[i] : 0,
      s: sJ[i] + L[i] / 2, len: L[i], order: 2 * i + 1,
    });
  }
  els.push({ m: mP, x: xTip, lenH: 0, s: sJ[n], len: 0, order: 2 * n }); // payload, outboard of everything

  const outboard = (j: number) => els.filter((e) => e.order > 2 * j);
  const sum = (list: Element[], f: (e: Element) => number) => list.reduce((s, e) => s + f(e), 0);

  const notes: string[] = [];
  const joints: ArmJointLoad[] = js.map((jn, j) => {
    const o = emptyJoint(jn, j);
    const out = outboard(j);
    o.outboardWeight_N = G * sum(out, (e) => e.m);
    const offset = jn.linkOffset_mm / 1000;
    const servo = jn.drive === 'servo';
    const label = jointLabel(jn, j);

    if (jn.motion === 'roll') {
      // Roll: everything between this joint and the next downstream non-roll joint k sits on the axis (lever 0,
      // including joint k's own mass). Everything beyond k is bent 90 degrees at k: its lever is the distance from k.
      const k = nextNonRoll(js, j);
      if (k < 0) {
        o.TstaticModel = 0;
        o.inertia = 0;
        o.note = `${label}: nothing past this roll sits off its axis, so no gravity or inertia torque is modelled. Use a manual torque if the tool is off-axis.`;
        notes.push(o.note);
      } else {
        const beyond = out.filter((e) => e.order > 2 * k);
        o.TstaticModel = G * sum(beyond, (e) => e.m * (e.s - sJ[k]));
        o.inertia = sum(beyond, (e) => {
          const d = e.s - sJ[k];
          return e.m * (d * d + (e.len * e.len) / 12);
        });
      }
      o.bearingRadial_N = o.outboardWeight_N;
      // Tilting moment on the roll bearing: axial distance along the roll axis. Straight out is the worst case;
      // bent at k puts everything beyond k at the axial distance of k.
      const straight = G * sum(out, (e) => e.m * (e.s - sJ[j]));
      const bent = G * sum(out, (e) => e.m * ((k >= 0 && e.order > 2 * k ? sJ[k] : e.s) - sJ[j]));
      o.bearingTiltMoment_Nm = Math.max(straight, bent);
    } else {
      // Pitch, and yaw. Horizontal lever from this joint's axis (arm straight out).
      const moment = G * sum(out, (e) => e.m * (e.x - xJ[j]));
      const inertia = sum(out, (e) => {
        const d = e.x - xJ[j];
        return e.m * (d * d + (e.lenH * e.lenH) / 12);
      });
      o.inertia = inertia;
      if (jn.motion === 'pitch') {
        o.TstaticModel = moment;
        o.bearingRadial_N = o.outboardWeight_N;
        o.bearingTiltMoment_Nm = o.bearingRadial_N * offset;
      } else {
        o.tiltedYaw = isTiltedYaw(js, j);
        o.TstaticModel = o.tiltedYaw ? moment : 0;
        o.bearingAxial_N = o.outboardWeight_N;
        o.bearingTiltMoment_Nm = moment;
        if (o.tiltedYaw) {
          o.bearingRadial_N = o.outboardWeight_N;
          o.bearingTiltMoment_Nm = Math.max(moment, o.outboardWeight_N * offset);
          o.note = `${label}: a pitch joint upstream can tilt this yaw axis horizontal, so its gravity torque is counted like a pitch joint (worst case).`;
          notes.push(o.note);
        }
      }
    }

    if (servo) { o.bearingRadial_N = 0; o.bearingAxial_N = 0; o.bearingTiltMoment_Nm = 0; }
    o.TdynModel = jn.alpha * o.inertia;
    o.TreqModel = o.TstaticModel + o.TdynModel;
    const ov = jn.override;
    o.treqOverridden = ov?.Treq != null;
    o.Treq = o.treqOverridden ? (ov!.Treq as number) : o.TreqModel;
    o.tdesOverridden = ov?.Tdes != null;
    const floor = servo ? 0 : a.TdesFloor;
    o.Tdes = o.tdesOverridden ? (ov!.Tdes as number) : Math.max(a.SF * o.Treq, floor);
    return o;
  });

  const totalMass = js.reduce((s, j) => s + j.mass_g, 0) + js.reduce((s, j) => s + j.linkMass_g, 0) + a.payload_g;
  const result: ArmResult = {
    valid: true, errors: [], warnings: v.warnings, joints,
    totalMass_g: totalMass, reach_mm: xTip * 1000, notes,
  };
  // Every output must be finite (inputs are range-checked, so this is a safety net against overflow).
  const bad = !Number.isFinite(totalMass) || !Number.isFinite(result.reach_mm) || joints.some((j) =>
    [j.TstaticModel, j.TdynModel, j.TreqModel, j.inertia, j.Treq, j.Tdes, j.outboardWeight_N,
      j.bearingRadial_N, j.bearingAxial_N, j.bearingTiltMoment_Nm].some((x) => !Number.isFinite(x)));
  if (bad) {
    return invalidResult(a, ['The arm values are so large that a torque overflows. Reduce the masses, lengths or accelerations.'], v.warnings);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Old fixed-format arm (five joints, bars) and its converter
// ---------------------------------------------------------------------------

export type Five = [number, number, number, number, number];

/** The arm format used before the arm became a list of joints. Kept for old sessions and exports. */
export interface LegacyArmInputs {
  /** Lumped mass at each joint J1..J5, g */
  jointMass_g: Five;
  /** Bar masses [riser, A, B, C, D], g */
  barMass_g: Five;
  /** Centre-to-centre length of each bar [riser, A, B, C, D], mm */
  barLength_mm: Five;
  payload_g: number;
  /** Link offset for the two pitch joints [J2, J3], mm */
  linkOffset_mm: [number, number];
  alpha: Five;
  SF: number;
  TdesFloor: number;
  override: [ArmOverride, ArmOverride, ArmOverride, ArmOverride, ArmOverride];
}

/** Convert the old fixed-format arm to the joint list. The default arm comes back as defaultArmInputs(). */
export function armFromLegacy(old: LegacyArmInputs): ArmInputs {
  const d = defaultArmInputs();
  const joints = d.joints.map((j, i): ArmJoint => ({
    ...j,
    mass_g: old.jointMass_g[i],
    linkMass_g: old.barMass_g[i],
    length_mm: old.barLength_mm[i],
    alpha: old.alpha[i],
    // the old model had link offsets for J2 and J3 only; the other joints keep the default (unused by their old rules)
    linkOffset_mm: i === 1 ? old.linkOffset_mm[0] : i === 2 ? old.linkOffset_mm[1] : j.linkOffset_mm,
    override: { Treq: old.override[i]?.Treq ?? null, Tdes: old.override[i]?.Tdes ?? null },
  }));
  return { joints, payload_g: old.payload_g, SF: old.SF, TdesFloor: old.TdesFloor };
}

/** True when a raw object looks like the old fixed-format arm (no joint list, but old array fields). */
export function isLegacyArm(raw: unknown): boolean {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return false;
  const p = raw as Record<string, unknown>;
  if (Array.isArray(p.joints)) return false;
  return ['jointMass_g', 'barMass_g', 'barLength_mm', 'alpha', 'linkOffset_mm', 'override'].some((k) => k in p);
}

/**
 * Fill any missing or non-numeric field of a partial/imported arm object from the defaults, so a
 * hand-edited JSON never crashes the engine. Accepts the old fixed-format arm too (converted with
 * identical results). Returns a complete ArmInputs. Never throws.
 */
export function normalizeArmInputs(partial: unknown): ArmInputs {
  const d = defaultArmInputs();
  if (!partial || typeof partial !== 'object' || Array.isArray(partial)) return d;
  const p = partial as Record<string, unknown>;
  const num = (v: unknown, base: number) => (typeof v === 'number' && Number.isFinite(v) ? v : base);
  const nullable = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

  if (isLegacyArm(p)) {
    const five = (v: unknown, base: Five): Five => {
      const out = [...base] as Five;
      if (Array.isArray(v)) {
        for (let i = 0; i < 5; i++) if (typeof v[i] === 'number' && Number.isFinite(v[i])) out[i] = v[i] as number;
      }
      return out;
    };
    const two = (v: unknown, base: [number, number]): [number, number] => {
      const out: [number, number] = [base[0], base[1]];
      if (Array.isArray(v)) for (let i = 0; i < 2; i++) if (typeof v[i] === 'number' && Number.isFinite(v[i])) out[i] = v[i] as number;
      return out;
    };
    const ov = Array.isArray(p.override) ? p.override : [];
    const override = [0, 1, 2, 3, 4].map((i) => {
      const o = ov[i];
      return o && typeof o === 'object'
        ? { Treq: nullable((o as Record<string, unknown>).Treq), Tdes: nullable((o as Record<string, unknown>).Tdes) }
        : noOverride();
    }) as LegacyArmInputs['override'];
    const dj = d.joints;
    return armFromLegacy({
      jointMass_g: five(p.jointMass_g, dj.map((j) => j.mass_g) as Five),
      barMass_g: five(p.barMass_g, dj.map((j) => j.linkMass_g) as Five),
      barLength_mm: five(p.barLength_mm, dj.map((j) => j.length_mm) as Five),
      payload_g: num(p.payload_g, d.payload_g),
      linkOffset_mm: two(p.linkOffset_mm, [DEFAULT_LINK_OFFSET_MM, DEFAULT_LINK_OFFSET_MM]),
      alpha: five(p.alpha, dj.map((j) => j.alpha) as Five),
      SF: num(p.SF, d.SF),
      TdesFloor: num(p.TdesFloor, d.TdesFloor),
      override,
    });
  }

  let joints: ArmJoint[] = d.joints;
  if (Array.isArray(p.joints) && p.joints.length > 0) {
    const used = new Set<string>();
    joints = p.joints.slice(0, MAX_JOINTS).map((raw, i): ArmJoint => {
      const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
      const base = d.joints[Math.min(i, d.joints.length - 1)];
      const motion = MOTION_TYPES.includes(r.motion as MotionType) ? (r.motion as MotionType) : base.motion;
      const drive = DRIVE_TYPES.includes(r.drive as DriveType) ? (r.drive as DriveType) : base.drive;
      let id = typeof r.id === 'string' && r.id.trim() ? r.id.trim().slice(0, 24) : '';
      if (!id || id === RESERVED_JOINT_ID || used.has(id)) id = nextJointId([...used].map((x) => ({ id: x })));
      used.add(id);
      const o = (r.override && typeof r.override === 'object' ? r.override : {}) as Record<string, unknown>;
      const dflt = NEW_JOINT[motion];
      const motor = normalizeMotor(r.motor);
      return {
        id,
        name: typeof r.name === 'string' ? r.name.slice(0, 40) : (i < d.joints.length ? base.name : motion),
        motion, drive,
        mass_g: num(r.mass_g, i < d.joints.length ? base.mass_g : dflt.mass_g),
        alpha: num(r.alpha, base.alpha),
        linkOffset_mm: num(r.linkOffset_mm, DEFAULT_LINK_OFFSET_MM),
        length_mm: num(r.length_mm, i < d.joints.length ? base.length_mm : dflt.length_mm),
        linkMass_g: num(r.linkMass_g, i < d.joints.length ? base.linkMass_g : dflt.linkMass_g),
        override: { Treq: nullable(o.Treq), Tdes: nullable(o.Tdes) },
        ...(motor ? { motor } : {}),
      };
    });
  }
  return {
    joints,
    payload_g: num(p.payload_g, d.payload_g),
    SF: num(p.SF, d.SF),
    TdesFloor: num(p.TdesFloor, d.TdesFloor),
  };
}
