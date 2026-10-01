// Pose explorer engine (CLAUDE.md Addition 9): forward kinematics and the static gravity torque at any pose.
// Invariants: q = 0 reproduces the worst-case T_static of every pitch joint; a base yaw with a vertical axis is 0 at
// every pose; no pose ever exceeds the worst case; hand-computed poses; never NaN.
import { describe, expect, it } from 'vitest';
import {
  clampAngle, clampPose, computeArm, computePose, defaultArmInputs, G, isTiltedYaw, lerpAngle, normalizeArmInputs, normalizeJointLimits,
  posePreset, randomPose, rodrigues, validateJointLimits, wrapDeg,
  type ArmInputs, type ArmJoint, type DriveType, type MotionType,
} from '../index';

const near = (got: number, want: number, tol = 1e-9, label = '') =>
  expect(Math.abs(got - want), `${label} got ${got} want ${want}`).toBeLessThanOrEqual(tol);

type Spec = [MotionType, DriveType, number, number, number]; // motion, drive, joint g, link mm, link g
function chain(spec: Spec[], payload_g: number): ArmInputs {
  const joints: ArmJoint[] = spec.map(([motion, drive, mass_g, length_mm, linkMass_g], i) => ({
    id: `J${i + 1}`, name: '', motion, drive, mass_g, alpha: 2, linkOffset_mm: 15, length_mm, linkMass_g,
    override: { Treq: null, Tdes: null },
  }));
  return { joints, payload_g, SF: 1.5, TdesFloor: 1.0 };
}

/** Deterministic PRNG (mulberry32). */
function prng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const MOTIONS: MotionType[] = ['yaw', 'pitch', 'roll'];
function randomArm(rnd: () => number): ArmInputs {
  const n = 1 + Math.floor(rnd() * 8);
  const pick = (zeroChance: number, max: number) => (rnd() < zeroChance ? 0 : Math.round(rnd() * max));
  const spec: Spec[] = [];
  for (let i = 0; i < n; i++) {
    spec.push([MOTIONS[Math.floor(rnd() * 3)], rnd() < 0.25 ? 'servo' : 'cycloidal', pick(0.15, 1200), pick(0.2, 400), pick(0.2, 300)]);
  }
  return chain(spec, pick(0.1, 2000));
}
const randomAngles = (n: number, rnd: () => number) => Array.from({ length: n }, () => -180 + 360 * rnd());

describe('helpers', () => {
  it('Rodrigues gives orthonormal rotations with det +1 and turns x to y about z by +90', () => {
    const R = rodrigues([0, 0, 1], Math.PI / 2);
    near(R[0] * 1 + R[1] * 0 + R[2] * 0, 0, 1e-15); // x -> (0, 1, 0)
    near(R[3], 1, 1e-15);
    const k: [number, number, number] = [1 / Math.sqrt(3), 1 / Math.sqrt(3), 1 / Math.sqrt(3)];
    const M = rodrigues(k, 1.234);
    const det = M[0] * (M[4] * M[8] - M[5] * M[7]) - M[1] * (M[3] * M[8] - M[5] * M[6]) + M[2] * (M[3] * M[7] - M[4] * M[6]);
    near(det, 1, 1e-12);
    for (let r = 0; r < 3; r++) near(M[r * 3] ** 2 + M[r * 3 + 1] ** 2 + M[r * 3 + 2] ** 2, 1, 1e-12);
  });
  it('wrapDeg keeps (-180, 180], lerpAngle takes the short way', () => {
    expect(wrapDeg(190)).toBe(-170);
    expect(wrapDeg(-180)).toBe(180);
    expect(wrapDeg(540)).toBe(180);
    expect(wrapDeg(NaN)).toBe(0);
    near(lerpAngle(170, -170, 0.5), 180, 1e-12);
    near(lerpAngle(-90, 90, 0.25), -45, 1e-12);
  });
  it('presets of the default arm', () => {
    const js = defaultArmInputs().joints;
    expect(posePreset(js, 'straight')).toEqual([0, 0, 0, 0, 0]);
    expect(posePreset(js, 'ready')).toEqual([0, 90, -90, 0, 0]);
    expect(posePreset(js, 'reachUp')).toEqual([0, 90, 0, 0, 0]);
    expect(posePreset(js, 'folded')).toEqual([0, 80, -145, 0, 65]);
    const r = randomPose(js, prng(3));
    expect(r).toHaveLength(5);
    for (const x of r) expect(Number.isInteger(x) && x >= -180 && x <= 180).toBe(true);
  });
});

describe('invariant (a): q = 0 is the worst case; a vertical base yaw is always 0', () => {
  it('the default arm at q = 0: every pitch joint reads T_static', () => {
    const a = defaultArmInputs();
    const res = computeArm(a);
    const p = computePose(a, [0, 0, 0, 0, 0], res);
    for (const j of p.joints) {
      if (j.motion === 'pitch') near(j.tau_Nm, res.joints[j.index].TstaticModel, 1e-9, `J${j.index + 1}`);
    }
    near(p.joints[0].tau_Nm, 0, 0); // base yaw
    near(p.reach_mm, 620, 1e-9); // 230 + 200 + 80 + 110 from J2 on the base axis
    near(p.reach_mm, res.reach_mm, 1e-9);
  });
  it('30 random arms: pitch joints at q = 0 equal T_static to 1e-9; a vertical yaw reads exactly 0 at 200 random poses', () => {
    const rnd = prng(42);
    let pitches = 0;
    let vertYaws = 0;
    for (let k = 0; k < 30; k++) {
      const a = randomArm(rnd);
      const res = computeArm(a);
      expect(res.valid).toBe(true);
      const z = computePose(a, a.joints.map(() => 0), res);
      a.joints.forEach((j, i) => {
        if (j.motion === 'pitch') { near(z.joints[i].tau_Nm, res.joints[i].TstaticModel, 1e-9, `arm ${k} J${i + 1}`); pitches++; }
      });
      for (let s = 0; s < 200; s++) {
        const p = computePose(a, randomAngles(a.joints.length, rnd), res);
        a.joints.forEach((j, i) => {
          if (j.motion === 'yaw' && !isTiltedYaw(a.joints, i)) { expect(p.joints[i].tau_Nm).toBe(0); vertYaws++; }
        });
      }
    }
    expect(pitches).toBeGreaterThan(20);
    expect(vertYaws).toBeGreaterThan(200);
  });
});

describe('invariant (b): no pose exceeds the worst case', () => {
  it('2000 random poses x 30 random arms (1-8 joints): |tau_i| <= T_static,i + 1e-9, bending <= the q = 0 maximum', () => {
    const rnd = prng(2026);
    let checked = 0;
    let maxShare = 0;
    for (let k = 0; k < 30; k++) {
      const a = randomArm(rnd);
      const res = computeArm(a);
      expect(res.valid).toBe(true);
      const n = a.joints.length;
      for (let s = 0; s < 2000; s++) {
        const p = computePose(a, randomAngles(n, rnd), res);
        for (let i = 0; i < n; i++) {
          const T = res.joints[i].TstaticModel;
          if (p.joints[i].absTau_Nm > T + 1e-9) {
            throw new Error(`arm ${k} pose ${s} J${i + 1} (${a.joints[i].motion}): |tau| ${p.joints[i].absTau_Nm} > T_static ${T}`);
          }
          if (T > 0) maxShare = Math.max(maxShare, p.joints[i].absTau_Nm / T);
          checked++;
        }
        expect(p.Mmax_Nm).toBeLessThanOrEqual(p.Mref_Nm + 1e-9);
      }
    }
    expect(checked).toBeGreaterThan(60000);
    expect(maxShare).toBeGreaterThan(0.95); // the bound is tight: random poses come close to it
  });
});

describe('invariant (c): hand-computed poses', () => {
  // J1 pitch (300 g, bar 300 mm 200 g), J2 pitch 500 g (tool 200 mm 100 g), payload 300 g
  //   q = 0:  tau1 = g (0.2*0.15 + 0.5*0.3 + 0.1*0.4 + 0.3*0.5) = 0.37 g ; tau2 = g (0.1*0.1 + 0.3*0.2) = 0.07 g
  const a = chain([['pitch', 'cycloidal', 300, 300, 200], ['pitch', 'cycloidal', 500, 200, 100]], 300);
  const res = computeArm(a);
  it('2-pitch arm at 0 deg', () => {
    const p = computePose(a, [0, 0], res);
    near(p.joints[0].tau_Nm, 0.37 * G, 1e-12);
    near(p.joints[1].tau_Nm, 0.07 * G, 1e-12);
    near(p.joints[0].tau_Nm, res.joints[0].TstaticModel, 1e-12);
    expect(p.tip_mm.map((x) => Math.round(x * 1e6) / 1e6)).toEqual([500, 0, 0]);
    // bending: root of bar 1 = tau1; midpoint of bar 1 (cut at 150 mm): rod half 0.1 kg at 75 mm, 0.5 at 150, 0.1 at 250, 0.3 at 350
    near(p.links[0].Mroot_Nm, 0.37 * G, 1e-12);
    near(p.links[0].Mmid_Nm, G * (0.1 * 0.075 + 0.5 * 0.15 + 0.1 * 0.25 + 0.3 * 0.35), 1e-12);
    near(p.links[1].Mroot_Nm, 0.07 * G, 1e-12);
    near(p.links[1].Mend_Nm, 0, 1e-12); // the payload sits at the cut
    near(p.Mref_Nm, 0.37 * G, 1e-12);
  });
  it('2-pitch arm at 90 deg (all up): no gravity torque, no bending; +q lifts the arm', () => {
    const p = computePose(a, [90, 0], res);
    near(p.joints[0].tau_Nm, 0, 1e-12);
    near(p.joints[1].tau_Nm, 0, 1e-12);
    near(p.tip_mm[0], 0, 1e-9);
    near(p.tip_mm[2], 500, 1e-9);
    near(p.height_mm, 500, 1e-9);
    near(p.links[0].Mroot_Nm, 0, 1e-12);
    // elbow bent 90 with the shoulder level: the forearm points up, tau1 sees bar 1 + J2 + forearm + payload at 0.3 m
    const q = computePose(a, [0, 90], res);
    near(q.joints[0].tau_Nm, G * (0.2 * 0.15 + (0.5 + 0.1 + 0.3) * 0.3), 1e-12);
    near(q.joints[1].tau_Nm, 0, 1e-12);
  });
  it('2-pitch arm at 45 deg: cos 45 of the straight-out torques; -45 too (the joint still holds up)', () => {
    const p = computePose(a, [45, 0], res);
    near(p.joints[0].tau_Nm, 0.37 * G * Math.SQRT1_2, 1e-12);
    near(p.joints[1].tau_Nm, 0.07 * G * Math.SQRT1_2, 1e-12);
    const m = computePose(a, [-45, 0], res);
    near(m.joints[0].tau_Nm, 0.37 * G * Math.SQRT1_2, 1e-12);
    // past vertical the load pulls the other way: the sign flips
    const back = computePose(a, [135, 0], res);
    near(back.joints[0].tau_Nm, -0.37 * G * Math.SQRT1_2, 1e-12);
  });
  it('the default 5-joint arm in its ready pose (J2 +90, J3 -90)', () => {
    // J2 at the origin, J3 at (0, 0, 230), J4 (200, 0, 230), J5 (280, 0, 230), tip (390, 0, 230).
    // tau_J2 = tau_J3 = g (0.09*0.1 + 0.18*0.2 + 0.04*0.24 + 0.12*0.28 + 0.07*0.335 + 0.25*0.39) = 0.20915 g
    // tau_J5 = g (0.07*0.055 + 0.25*0.11) = 0.03135 g ; J4 roll: everything outboard is on its axis
    const d = defaultArmInputs();
    const p = computePose(d, posePreset(d.joints, 'ready'));
    near(p.joints[0].tau_Nm, 0, 0);
    near(p.joints[1].tau_Nm, 0.20915 * G, 1e-12);
    near(p.joints[2].tau_Nm, 0.20915 * G, 1e-12);
    near(p.joints[3].tau_Nm, 0, 1e-12);
    near(p.joints[4].tau_Nm, 0.03135 * G, 1e-12);
    const tip = p.tip_mm;
    near(tip[0], 390, 1e-9); near(tip[1], 0, 1e-9); near(tip[2], 230, 1e-9);
    near(p.reach_mm, 390, 1e-9);
    near(p.height_mm, 230, 1e-9);
    // T_des comes from computeArm: J2 utilization = tau / T_des
    const res2 = computeArm(d);
    near(p.joints[1].util!, (0.20915 * G) / res2.joints[1].Tdes, 1e-12);
    expect(p.joints[1].status).toBe('ok');
  });
  it('roll worst case: J4 rolled 90 so the J5 axis is vertical, J5 bent 90: bar D horizontal across the roll axis', () => {
    const d = defaultArmInputs();
    const res2 = computeArm(d);
    const p = computePose(d, [0, 0, 0, 90, 90], res2);
    near(p.joints[3].absTau_Nm, res2.joints[3].TstaticModel, 1e-12);
    near(p.joints[3].absTau_Nm, G * (0.07 * 0.055 + 0.25 * 0.11), 1e-12);
    // bar D points along -y, still horizontal
    near(p.links[4].dir[1], -1, 1e-12);
    near(p.joints[4].axis[2], -1, 1e-12); // J5 axis turned vertical
    // bending J5 alone (no roll) keeps bar D in the vertical plane through the roll axis: J4 sees nothing
    const q = computePose(d, [0, 0, 0, 0, 90], res2);
    near(q.joints[3].tau_Nm, 0, 1e-12);
  });
  it('a tilted yaw (after a pitch) carries gravity once the pitch turns its axis horizontal', () => {
    // pitch (bar 200 mm 0 g), yaw 0 g (tool 100 mm 0 g), payload 1 kg. Pitch +90: the yaw axis points along -x...
    const b = chain([['pitch', 'cycloidal', 0, 200, 0], ['yaw', 'cycloidal', 0, 100, 0]], 1000);
    const r = computeArm(b);
    near(r.joints[1].TstaticModel, G * 0.1, 1e-12);
    near(computePose(b, [0, 0], r).joints[1].tau_Nm, 0, 1e-12); // axis vertical at q = 0
    const p = computePose(b, [90, 0], r);
    // axis = R_y(-90 about -y) z = (-1, 0, 0) ; the tool points up (+z): lever 0. Turn the yaw 90: tool horizontal along y
    near(p.joints[1].axis[0], -1, 1e-12);
    const t = computePose(b, [90, 90], r);
    near(t.joints[1].absTau_Nm, G * 0.1, 1e-12);
  });
});

describe('invariant (d): never NaN', () => {
  const finiteAll = (o: unknown): boolean => {
    if (typeof o === 'number') return Number.isFinite(o);
    if (o === null || typeof o !== 'object') return true;
    return Object.values(o as Record<string, unknown>).every(finiteAll);
  };
  it('zero-length links, zero masses, NaN and huge angles, short or missing angle arrays', () => {
    const zero = chain([['yaw', 'cycloidal', 0, 0, 0], ['pitch', 'cycloidal', 0, 0, 0], ['roll', 'servo', 0, 0, 0]], 0);
    for (const ang of [[0, 0, 0], [NaN, Infinity, -Infinity], [1e300, -1e300, 5], [], [90]]) {
      const p = computePose(zero, ang as number[]);
      expect(finiteAll(p)).toBe(true);
      for (const l of p.links) expect(finiteAll(l.dir)).toBe(true);
    }
    const mixed = chain([['pitch', 'cycloidal', 500, 0, 100], ['pitch', 'servo', 300, 150, 0], ['roll', 'servo', 0, 0, 0]], 200);
    const p = computePose(mixed, [33, NaN, 12]);
    expect(finiteAll(p)).toBe(true);
    expect(p.joints[2].util).toBe(0); // a roll with nothing off-axis: T_des 0 and tau 0
  });
  it('an invalid arm (NaN, negative or absurd values) still gives finite numbers, with util null', () => {
    const bad = chain([['pitch', 'cycloidal', NaN, -5, 1e30], ['pitch', 'cycloidal', 1e9, 1e9, NaN]], -1);
    const p = computePose(bad, [10, 20]);
    expect(p.armValid).toBe(false);
    expect(finiteAll(p)).toBe(true);
    for (const j of p.joints) { expect(j.util).toBeNull(); expect(j.status).toBe('none'); }
    const empty = computePose({ joints: [], payload_g: 0, SF: 1.5, TdesFloor: 1 } as ArmInputs, []);
    expect(finiteAll(empty)).toBe(true);
    expect(empty.joints).toHaveLength(0);
  });
  it('8 joints, 1000 poses: under 2 ms per pose on average', () => {
    const a = chain(Array.from({ length: 8 }, (_, i): Spec => [MOTIONS[i % 3], 'cycloidal', 300, 120, 60]), 500);
    const res = computeArm(a);
    const rnd = prng(9);
    const t0 = performance.now();
    for (let s = 0; s < 1000; s++) computePose(a, randomAngles(8, rnd), res);
    expect((performance.now() - t0) / 1000).toBeLessThan(2);
  });
});

describe('joint limits (display only)', () => {
  it('validate and normalize: min < max inside -180..180; garbage or the full range is dropped', () => {
    expect(validateJointLimits(-30, 60)).toBeNull();
    expect(validateJointLimits(60, 60)).toMatch(/less than/);
    expect(validateJointLimits(70, 60)).toMatch(/less than/);
    expect(validateJointLimits(-200, 60)).toMatch(/between/);
    expect(validateJointLimits(NaN, 60)).toMatch(/not a number/);
    expect(normalizeJointLimits({ min: -30, max: 60 })).toEqual({ min: -30, max: 60 });
    expect(normalizeJointLimits({ min: 60, max: -30 })).toBeUndefined();
    expect(normalizeJointLimits({ min: -180, max: 180 })).toBeUndefined();
    expect(normalizeJointLimits('x')).toBeUndefined();
    const raw = JSON.parse(JSON.stringify(defaultArmInputs()));
    raw.joints[1].limits = { min: -10, max: 100 };
    raw.joints[2].limits = { min: 5, max: 5 };
    const n = normalizeArmInputs(raw);
    expect(n.joints[1].limits).toEqual({ min: -10, max: 100 });
    expect(n.joints[2].limits).toBeUndefined();
    expect('limits' in normalizeArmInputs(JSON.parse(JSON.stringify(defaultArmInputs()))).joints[0]).toBe(false); // old sessions: none
  });
  it('limits never change the arm model (the checks keep the worst case)', () => {
    const a = defaultArmInputs();
    const b: ArmInputs = { ...a, joints: a.joints.map((j) => ({ ...j, limits: { min: -5, max: 5 } })) };
    expect(computeArm(b)).toEqual(computeArm(a));
  });
  it('clampAngle / clampPose / presets / random stay inside the limits; full-range joints wrap', () => {
    const js = defaultArmInputs().joints.map((j) => (j.id === 'J2' ? { ...j, limits: { min: -20, max: 45 } } : j));
    expect(clampAngle(js[1], 90)).toBe(45);
    expect(clampAngle(js[1], -90)).toBe(-20);
    expect(clampAngle(js[1], NaN)).toBe(0);
    expect(clampAngle(js[0], 200)).toBe(-160);
    const r = clampPose(js, posePreset(js, 'ready'));
    expect(r.angles).toEqual([0, 45, -90, 0, 0]);
    expect(r.clamped).toEqual([1]);
    expect(clampPose(js, posePreset(js, 'straight')).clamped).toEqual([]);
    const rnd = prng(77);
    const tight = js.map((j, i) => ({ ...j, limits: { min: -3 - i, max: 2.5 + i } }));
    for (let k = 0; k < 500; k++) {
      const p = randomPose(tight, rnd);
      p.forEach((x, i) => { expect(x).toBeGreaterThanOrEqual(-3 - i); expect(x).toBeLessThanOrEqual(2.5 + i); });
      const q = randomPose(js, rnd);
      expect(q[1]).toBeGreaterThanOrEqual(0); expect(q[1]).toBeLessThanOrEqual(45); // first pitch 0..120 within -20..45
    }
  });
});
