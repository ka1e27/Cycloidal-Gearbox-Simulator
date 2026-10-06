// Machining tolerances, backlash, load sharing and stiffness (CLAUDE.md Addition 13, src/calc/tolerance.ts).
import { afterEach, describe, expect, it } from 'vitest';
import {
  ARCMIN_PER_RAD, PRESETS, SPEC_STEEL, analyzeTolerance, armTipLevers, armTipSlop, checkGearbox, clearToleranceKc,
  defaultArmInputs, defaultToleranceSpec, deriveGeometry, feasibleTranslation, freeRotation, getToleranceKc,
  hertzLineApproach, innerFreeRotation, loadShare, materialProps, matchProcess, normalizeGearboxInputs,
  normalizeToleranceSpec, pinStiffness, processSpec, fittedClearances, REAMED_HOLE_PLAY, fitClearances, statisticalFitFor, resolveKc, setToleranceKc, suggestFixes, tighterProcesses,
  toleranceGeometryAt, toleranceKey, toleranceOf, validateToleranceSpec, withTolerance, type GearboxInputs,
  type ToleranceSpec,
} from '..';
import { createWorkerHandler } from '../workerCore';
import type { WorkerResponse } from '../messages';

const J2 = PRESETS.J2;
const J3 = PRESETS.J3;

/** Every clearance, play and tolerance zero. */
function zeroSpec(): ToleranceSpec {
  const t = defaultToleranceSpec();
  for (const k of Object.keys(t) as (keyof ToleranceSpec)[]) if (k !== 'mcTrials' && k !== 'seed' && k !== 'fitMode' && k !== 'bindTarget') (t as unknown as Record<string, number>)[k] = 0;
  return t;
}
const only = (patch: Partial<ToleranceSpec>): ToleranceSpec => ({ ...zeroSpec(), ...patch });
const FAST = { trials: 60, sensitivity: false } as const;

afterEach(() => clearToleranceKc());

describe('spec, presets and old sessions', () => {
  it('a missing spec is the CNC mill preset with fitted clearances (no CAN BIND by default)', () => {
    const t = toleranceOf(J3);
    expect(J3.tolerance).toBeUndefined();
    expect(t).toEqual(processSpec('mill'));
    expect(matchProcess(t)).toBe('mill');
    expect(t.holePlay).toBe(0.1);
    expect(t.mcTrials).toBe(400);
    // 0.02 + 0.02 + 0.1 (hole play, a position error) + 0.005 + 0.01; inner 2 x (0.02 + 0.005 + 0.01)
    expect(t.profileClearance).toBe(0.155);
    expect(t.innerHoleClearance).toBe(0.07);
    const a = analyzeTolerance(J3, FAST);
    expect(a.binding.binds).toBe(false);
    expect(a.binding.innerBinds).toBe(false);
    expect(a.bindProb).toBe(0);
    // a machined ring: 2 x 0.02 + 0.01, no hole play
    const ti = toleranceOf({ ...J3, outerPin: { ...J3.outerPin, construction: 'integral' } });
    expect(ti.profileClearance).toBe(0.05);
    expect(matchProcess(ti, true)).toBe('mill');
  });

  it('editing a clearance makes the process Custom; the reamed fit keeps the preset with re-fitted clearances', () => {
    const t = processSpec('mill');
    expect(matchProcess({ ...t, profileClearance: 0.2 })).toBeNull();
    expect(matchProcess({ ...t, profileError: 0.03 })).toBeNull();
    const r = processSpec('mill', { holePlay: REAMED_HOLE_PLAY });
    expect(r.profileClearance).toBe(0.06);
    expect(matchProcess(r)).toBe('mill');
    expect(matchProcess({ ...t, holePlay: REAMED_HOLE_PLAY })).toBeNull(); // clearances not re-fitted: custom
    expect(fittedClearances({ ...t, holePlay: REAMED_HOLE_PLAY }, false)).toEqual({ profileClearance: 0.06, innerHoleClearance: 0.07 });
  });

  it('presets carry the brief values', () => {
    expect(processSpec('waterjet')).toMatchObject({ profileError: 0.1, pinPosition: 0.1, eccError: 0.03, innerHolePosition: 0.1, profileClearance: 0.335, innerHoleClearance: 0.27 });
    expect(processSpec('edm')).toMatchObject({ profileError: 0.005, profileClearance: 0.12, innerHoleClearance: 0.03 });
    expect(processSpec('fdm')).toMatchObject({ pinPosition: 0.2, eccError: 0.05, profileClearance: 0.505, innerHoleClearance: 0.51 });
    for (const id of ['waterjet', 'laser', 'router', 'mill', 'edm', 'fdm', 'sls'] as const) {
      const t = processSpec(id);
      expect(t).toMatchObject({ pinDiaTol: 0.01, innerPinDiaTol: 0.01, bushingPlay: 0.025, holePlay: 0.1, bearingClearance: 0.01 });
      // fitted: the worst-case stack rounded up to 0.005 mm, so nothing binds
      const a = analyzeTolerance({ ...J3, tolerance: t }, { trials: 40, sensitivity: false });
      expect(a.binding.binds || a.binding.innerBinds, id).toBe(false);
      expect(a.bindProb, id).toBe(0);
      expect(t.profileClearance - a.binding.requiredProfileClearance).toBeLessThan(0.005);
    }
    // the next better process first
    expect(tighterProcesses(processSpec('waterjet')).map((p) => p.id)).toEqual(['laser', 'router', 'mill', 'edm']);
    expect(tighterProcesses(processSpec('edm'))).toEqual([]);
  });

  it('normalizes garbage and validates ranges', () => {
    const t = normalizeToleranceSpec({ profileClearance: 0.07, pinPosition: 'x', seed: 9 });
    expect(t.profileClearance).toBe(0.07);
    expect(t.pinPosition).toBe(0.02);
    expect(t.seed).toBe(9);
    expect(normalizeToleranceSpec(null)).toEqual(defaultToleranceSpec());
    expect(validateToleranceSpec({ ...t, profileError: -1, mcTrials: 3 })).toMatchObject({ profileError: expect.any(String), mcTrials: expect.any(String) });
    expect(Object.keys(validateToleranceSpec(defaultToleranceSpec()))).toHaveLength(0);
  });

  it('old sessions load: normalizeGearboxInputs keeps a spec and the switch, and leaves a missing one missing', () => {
    const old = normalizeGearboxInputs(JSON.parse(JSON.stringify(J3)));
    expect(old.tolerance).toBeUndefined();
    expect(old.useToleranceKc).toBeUndefined();
    const n = normalizeGearboxInputs({ ...J3, tolerance: { ...processSpec('laser'), holePlay: 'bad' }, useToleranceKc: true });
    expect(n.tolerance).toEqual(processSpec('laser'));
    expect(n.useToleranceKc).toBe(true);
    // the main checks are untouched by the tolerance inputs
    expect(checkGearbox(n).maxUtilization).toBe(checkGearbox(J3).maxUtilization);
  });
});

describe('free rotation (backlash)', () => {
  const Rp = J3.D / 2;
  const geo = (th: number) => toleranceGeometryAt(J3.Zp, Rp, J3.e, J3.rr, J3.Zw, th);

  it('zero gaps and no bearing clearance: no backlash', () => {
    const g = geo(0.1);
    const r = freeRotation(g.arm, g.nx, g.ny, new Float64Array(J3.Zp), 0);
    expect(r).toEqual({ plus: 0, minus: 0, interference: false });
    const a = analyzeTolerance({ ...J3, tolerance: zeroSpec() }, FAST);
    expect(a.valid).toBe(true);
    expect(a.backlash.design.total).toBe(0);
    expect(a.backlash.worst.total).toBe(0);
    expect(a.backlash.mc.p95).toBe(0);
  });

  it('uniform gap, c_b = 0: backlash = drp (1/max arm+ + 1/max |arm-|) exactly', () => {
    const drp = 0.05;
    for (const th of [0, 0.07, 0.2]) {
      const g = geo(th);
      let ap = 0, an = 0;
      for (const a of g.arm) { if (a > 0) ap = Math.max(ap, a); else an = Math.max(an, -a); }
      const r = freeRotation(g.arm, g.nx, g.ny, new Float64Array(J3.Zp).fill(drp), 0);
      expect(r.plus + r.minus).toBeCloseTo(drp * (1 / ap + 1 / an), 14);
    }
    // the analysis: max over 24 samples of one pitch
    const a = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: drp }) }, FAST);
    let want = 0;
    for (let j = 0; j < 24; j++) {
      const g = geo(((2 * Math.PI) / J3.Zp) * (j / 24));
      let ap = 0, an = 0;
      for (const x of g.arm) { if (x > 0) ap = Math.max(ap, x); else an = Math.max(an, -x); }
      want = Math.max(want, drp * (1 / ap + 1 / an));
    }
    expect(a.backlash.design.total).toBeCloseTo(want, 14);
    expect(a.backlash.design.arcmin).toBeCloseTo(want * ARCMIN_PER_RAD, 10);
    expect(a.backlash.worst.total).toBeCloseTo(want, 14);
  });

  it('bearing clearance increases the backlash', () => {
    const g = geo(0.05);
    const gaps = new Float64Array(J3.Zp).fill(0.03);
    const r0 = freeRotation(g.arm, g.nx, g.ny, gaps, 0);
    const r1 = freeRotation(g.arm, g.nx, g.ny, gaps, 0.01);
    const r2 = freeRotation(g.arm, g.nx, g.ny, gaps, 0.02);
    expect(r1.plus + r1.minus).toBeGreaterThan(r0.plus + r0.minus);
    expect(r2.plus + r2.minus).toBeGreaterThan(r1.plus + r1.minus);
    const a0 = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: 0.03 }) }, FAST);
    const a1 = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: 0.03, bearingClearance: 0.01 }) }, FAST);
    expect(a1.backlash.design.total).toBeGreaterThan(a0.backlash.design.total * 1.05);
  });

  it('matches a brute-force grid over t within 1%', () => {
    // brute force: for each t in the disc, psi+(t) = min over arm<0 of (g + n.t)/(-arm), valid if every arm>=0 gap stays >= 0
    const brute = (arm: Float64Array, nx: Float64Array, ny: Float64Array, g: ArrayLike<number>, c: number, sign: 1 | -1) => {
      let best = -Infinity;
      const N = 300;
      for (let ix = -N; ix <= N; ix++) {
        for (let iy = -N; iy <= N; iy++) {
          const tx = (c * ix) / N, ty = (c * iy) / N;
          if (tx * tx + ty * ty > c * c) continue;
          let hi = Infinity, lo = 0;
          for (let i = 0; i < g.length; i++) {
            const a = sign * arm[i], s = g[i] + nx[i] * tx + ny[i] * ty;
            if (a < -1e-12) hi = Math.min(hi, s / -a);
            else if (a > 1e-12) lo = Math.max(lo, -s / a);
            else if (s < 0) hi = -Infinity;
          }
          if (hi >= lo && hi > best) best = hi;
        }
      }
      return best;
    };
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    for (let trial = 0; trial < 6; trial++) {
      const g = geo(rnd() * 2 * Math.PI);
      const gaps = Array.from({ length: J3.Zp }, () => 0.01 + 0.06 * rnd());
      const c = 0.004 + 0.01 * rnd();
      const r = freeRotation(g.arm, g.nx, g.ny, gaps, c);
      const bp = brute(g.arm, g.nx, g.ny, gaps, c, 1), bm = brute(g.arm, g.nx, g.ny, gaps, c, -1);
      expect(Math.abs(r.plus - bp) / bp).toBeLessThan(0.01);
      expect(Math.abs(r.minus - bm) / bm).toBeLessThan(0.01);
      // the exact solver is never below the grid (the grid is a subset of the disc)
      expect(r.plus).toBeGreaterThanOrEqual(bp * (1 - 1e-6));
    }
  });

  it('a negative gap is fine if the bearing clearance lets the disc move away; else interference', () => {
    const g = geo(0.3);
    const gaps = new Float64Array(J3.Zp).fill(0.05);
    const i0 = g.arm.indexOf(Math.max(...g.arm));
    gaps[i0] = -0.005;
    expect(freeRotation(g.arm, g.nx, g.ny, gaps, 0).interference).toBe(true);
    expect(freeRotation(g.arm, g.nx, g.ny, gaps, 0.01).interference).toBe(false);
    // the exact 2D test agrees with the obvious move t = 0.01 n_i0
    const b = Array.from(gaps, (x) => -x);
    expect(feasibleTranslation(g.nx, g.ny, b, 0.01)).toBe(true);
    expect(feasibleTranslation(g.nx, g.ny, b, 0.004)).toBe(false);
  });

  it('inner holes: equal gaps give 2 (dh/2) / (Rw max |t.u|) for a symmetric pattern', () => {
    const g = geo(0);
    const Rw = deriveGeometry(J3).Rw;
    const r = innerFreeRotation(g.tu, new Float64Array(J3.Zw).fill(0.025), Rw);
    const m = Math.max(...Array.from(g.tu, Math.abs));
    expect(r.plus + r.minus).toBeCloseTo((2 * 0.025) / (Rw * m), 12);
    expect(innerFreeRotation(g.tu, new Float64Array(J3.Zw).fill(-0.001), Rw).interference).toBe(true);
    // in the analysis the inner part adds on top of the ring
    const a = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: 0.05, innerHoleClearance: 0.05 }) }, FAST);
    const b = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: 0.05 }) }, FAST);
    expect(a.backlash.design.inner).toBeGreaterThan(0);
    expect(a.backlash.design.total).toBeGreaterThan(b.backlash.design.total);
  });
});

describe('binding', () => {
  it('is predicted when the worst stack exceeds the profile clearance', () => {
    const t = { ...processSpec('mill'), profileClearance: 0.03 };
    const a = analyzeTolerance({ ...J3, tolerance: t }, FAST);
    // stack = dp + dQ + holePlay + tol/2 + de max|n.u| (max |n.u| = 1)
    const stack = a.binding.requiredProfileClearance;
    expect(stack).toBeCloseTo(0.02 + 0.02 + 0.1 + 0.005 + 0.01, 12);
    expect(a.binding.minGapWorst).toBeCloseTo(0.03 - stack, 12);
    expect(a.binding.binds).toBe(true);
    expect(a.binding.suggestedProfileClearance).toBeGreaterThanOrEqual(stack - 1e-12);
    expect(a.warnings.join(' ')).toMatch(/bind/);
    const ok = analyzeTolerance({ ...J3, tolerance: { ...t, profileClearance: a.binding.suggestedProfileClearance } }, FAST);
    expect(ok.binding.binds).toBe(false);
    expect(ok.binding.interferenceProb).toBe(0);
    // the bushing play is not counted as reliable clearance, and the hole play is a position error (it can close the gap)
    expect(analyzeTolerance({ ...J3, tolerance: { ...t, bushingPlay: 1 } }, FAST).binding.binds).toBe(true);
    expect(analyzeTolerance({ ...J3, tolerance: { ...t, profileClearance: 0.155, holePlay: 0.2 } }, FAST).binding.binds).toBe(true);
  });

  it('a sloppy process with a small clearance makes most builds bind: no statistics then', () => {
    const a = analyzeTolerance({ ...J3, tolerance: { ...processSpec('waterjet'), profileClearance: 0.05, innerHoleClearance: 0.05 } }, FAST);
    expect(a.binding.binds).toBe(true);
    expect(a.binding.interferenceProb).toBeGreaterThan(0.2);
    expect(a.bindProb).toBeGreaterThan(0.5);
    expect(a.freeBuilds).toBeLessThan(50);
    expect(a.statsShown).toBe(false);
    expect(a.backlash.mc.p95).toBeNaN();
    expect(a.kc.strength.p95).toBeNaN();
    expect(a.warnings.join(' ')).toMatch(/raise the clearance/);
  });
});

describe('ordering of the backlash statistics', () => {
  it('p50 <= p95 <= worst and design <= worst for every preset; worst bounds every build', () => {
    for (const id of ['waterjet', 'mill', 'edm', 'fdm'] as const) {
      for (const inp of [J2, J3, { ...J3, outerPin: { ...J3.outerPin, construction: 'integral' as const } }]) {
        const integral = inp.outerPin.construction === 'integral';
        const a = analyzeTolerance({ ...inp, tolerance: processSpec(id, { integral }) }, { trials: 120, sensitivity: false });
        const bl = a.backlash;
        expect(a.statsShown).toBe(true);
        expect(bl.mc.p50).toBeLessThanOrEqual(bl.mc.p95);
        expect(bl.mc.p95).toBeLessThanOrEqual(bl.worst.total + 1e-12);
        expect(bl.design.total).toBeLessThanOrEqual(bl.worst.total);
        // random errors usually take play away (the tightest pin stops the disc), so design <= p50 is not asserted
      }
    }
  });

  it('with only a bushing play (no random errors) the design is its mean and every build lies between 0 and worst', () => {
    const a = analyzeTolerance({ ...J3, tolerance: only({ bushingPlay: 0.04 }) }, { trials: 200, sensitivity: false });
    const half = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: 0.02 }) }, FAST);
    expect(a.backlash.design.total).toBeCloseTo(half.backlash.design.total, 12); // play/2 = a 0.02 mm uniform gap
    expect(a.backlash.mc.p95).toBeLessThanOrEqual(a.backlash.worst.total + 1e-12);
    // no errors at all: all four agree
    const z = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: 0.03, bearingClearance: 0.01 }) }, FAST);
    expect(z.backlash.mc.p50).toBeCloseTo(z.backlash.design.total, 12);
    expect(z.backlash.mc.p95).toBeCloseTo(z.backlash.worst.total, 12);
  });
});

describe('load sharing (Kc)', () => {
  it('zero tolerances and zero clearance: Kc = 1', () => {
    const a = analyzeTolerance({ ...J3, tolerance: zeroSpec() }, FAST);
    expect(a.kc.designStrength).toBeCloseTo(1, 12);
    expect(a.kc.strength.p95).toBeCloseTo(1, 12);
    expect(a.kc.life.p50).toBeCloseTo(1, 12);
  });

  it('uniform gap: Kc > 1 and falling as the torque rises', () => {
    const g = toleranceGeometryAt(J3.Zp, J3.D / 2, J3.e, J3.rr, J3.Zw, 0.1);
    const gaps = new Float64Array(J3.Zp).fill(0.05);
    const k = 40000;
    let prev = Infinity;
    for (const T of [500, 2000, 8000, 32000, 128000, 1e6]) {
      const r = loadShare(g.arm, gaps, k, T);
      expect(r.Kc).toBeGreaterThan(1);
      expect(r.Kc).toBeLessThan(prev);
      // torque balance
      let M = 0;
      for (let i = 0; i < J3.Zp; i++) if (g.arm[i] > 0) M += k * Math.max(0, g.arm[i] * r.psi - gaps[i]) * g.arm[i];
      expect(M).toBeCloseTo(T, 6);
      prev = r.Kc;
    }
    // with zero gaps the rigid distribution comes back at any torque
    expect(loadShare(g.arm, new Float64Array(J3.Zp), k, 777).Kc).toBeCloseTo(1, 12);
    // the analysis with a uniform profile clearance only
    const a = analyzeTolerance({ ...J3, tolerance: only({ profileClearance: 0.05 }) }, FAST);
    expect(a.kc.designStrength).toBeGreaterThan(1);
    expect(a.kc.designLife).toBeGreaterThan(a.kc.designStrength); // T_req < T_des: less torque, worse sharing
  });

  it('the Monte Carlo is deterministic for a seed', () => {
    const inp = { ...J2, tolerance: processSpec('mill') };
    const a = analyzeTolerance(inp, { trials: 80 });
    const b = analyzeTolerance(inp, { trials: 80 });
    expect(b.kc).toEqual(a.kc);
    expect(b.backlash).toEqual(a.backlash);
    expect(b.sensitivity).toEqual(a.sensitivity);
    const c = analyzeTolerance({ ...inp, tolerance: { ...inp.tolerance, seed: 2 } }, { trials: 80 });
    expect(c.kc.strength.p95).not.toBe(a.kc.strength.p95);
  });

  it('sensitivity shares add up to 1', () => {
    const a = analyzeTolerance({ ...J2, tolerance: processSpec('mill') }, { trials: 60, sensitivityTrials: 40 });
    const s = a.sensitivity!;
    expect(s.backlash.reduce((x, i) => x + i.share, 0)).toBeCloseTo(1, 12);
    expect(s.kc.reduce((x, i) => x + i.share, 0)).toBeCloseTo(1, 12);
    // with clearance holes the fitted profile clearance is the biggest backlash term; the hole play leads the Kc spread
    const top = s.backlash.slice().sort((x, y) => y.value - x.value)[0];
    expect(top.term).toBe('profileClearance');
    expect(s.kc.slice().sort((x, y) => y.value - x.value)[0].term).toBe('holePlay');
  });
});

describe('stiffness', () => {
  it('Hertz secant and bolt bending match a hand calculation', () => {
    // Steel bushing (E 200 GPa, nu 0.30) on 6061-T6 (E 69 GPa, nu 0.33), F = 100 N, L = 6.35 mm, rr = 2.5 mm, disc
    // radius 20 mm (kappa_a = 1/20). By hand:
    //   E* = 1 / (0.91/200000 + 0.8911/69000) = 57259.03 MPa;  R* = 1/(1/2.5 + 1/20) = 2.2222 mm
    //   a  = sqrt(4 * 100 * 2.2222 / (pi * 6.35 * 57259.03)) = 0.0278959 mm
    //   bracket = 0.91/200000 (ln(10/a) - 0.5) + 0.8911/69000 (ln(80/a) - 0.5) = 2.44875e-5 + 9.63589e-5
    //   delta_c = 2 * 100 / (pi * 6.35) * bracket = 0.00121155 mm  ->  k_c = 82539 N/mm
    //   M3 shank: I = pi 3^4 / 64 = 3.97608 mm^4, span 6.35 + 2 * 0.5 = 7.35 mm (one disc)
    //   k_b = 48 * 200000 * 3.97608 / 7.35^3 = 96131 N/mm;  k = 1/(1/82539 + 1/96131) = 44409 N/mm
    const h = hertzLineApproach(100, 6.35, 2.5, 200000, 0.3, 20, 69000, 0.33, 1 / 2.5 + 1 / 20);
    expect(h.a).toBeCloseTo(0.0278959, 6);
    expect(h.delta).toBeCloseTo(0.00121155, 7);
    const inp: GearboxInputs = { ...J3, discMaterial: { ...materialProps('al-6061'), E: 69000, nu: 0.33 }, outerPin: { ...J3.outerPin, material: { ...SPEC_STEEL } } };
    const s = pinStiffness(inp, 100, 1 / 20, deriveGeometry(inp).span);
    expect(s.kc).toBeCloseTo(82539.1, 0);
    expect(s.kb).toBeCloseTo(96131.1, 0);
    expect(s.k).toBeCloseTo(44409.1, 0);
  });

  it('torsional stiffness: K_t = k sum arm^2 / (1000 share), twist = T_req / K_t', () => {
    const a = analyzeTolerance({ ...J2, tolerance: processSpec('mill') }, FAST);
    const st = a.stiffness;
    expect(st.share).toBe(0.55);
    expect(st.Kt_Nm_per_rad).toBeCloseTo((st.life.k * st.sumArm2) / (1000 * 0.55), 9);
    expect(st.twistReq).toBeCloseTo(J2.Treq / st.Kt_Nm_per_rad, 12);
    expect(st.Kt_Nm_per_arcmin).toBeCloseTo(st.Kt_Nm_per_rad / ARCMIN_PER_RAD, 12);
    // the bending of the longer two-disc bolts softens the J2 pins
    expect(st.life.kb).toBeLessThan(st.life.kc);
  });
});

describe('integral ring', () => {
  const INT: GearboxInputs = { ...J3, outerPin: { ...J3.outerPin, construction: 'integral' } };
  it('uses the profile error twice, no plays, no bending', () => {
    const t = processSpec('mill');
    const a = analyzeTolerance({ ...INT, tolerance: t }, FAST);
    expect(a.valid).toBe(true);
    expect(a.integral).toBe(true);
    expect(a.stiffness.strength.kb).toBe(Infinity);
    expect(a.stiffness.strength.k).toBe(a.stiffness.strength.kc);
    // stack 2 dp + de max |n.u|
    expect(a.binding.requiredProfileClearance).toBeGreaterThan(2 * t.profileError);
    expect(a.binding.requiredProfileClearance).toBeLessThanOrEqual(2 * t.profileError + t.eccError + 1e-12);
    // plays do nothing for a machined ring
    const b = analyzeTolerance({ ...INT, tolerance: { ...t, holePlay: 0.5, bushingPlay: 0.5 } }, FAST);
    expect(b.backlash.design.total).toBe(a.backlash.design.total);
    expect(a.sensitivity === null || !a.sensitivity.backlash.some((x) => x.term === 'holePlay')).toBe(true);
    // zero tolerances: Kc 1, no backlash
    const z = analyzeTolerance({ ...INT, tolerance: zeroSpec() }, FAST);
    expect(z.backlash.design.total).toBe(0);
    expect(z.kc.strength.p95).toBeCloseTo(1, 12);
  });
});

describe('use tolerance Kc in the checks', () => {
  it('feeds Kc and Kc_life from the cache; typed until it is there', () => {
    const inp: GearboxInputs = { ...J3, useToleranceKc: true };
    const pending = checkGearbox(inp);
    expect(pending.kc.source).toBe('pending');
    expect(pending.kc.Kc).toBe(J3.Kc);
    expect(pending.maxUtilization).toBe(checkGearbox(J3).maxUtilization);
    setToleranceKc(inp, { Kc: 3.1, KcLife: 2.4 });
    expect(getToleranceKc({ ...inp, Kc: 9, KcLife: 9, useToleranceKc: false })).toEqual({ Kc: 3.1, KcLife: 2.4 });
    const used = checkGearbox(inp);
    const typed = checkGearbox({ ...J3, Kc: 3.1, KcLife: 2.4 });
    expect(used.kc).toEqual({ source: 'tolerance', Kc: 3.1, KcLife: 2.4, typedKc: J3.Kc, typedKcLife: J3.KcLife });
    expect(used.loads).toEqual(typed.loads);
    expect(used.checks.map((c) => c.utilization)).toEqual(typed.checks.map((c) => c.utilization));
    // the switch off: the typed values, whatever is cached
    expect(checkGearbox({ ...inp, useToleranceKc: false }).kc.source).toBe('typed');
    // an explicit value (sent with a worker job) wins
    expect(checkGearbox(inp, { toleranceKc: { Kc: 5, KcLife: 5 } }).kc.Kc).toBe(5);
    // the key ignores the typed factors and the switch only
    expect(toleranceKey({ ...J3, Kc: 7 })).toBe(toleranceKey(J3));
    expect(toleranceKey({ ...J3, Tdes: 7 })).not.toBe(toleranceKey(J3));
    expect(resolveKc(J3).source).toBe('typed');
  });

  it('the fix engine holds the tolerance Kc and offers a tighter process', () => {
    const inp: GearboxInputs = { ...J3, tolerance: processSpec('waterjet'), useToleranceKc: true };
    const a = analyzeTolerance(inp, { trials: 100, sensitivity: false });
    const kc = { Kc: a.kc.strength.p95, KcLife: a.kc.life.p95 };
    const rep = suggestFixes(inp, { toleranceKc: kc, processTrials: 60 });
    expect(rep.valid).toBe(true);
    expect(rep.maxUtil).toBeCloseTo(checkGearbox({ ...J3, Kc: kc.Kc, KcLife: kc.KcLife }).maxUtilization, 9);
    const f = rep.fixes.find((x) => x.field === 'tolerance');
    expect(f).toBeTruthy();
    expect(f!.short).toMatch(/Process → /);
    expect(f!.patch.tolerance).toBeTruthy();
    expect(f!.patch.Kc).toBeUndefined();
    // without the switch there is no process fix
    expect(suggestFixes({ ...inp, useToleranceKc: false }).fixes.some((x) => x.field === 'tolerance')).toBe(false);
  });
});

describe('arm tip effect', () => {
  it('levers from the worst-case pose of the default arm', () => {
    // lengths 100 (column), 230, 200, 80, 110; motions yaw, pitch, pitch, roll, pitch
    expect(armTipLevers(defaultArmInputs())).toEqual([620, 620, 390, 110, 110]);
  });
  it('tip error = (backlash + twist) x lever; sum and RSS', () => {
    const s = armTipSlop([600, 400, 100], [{ backlash: 0.001, twist: 0.0001 }, null, { backlash: 0.002, twist: 0 }]);
    expect(s.joints[0].tip).toBeCloseTo(0.66, 12);
    expect(s.joints[1].tip).toBeNull();
    expect(s.joints[2].tip).toBeCloseTo(0.2, 12);
    expect(s.sum).toBeCloseTo(0.86, 12);
    expect(s.rss).toBeCloseTo(Math.hypot(0.66, 0.2), 12);
    expect(s.counted).toBe(2);
  });
});

describe('worker', () => {
  it('runs the tolerance job and reports progress', async () => {
    const out: WorkerResponse[] = [];
    const h = createWorkerHandler({ post: (m) => out.push(m) });
    await h({ type: 'tolerance', id: 3, inputs: withTolerance(J3, processSpec('mill')), options: { trials: 40, sensitivity: false } });
    const res = out.find((m) => m.type === 'result');
    expect(res && res.type === 'result' && res.kind === 'tolerance' && res.result.valid).toBe(true);
  });
});

describe('statistical clearance fit', () => {
  const statSpec = (target = 0.01, holePlay?: number) => processSpec('mill', { holePlay, keep: { fitMode: 'statistical', bindTarget: target, mcTrials: 200 } });

  it('old specs default to the worst-case fit; the target is validated', () => {
    expect(normalizeToleranceSpec({ profileClearance: 0.1 })).toMatchObject({ fitMode: 'worst', bindTarget: 0.01 });
    expect(toleranceOf(J3).fitMode).toBe('worst');
    expect(normalizeToleranceSpec({ fitMode: 'odd' }).fitMode).toBe('worst');
    expect(validateToleranceSpec({ ...defaultToleranceSpec(), bindTarget: 0.5 }).bindTarget).toBeTruthy();
    expect(validateToleranceSpec({ ...defaultToleranceSpec(), bindTarget: 0.001 }).bindTarget).toBeUndefined();
  });

  it('is at most the worst-case fit, deterministic, and monotone in the target', () => {
    for (const inp of [J2, J3]) {
      for (const hp of [undefined, REAMED_HOLE_PLAY]) {
        const worst = processSpec('mill', { holePlay: hp });
        let prevP = Infinity, prevI = Infinity;
        for (const target of [0.001, 0.005, 0.01, 0.05, 0.2]) {
          const a = statisticalFitFor(inp, statSpec(target, hp));
          expect(a.profileClearance).toBeLessThanOrEqual(worst.profileClearance + 1e-12);
          expect(a.innerHoleClearance).toBeLessThanOrEqual(worst.innerHoleClearance + 1e-12);
          expect(a.profileClearance).toBeLessThanOrEqual(prevP + 1e-12);
          expect(a.innerHoleClearance).toBeLessThanOrEqual(prevI + 1e-12);
          prevP = a.profileClearance; prevI = a.innerHoleClearance;
        }
        const x = statisticalFitFor(inp, statSpec(0.01, hp)), y = statisticalFitFor(inp, statSpec(0.01, hp));
        expect({ ...x, elapsedMs: 0 }).toEqual({ ...y, elapsedMs: 0 });
      }
    }
    // clearance holes: statistical saves a lot (worst 0.155 mm)
    expect(statisticalFitFor(J2, statSpec()).profileClearance).toBeLessThan(0.13);
  });

  it('the Monte Carlo binding probability at the fitted value is <= target, one grid step below it is > target', () => {
    for (const target of [0.01, 0.05]) {
      const spec = fitClearances(J3, statSpec(target));
      expect(spec.fitMode).toBe('statistical');
      const at = analyzeTolerance({ ...J3, tolerance: spec }, { sensitivity: false });
      expect(at.binding.interferenceProb).toBeLessThanOrEqual(target + 1e-12);
      expect(at.binding.innerInterferenceProb).toBeLessThanOrEqual(target + 1e-12);
      expect(at.fit.statistical.profileClearance).toBe(spec.profileClearance);
      if (spec.profileClearance >= 0.005) {
        const below = analyzeTolerance({ ...J3, tolerance: { ...spec, profileClearance: spec.profileClearance - 0.005 } }, { sensitivity: false });
        expect(below.binding.interferenceProb).toBeGreaterThan(target);
      }
      if (spec.innerHoleClearance >= 0.005) {
        const below = analyzeTolerance({ ...J3, tolerance: { ...spec, innerHoleClearance: spec.innerHoleClearance - 0.005 } }, { sensitivity: false });
        expect(below.binding.innerInterferenceProb).toBeGreaterThan(target);
      }
    }
  });

  it('matchProcess respects the mode', () => {
    const s = statSpec();
    const fitted = fitClearances(J3, s);
    const f = statisticalFitFor(J3, s);
    expect(matchProcess(fitted, false, f)).toBe('mill');
    expect(matchProcess({ ...fitted, profileClearance: fitted.profileClearance + 0.01 }, false, f)).toBeNull();
    // worst mode: the statistical values are custom
    expect(matchProcess({ ...fitted, fitMode: 'worst' })).toBeNull();
  });
});
