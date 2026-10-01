// Configurable arm (CLAUDE.md Addition 7): hand-computed torques, inertia and bearing loads for chains other than
// the default five joints. Every expected number is worked out on paper in the comments (g = 9.81, kg and m).
import { describe, expect, it } from 'vitest';
import {
  computeArm, defaultArmInputs, G, isTiltedYaw, jointLabel, makeJoint, MAX_JOINTS, nextJointId, normalizeArmInputs,
  validateArmInputs,
} from '../index';
import type { ArmInputs, ArmJoint, DriveType, MotionType } from '../index';

const near = (got: number, want: number, rel = 1e-9, label = '') =>
  expect(Math.abs(got - want), `${label} got ${got} want ${want}`).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(want) * rel));

/** [motion, drive, joint mass g, link length mm (to the next joint, or the tool), link mass g] */
type Spec = [MotionType, DriveType, number, number, number];
function chain(spec: Spec[], payload_g: number, alpha = 1, over: Partial<ArmInputs> = {}): ArmInputs {
  const joints: ArmJoint[] = spec.map(([motion, drive, mass_g, length_mm, linkMass_g], i) => ({
    id: `J${i + 1}`, name: '', motion, drive, mass_g, alpha, linkOffset_mm: 15, length_mm, linkMass_g,
    override: { Treq: null, Tdes: null },
  }));
  return { joints, payload_g, SF: 1.5, TdesFloor: 1.0, ...over };
}

describe('3-DOF yaw, pitch, pitch', () => {
  // J1 yaw 500 g, column 100 mm 50 g | J2 pitch 400 g, bar 300 mm 200 g | J3 pitch 300 g, tool 200 mm 100 g | payload 1000 g, alpha 2
  const a = chain([
    ['yaw', 'cycloidal', 500, 100, 50],
    ['pitch', 'cycloidal', 400, 300, 200],
    ['pitch', 'cycloidal', 300, 200, 100],
  ], 1000, 2);
  const r = computeArm(a);
  it('is valid and has one load per joint', () => {
    expect(r.valid).toBe(true);
    expect(r.joints).toHaveLength(3);
    expect(r.joints.map((j) => j.joint)).toEqual(['J1', 'J2', 'J3']);
    near(r.totalMass_g, 500 + 400 + 300 + 50 + 200 + 100 + 1000);
    near(r.reach_mm, 500, 1e-12);
  });
  it('J3 (elbow, last): tool 100 g at 0.1 m + payload 1 kg at 0.2 m', () => {
    // T = g (0.1*0.1 + 1*0.2) = 0.21 g ; I = 0.1 (0.1^2 + 0.2^2/12) + 1*0.2^2 = 0.0413333
    near(r.joints[2].TstaticModel, G * 0.21);
    const I = 0.1 * (0.01 + 0.04 / 12) + 0.04;
    near(r.joints[2].inertia, I);
    near(r.joints[2].Treq, G * 0.21 + 2 * I);
    near(r.joints[2].outboardWeight_N, G * 1.1);
    near(r.joints[2].bearingRadial_N, G * 1.1);
    near(r.joints[2].bearingTiltMoment_Nm, G * 1.1 * 0.015);
  });
  it('J2 (shoulder): bar 200 g at 0.15, J3 300 g at 0.3, tool 100 g at 0.4, payload at 0.5', () => {
    near(r.joints[1].TstaticModel, G * (0.2 * 0.15 + 0.3 * 0.3 + 0.1 * 0.4 + 1 * 0.5)); // 0.66 g
    const I = 0.2 * (0.15 ** 2 + 0.09 / 12) + 0.3 * 0.09 + 0.1 * (0.16 + 0.04 / 12) + 0.25; // 0.2993333
    near(r.joints[1].inertia, I);
    near(r.joints[1].outboardWeight_N, G * 1.6);
  });
  it('J1 (yaw, vertical axis): no gravity torque, I_z equals J2 inertia (J2 sits on the axis), thrust + overturning', () => {
    near(r.joints[0].TstaticModel, 0, 1e-12);
    near(r.joints[0].inertia, r.joints[1].inertia);
    near(r.joints[0].Treq, 2 * r.joints[1].inertia);
    near(r.joints[0].Tdes, Math.max(1.5 * r.joints[0].Treq, 1));
    near(r.joints[0].outboardWeight_N, G * 2.05); // 0.05 + 0.4 + 0.2 + 0.3 + 0.1 + 1
    near(r.joints[0].bearingAxial_N, G * 2.05);
    near(r.joints[0].bearingRadial_N, 0, 1e-12);
    near(r.joints[0].bearingTiltMoment_Nm, G * 0.66); // same reach moment as the shoulder carries
    expect(r.joints[0].tiltedYaw).toBe(false);
  });
});

describe('6-DOF yaw, pitch, pitch, roll, pitch, roll', () => {
  // masses g / links mm / link masses g
  const a = chain([
    ['yaw', 'cycloidal', 500, 100, 50],
    ['pitch', 'cycloidal', 400, 300, 200],
    ['pitch', 'cycloidal', 300, 250, 100],
    ['roll', 'cycloidal', 200, 100, 40],
    ['pitch', 'servo', 150, 80, 30],
    ['roll', 'servo', 100, 60, 20],
  ], 500, 1);
  const r = computeArm(a);
  it('J5 (wrist pitch): beyond it link 30 g at 0.04, J6 100 g at 0.08, tool 20 g at 0.11, payload 0.5 kg at 0.14', () => {
    expect(r.valid).toBe(true);
    near(r.joints[4].TstaticModel, G * (0.03 * 0.04 + 0.1 * 0.08 + 0.02 * 0.11 + 0.5 * 0.14)); // 0.0814 g
    const I = 0.03 * (0.04 ** 2 + 0.08 ** 2 / 12) + 0.1 * 0.08 ** 2 + 0.02 * (0.11 ** 2 + 0.06 ** 2 / 12) + 0.5 * 0.14 ** 2; // 0.010752
    near(r.joints[4].inertia, 0.010752, 1e-9);
    near(r.joints[4].inertia, I);
    near(r.joints[4].Tdes, 1.5 * r.joints[4].Treq, 1e-12); // servo: no floor
  });
  it('J4 (roll before the wrist): same lever as the wrist because J5 and the link before it sit on the roll axis', () => {
    near(r.joints[3].TstaticModel, r.joints[4].TstaticModel);
    near(r.joints[3].inertia, 0.010752, 1e-9);
    near(r.joints[3].outboardWeight_N, G * 0.84); // 0.04+0.15+0.03+0.1+0.02+0.5
    near(r.joints[3].bearingRadial_N, G * 0.84);
    // axial distances from J4: link 0.05, J5 0.1, link 0.14, J6 0.18, tool 0.21, payload 0.24
    near(r.joints[3].bearingTiltMoment_Nm, G * (0.04 * 0.05 + 0.15 * 0.1 + 0.03 * 0.14 + 0.1 * 0.18 + 0.02 * 0.21 + 0.5 * 0.24)); // 0.1634 g
    near(r.joints[3].Tdes, Math.max(1.5 * r.joints[3].Treq, 1), 1e-12);
  });
  it('J6 (roll at the tip, servo): nothing off its axis, so no torque, and no bearing load for a servo', () => {
    near(r.joints[5].TstaticModel, 0, 1e-12);
    near(r.joints[5].inertia, 0, 1e-12);
    near(r.joints[5].Treq, 0, 1e-12);
    near(r.joints[5].Tdes, 0, 1e-12);
    near(r.joints[5].outboardWeight_N, G * 0.52);
    near(r.joints[5].bearingRadial_N + r.joints[5].bearingAxial_N + r.joints[5].bearingTiltMoment_Nm, 0, 1e-12);
    expect(r.joints[5].note).toMatch(/roll/);
  });
  it('J3 (elbow) sees every later element at its horizontal distance, rods add L^2/12', () => {
    const els: [number, number, number][] = [ // [kg, distance from J3 axis (m), rod length (m)]
      [0.1, 0.125, 0.25], [0.2, 0.25, 0], [0.04, 0.3, 0.1], [0.15, 0.35, 0], [0.03, 0.39, 0.08], [0.1, 0.43, 0], [0.02, 0.46, 0.06], [0.5, 0.49, 0],
    ];
    near(r.joints[2].TstaticModel, G * els.reduce((s, [m, d]) => s + m * d, 0)); // 0.4359 g
    near(r.joints[2].TstaticModel, G * 0.4359, 1e-9);
    near(r.joints[2].inertia, els.reduce((s, [m, d, l]) => s + m * (d * d + l * l / 12), 0));
  });
  it('J1 (yaw below the first pitch) keeps a vertical axis: gravity 0, I_z equals the shoulder inertia', () => {
    near(r.joints[0].TstaticModel, 0, 1e-12);
    near(r.joints[0].inertia, r.joints[1].inertia);
    expect(r.joints[0].tiltedYaw).toBe(false);
  });
  it('reach is the horizontal extent from the first pitch joint to the tip (300+250+100+80+60 = 790 mm)', () => {
    near(r.reach_mm, 300 + 250 + 100 + 80 + 60, 1e-12);
  });
});

describe('two consecutive rolls', () => {
  // J1 yaw 300 | J2 pitch 400 g, 200 mm 100 g | J3 roll 150 g, 100 mm 40 g | J4 roll 120 g, 80 mm 30 g | J5 pitch servo 100 g, tool 60 mm 20 g | payload 400 g
  const a = chain([
    ['yaw', 'cycloidal', 300, 100, 50],
    ['pitch', 'cycloidal', 400, 200, 100],
    ['roll', 'cycloidal', 150, 100, 40],
    ['roll', 'cycloidal', 120, 80, 30],
    ['pitch', 'servo', 100, 60, 20],
  ], 400, 1);
  const r = computeArm(a);
  it('both rolls use the same downstream non-roll joint (the wrist): tool 20 g at 0.03, payload at 0.06', () => {
    const T = G * (0.02 * 0.03 + 0.4 * 0.06); // 0.0246 g
    const I = 0.02 * (0.03 ** 2 + 0.06 ** 2 / 12) + 0.4 * 0.06 ** 2; // 0.001464
    near(r.joints[2].TstaticModel, T);
    near(r.joints[3].TstaticModel, T);
    near(r.joints[2].inertia, I);
    near(r.joints[3].inertia, I);
    near(r.joints[4].TstaticModel, T); // the wrist itself carries the same tool
  });
  it('bearing of the first roll: tilt uses the straight-out tool, which is worse than bent at the wrist', () => {
    near(r.joints[2].outboardWeight_N, G * 0.71);
    near(r.joints[2].bearingRadial_N, G * 0.71);
    // axial distances from J3: link 0.05, J4 0.1, link 0.14, J5 0.18, tool 0.21, payload 0.24
    near(r.joints[2].bearingTiltMoment_Nm, G * (0.04 * 0.05 + 0.12 * 0.1 + 0.03 * 0.14 + 0.1 * 0.18 + 0.02 * 0.21 + 0.4 * 0.24)); // 0.1364 g
    expect(r.joints[2].bearingTiltMoment_Nm).toBeGreaterThan(
      G * (0.04 * 0.05 + 0.12 * 0.1 + 0.03 * 0.14 + 0.1 * 0.18 + 0.02 * 0.18 + 0.4 * 0.18));
  });
});

describe('a roll at the tip (gravity 0)', () => {
  // J1 pitch 400 g, 200 mm 100 g | J2 roll 100 g, tool 50 mm 30 g | payload 500 g, alpha 3
  const a = chain([
    ['pitch', 'cycloidal', 400, 200, 100],
    ['roll', 'cycloidal', 100, 50, 30],
  ], 500, 3);
  const r = computeArm(a);
  it('has zero gravity and inertia torque; T_des is the floor', () => {
    near(r.joints[1].TstaticModel, 0, 1e-12);
    near(r.joints[1].TdynModel, 0, 1e-12);
    near(r.joints[1].Treq, 0, 1e-12);
    near(r.joints[1].Tdes, 1.0, 1e-12);
    expect(r.notes).toHaveLength(1);
  });
  it('still reports its bearing: radial = tool + payload weight, tilt = axial distance (tool 25 mm, payload 50 mm)', () => {
    near(r.joints[1].bearingRadial_N, G * 0.53);
    near(r.joints[1].bearingTiltMoment_Nm, G * (0.03 * 0.025 + 0.5 * 0.05));
  });
  it('the pitch before it carries the whole tool straight out', () => {
    // link 100 g at 0.1, roll joint 100 g at 0.2, tool 30 g at 0.225, payload at 0.25
    near(r.joints[0].TstaticModel, G * (0.1 * 0.1 + 0.1 * 0.2 + 0.03 * 0.225 + 0.5 * 0.25)); // 0.16175 g
  });
});

describe('a yaw after a pitch', () => {
  // J1 pitch 400 g, 200 mm 100 g | J2 yaw 300 g, 100 mm 40 g | J3 pitch 100 g, tool 60 mm 20 g | payload 300 g, alpha 2
  const a = chain([
    ['pitch', 'cycloidal', 400, 200, 100],
    ['yaw', 'cycloidal', 300, 100, 40],
    ['pitch', 'cycloidal', 100, 60, 20],
  ], 300, 2);
  const r = computeArm(a);
  it('is treated like a pitch joint for gravity (worst case), with a note', () => {
    expect(isTiltedYaw(a.joints, 1)).toBe(true);
    expect(r.joints[1].tiltedYaw).toBe(true);
    // beyond J2: link 40 g at 0.05, J3 100 g at 0.1, tool 20 g at 0.13, payload 0.3 kg at 0.16
    near(r.joints[1].TstaticModel, G * (0.04 * 0.05 + 0.1 * 0.1 + 0.02 * 0.13 + 0.3 * 0.16)); // 0.0626 g
    const I = 0.04 * (0.05 ** 2 + 0.1 ** 2 / 12) + 0.1 * 0.01 + 0.02 * (0.13 ** 2 + 0.06 ** 2 / 12) + 0.3 * 0.16 ** 2; // 0.0091573
    near(r.joints[1].inertia, I);
    near(r.joints[1].Treq, r.joints[1].TstaticModel + 2 * I);
    expect(r.joints[1].note).toMatch(/pitch/);
  });
  it('bearing: yaw rules (axial + overturning) plus the radial worst case of a tilted axis', () => {
    near(r.joints[1].bearingAxial_N, G * 0.46);
    near(r.joints[1].bearingRadial_N, G * 0.46);
    // overturning moment g*sum(m*reach) = 0.0626 g beats radial x offset (0.46 g x 0.015 m)
    near(r.joints[1].bearingTiltMoment_Nm, G * 0.0626);
  });
  it('a yaw with no pitch upstream (a second base yaw) stays vertical', () => {
    const b = chain([
      ['yaw', 'cycloidal', 300, 100, 40],
      ['yaw', 'cycloidal', 200, 100, 30],
      ['pitch', 'cycloidal', 100, 150, 20],
    ], 300, 2);
    expect(isTiltedYaw(b.joints, 0)).toBe(false);
    expect(isTiltedYaw(b.joints, 1)).toBe(false);
    near(computeArm(b).joints[1].TstaticModel, 0, 1e-12);
  });
});

describe('a 1-joint arm', () => {
  it('pitch: tool 100 g at 0.1 m, payload 0.5 kg at 0.2 m', () => {
    const r = computeArm(chain([['pitch', 'cycloidal', 400, 200, 100]], 500, 3));
    expect(r.valid).toBe(true);
    expect(r.joints).toHaveLength(1);
    near(r.joints[0].TstaticModel, G * (0.1 * 0.1 + 0.5 * 0.2)); // 0.11 g
    const I = 0.1 * (0.1 ** 2 + 0.2 ** 2 / 12) + 0.5 * 0.04; // 0.0213333
    near(r.joints[0].inertia, I);
    near(r.joints[0].Treq, G * 0.11 + 3 * I);
    near(r.reach_mm, 200, 1e-12);
  });
  it('yaw or roll alone: everything is on the axis, so the torque is 0 and T_des is the floor', () => {
    for (const m of ['yaw', 'roll'] as const) {
      const r = computeArm(chain([[m, 'cycloidal', 400, 200, 100]], 500, 3));
      expect(r.valid).toBe(true);
      near(r.joints[0].Treq, 0, 1e-12);
      near(r.joints[0].Tdes, 1, 1e-12);
      near(r.reach_mm, 0, 1e-12);
    }
  });
  it('the joint count must be 1 to 8', () => {
    const d = defaultArmInputs();
    expect(computeArm({ ...d, joints: [] }).valid).toBe(false);
    expect(validateArmInputs({ ...d, joints: [] }).errors[0]).toMatch(/1 to 8 joints/);
    const nine = chain(Array.from({ length: 9 }, () => ['pitch', 'cycloidal', 100, 100, 10] as Spec), 0);
    expect(computeArm(nine).valid).toBe(false);
    expect(nine.joints.length).toBe(MAX_JOINTS + 1);
  });
});

describe('an 8-joint arm', () => {
  // only the payload (1 kg) has mass; links 100,200,150,100,50,40,30,20 mm; yaw, pitch, pitch, roll, pitch, roll, pitch, roll
  const motions: MotionType[] = ['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll', 'pitch', 'roll'];
  const len = [100, 200, 150, 100, 50, 40, 30, 20];
  const a = chain(motions.map((m, i) => [m, 'cycloidal', 0, len[i], 0] as Spec), 1000, 1);
  const r = computeArm(a);
  it('pitch joints: T = g * payload * horizontal distance to the tip', () => {
    expect(r.valid).toBe(true);
    expect(r.joints).toHaveLength(8);
    // x from J2: J3 0.2, J4 0.35, J5 0.45, J6 0.5, J7 0.54, J8 0.57, tip 0.59
    near(r.joints[1].TstaticModel, G * 0.59);
    near(r.joints[2].TstaticModel, G * 0.39);
    near(r.joints[4].TstaticModel, G * 0.14);
    near(r.joints[6].TstaticModel, G * 0.05);
    near(r.joints[1].inertia, 0.59 ** 2);
    near(r.reach_mm, 590, 1e-12);
  });
  it('roll joints use the next pitch downstream; the last roll is at the tip', () => {
    near(r.joints[3].TstaticModel, G * 0.14); // beyond J5: 50+40+30+20 mm
    near(r.joints[3].inertia, 0.14 ** 2);
    near(r.joints[5].TstaticModel, G * 0.05); // beyond J7: 30 + 20 mm of links to the payload
    near(r.joints[7].TstaticModel, 0, 1e-12);
  });
  it('yaw: no gravity torque, I_z = payload * 0.59^2', () => {
    near(r.joints[0].TstaticModel, 0, 1e-12);
    near(r.joints[0].inertia, 0.59 ** 2);
  });
});

describe('base column length', () => {
  it('a 0 mm column gives exactly the same numbers as the 100 mm default (it only moves the drawing)', () => {
    const d = computeArm(defaultArmInputs());
    const z = defaultArmInputs();
    z.joints[0].length_mm = 0;
    const r = computeArm(z);
    expect(r.valid).toBe(true);
    r.joints.forEach((j, i) => {
      const e = d.joints[i];
      for (const k of ['TstaticModel', 'TdynModel', 'TreqModel', 'inertia', 'Treq', 'Tdes', 'outboardWeight_N', 'bearingRadial_N', 'bearingAxial_N', 'bearingTiltMoment_Nm'] as const) {
        near(j[k], e[k], 1e-12, `${i} ${k}`);
      }
    });
    near(r.reach_mm, d.reach_mm, 1e-12);
    near(r.totalMass_g, d.totalMass_g, 1e-12);
  });
});

describe('joint list helpers', () => {
  it('ids are never reused while a larger one exists; labels follow the position', () => {
    const a = defaultArmInputs();
    expect(nextJointId(a.joints)).toBe('J6');
    const b = a.joints.filter((j) => j.id !== 'J2');
    expect(nextJointId(b)).toBe('J6');
    expect(jointLabel(a.joints[2], 2)).toBe('J3 elbow pitch');
    expect(jointLabel({ name: ' ' }, 0)).toBe('J1');
    const j = makeJoint(a.joints, 'roll');
    expect(j.id).toBe('J6');
    expect(j.name).toBe('roll');
    expect(j.drive).toBe('cycloidal');
    expect(computeArm({ ...a, joints: [...a.joints, j] }).valid).toBe(true);
  });
  it('rejects repeated ids and unknown types without throwing', () => {
    const a = defaultArmInputs();
    a.joints[1].id = 'J1';
    expect(validateArmInputs(a).errors[0]).toMatch(/repeats the id/);
    const b = defaultArmInputs();
    (b.joints[2] as unknown as { motion: string }).motion = 'swing';
    expect(computeArm(b).valid).toBe(false);
    expect(computeArm(b).joints).toHaveLength(5);
  });
  it('normalizeArmInputs keeps a valid joint list, repairs bad fields and ids, and clamps to 8 joints', () => {
    const a = chain(Array.from({ length: 10 }, () => ['pitch', 'cycloidal', 100, 100, 10] as Spec), 5);
    const n = normalizeArmInputs(JSON.parse(JSON.stringify(a)));
    expect(n.joints).toHaveLength(MAX_JOINTS);
    const messy = normalizeArmInputs({
      joints: [{ id: 'A', motion: 'roll', mass_g: 'x' }, { id: 'A', motion: 'nope', drive: 'servo', length_mm: 5 }, 'junk'],
      payload_g: 7,
    });
    expect(messy.joints).toHaveLength(3);
    expect(new Set(messy.joints.map((j) => j.id)).size).toBe(3);
    expect(messy.joints[0].motion).toBe('roll');
    expect(messy.joints[0].mass_g).toBe(450); // from the default of that position
    expect(messy.joints[1].motion).toBe('pitch'); // unknown type falls back to the default of that position
    expect(messy.joints[1].drive).toBe('servo');
    expect(messy.joints[1].length_mm).toBe(5);
    expect(messy.payload_g).toBe(7);
    expect(computeArm(messy).valid).toBe(true);
  });
});
