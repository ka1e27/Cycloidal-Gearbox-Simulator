// Independent re-derivation of the arm load model (audit). The reference below does NOT reuse arm.ts's structure:
// it places every element of ANY chain in 3D (x horizontal along the arm, y horizontal and perpendicular, z up) with
// explicit direction vectors, and computes torque / inertia about each joint axis with vector formulas (r x F, and the
// parallel-axis theorem with the rod's own inertia projected on the axis). Rules it implements (CLAUDE.md Addition 7):
//   pose A (worst case): links before the first pitch joint point up, from the first pitch joint on they point along x;
//   pitch axis = y; yaw axis = z, or y when a pitch joint is upstream (worst case); roll axis = along its link;
//   roll: the elements up to the next downstream non-roll joint k stay on the axis, everything beyond k is bent 90
//   degrees (along y) at k; a roll with no such k has nothing off its axis.
import { describe, expect, it } from 'vitest';
import {
  armFromLegacy, computeArm, defaultArmInputs, makeJoint, type ArmInputs, type DriveType, type MotionType,
} from '../../calc';

const g = 9.81;
type V = [number, number, number];
const add = (a: V, b: V): V => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const sub = (a: V, b: V): V => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const mul = (a: V, k: number): V => [a[0] * k, a[1] * k, a[2] * k];
const dot = (a: V, b: V) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V, b: V): V => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const X: V = [1, 0, 0], Y: V = [0, 1, 0], Z: V = [0, 0, 1];

interface El { m: number; c: V; rod: { dir: V; L: number } | null }
interface Ref { T: number; I: number; W: number; reach: number; rollTilt: number }

/** Inertia of the elements about the line through `p` with unit direction `a`. */
function inertiaAbout(els: El[], p: V, a: V): number {
  let I = 0;
  for (const e of els) {
    const r = sub(e.c, p);
    I += e.m * (dot(r, r) - dot(r, a) ** 2);
    if (e.rod) I += (e.m * e.rod.L ** 2 / 12) * (1 - dot(e.rod.dir, a) ** 2);
  }
  return I;
}
/** Gravity torque (vertical load, -z) of the elements about the line through p along a: |sum (r x F) . a|. */
function gravityTorque(els: El[], p: V, a: V): number {
  let t = 0;
  for (const e of els) t += dot(cross(sub(e.c, p), [0, 0, -e.m * g]), a);
  return Math.abs(t);
}

function reference(arm: ArmInputs): Ref[] {
  const js = arm.joints;
  const n = js.length;
  const L = js.map((j) => j.length_mm / 1000);
  const pitchAt = js.findIndex((j) => j.motion === 'pitch');
  const dirOf = (i: number): V => (pitchAt < 0 || i < pitchAt ? Z : X);

  // pose A: joint positions and elements, in chain order (joint 0, link 0, joint 1, link 1, ..., payload)
  const P: V[] = [[0, 0, 0]];
  for (let i = 0; i < n; i++) P.push(add(P[i], mul(dirOf(i), L[i])));
  const chainEls = (pos: (i: number) => V, dir: (i: number) => V, tip: V): El[] => {
    const list: El[] = [];
    for (let i = 0; i < n; i++) {
      list.push({ m: js[i].mass_g / 1000, c: pos(i), rod: null });
      list.push({ m: js[i].linkMass_g / 1000, c: add(pos(i), mul(dir(i), L[i] / 2)), rod: { dir: dir(i), L: L[i] } });
    }
    list.push({ m: arm.payload_g / 1000, c: tip, rod: null });
    return list;
  };
  const poseA = chainEls((i) => P[i], dirOf, P[n]);
  const after = (els: El[], j: number) => els.slice(2 * j + 1); // everything outboard of joint j (its own mass is index 2j)

  return js.map((jn, j) => {
    const outA = after(poseA, j);
    const W = outA.reduce((s, e) => s + e.m * g, 0);
    const tilted = jn.motion === 'yaw' && js.slice(0, j).some((q) => q.motion === 'pitch');
    // horizontal reach moment about the vertical through the joint: sum m g * horizontal distance
    const horiz = (r: V) => Math.sqrt(Math.max(0, dot(r, r) - dot(r, Z) ** 2));
    const reach = outA.reduce((s, e) => s + e.m * g * horiz(sub(e.c, P[j])), 0);
    if (jn.motion === 'pitch' || tilted) {
      return { T: gravityTorque(outA, P[j], Y), I: inertiaAbout(outA, P[j], Y), W, reach, rollTilt: 0 };
    }
    if (jn.motion === 'yaw') {
      return { T: gravityTorque(outA, P[j], Z), I: inertiaAbout(outA, P[j], Z), W, reach, rollTilt: 0 };
    }
    // roll: lay the chain from this joint along +x (the roll axis); beyond the next non-roll joint k bend along +y
    const k = js.findIndex((q, i) => i > j && q.motion !== 'roll');
    const S: number[] = [0];
    for (let i = j; i < n; i++) S.push(S[S.length - 1] + L[i]); // S[i - j] = chain distance of joint i from this joint
    const sAt = (i: number) => S[i - j];
    const bent = (i: number): V => (k >= 0 && i >= k ? [sAt(k), sAt(i) - sAt(k), 0] : [sAt(i), 0, 0]); // joint i position
    const straight = (i: number): V => [sAt(i), 0, 0];
    const mk = (pos: (i: number) => V, bendDir: (i: number) => V): El[] => {
      const list: El[] = [];
      for (let i = j + 1; i < n; i++) list.push({ m: js[i].mass_g / 1000, c: pos(i), rod: null });
      for (let i = j; i < n; i++) {
        const d = bendDir(i);
        list.push({ m: js[i].linkMass_g / 1000, c: add(pos(i), mul(d, L[i] / 2)), rod: { dir: d, L: L[i] } });
      }
      return list;
    };
    const tipB = k >= 0 ? [sAt(k), sAt(n) - sAt(k), 0] as V : ([sAt(n), 0, 0] as V);
    const dirBent = (i: number): V => (k >= 0 && i >= k ? Y : X);
    const bentEls = [...mk(bent, dirBent), { m: arm.payload_g / 1000, c: tipB, rod: null }];
    const straightEls = [...mk(straight, () => X), { m: arm.payload_g / 1000, c: [sAt(n), 0, 0] as V, rod: null }];
    const origin: V = [0, 0, 0];
    // the elements up to k lie on the axis and contribute exactly 0 to the gravity torque and the inertia
    return {
      T: k >= 0 ? gravityTorque(bentEls, origin, X) : 0,
      I: k >= 0 ? inertiaAbout(bentEls, origin, X) : inertiaAbout(straightEls, origin, X),
      W, reach,
      rollTilt: Math.max(
        straightEls.reduce((s, e) => s + e.m * g * dot(sub(e.c, origin), X), 0),
        bentEls.reduce((s, e) => s + e.m * g * dot(sub(e.c, origin), X), 0),
      ),
    };
  });
}

const near = (got: number, want: number, rel = 1e-9, msg = '') =>
  expect(Math.abs(got - want), `${msg} got ${got} want ${want}`).toBeLessThanOrEqual(Math.max(1e-12, Math.abs(want) * rel));

function checkAgainstReference(name: string, arm: ArmInputs) {
  const r = computeArm(arm);
  expect(r.valid, name).toBe(true);
  const ref = reference(arm);
  arm.joints.forEach((jn, j) => {
    const m = r.joints[j];
    const e = ref[j];
    const tag = `${name} J${j + 1} (${jn.motion}/${jn.drive})`;
    near(m.inertia, e.I, 1e-9, `${tag} inertia`);
    near(m.TstaticModel, e.T, 1e-9, `${tag} static`);
    near(m.TdynModel, jn.alpha * e.I, 1e-9, `${tag} dyn`);
    near(m.TreqModel, e.T + jn.alpha * e.I, 1e-9, `${tag} Treq`);
    near(m.outboardWeight_N, e.W, 1e-9, `${tag} outboard weight`);
    const floor = jn.drive === 'servo' ? 0 : arm.TdesFloor;
    near(m.Tdes, Math.max(arm.SF * m.Treq, floor), 1e-12, `${tag} Tdes`);
    const sum = m.bearingRadial_N + m.bearingAxial_N + m.bearingTiltMoment_Nm;
    if (jn.drive === 'servo') { near(sum, 0, 1e-12, `${tag} servo has no bearing loads`); return; }
    const tilted = jn.motion === 'yaw' && arm.joints.slice(0, j).some((q) => q.motion === 'pitch');
    if (jn.motion === 'pitch') {
      near(m.bearingRadial_N, e.W, 1e-9, `${tag} radial`);
      near(m.bearingAxial_N, 0, 1e-12, `${tag} axial`);
      near(m.bearingTiltMoment_Nm, e.W * jn.linkOffset_mm / 1000, 1e-9, `${tag} tilt`);
    } else if (jn.motion === 'yaw') {
      near(m.bearingAxial_N, e.W, 1e-9, `${tag} axial`);
      near(m.bearingRadial_N, tilted ? e.W : 0, 1e-9, `${tag} radial`);
      near(m.bearingTiltMoment_Nm, tilted ? Math.max(e.reach, e.W * jn.linkOffset_mm / 1000) : e.reach, 1e-9, `${tag} overturning`);
    } else {
      near(m.bearingRadial_N, e.W, 1e-9, `${tag} radial`);
      near(m.bearingAxial_N, 0, 1e-12, `${tag} axial`);
      near(m.bearingTiltMoment_Nm, e.rollTilt, 1e-9, `${tag} roll tilt`);
    }
  });
  const total = arm.joints.reduce((s, j) => s + j.mass_g + j.linkMass_g, 0) + arm.payload_g;
  near(r.totalMass_g, total, 1e-12, `${name} total mass`);
  const pitchAt = arm.joints.findIndex((j) => j.motion === 'pitch');
  const reach = pitchAt < 0 ? 0 : arm.joints.slice(pitchAt).reduce((s, j) => s + j.length_mm, 0);
  near(r.reach_mm, reach, 1e-12, `${name} reach`);
}

const OV = () => [0, 1, 2, 3, 4].map(() => ({ Treq: null, Tdes: null })) as never;
function legacy(over: Partial<{
  jointMass_g: number[]; barMass_g: number[]; barLength_mm: number[]; payload_g: number; alpha: number[]; SF: number; TdesFloor: number; linkOffset_mm: [number, number];
}>): ArmInputs {
  const d = defaultArmInputs();
  return armFromLegacy({
    jointMass_g: d.joints.map((j) => j.mass_g) as never, barMass_g: d.joints.map((j) => j.linkMass_g) as never,
    barLength_mm: d.joints.map((j) => j.length_mm) as never, payload_g: d.payload_g, alpha: d.joints.map((j) => j.alpha) as never,
    SF: d.SF, TdesFloor: d.TdesFloor, linkOffset_mm: [15, 15], override: OV(), ...over,
  } as never);
}

const ARMS: { name: string; arm: ArmInputs }[] = [
  { name: 'default', arm: defaultArmInputs() },
  {
    name: 'long light arm, high alpha',
    arm: legacy({
      jointMass_g: [900, 1200, 800, 300, 150], barMass_g: [200, 300, 250, 90, 120],
      barLength_mm: [180, 420, 380, 120, 160], payload_g: 500, alpha: [8, 6, 6, 10, 12], SF: 2, TdesFloor: 2,
    }),
  },
  {
    name: 'tiny arm, no payload',
    arm: legacy({
      jointMass_g: [100, 120, 90, 40, 25], barMass_g: [10, 30, 25, 12, 15], barLength_mm: [50, 90, 80, 40, 60],
      payload_g: 0, alpha: [1, 2, 3, 4, 5], SF: 1.2, TdesFloor: 0.2,
    }),
  },
  {
    name: 'heavy payload, short tool',
    arm: legacy({
      jointMass_g: [2000, 2500, 1500, 600, 400], barMass_g: [400, 800, 700, 300, 250],
      barLength_mm: [250, 500, 450, 150, 90], payload_g: 3000, alpha: [2, 2, 2, 5, 5], SF: 1.5, TdesFloor: 1,
    }),
  },
];

function chainOf(motions: MotionType[], drives: DriveType[], seed: number): ArmInputs {
  let s = seed;
  const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
  const joints = motions.map((m, i) => {
    const j = makeJoint(Array.from({ length: i }, (_, k) => ({ id: `J${k + 1}` })), m, drives[i] ?? 'cycloidal');
    j.mass_g = Math.round(50 + rnd() * 900);
    j.linkMass_g = Math.round(10 + rnd() * 300);
    j.length_mm = Math.round(20 + rnd() * 400);
    j.alpha = Math.round((0.5 + rnd() * 10) * 10) / 10;
    j.linkOffset_mm = Math.round(rnd() * 40);
    return j;
  });
  return { joints, payload_g: Math.round(rnd() * 1500), SF: 1.5, TdesFloor: 1 };
}

describe('audit: arm model vs an independent 3D re-derivation', () => {
  for (const { name, arm } of ARMS) {
    it(`matches torque, inertia, weight and moment: ${name}`, () => checkAgainstReference(name, arm));
  }

  const SHAPES: [string, MotionType[], DriveType[]][] = [
    ['yaw-pitch-pitch', ['yaw', 'pitch', 'pitch'], []],
    ['6-DOF', ['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll'], ['cycloidal', 'cycloidal', 'cycloidal', 'cycloidal', 'servo', 'servo']],
    ['two rolls', ['yaw', 'pitch', 'roll', 'roll', 'pitch'], []],
    ['roll at the tip', ['pitch', 'pitch', 'roll'], []],
    ['yaw after pitch', ['pitch', 'yaw', 'pitch'], []],
    ['yaw, yaw, pitch', ['yaw', 'yaw', 'pitch', 'pitch'], []],
    ['no pitch at all', ['yaw', 'roll', 'yaw'], []],
    ['roll before the first pitch', ['roll', 'yaw', 'pitch', 'roll', 'pitch'], []],
    ['1 joint pitch', ['pitch'], []],
    ['1 joint yaw', ['yaw'], []],
    ['1 joint roll', ['roll'], []],
    ['8 joints', ['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll', 'pitch', 'roll'], []],
    ['8 pitch joints', Array(8).fill('pitch') as MotionType[], []],
    ['pitch, roll, yaw, roll, pitch', ['pitch', 'roll', 'yaw', 'roll', 'pitch'], ['servo', 'cycloidal', 'servo', 'cycloidal', 'servo']],
  ];
  for (const [name, motions, drives] of SHAPES) {
    it(`matches the reference for ${name}`, () => {
      for (let seed = 1; seed <= 6; seed++) checkAgainstReference(`${name} #${seed}`, chainOf(motions, drives, seed * 7919));
    });
  }

  it('300 random chains of 1 to 8 joints with random motion and drive types', () => {
    let s = 987654321;
    const rnd = () => { s = (s * 1664525 + 1013904223) % 4294967296; return s / 4294967296; };
    const MO: MotionType[] = ['yaw', 'pitch', 'roll'];
    for (let n = 0; n < 300; n++) {
      const count = 1 + Math.floor(rnd() * 8);
      const motions = Array.from({ length: count }, () => MO[Math.floor(rnd() * 3)]);
      const drives = Array.from({ length: count }, () => (rnd() < 0.3 ? 'servo' : 'cycloidal') as DriveType);
      checkAgainstReference(`random #${n} [${motions.join(',')}]`, chainOf(motions, drives, 1000 + n * 31));
    }
  });

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
    const a = legacy({ jointMass_g: [0, 0, 1000, 0, 0], barMass_g: [0, 0, 0, 0, 0], payload_g: 0, barLength_mm: [100, 200, 150, 100, 50], alpha: [1, 1, 1, 1, 1] });
    const r = computeArm(a);
    near(r.joints[1].TstaticModel, g * 1 * 0.2, 1e-12, 'J2 carries it');
    near(r.joints[1].inertia, 1 * 0.2 * 0.2, 1e-12, 'J2 inertia carries it');
    near(r.joints[2].TstaticModel, 0, 1e-12, 'J3 does not');
    near(r.joints[2].inertia, 0, 1e-12, 'J3 inertia has no own point mass');
  });

  it('unit handling: grams and millimetres are scaled once (1 kg at 1 m is 9.81 N*m)', () => {
    const a = legacy({
      jointMass_g: [0, 0, 0, 0, 0], barMass_g: [0, 0, 0, 0, 0], payload_g: 1000, alpha: [0, 0, 0, 0, 0],
      barLength_mm: [100, 1000, 0, 0, 0],
    });
    const r = computeArm(a);
    near(r.joints[1].TstaticModel, 9.81, 1e-12);
    near(r.joints[1].inertia, 1, 1e-12);
  });

  it('J1 yaw: no gravity torque; the riser is on axis and adds no inertia', () => {
    const a = legacy({ barMass_g: [500, 0, 0, 0, 0], jointMass_g: [0, 0, 0, 0, 0], payload_g: 0 });
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
    a.joints[3].override = { Treq: 2, Tdes: null };
    r = computeArm(a);
    near(r.joints[3].Treq, 2, 1e-12);
    near(r.joints[3].Tdes, Math.max(a.SF * 2, 5), 1e-12);
    a.joints[3].override = { Treq: 2, Tdes: 0.5 };
    r = computeArm(a);
    near(r.joints[3].Tdes, 0.5, 1e-12, 'manual T_des wins even below the floor');
  });

  it('changing a joint to a servo drops the floor and the bearing loads, keeps the torque', () => {
    const a = defaultArmInputs();
    const before = computeArm(a).joints[1];
    a.joints[1].drive = 'servo';
    const after = computeArm(a).joints[1];
    near(after.Treq, before.Treq, 1e-12);
    near(after.Tdes, a.SF * after.Treq, 1e-12);
    near(after.bearingRadial_N + after.bearingTiltMoment_Nm, 0, 1e-12);
  });
});
