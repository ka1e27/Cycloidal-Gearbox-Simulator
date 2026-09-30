// All-joints summary (CLAUDE.md Addition 4): one row per gearbox joint J1..J4, plus the J5 servo row.

import { computeArm, type ArmInputs, type ArmJointLoad, type ArmResult } from './arm';
import { checkGearbox } from './gearbox';
import { JOINT_IDS, type JointId } from './presets';
import type { GearboxInputs, GearboxResult, ResolutionOptions, Verdict } from './types';

export interface JointSummaryRow {
  joint: JointId;
  /** True if T_req / T_des came from the arm model; false if the gearbox inputs' own torques were used */
  loadsFromArm: boolean;
  Treq: number;
  Tdes: number;
  /** Output-bearing radial load (outboard weight), N */
  outboardWeight_N: number;
  /** Output-bearing overturning (gravity) moment, N*m */
  overturningMoment_Nm: number;
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
  joint: 'J5';
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
  rows: JointSummaryRow[];
  servo: ServoRow;
  /** Number of rows that fail / are marginal / pass, for a header read-out */
  counts: { pass: number; marginal: number; fail: number; invalid: number };
}

export interface SummaryOptions {
  /** Per joint: use the arm-model torques (default true for all). false = keep the gearbox inputs' own T_req / T_des */
  useArmLoads?: boolean | Partial<Record<JointId, boolean>>;
  resolution?: ResolutionOptions;
}

function useArm(opt: SummaryOptions['useArmLoads'], j: JointId): boolean {
  if (opt === undefined) return true;
  if (typeof opt === 'boolean') return opt;
  return opt[j] ?? true;
}

/** Table data for the All Joints tab. Never throws. */
export function summarizeAllJoints(
  armInputs: ArmInputs,
  gearboxes: Record<JointId, GearboxInputs>,
  opts: SummaryOptions = {},
): AllJointsSummary {
  const arm = computeArm(armInputs);
  const counts = { pass: 0, marginal: 0, fail: 0, invalid: 0 };
  const rows: JointSummaryRow[] = JOINT_IDS.map((j, idx) => {
    const load: ArmJointLoad = arm.joints[idx];
    const fromArm = useArm(opts.useArmLoads, j) && arm.valid;
    const g = gearboxes[j];
    const inputs: GearboxInputs = fromArm ? { ...g, Treq: load.Treq, Tdes: load.Tdes } : g;
    const result = checkGearbox(inputs, opts.resolution);
    counts[result.verdict]++;
    return {
      joint: j,
      loadsFromArm: fromArm,
      Treq: inputs.Treq,
      Tdes: inputs.Tdes,
      outboardWeight_N: load.outboardWeight_N,
      overturningMoment_Nm: load.overturningMoment_Nm,
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
    };
  });
  const j5 = arm.joints[4];
  return {
    arm,
    rows,
    servo: {
      joint: 'J5',
      Treq: j5.Treq,
      Tdes: j5.Tdes,
      Tstatic: j5.TstaticModel,
      Tdyn: j5.TdynModel,
      outboardWeight_N: j5.outboardWeight_N,
    },
    counts,
  };
}
