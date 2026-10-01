// Regression proof for the configurable arm: the default five-joint arm, and any arm saved in the old fixed format,
// must give exactly the numbers the old engine gave. `legacyArm.ts` is a verbatim copy of the pre-joint-list engine.
import { describe, expect, it } from 'vitest';
import { armFromLegacy, computeArm, defaultArmInputs, normalizeArmInputs } from '../index';
import { computeArm as legacyCompute, defaultArmInputs as legacyDefault, type ArmInputs as Legacy } from './legacyArm';

const REL = 1e-12;
const near = (got: number, want: number, label: string) =>
  expect(Math.abs(got - want), `${label} got ${got} want ${want}`).toBeLessThanOrEqual(Math.max(1e-14, Math.abs(want) * REL));

const FIELDS = [
  'TstaticModel', 'TdynModel', 'TreqModel', 'inertia', 'Treq', 'Tdes', 'outboardWeight_N',
  'bearingRadial_N', 'bearingAxial_N', 'bearingTiltMoment_Nm',
] as const;

function compare(old: Legacy, label: string) {
  const want = legacyCompute(old);
  const got = computeArm(armFromLegacy(old as never));
  expect(got.valid, label).toBe(want.valid);
  if (!want.valid) {
    expect(got.errors, label).toEqual(want.errors);
    return;
  }
  expect(got.joints).toHaveLength(5);
  want.joints.forEach((w, i) => {
    for (const k of FIELDS) near(got.joints[i][k], w[k], `${label} J${i + 1} ${k}`);
    expect(got.joints[i].treqOverridden, `${label} J${i + 1}`).toBe(w.treqOverridden);
    expect(got.joints[i].tdesOverridden, `${label} J${i + 1}`).toBe(w.tdesOverridden);
  });
  near(got.totalMass_g, want.totalMass_g, `${label} mass`);
  near(got.reach_mm, want.reach_mm, `${label} reach`);
  expect(got.warnings, label).toEqual(want.warnings);
}

/** Small deterministic generator (mulberry32) so the "random" arms are the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe('default arm: frozen numbers from the old engine', () => {
  // [static, dyn, inertia, Treq, Tdes, W, radial, axial, tilt] per joint, copied from the old engine's output
  const GOLD: number[][] = [
    [0, 0.7032949000000002, 0.2344316333333334, 0.7032949000000002, 1.0549423500000001, 21.748770000000007, 0, 21.748770000000007, 5.1699681],
    [5.1699681, 0.7032949000000002, 0.2344316333333334, 5.873263000000001, 8.8098945, 14.09697, 14.09697, 0, 0.21145455],
    [2.0517615, 0.19825400000000004, 0.06608466666666668, 2.2500155, 3.37502325, 7.3575, 7.3575, 0, 0.11036249999999999],
    [0.3075435, 0.009922, 0.003307333333333333, 0.3174655, 1, 4.7088, 4.7088, 0, 0.6685515],
    [0.3075435, 0.009922, 0.003307333333333333, 0.3174655, 0.47619825000000005, 3.1392, 0, 0, 0],
  ];
  it('the new default arm reproduces them', () => {
    const r = computeArm(defaultArmInputs());
    expect(r.valid).toBe(true);
    r.joints.forEach((j, i) => {
      const g = GOLD[i];
      const got = [j.TstaticModel, j.TdynModel, j.inertia, j.Treq, j.Tdes, j.outboardWeight_N, j.bearingRadial_N, j.bearingAxial_N, j.bearingTiltMoment_Nm];
      got.forEach((x, k) => near(x, g[k], `J${i + 1} #${k}`));
    });
    near(r.totalMass_g, 2667, 'mass');
    near(r.reach_mm, 620, 'reach');
  });
  it('the converted old default equals the new default exactly', () => {
    // the old default had a 100 mm base column; the new default has 0 mm (the shoulder sits on the turntable).
    // An old session keeps its stored length, so the conversion equals the new default with 100 mm in that one field.
    const want = defaultArmInputs();
    want.joints[0].length_mm = 100;
    expect(armFromLegacy(legacyDefault() as never)).toEqual(want);
  });
  it('the old engine, run now, still gives the frozen numbers (guards the copy itself)', () => {
    const r = legacyCompute(legacyDefault());
    r.joints.forEach((j, i) => near(j.Treq, GOLD[i][3], `legacy J${i + 1}`));
  });
});

describe('old-format arms give identical results through the converter', () => {
  it('300 random arms, every output of every joint', () => {
    const rand = rng(20260930);
    const pick = (lo: number, hi: number) => lo + (hi - lo) * rand();
    for (let n = 0; n < 300; n++) {
      const arr = (lo: number, hi: number) => [0, 1, 2, 3, 4].map(() => Math.round(pick(lo, hi) * 10) / 10) as never;
      const old: Legacy = {
        jointMass_g: arr(0, 3000), barMass_g: arr(0, 900), barLength_mm: arr(0, 600), payload_g: pick(0, 3000),
        linkOffset_mm: [pick(0, 60), pick(0, 60)], alpha: arr(0, 12), SF: pick(0.8, 3), TdesFloor: pick(0, 4),
        override: [0, 1, 2, 3, 4].map(() => ({
          Treq: rand() < 0.2 ? pick(0, 20) : null, Tdes: rand() < 0.2 ? pick(0, 30) : null,
        })) as never,
      };
      compare(old, `arm #${n}`);
    }
  });
  it('edge cases: all zero, one huge length, invalid values', () => {
    const z = legacyDefault();
    z.jointMass_g = [0, 0, 0, 0, 0]; z.barMass_g = [0, 0, 0, 0, 0]; z.payload_g = 0; z.barLength_mm = [0, 0, 0, 0, 0];
    compare(z, 'zero');
    const big = legacyDefault();
    big.barLength_mm = [1e5, 1e5, 1e5, 1e5, 1e5]; big.alpha = [1e4, 1e4, 1e4, 1e4, 1e4];
    compare(big, 'large');
    const bad = legacyDefault();
    bad.payload_g = -1;
    const want = legacyCompute(bad);
    const got = computeArm(armFromLegacy(bad as never));
    expect(want.valid).toBe(false);
    expect(got.valid).toBe(false);
    expect(got.errors).toEqual(want.errors);
  });
  it('an old saved/exported arm object (JSON) loads through normalizeArmInputs with identical results', () => {
    const rand = rng(7);
    for (let n = 0; n < 40; n++) {
      const old = legacyDefault();
      old.jointMass_g = old.jointMass_g.map((x) => Math.round(x * (0.5 + rand()))) as never;
      old.barLength_mm = old.barLength_mm.map((x) => Math.round(x * (0.5 + rand()))) as never;
      old.payload_g = Math.round(rand() * 800);
      old.linkOffset_mm = [Math.round(rand() * 40), Math.round(rand() * 40)];
      old.override[1] = { Treq: rand() < 0.5 ? 6 : null, Tdes: null };
      const loaded = normalizeArmInputs(JSON.parse(JSON.stringify(old)));
      expect(loaded.joints).toHaveLength(5);
      const want = legacyCompute(old);
      const got = computeArm(loaded);
      want.joints.forEach((w, i) => FIELDS.forEach((k) => near(got.joints[i][k], w[k], `json #${n} J${i + 1} ${k}`)));
    }
  });
  it('an old export that lacks the link offset (before it existed) still loads with the default offsets', () => {
    const old = legacyDefault() as unknown as Record<string, unknown>;
    delete old.linkOffset_mm;
    const loaded = normalizeArmInputs(old);
    const want = defaultArmInputs();
    want.joints[0].length_mm = 100; // the stored value of the old session is kept
    expect(loaded).toEqual(want);
  });
});
