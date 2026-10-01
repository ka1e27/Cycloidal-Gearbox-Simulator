// Independent re-derivation of the arm load model (audit). The reference below does NOT reuse arm.ts's
// structure: it places every element in 3D (x along the straight-out arm, y horizontal and perpendicular,
// z up), orders the chain, and computes torque / inertia about each joint axis with vector formulas.
import { describe, expect, it } from 'vitest';
import { computeArm, defaultArmInputs, type ArmInputs, type Five } from '../../calc';

const g = 9.81;

interface El { m: number; c: [number, number, number]; rod?: { axis: 'x' | 'y' | 'z'; L: number } }
type Axis = 'x' | 'y' | 'z';

/** Chain order: J1, riser, J2, A, J3, B, J4, C, J5, D, payload. Elements after a joint are outboard of it. */
function reference(a: ArmInputs) {
  const L = a.barLength_mm.map((v) => v / 1000);
  const mj = a.jointMass_g.map((x) => x / 1000);
  const mb = a.barMass_g.map((x) => x / 1000);
  const mp = a.payload_g / 1000;
  const x2 = 0, x3 = L[1], x4 = L[1] + L[2], x5 = L[1] + L[2] + L[3], xt = x5 + L[4];
  // z measured up from the J2 axis; J1 sits one riser length below
  const build = (toolAlong: 'x' | 'y'): El[] => {
    const toolC: [number, number, number] = toolAlong === 'x' ? [x5 + L[4] / 2, 0, 0] : [x5, L[4] / 2, 0];
    const tipC: [number, number, number] = toolAlong === 'x' ? [xt, 0, 0] : [x5, L[4], 0];
    return [
      { m: mj[0], c: [0, 0, -L[0]] },
      { m: mb[0], c: [0, 0, -L[0] / 2], rod: { axis: 'z', L: L[0] } },
      { m: mj[1], c: [x2, 0, 0] },
      { m: mb[1], c: [x2 + L[1] / 2, 0, 0], rod: { axis: 'x', L: L[1] } },
      { m: mj[2], c: [x3, 0, 0] },
      { m: mb[2], c: [x3 + L[2] / 2, 0, 0], rod: { axis: 'x', L: L[2] } },
      { m: mj[3], c: [x4, 0, 0] },
      { m: mb[3], c: [x4 + L[3] / 2, 0, 0], rod: { axis: 'x', L: L[3] } },
      { m: mj[4], c: [x5, 0, 0] },
      { m: mb[4], c: toolC, rod: { axis: toolAlong, L: L[4] } },
      { m: mp, c: tipC },
    ];
  };
  const rank: Record<string, number> = { J1: 0, J2: 2, J3: 4, J4: 6, J4s: 6, J5: 8 };
  const jointPos: Record<string, [number, number, number]> = {
    J1: [0, 0, -L[0]], J2: [x2, 0, 0], J3: [x3, 0, 0], J4: [x4, 0, 0], J4s: [x4, 0, 0], J5: [x5, 0, 0],
  };
  // rod inertia about its own centre for a rotation axis perpendicular to the rod; zero about the rod axis
  const own = (e: El, axis: Axis) => (e.rod && e.rod.axis !== axis ? (e.m * e.rod.L * e.rod.L) / 12 : 0);
  const perp2 = (d: [number, number, number], axis: Axis) =>
    axis === 'x' ? d[1] ** 2 + d[2] ** 2 : axis === 'y' ? d[0] ** 2 + d[2] ** 2 : d[0] ** 2 + d[1] ** 2;

  const out: Record<string, { T: number; I: number; W: number; M: number }> = {};
  const calc = (name: string, axis: Axis, tool: 'x' | 'y') => {
    const els = build(tool).filter((_, i) => i > rank[name]);
    const p = jointPos[name];
    let T = 0, I = 0, W = 0, M = 0;
    for (const e of els) {
      const d: [number, number, number] = [e.c[0] - p[0], e.c[1] - p[1], e.c[2] - p[2]];
      I += e.m * perp2(d, axis) + own(e, axis);
      W += e.m * g;
      if (axis === 'y') T += e.m * g * d[0]; // pitch: gravity lever arm is the horizontal x offset
      if (axis === 'x') T += e.m * g * d[1]; // roll: lever arm is the horizontal y offset
      M += e.m * g * d[0];
    }
    out[name] = { T, I, W, M };
  };
  calc('J1', 'z', 'x');
  calc('J2', 'y', 'x');
  calc('J3', 'y', 'x');
  calc('J4', 'x', 'y'); // roll about the forearm axis with the tool bent 90 degrees
  calc('J4s', 'x', 'x'); // same joint with the tool straight out (worst case for the tilting moment of its bearing)
  calc('J5', 'y', 'x'); // wrist pitch with the tool straight out
  return out;
}

const near = (got: number, want: number, rel = 1e-9, msg = '') =>
  expect(Math.abs(got - want), `${msg} got ${got} want ${want}`).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(want) * rel));

const OV = () => [0, 1, 2, 3, 4].map(() => ({ Treq: null, Tdes: null })) as ArmInputs['override'];
function mk(over: Partial<ArmInputs>): ArmInputs {
  return { ...defaultArmInputs(), override: OV(), ...over };
}

const ARMS: { name: string; arm: ArmInputs }[] = [
  { name: 'default', arm: defaultArmInputs() },
  {
    name: 'long light arm, high alpha',
    arm: mk({
      jointMass_g: [900, 1200, 800, 300, 150], barMass_g: [200, 300, 250, 90, 120],
      barLength_mm: [180, 420, 380, 120, 160], payload_g: 500, alpha: [8, 6, 6, 10, 12], SF: 2, TdesFloor: 2,
    }),
  },
  {
    name: 'tiny arm, no payload',
    arm: mk({
      jointMass_g: [100, 120, 90, 40, 25], barMass_g: [10, 30, 25, 12, 15], barLength_mm: [50, 90, 80, 40, 60],
      payload_g: 0, alpha: [1, 2, 3, 4, 5], SF: 1.2, TdesFloor: 0.2,
    }),
  },
  {
    name: 'heavy payload, short tool',
    arm: mk({
      jointMass_g: [2000, 2500, 1500, 600, 400], barMass_g: [400, 800, 700, 300, 250],
      barLength_mm: [250, 500, 450, 150, 90], payload_g: 3000, alpha: [2, 2, 2, 5, 5], SF: 1.5, TdesFloor: 1,
    }),
  },
];

describe('audit: arm model vs an independent 3D re-derivation', () => {
  for (const { name, arm } of ARMS) {
    it(`matches torque, inertia, weight and moment: ${name}`, () => {
      const r = computeArm(arm);
      expect(r.valid).toBe(true);
      const ref = reference(arm);
      ['J1', 'J2', 'J3', 'J4', 'J5'].forEach((jn, j) => {
        const e = ref[jn];
        const m = r.joints[j];
        const stat = jn === 'J1' ? 0 : e.T;
        near(m.TstaticModel, stat, 1e-9, `${name} ${jn} static`);
        near(m.inertia, e.I, 1e-9, `${name} ${jn} inertia`);
        near(m.TdynModel, arm.alpha[j] * e.I, 1e-9, `${name} ${jn} dyn`);
        near(m.TreqModel, stat + arm.alpha[j] * e.I, 1e-9, `${name} ${jn} Treq`);
        near(m.outboardWeight_N, e.W, 1e-9, `${name} ${jn} outboard weight`);
        const floor = j === 4 ? 0 : arm.TdesFloor;
        near(m.Tdes, Math.max(arm.SF * m.Treq, floor), 1e-12, `${name} ${jn} Tdes`);
      });
      // output-bearing loads. J1: axial thrust + overturning moment of the horizontal reach, no radial load.
      near(r.joints[0].bearingAxial_N, ref.J1.W, 1e-9, 'J1 axial');
      near(r.joints[0].bearingRadial_N, 0, 1e-12, 'J1 radial');
      near(r.joints[0].bearingTiltMoment_Nm, ref.J1.M, 1e-9, 'J1 overturning moment');
      // J2, J3: radial = outboard weight, tilt = radial x link offset along the axis
      near(r.joints[1].bearingRadial_N, ref.J2.W, 1e-9, 'J2 radial');
      near(r.joints[1].bearingTiltMoment_Nm, ref.J2.W * arm.linkOffset_mm[0] / 1000, 1e-9, 'J2 tilt');
      near(r.joints[2].bearingRadial_N, ref.J3.W, 1e-9, 'J3 radial');
      near(r.joints[2].bearingTiltMoment_Nm, ref.J3.W * arm.linkOffset_mm[1] / 1000, 1e-9, 'J3 tilt');
      near(r.joints[1].bearingAxial_N + r.joints[2].bearingAxial_N + r.joints[3].bearingAxial_N, 0, 1e-12, 'no axial load on pitch / roll');
      // J4: radial = outboard weight, tilt = sum m g (axial distance along the roll axis), tool straight (worse than bent)
      near(r.joints[3].bearingRadial_N, ref.J4.W, 1e-9, 'J4 radial');
      near(r.joints[3].bearingTiltMoment_Nm, ref.J4s.M, 1e-9, 'J4 tilting moment');
      expect(ref.J4s.M).toBeGreaterThanOrEqual(ref.J4.M - 1e-12);
      // J5 is a servo: no bearing loads
      near(r.joints[4].bearingRadial_N + r.joints[4].bearingAxial_N + r.joints[4].bearingTiltMoment_Nm, 0, 1e-12, 'J5');
      near(r.totalMass_g, arm.jointMass_g.reduce((s, x) => s + x, 0) + arm.barMass_g.reduce((s, x) => s + x, 0) + arm.payload_g, 1e-12);
      near(r.reach_mm, arm.barLength_mm.slice(1).reduce((s, x) => s + x, 0), 1e-12, 'reach');
    });
  }

  it('default arm reproduces the stated placeholder torques', () => {
    const r = computeArm(defaultArmInputs());
    const T = r.joints.map((j) => j.Treq);
    near(T[0], 0.70, 0.01, 'J1');
    near(T[1], 5.87, 0.005, 'J2');
    near(T[2], 2.25, 0.005, 'J3');
    near(T[3], 0.32, 0.02, 'J4');
    near(T[4], 0.32, 0.02, 'J5');
  });

  it('default arm bearing loads (placeholders, 15 mm link offset)', () => {
    const r = computeArm(defaultArmInputs());
    const j = r.joints;
    near(j[0].bearingAxial_N, 9.81 * 2.217, 1e-9, 'J1 axial');
    // horizontal reach (m) x mass (kg): A 0.115*0.110, J3 0.23*0.577, B 0.33*0.090, J4 0.43*0.180, C 0.47*0.040, J5 0.51*0.120, D 0.565*0.070, payload 0.62*0.250
    const jm = 0.115 * 0.110 + 0.23 * 0.577 + 0.33 * 0.09 + 0.43 * 0.18 + 0.47 * 0.04 + 0.51 * 0.12 + 0.565 * 0.07 + 0.62 * 0.25;
    near(j[0].bearingTiltMoment_Nm, 9.81 * jm, 1e-9, 'J1 overturning moment');
    // J4 tilt, tool straight: C 0.04 at 0.04, J5 0.12 at 0.08, D 0.07 at 0.135, payload 0.25 at 0.19
    near(j[3].bearingTiltMoment_Nm, 9.81 * (0.04 * 0.04 + 0.12 * 0.08 + 0.07 * 0.135 + 0.25 * 0.19), 1e-9, 'J4 tilt');
    near(j[1].bearingRadial_N, 9.81 * 1.437, 1e-9, 'J2 radial');
    near(j[1].bearingTiltMoment_Nm, 9.81 * 1.437 * 0.015, 1e-9, 'J2 tilt');
    near(j[2].bearingRadial_N, 9.81 * 0.750, 1e-9, 'J3 radial');
    near(j[2].bearingTiltMoment_Nm, 9.81 * 0.750 * 0.015, 1e-9, 'J3 tilt');
    near(j[3].bearingRadial_N, 9.81 * 0.480, 1e-9, 'J4 radial');
  });

  it('own mass is excluded from own torque but loads inboard joints', () => {
    const z = (): Five => [0, 0, 0, 0, 0];
    const a = mk({ jointMass_g: z(), barMass_g: z(), payload_g: 0, barLength_mm: [100, 200, 150, 100, 50], alpha: [1, 1, 1, 1, 1] });
    a.jointMass_g = [0, 0, 1000, 0, 0]; // only J3's motor, 200 mm from J2
    const r = computeArm(a);
    near(r.joints[1].TstaticModel, g * 1 * 0.2, 1e-12, 'J2 carries it');
    near(r.joints[1].inertia, 1 * 0.2 * 0.2, 1e-12, 'J2 inertia carries it');
    near(r.joints[2].TstaticModel, 0, 1e-12, 'J3 does not');
    near(r.joints[2].inertia, 0, 1e-12, 'J3 inertia has no own point mass');
  });

  it('unit handling: grams and millimetres are scaled once (1 kg at 1 m is 9.81 N*m)', () => {
    const a = mk({
      jointMass_g: [0, 0, 0, 0, 0], barMass_g: [0, 0, 0, 0, 0], payload_g: 1000, alpha: [0, 0, 0, 0, 0],
      barLength_mm: [100, 1000, 0, 0, 0],
    });
    const r = computeArm(a);
    near(r.joints[1].TstaticModel, 9.81, 1e-12);
    near(r.joints[1].inertia, 1, 1e-12);
  });

  it('J1 yaw: no gravity torque; the riser is on axis and adds no inertia', () => {
    const a = mk({ barMass_g: [500, 0, 0, 0, 0], jointMass_g: [0, 0, 0, 0, 0], payload_g: 0 });
    const r = computeArm(a);
    near(r.joints[0].inertia, 0, 1e-15);
    near(r.joints[0].TstaticModel, 0, 1e-15);
  });

  it('T_des floor and manual overrides', () => {
    const a = defaultArmInputs();
    a.TdesFloor = 5;
    let r = computeArm(a);
    near(r.joints[3].Tdes, 5, 1e-12, 'J4 floored');
    near(r.joints[4].Tdes, a.SF * r.joints[4].Treq, 1e-12, 'J5 has no floor');
    a.override[3] = { Treq: 2, Tdes: null };
    r = computeArm(a);
    near(r.joints[3].Treq, 2, 1e-12);
    near(r.joints[3].Tdes, Math.max(a.SF * 2, 5), 1e-12);
    a.override[3] = { Treq: 2, Tdes: 0.5 };
    r = computeArm(a);
    near(r.joints[3].Tdes, 0.5, 1e-12, 'manual T_des wins even below the floor');
  });
});
