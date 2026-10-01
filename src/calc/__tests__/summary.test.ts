import { describe, expect, it } from 'vitest';
import {
  JOINT_IDS, PRESETS, JOINT_PRESET_SPECS, computeArm, defaultArmInputs, summarizeAllJoints, checkGearbox, closestPresetId,
  makeJoint, presetInputs,
} from '../index';
import type { GearboxInputs } from '../index';

describe('joint presets (SPEC.md table)', () => {
  it('match the SPEC.md values', () => {
    const s = JOINT_PRESET_SPECS;
    expect([s.J2.D, s.J2.e, s.J2.Treq, s.J2.Tdes, s.J2.discs]).toEqual([85, 1.6, 5.85, 8.8, 2]);
    expect([s.J3.D, s.J3.e, s.J3.Treq, s.J3.Tdes, s.J3.discs]).toEqual([70, 1.07, 2.25, 3.4, 1]);
    expect([s.J1.D, s.J1.e, s.J1.Treq, s.J1.Tdes, s.J1.discs]).toEqual([60, 0.92, 1.3, 2.0, 1]);
    expect([s.J4.D, s.J4.e, s.J4.Treq, s.J4.Tdes, s.J4.discs]).toEqual([60, 0.92, 0.3, 1.0, 1]);
    for (const id of JOINT_IDS) expect(PRESETS[id].D).toBe(s[id].D);
  });
});

describe('all-joints summary', () => {
  const gearboxes: Record<string, GearboxInputs> = { J1: PRESETS.J1, J2: PRESETS.J2, J3: PRESETS.J3, J4: PRESETS.J4 };

  it('uses arm-model torques by default and reports one row per joint plus the servo', () => {
    const arm = defaultArmInputs();
    const s = summarizeAllJoints(arm, gearboxes);
    const a = computeArm(arm);
    expect(s.rows.map((r) => r.joint)).toEqual(['J1', 'J2', 'J3', 'J4']);
    s.rows.forEach((r, i) => {
      expect(r.loadsFromArm).toBe(true);
      expect(r.Treq).toBeCloseTo(a.joints[i].Treq, 12);
      expect(r.Tdes).toBeCloseTo(a.joints[i].Tdes, 12);
      expect(r.inputs.Treq).toBe(r.Treq);
      expect(r.outboardWeight_N).toBeCloseTo(a.joints[i].outboardWeight_N, 12);
      expect(r.bearingRadial_N).toBeCloseTo(a.joints[i].bearingRadial_N, 12);
      expect(r.bearingAxial_N).toBeCloseTo(a.joints[i].bearingAxial_N, 12);
      expect(r.bearingTiltMoment_Nm).toBeCloseTo(a.joints[i].bearingTiltMoment_Nm, 12);
      // the row's result is exactly the gearbox check of those inputs
      expect(r.result.maxUtilization).toBeCloseTo(checkGearbox(r.inputs).maxUtilization, 12);
      expect(r.maxUtilization).toBe(r.result.maxUtilization);
      expect(r.governing).toBe(r.result.governing?.label);
      expect(r.discMass_g).toBeCloseTo(r.result.mass.total_g, 12);
      expect(r.geometry.D).toBe(gearboxes[r.joint].D);
    });
    expect(s.servos.map((x) => x.joint)).toEqual(['J5']);
    expect(s.servos[0].index).toBe(4);
    expect(s.servos[0].Treq).toBeCloseTo(a.joints[4].Treq, 12);
    expect(s.servos[0].Treq).toBeCloseTo(s.servos[0].Tstatic + s.servos[0].Tdyn, 12);
    expect(s.counts.pass + s.counts.marginal + s.counts.fail + s.counts.invalid).toBe(4);
  });

  it('per-joint switch keeps the gearbox torques typed by the user', () => {
    const s = summarizeAllJoints(defaultArmInputs(), gearboxes, { useArmLoads: { J2: false } });
    expect(s.rows[1].loadsFromArm).toBe(false);
    expect(s.rows[1].Treq).toBe(5.85);
    expect(s.rows[1].Tdes).toBe(8.8);
    expect(s.rows[2].loadsFromArm).toBe(true);
    const off = summarizeAllJoints(defaultArmInputs(), gearboxes, { useArmLoads: false });
    expect(off.rows.every((r) => !r.loadsFromArm)).toBe(true);
  });

  it('invalid arm input falls back to the typed torques and does not throw', () => {
    const arm = defaultArmInputs();
    arm.payload_g = NaN;
    const s = summarizeAllJoints(arm, gearboxes);
    expect(s.arm.valid).toBe(false);
    expect(s.rows.every((r) => !r.loadsFromArm)).toBe(true);
    expect(s.rows[1].Treq).toBe(5.85);
  });
});

describe('all-joints summary for a configurable arm', () => {
  it('follows the joint list: servo joints become servo rows, new cycloidal joints are rows', () => {
    const arm = defaultArmInputs();
    arm.joints[2].drive = 'servo'; // elbow becomes a servo
    const added = makeJoint(arm.joints, 'pitch');
    arm.joints.push(added);
    const gb = { J1: PRESETS.J1, J2: PRESETS.J2, J4: PRESETS.J4, [added.id]: presetInputs('J3') };
    const s = summarizeAllJoints(arm, gb);
    expect(s.rows.map((r) => r.joint)).toEqual(['J1', 'J2', 'J4', added.id]);
    expect(s.rows.map((r) => r.index)).toEqual([0, 1, 3, 5]);
    expect(s.servos.map((r) => r.joint)).toEqual(['J3', 'J5']);
    expect(s.counts.pass + s.counts.marginal + s.counts.fail + s.counts.invalid).toBe(4);
    const a = computeArm(arm);
    expect(s.rows[3].Treq).toBeCloseTo(a.joints[5].Treq, 12);
    expect(s.servos[0].Tdes).toBeCloseTo(a.joints[2].Tdes, 12);
  });
  it('a cycloidal joint with no stored gearbox falls back to its closest preset instead of throwing', () => {
    const s = summarizeAllJoints(defaultArmInputs(), {});
    expect(s.rows).toHaveLength(4);
    expect(s.rows.every((r) => r.result.valid || r.result.errors.length > 0)).toBe(true);
  });
  it('closestPresetId picks the preset with the nearest working torque (by ratio)', () => {
    expect(closestPresetId(5.9)).toBe('J2');
    expect(closestPresetId(2.2)).toBe('J3');
    expect(closestPresetId(0.31)).toBe('J4');
    expect(closestPresetId(1.2)).toBe('J1');
    expect(closestPresetId(0)).toBe('J3');
    expect(closestPresetId(NaN)).toBe('J3');
    expect(closestPresetId(null)).toBe('J3');
    expect(closestPresetId(500)).toBe('J2');
  });
});
