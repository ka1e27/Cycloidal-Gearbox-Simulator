import { describe, expect, it } from 'vitest';
import { computeArm, defaultArmInputs, G } from '../index';
import type { ArmInputs } from '../index';

const near = (got: number, want: number, rel = 1e-9, label = '') =>
  expect(Math.abs(got - want), `${label} got ${got} want ${want}`).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(want) * rel));

/** Everything massless and zero alpha unless the test sets it. Lengths in mm: riser, A, B, C, D. */
function blank(): ArmInputs {
  return {
    jointMass_g: [0, 0, 0, 0, 0],
    barMass_g: [0, 0, 0, 0, 0],
    barLength_mm: [100, 200, 150, 100, 50],
    payload_g: 0,
    linkOffset_mm: [15, 15],
    alpha: [0, 0, 0, 0, 0],
    SF: 1.5,
    TdesFloor: 1.0,
    override: [
      { Treq: null, Tdes: null }, { Treq: null, Tdes: null }, { Treq: null, Tdes: null },
      { Treq: null, Tdes: null }, { Treq: null, Tdes: null },
    ],
  };
}

describe('arm model: static torques, hand computed', () => {
  it('1 kg payload only: T = g * m * distance to the tip', () => {
    const a = blank();
    a.payload_g = 1000;
    const r = computeArm(a);
    expect(r.valid).toBe(true);
    // tip is at 200+150+100+50 = 500 mm from J2; 300 mm from J3; 50 mm from J4 and J5
    near(r.joints[0].TreqModel, 0, 1e-9, 'J1');
    near(r.joints[1].TreqModel, G * 0.5, 1e-9, 'J2');
    near(r.joints[2].TreqModel, G * 0.3, 1e-9, 'J3');
    near(r.joints[3].TreqModel, G * 0.05, 1e-9, 'J4');
    near(r.joints[4].TreqModel, G * 0.05, 1e-9, 'J5');
    // output-bearing loads: weight 9.81 N outboard of every joint
    for (let j = 0; j < 5; j++) near(r.joints[j].outboardWeight_N, G, 1e-9, `W J${j + 1}`);
    // J1: axial thrust = weight, no radial load, overturning moment = weight x horizontal reach (0.5 m)
    near(r.joints[0].bearingAxial_N, G, 1e-9, 'J1 axial');
    near(r.joints[0].bearingRadial_N, 0, 1e-12, 'J1 radial');
    near(r.joints[0].bearingTiltMoment_Nm, G * 0.5, 1e-9, 'J1 overturning moment');
    // J2 / J3: radial = weight, tilt = radial x 15 mm link offset (NOT the gravity torque)
    near(r.joints[1].bearingRadial_N, G, 1e-9, 'J2 radial');
    near(r.joints[1].bearingTiltMoment_Nm, G * 0.015, 1e-9, 'J2 tilt');
    near(r.joints[2].bearingRadial_N, G, 1e-9, 'J3 radial');
    near(r.joints[2].bearingTiltMoment_Nm, G * 0.015, 1e-9, 'J3 tilt');
    // J4: radial = weight; payload at 50 mm along the roll axis when the tool is straight (bent: still 0 for the tool)
    near(r.joints[3].bearingRadial_N, G, 1e-9, 'J4 radial');
    near(r.joints[3].bearingTiltMoment_Nm, G * (0.1 + 0.05), 1e-9, 'J4 tilt (bar C length 100 mm + tool 50 mm)');
    // J5 is a servo
    near(r.joints[4].bearingRadial_N + r.joints[4].bearingAxial_N + r.joints[4].bearingTiltMoment_Nm, 0, 1e-12, 'J5');
  });

  it('bearing tilt moments: link offset scales J2/J3 only; J4 uses the straight tool (worse than bent)', () => {
    const a = blank();
    a.payload_g = 1000;
    a.linkOffset_mm = [30, 0];
    const r = computeArm(a);
    near(r.joints[1].bearingTiltMoment_Nm, G * 0.03, 1e-9, 'J2 30 mm');
    near(r.joints[2].bearingTiltMoment_Nm, 0, 1e-12, 'J3 0 mm');
    near(r.joints[0].bearingTiltMoment_Nm, G * 0.5, 1e-9, 'J1 independent of the offset');
    // every element on the roll axis: bar C 200 g at 50 mm, J5 300 g at 100 mm, bar D 400 g at 125 mm, payload 500 g at 150 mm
    const b = blank();
    b.barMass_g = [0, 0, 0, 200, 400];
    b.jointMass_g = [0, 0, 0, 0, 300];
    b.payload_g = 500;
    const rb = computeArm(b);
    near(rb.joints[3].bearingTiltMoment_Nm, G * (0.2 * 0.05 + 0.3 * 0.1 + 0.4 * 0.125 + 0.5 * 0.15), 1e-9, 'J4 straight tool');
    near(rb.joints[3].TstaticModel, G * (0.4 * 0.025 + 0.5 * 0.05), 1e-9, 'gravity torque (bent tool) is a separate number');
  });

  it('uniform bar A (600 g, 200 mm): COM at the midpoint, loads J2 only', () => {
    const a = blank();
    a.barMass_g[1] = 600;
    const r = computeArm(a);
    near(r.joints[1].TreqModel, G * 0.6 * 0.1, 1e-9, 'J2');
    near(r.joints[2].TreqModel, 0, 1e-9, 'J3');
    near(r.joints[1].outboardWeight_N, G * 0.6, 1e-9);
    near(r.joints[2].outboardWeight_N, 0, 1e-9);
  });

  it('a joint lumped mass has zero arm at its own joint but loads joints inboard', () => {
    const a = blank();
    a.jointMass_g[2] = 500; // J3 motor, 200 mm from J2
    const r = computeArm(a);
    near(r.joints[1].TreqModel, G * 0.5 * 0.2, 1e-9, 'J2 carries the J3 motor');
    near(r.joints[2].TreqModel, 0, 1e-9, 'J3 does not carry its own motor');
    near(r.joints[1].outboardWeight_N, G * 0.5, 1e-9);
    near(r.joints[2].outboardWeight_N, 0, 1e-9);
  });

  it('J4 roll: bar D and payload only (J5 mass and bar C are on the roll axis)', () => {
    const a = blank();
    a.barLength_mm = [100, 200, 150, 100, 100];
    a.barMass_g[4] = 400;
    a.payload_g = 200;
    a.jointMass_g[4] = 300; // J5 on the axis
    a.barMass_g[3] = 250; // bar C on the axis
    const r = computeArm(a);
    near(r.joints[3].TstaticModel, G * (0.4 * 0.05 + 0.2 * 0.1), 1e-9, 'J4 static');
    // outboard weight of J4 includes bar C, J5, bar D and payload
    near(r.joints[3].outboardWeight_N, G * (0.25 + 0.3 + 0.4 + 0.2), 1e-9);
    near(r.joints[4].TstaticModel, G * 0.04, 1e-9, 'J5 servo static');
  });
});

describe('arm model: dynamic terms', () => {
  it('payload only, alpha = 2: T_dyn = alpha * m * x^2', () => {
    const a = blank();
    a.payload_g = 1000;
    a.alpha = [2, 2, 2, 2, 2];
    const r = computeArm(a);
    near(r.joints[1].TdynModel, 2 * 1 * 0.5 ** 2, 1e-9, 'J2');
    near(r.joints[2].TdynModel, 2 * 1 * 0.3 ** 2, 1e-9, 'J3');
    near(r.joints[3].TdynModel, 2 * 1 * 0.05 ** 2, 1e-9, 'J4');
    near(r.joints[0].TdynModel, 2 * 1 * 0.5 ** 2, 1e-9, 'J1 yaw, arm straight out');
    near(r.joints[0].TreqModel, r.joints[0].TdynModel, 1e-12, 'J1 has no gravity torque');
  });

  it('rod inertia m (L^2/12 + xc^2): bar A 600 g, 200 mm, alpha = 3', () => {
    const a = blank();
    a.barMass_g[1] = 600;
    a.alpha = [3, 3, 3, 3, 3];
    const r = computeArm(a);
    const I = 0.6 * (0.2 ** 2 / 12 + 0.1 ** 2);
    near(r.joints[1].inertia, I, 1e-9);
    near(r.joints[1].TdynModel, 3 * I, 1e-9);
    near(r.joints[1].TreqModel, G * 0.6 * 0.1 + 3 * I, 1e-9);
    near(r.joints[0].TdynModel, 3 * I, 1e-9, 'J1 sees the same inertia');
  });

  it('J4 roll inertia: bar D as a rod about its end (m L^2/3) plus payload m L^2', () => {
    const a = blank();
    a.barLength_mm = [100, 200, 150, 100, 100];
    a.barMass_g[4] = 400;
    a.payload_g = 200;
    a.alpha = [3, 3, 3, 3, 3];
    const r = computeArm(a);
    const I = (0.4 * 0.1 ** 2) / 3 + 0.2 * 0.1 ** 2;
    near(r.joints[3].inertia, I, 1e-9);
    near(r.joints[3].TreqModel, G * 0.04 + 3 * I, 1e-9);
  });

  it('J1 yaw with a riser on the axis and masses along the arm', () => {
    const a = blank();
    a.barMass_g[0] = 500; // vertical riser on the J1 axis: no yaw inertia
    a.jointMass_g[2] = 400; // J3 at 200 mm
    a.jointMass_g[3] = 300; // J4 at 350 mm
    a.alpha = [4, 0, 0, 0, 0];
    const r = computeArm(a);
    const I = 0.4 * 0.2 ** 2 + 0.3 * 0.35 ** 2;
    near(r.joints[0].inertia, I, 1e-9);
    near(r.joints[0].TreqModel, 4 * I, 1e-9);
  });
});

describe('arm model: T_des and overrides', () => {
  it('T_des = max(SF * T_req, floor)', () => {
    const a = blank();
    a.payload_g = 1000;
    const r = computeArm(a);
    near(r.joints[1].Tdes, 1.5 * G * 0.5, 1e-9); // 7.36 > floor
    near(r.joints[3].Tdes, 1.0, 1e-9); // 1.5*0.49 = 0.74 < floor 1.0
    near(r.joints[0].Tdes, 1.0, 1e-9); // T_req = 0 -> floor
  });
  it('manual overrides replace the model values', () => {
    const a = blank();
    a.payload_g = 1000;
    a.override[1] = { Treq: 4, Tdes: null };
    a.override[2] = { Treq: null, Tdes: 9 };
    const r = computeArm(a);
    near(r.joints[1].Treq, 4);
    near(r.joints[1].Tdes, 6);
    expect(r.joints[1].treqOverridden).toBe(true);
    near(r.joints[2].Treq, G * 0.3, 1e-9);
    near(r.joints[2].Tdes, 9);
    expect(r.joints[2].tdesOverridden).toBe(true);
  });
  it('J5 servo torque has no floor', () => {
    const a = blank();
    a.payload_g = 1000;
    const r = computeArm(a);
    near(r.joints[4].Tdes, 1.5 * G * 0.05, 1e-9);
  });
});

describe('arm model: defaults and bad input', () => {
  it('default arm gives roughly J2 = 5.85 N*m and J3 = 2.25 N*m T_req', () => {
    const r = computeArm(defaultArmInputs());
    expect(r.valid).toBe(true);
    near(r.joints[1].TreqModel, 5.85, 0.03, 'J2');
    near(r.joints[2].TreqModel, 2.25, 0.03, 'J3');
    near(r.joints[3].TreqModel, 0.3, 0.2, 'J4 ~0.3');
  });
  it('never throws on garbage and reports errors', () => {
    const a = defaultArmInputs();
    a.payload_g = NaN;
    a.barLength_mm[2] = -5;
    const r = computeArm(a);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    const r2 = computeArm(null as unknown as ArmInputs);
    expect(r2.valid).toBe(false);
    expect(r2.joints).toHaveLength(5);
  });
});
