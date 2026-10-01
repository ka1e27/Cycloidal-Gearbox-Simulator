import { describe, expect, it } from 'vitest';
import {
  JOINT_IDS, PRESETS, JOINT_PRESET_SPECS, computeArm, defaultArmInputs, summarizeAllJoints, checkGearbox,
} from '../index';

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
  const gearboxes = { J1: PRESETS.J1, J2: PRESETS.J2, J3: PRESETS.J3, J4: PRESETS.J4 };

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
    expect(s.servo.joint).toBe('J5');
    expect(s.servo.Treq).toBeCloseTo(a.joints[4].Treq, 12);
    expect(s.servo.Treq).toBeCloseTo(s.servo.Tstatic + s.servo.Tdyn, 12);
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
