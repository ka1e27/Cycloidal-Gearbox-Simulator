// All-joints summary (CLAUDE.md Addition 4, generalized by Addition 7): one row per cycloidal joint, plus a servo row
// for every direct-drive joint, for any arm of 1 to 8 joints.

import { computeArm, type ArmInputs, type ArmJointLoad, type ArmResult, type DriveType, type MotionType } from './arm';
import { checkGearbox } from './gearbox';
import { closestPresetId, presetInputs } from './presets';
import type { GearboxInputs, GearboxResult, ResolutionOptions, Verdict } from './types';

export interface JointSummaryRow {
  /** Stable joint id (ArmJoint.id): the key of its gearbox inputs */
  joint: string;
  /** Position in the arm, 0-based */
  index: number;
  name: string;
  motion: MotionType;
  /** True if T_req / T_des came from the arm model; false if the gearbox inputs' own torques were used */
  loadsFromArm: boolean;
  Treq: number;
  Tdes: number;
  /** Weight of everything outboard of the joint, N */
  outboardWeight_N: number;
  /** Output-bearing radial load, N */
  bearingRadial_N: number;
  /** Output-bearing axial (thrust) load, N (a yaw) */
  bearingAxial_N: number;
  /** Output-bearing tilting moment, N*m (see ArmJointLoad.bearingTiltMoment_Nm) */
  bearingTiltMoment_Nm: number;
  /** The inputs that were actually checked (torques applied) */
  inputs: GearboxInputs;
  result: GearboxResult;
  verdict: Verdict;
  /** Governing failure mode label, '' if invalid */
  governing: string;
  maxUtilization: number;
  /** Total disc mass, g */
  discMass_g: number;
  /** Short geometry read-out */
  geometry: { Zp: number; ratio: number; D: number; e: number; K1: number; L: number; discs: number };
}

export interface ServoRow {
  joint: string;
  index: number;
  name: string;
  motion: MotionType;
  drive: DriveType;
  /** Static + dynamic torque the servo must deliver, N*m */
  Treq: number;
  /** SF x Treq (servo sizing margin), N*m */
  Tdes: number;
  Tstatic: number;
  Tdyn: number;
  outboardWeight_N: number;
}

export interface AllJointsSummary {
  arm: ArmResult;
  /** One per cycloidal joint, in arm order */
  rows: JointSummaryRow[];
  /** One per servo joint, in arm order */
  servos: ServoRow[];
  /** Number of rows that fail / are marginal / pass, for a header read-out (gearbox rows only) */
  counts: { pass: number; marginal: number; fail: number; invalid: number };
}

export interface SummaryOptions {
  /** Per joint id: use the arm-model torques (default true for all). false = keep the gearbox inputs' own T_req / T_des */
  useArmLoads?: boolean | Record<string, boolean | undefined>;
  resolution?: ResolutionOptions;
}

function useArm(opt: SummaryOptions['useArmLoads'], id: string): boolean {
  if (opt === undefined) return true;
  if (typeof opt === 'boolean') return opt;
  return opt[id] ?? true;
}

/** Table data for the All Joints tab. Never throws. A cycloidal joint without stored inputs gets its closest preset. */
export function summarizeAllJoints(
  armInputs: ArmInputs,
  gearboxes: Record<string, GearboxInputs>,
  opts: SummaryOptions = {},
): AllJointsSummary {
  const arm = computeArm(armInputs);
  const counts = { pass: 0, marginal: 0, fail: 0, invalid: 0 };
  const rows: JointSummaryRow[] = [];
  const servos: ServoRow[] = [];
  arm.joints.forEach((load: ArmJointLoad, idx) => {
    if (load.drive === 'servo') {
      servos.push({
        joint: load.joint, index: idx, name: load.name, motion: load.motion, drive: load.drive,
        Treq: load.Treq, Tdes: load.Tdes, Tstatic: load.TstaticModel, Tdyn: load.TdynModel,
        outboardWeight_N: load.outboardWeight_N,
      });
      return;
    }
    const fromArm = useArm(opts.useArmLoads, load.joint) && arm.valid;
    const g = gearboxes[load.joint] ?? presetInputs(closestPresetId(arm.valid ? load.Treq : null));
    const inputs: GearboxInputs = fromArm ? { ...g, Treq: load.Treq, Tdes: load.Tdes } : g;
    const result = checkGearbox(inputs, opts.resolution);
    counts[result.verdict]++;
    rows.push({
      joint: load.joint, index: idx, name: load.name, motion: load.motion,
      loadsFromArm: fromArm,
      Treq: inputs.Treq,
      Tdes: inputs.Tdes,
      outboardWeight_N: load.outboardWeight_N,
      bearingRadial_N: load.bearingRadial_N,
      bearingAxial_N: load.bearingAxial_N,
      bearingTiltMoment_Nm: load.bearingTiltMoment_Nm,
      inputs,
      result,
      verdict: result.verdict,
      governing: result.governing?.label ?? '',
      maxUtilization: result.maxUtilization,
      discMass_g: result.mass.total_g,
      geometry: {
        Zp: inputs.Zp, ratio: inputs.Zp - 1, D: inputs.D, e: inputs.e,
        K1: result.derived.K1, L: inputs.L, discs: inputs.discs,
      },
    });
  });
  return { arm, rows, servos, counts };
}
