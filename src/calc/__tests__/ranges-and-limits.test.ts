// Input range validation (no Infinity / NaN can reach a result or a message), the arm bearing-load
// model inputs, and the contact limit being set by the weaker of disc and pin part.

import { describe, expect, it } from 'vitest';
import {
  applySolverSolution, ARM_LIMITS, checkGearbox, computeArm, contactLimits, defaultArmInputs, defaultGearboxInputs,
  GEARBOX_MAX, materialProps, normalizeArmInputs, solveMinimumSize, validateArmInputs, validateGearboxInputs,
} from '../index';
import type { ArmInputs, GearboxInputs } from '../index';

const bad = (s: string) => /Infinity|NaN|undefined|e\+\d/.test(s);

describe('arm model: range validation and overflow', () => {
  it('rejects values around 1e308 with a friendly message and no Infinity', () => {
    const a = defaultArmInputs();
    a.payload_g = 1e308;
    a.joints.forEach((j) => { j.length_mm = 1e308; j.mass_g = 1e308; });
    const r = computeArm(a);
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    for (const e of r.errors) expect(bad(e), e).toBe(false);
    expect(r.errors[0]).toMatch(/must be at most/);
    // the UI reads joints even when invalid: nothing may be Infinity
    for (const j of r.joints) for (const v of Object.values(j)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
  });

  it('enforces the documented ranges', () => {
    const L = ARM_LIMITS;
    const t = (mut: (a: ArmInputs) => void, text: RegExp) => {
      const a = defaultArmInputs();
      mut(a);
      const e = validateArmInputs(a).errors;
      expect(e.some((x) => text.test(x)), `${text} in ${JSON.stringify(e)}`).toBe(true);
      expect(computeArm(a).valid).toBe(false);
    };
    t((a) => { a.joints[2].mass_g = L.mass_g[1] + 1; }, /Joint mass 3 must be at most 1000000 g/);
    t((a) => { a.joints[0].linkMass_g = -1; }, /Bar mass 1 must be >= 0 g/);
    t((a) => { a.joints[4].length_mm = L.length_mm[1] + 1; }, /Bar length 5 must be at most 100000 mm/);
    t((a) => { a.joints[1].alpha = L.alpha[1] + 1; }, /Angular acceleration 2 must be at most 10000/);
    t((a) => { a.SF = 11; }, /Service factor must be at most 10/);
    t((a) => { a.SF = 0; }, /Service factor must be > 0/);
    t((a) => { a.payload_g = 2e6; }, /Payload must be at most 1000000 g/);
    t((a) => { a.joints[1].linkOffset_mm = -1; }, /Link offset J2 must be >= 0 mm/);
    t((a) => { a.joints[2].linkOffset_mm = 1e5; }, /Link offset J3 must be at most 10000 mm/);
    t((a) => { a.joints[2].override = { Treq: 1e9, Tdes: null }; }, /Manual T_req for J3 must be at most 1000000 N\*m/);
    t((a) => { a.TdesFloor = Number.NaN; }, /T_des floor is not a number/);
  });

  it('every output is finite when every input sits at its upper limit', () => {
    const a = defaultArmInputs();
    a.joints.forEach((j) => { j.mass_g = 1e6; j.linkMass_g = 1e6; j.length_mm = 1e5; j.alpha = 1e4; j.linkOffset_mm = 1e4; });
    a.payload_g = 1e6;
    a.SF = 10;
    const r = computeArm(a);
    expect(r.valid).toBe(true);
    for (const j of r.joints) for (const v of Object.values(j)) if (typeof v === 'number') expect(Number.isFinite(v)).toBe(true);
    expect(Number.isFinite(r.totalMass_g)).toBe(true);
  });

  it('a session exported before the link offset existed loads with the default offsets', () => {
    const d = defaultArmInputs();
    const old: Record<string, unknown> = {
      jointMass_g: d.joints.map((j) => j.mass_g), barMass_g: d.joints.map((j) => j.linkMass_g),
      barLength_mm: d.joints.map((j) => j.length_mm), payload_g: d.payload_g, alpha: d.joints.map((j) => j.alpha),
      SF: d.SF, TdesFloor: d.TdesFloor, override: d.joints.map((j) => j.override),
    };
    const offs = (a: ArmInputs) => a.joints.map((j) => j.linkOffset_mm).slice(1, 3);
    expect(offs(normalizeArmInputs(old))).toEqual([15, 15]);
    expect(offs(normalizeArmInputs({ ...old, linkOffset_mm: [20, 'x'] }))).toEqual([20, 15]);
    expect(offs(normalizeArmInputs({ ...old, linkOffset_mm: 7 }))).toEqual([15, 15]);
    const n = normalizeArmInputs(old);
    expect(computeArm(n).valid).toBe(true);
  });
});

describe('gearbox inputs: upper bounds', () => {
  const M = GEARBOX_MAX;
  const withInp = (mut: (g: GearboxInputs) => void) => {
    const g = defaultGearboxInputs();
    mut(g);
    return g;
  };
  const cases: [string, (g: GearboxInputs) => void, RegExp][] = [
    ['D', (g) => { g.D = M.D + 1; }, /D must be at most 10000 mm/],
    ['e', (g) => { g.e = M.e + 1; }, /e must be at most 1000 mm/],
    ['L', (g) => { g.L = 1e308; }, /L must be at most 1000 mm/],
    ['rr', (g) => { g.rr = 5000; }, /rr must be at most 1000 mm/],
    ['rw', (g) => { g.rw = 5000; }, /rw must be at most 1000 mm/],
    ['Db', (g) => { g.Db = 1e5; }, /Db must be at most 10000 mm/],
    ['tMin', (g) => { g.tMin = 1e4; }, /t_min must be at most 1000 mm/],
    ['gap', (g) => { g.gap = 1e4; }, /gap must be at most 1000 mm/],
    ['wall', (g) => { g.wall = 1e4; }, /wall must be at most 1000 mm/],
    ['Treq', (g) => { g.Treq = 1e308; }, /T_req must be at most 1000000 N\*m/],
    ['Tdes', (g) => { g.Tdes = 1e7; }, /T_des must be at most 1000000 N\*m/],
    ['Kc', (g) => { g.Kc = 1e6; }, /Kc must be at most 100/],
    ['rpm', (g) => { g.rpm = 1e9; }, /Input speed must be at most 1000000 rpm/],
    ['life', (g) => { g.reqLifeH = 1e12; }, /Required life must be at most 1000000000 h/],
    ['C', (g) => { g.bearing.C = 1e12; }, /Bearing C must be at most 1000000000 N/],
    ['E', (g) => { g.discMaterial.E = 1e308; }, /Disc material: E must be at most 10000000 MPa/],
    ['Sy', (g) => { g.innerPin.material.Sy = 1e9; }, /Inner pin material: yield strength must be at most 1000000 MPa/],
    ['shank', (g) => { g.outerPin.shankDia = 1e4; }, /Bolt shank diameter must be at most 1000 mm/],
    ['standoff', (g) => { g.innerPin.od = 1e4; }, /Standoff OD must be at most 1000 mm/],
    ['Rw', (g) => { g.RwOverride = 1e9; }, /Rw override must be at most 10000 mm/],
  ];
  it.each(cases)('rejects an oversized %s with a friendly message', (_n, mut, text) => {
    const v = validateGearboxInputs(withInp(mut));
    expect(v.errors.some((e) => text.test(e)), JSON.stringify(v.errors)).toBe(true);
    const r = checkGearbox(withInp(mut));
    expect(r.valid).toBe(false);
    for (const m of [...r.errors, ...r.warnings]) expect(bad(m), m).toBe(false);
  });

  it('no message or valid result contains Infinity / NaN, even with every input at an extreme', () => {
    const lows = (g: GearboxInputs) => { g.D = 1; g.e = 1e-6; g.L = 1e-6; g.rr = 1e-6; g.rw = 1e-6; g.Treq = 0; g.Tdes = 0; };
    const highs = (g: GearboxInputs) => {
      g.D = M.D; g.e = M.e; g.L = M.L; g.rr = M.rr; g.rw = M.rw; g.Db = M.Db; g.tMin = M.tMin; g.gap = M.gap;
      g.wall = M.wall; g.Treq = M.torque; g.Tdes = M.torque; g.Kc = M.K; g.KcLife = M.K; g.rpm = M.rpm; g.reqLifeH = M.hours;
    };
    const unit = (g: GearboxInputs) => { g.D = 1e4; g.e = 5; g.L = 1000; g.rr = 20; g.rw = 20; g.Db = 5000; g.Treq = 1e6; g.Tdes = 1e6; g.Kc = 100; g.KcLife = 100; };
    for (const mut of [lows, highs, unit]) {
      const r = checkGearbox(withInp(mut));
      for (const m of [...r.errors, ...r.warnings]) expect(bad(m), m).toBe(false);
      if (r.valid) {
        for (const c of r.checks) {
          expect(Number.isNaN(c.value) || Number.isNaN(c.utilization)).toBe(false);
          expect(Number.isFinite(c.utilization)).toBe(true);
        }
        for (const [k, v] of Object.entries(r.loads)) if (k !== 'L10h') expect(Number.isFinite(v), k).toBe(true);
        expect(Number.isFinite(r.mass.total_g)).toBe(true);
      }
    }
  });
});

describe('contact limits use the weaker of disc and pin part (bushing, standoff, solid pin)', () => {
  it('steel on 6061: unchanged SPEC limits, disc governs', () => {
    const g = defaultGearboxInputs();
    const l = contactLimits(g.discMaterial, g.outerPin.material);
    expect(l.strength).toBeCloseTo(1.67 * 276, 9);
    expect(l.life).toBeCloseTo((0.577 * 104) / 0.25, 9);
    expect(l.governedBy).toBe('disc');
    const r = checkGearbox(g);
    const lim = (id: string) => r.checks.find((c) => c.id === id)!.limit;
    expect(lim('ringContactStrength')).toBeCloseTo(460.92, 6);
    expect(lim('ringContactLife')).toBeCloseTo(240.032, 6);
    expect(lim('innerContactStrength')).toBeCloseTo(460.92, 6);
    expect(lim('innerContactLife')).toBeCloseTo(240.032, 6);
  });

  it('a weak bushing lowers the ring limits only, a weak standoff the inner limits only', () => {
    const g = defaultGearboxInputs();
    g.outerPin.material = materialProps('petg');   // Sy 40, sigma_f 12
    const r = checkGearbox(g);
    const lim = (id: string) => r.checks.find((c) => c.id === id)!.limit;
    expect(lim('ringContactStrength')).toBeCloseTo(1.67 * 40, 9);
    expect(lim('ringContactLife')).toBeCloseTo((0.577 * 12) / 0.25, 9);
    expect(lim('innerContactStrength')).toBeCloseTo(460.92, 6);
    const h = defaultGearboxInputs();
    h.innerPin.material = materialProps('pla');    // Sy 50, sigma_f 15
    const s = checkGearbox(h);
    const limS = (id: string) => s.checks.find((c) => c.id === id)!.limit;
    expect(limS('innerContactStrength')).toBeCloseTo(1.67 * 50, 9);
    expect(limS('innerContactLife')).toBeCloseTo((0.577 * 15) / 0.25, 9);
    expect(limS('ringContactStrength')).toBeCloseTo(460.92, 6);
  });

  it('a stronger disc is capped by the SPEC steel bushing (7075: 1.67 x 300, not 1.67 x 503)', () => {
    const g = defaultGearboxInputs();
    g.discMaterial = materialProps('al-7075');
    const r = checkGearbox(g);
    const lim = (id: string) => r.checks.find((c) => c.id === id)!.limit;
    expect(lim('ringContactStrength')).toBeCloseTo(1.67 * 300, 9);
    expect(lim('ringContactLife')).toBeCloseTo((0.577 * 160) / 0.25, 9); // sigma_f 160 < steel 190: disc governs
    expect(lim('innerContactStrength')).toBeCloseTo(1.67 * 300, 9);
  });

  it('the solver and the check use the same limits (score at the answer equals the check)', () => {
    const g: GearboxInputs = { ...defaultGearboxInputs(), Treq: 2.25, Tdes: 3.4 };
    g.discMaterial = materialProps('al-7075');
    const s = solveMinimumSize(g);
    expect(s.noSolution).toBe(false);
    const r = checkGearbox(applySolverSolution(g, s.minD!, s.bestE!));
    expect(r.contactScore).toBeCloseTo(s.bestScore!, 9);
    expect(r.contactScore).toBeLessThanOrEqual(1 + 1e-9);
  });
});
