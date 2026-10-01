// UI-side helpers for the motor and ratio features (CLAUDE.md Addition 8). Pure TypeScript (no React), so they are easy to test.

import {
  hasMotorTorque,
  motorZpSet,
  recommendRatio,
  validateMotor,
  type ArmInputs,
  type ArmJoint,
  type JointMotorInfo,
  type MotorRecommendation,
  type MotorSpec,
} from '../calc';
import { ratioModeOf, type AdvisorLockState, type RatioMode } from './advisorLocks';

// ---------------------------------------------------------------------------
// Quick-fill presets (typical values only: check the datasheet of the motor you buy)
// ---------------------------------------------------------------------------

export interface MotorPreset {
  id: string;
  label: string;
  name: string;
  Tpeak_Nm: number;
  maxSpeed_rpm: number;
}

/** Generic hybrid stepper motors. Holding torque is used as the peak; torque falls with speed, so verify on the datasheet. */
export const MOTOR_PRESETS: readonly MotorPreset[] = [
  { id: 'nema17', label: 'NEMA 17, generic', name: 'NEMA 17 (typical)', Tpeak_Nm: 0.45, maxSpeed_rpm: 1000 },
  { id: 'nema17s', label: 'NEMA 17, short body', name: 'NEMA 17 short (typical)', Tpeak_Nm: 0.26, maxSpeed_rpm: 1000 },
  { id: 'nema23', label: 'NEMA 23, generic', name: 'NEMA 23 (typical)', Tpeak_Nm: 1.26, maxSpeed_rpm: 1000 },
];

export const MOTOR_NOTE =
  'Preset values are typical stepper holding torques, not a datasheet. Stepper torque also falls with speed. Check the datasheet of the motor you will buy.';

/** Which quick-fill option matches a joint's motor: '' = no motor, a preset id, or 'custom'. */
export function presetIdOf(m: MotorSpec | undefined): string {
  if (!m) return '';
  const hit = MOTOR_PRESETS.find((p) => m.name === p.name && m.Tpeak_Nm === p.Tpeak_Nm && m.maxSpeed_rpm === p.maxSpeed_rpm);
  return hit ? hit.id : 'custom';
}

// ---------------------------------------------------------------------------
// Editing the motor of a joint
// ---------------------------------------------------------------------------

const CUSTOM_NAME = 'Custom';
/** Nothing entered (a lone "Custom" label or the default efficiency does not keep a motor alive). */
const isEmpty = (m: MotorSpec): boolean =>
  m.Tpeak_Nm == null && m.Tcont_Nm == null && m.maxSpeed_rpm == null && m.requiredSpeed_degps == null && (!m.name || m.name === CUSTOM_NAME);

/** A blank motor: nothing entered, default efficiency. */
export const blankMotor = (): MotorSpec => ({
  Tpeak_Nm: null, Tcont_Nm: null, maxSpeed_rpm: null, requiredSpeed_degps: null, efficiency: 0.85,
});

/**
 * Patch the motor of a joint (creating it on first use). When every value is empty again the motor is removed, so a joint
 * with nothing entered has no `motor` key at all. Efficiency alone does not keep a motor alive.
 */
export function patchMotor(arm: ArmInputs, id: string, patch: Partial<MotorSpec>): ArmInputs {
  const j = arm.joints.find((x) => x.id === id);
  if (!j) return arm;
  const next: MotorSpec = { ...(j.motor ?? blankMotor()), ...patch };
  if (!next.name) delete next.name;
  // editing a preset's torque or speed makes it a custom motor
  if (next.name && MOTOR_PRESETS.some((p) => p.name === next.name) && presetIdOf(next) === 'custom') next.name = CUSTOM_NAME;
  return setMotor(arm, id, isEmpty(next) ? undefined : next);
}

/** Replace (or remove, with undefined) the motor of a joint. */
export function setMotor(arm: ArmInputs, id: string, motor: MotorSpec | undefined): ArmInputs {
  return {
    ...arm,
    joints: arm.joints.map((j) => {
      if (j.id !== id) return j;
      const { motor: _old, ...rest } = j;
      void _old;
      return (motor ? { ...rest, motor } : rest) as ArmJoint;
    }),
  };
}

/** Fill a joint's motor from a preset. Keeps the efficiency and the required speed the user typed; clears the continuous torque. */
export function applyPreset(arm: ArmInputs, id: string, presetId: string): ArmInputs {
  const j = arm.joints.find((x) => x.id === id);
  const p = MOTOR_PRESETS.find((x) => x.id === presetId);
  if (!j || !p) return arm;
  return setMotor(arm, id, {
    name: p.name, Tpeak_Nm: p.Tpeak_Nm, Tcont_Nm: null, maxSpeed_rpm: p.maxSpeed_rpm,
    requiredSpeed_degps: j.motor?.requiredSpeed_degps ?? null, efficiency: j.motor?.efficiency ?? 0.85,
  });
}

/** "Custom": keep the numbers, drop the preset name. With no motor yet, start a blank one. */
export function makeCustom(arm: ArmInputs, id: string): ArmInputs {
  const j = arm.joints.find((x) => x.id === id);
  if (!j) return arm;
  const { name: _n, ...rest } = j.motor ?? blankMotor();
  void _n;
  return setMotor(arm, id, { ...rest, name: CUSTOM_NAME } as MotorSpec);
}


// ---------------------------------------------------------------------------
// Ratio planning (shared by the Gearbox card, the Advisor and the store)
// ---------------------------------------------------------------------------

export interface RatioPlan {
  mode: RatioMode;
  /** null when the joint has no cycloidal motor data */
  rec: MotorRecommendation | null;
  /** The motor is complete and valid enough to restrict the ratio */
  usable: boolean;
  /** Zp values the advisor searches in "from motor" mode (the nearest one when none is feasible) */
  zps: number[];
  /** At least one Zp in the advisor range is motor-feasible */
  feasible: boolean;
  nearest: number | null;
  note: string;
}

/** True for a cycloidal joint whose motor has a valid peak torque. */
export function motorUsable(joint: Pick<ArmJoint, 'drive' | 'motor'> | undefined): boolean {
  if (!joint || joint.drive !== 'cycloidal' || !joint.motor) return false;
  return hasMotorTorque(joint.motor) && validateMotor(joint.motor).errors.length === 0;
}

/**
 * The ratio mode of a joint's advisor lock state and, for "from motor", the Zp set to search.
 * `load` is the gearbox's design load (the torques the checks use).
 */
export function ratioPlanFor(
  joint: Pick<ArmJoint, 'drive' | 'motor'> | undefined, load: { Treq: number; Tdes: number }, lock: AdvisorLockState,
): RatioPlan {
  const usable = motorUsable(joint);
  const rec = usable ? recommendRatio(load, joint!.motor) : null;
  const usableNow = usable && rec != null && (rec.status === 'ok' || rec.status === 'warning' || rec.status === 'infeasible');
  const mode = ratioModeOf(lock, usableNow);
  if (!rec || !usableNow) return { mode, rec, usable: false, zps: [], feasible: false, nearest: null, note: '' };
  const z = motorZpSet(rec);
  return { mode, rec, usable: true, zps: z.zps, feasible: z.feasible, nearest: z.nearest, note: z.note };
}

// ---------------------------------------------------------------------------
// Applying a recommended Zp: keep K1
// ---------------------------------------------------------------------------

export const K1_MIN = 0.4;
export const K1_MAX = 0.85;

export interface ZpRescale {
  /** e after the change, mm (rounded to 0.0001) */
  e: number;
  /** K1 before and after */
  k1Before: number;
  k1After: number;
  /** The old K1 was outside 0.40..0.85 (or not usable), so the new one was clamped into the range */
  clamped: boolean;
  /** e did not change */
  unchanged: boolean;
}

/**
 * Eccentricity that keeps K1 = e·Zp / (D/2) when Zp changes: e_new = K1·Rp / Zp_new. A K1 outside 0.40..0.85
 * (or a non-finite one) is clamped into the range first. D is not touched. Returns null for unusable numbers.
 */
export function rescaleEForZp(g: { D: number; e: number; Zp: number }, newZp: number): ZpRescale | null {
  if (![g.D, g.e, g.Zp, newZp].every(Number.isFinite) || g.D <= 0 || g.Zp <= 0 || newZp <= 0) return null;
  const Rp = g.D / 2;
  const k1Before = (g.e * g.Zp) / Rp;
  const target = Math.min(K1_MAX, Math.max(K1_MIN, k1Before));
  const e = Math.round(((target * Rp) / newZp) * 1e4) / 1e4;
  return {
    e, k1Before, k1After: (e * newZp) / Rp, clamped: target !== k1Before, unchanged: Math.abs(e - g.e) < 1e-9,
  };
}

// ---------------------------------------------------------------------------
// Short texts for tables and chips
// ---------------------------------------------------------------------------

/** Compact status of a joint's motor for a chip. */
export function motorChip(info: JointMotorInfo | null): { kind: 'ok' | 'marginal' | 'fail' | 'neutral'; word: string; title: string } {
  if (!info) return { kind: 'neutral', word: 'NO MOTOR', title: 'No motor data entered for this joint (Arm & Loads).' };
  const c = info.check;
  if (c.status === 'incomplete') return { kind: 'neutral', word: 'INCOMPLETE', title: 'Enter the motor’s peak torque on Arm & Loads.' };
  if (c.status === 'invalid') return { kind: 'fail', word: 'CHECK INPUT', title: c.errors[0] ?? 'The motor values need fixing.' };
  if (c.status === 'short') return { kind: 'fail', word: 'TOO WEAK', title: c.problems.join(' ') };
  if (c.overload?.exceeds) return { kind: 'marginal', word: 'LIMIT CURRENT', title: c.overload.message };
  return { kind: 'ok', word: 'MOTOR OK', title: c.info.join(' ') };
}

/** Table cell text for the recommended ratio: "24:1 (Zp 25)" or "—" plus the reason. */
export function recommendedText(rec: MotorRecommendation | null): { text: string; reason: string | null } {
  if (!rec) return { text: '—', reason: null };
  if (rec.Zp != null) return { text: `${rec.Zp - 1}:1 (Zp ${rec.Zp})`, reason: rec.status === 'warning' ? warningShort(rec) : null };
  return { text: '—', reason: rec.headline };
}

function warningShort(rec: MotorRecommendation): string {
  if (!rec.singleStageSensible) return 'more than one stage sensibly gives';
  if (!rec.inAdvisorRange) return 'outside the advisor’s Zp 12 to 26';
  return '';
}
