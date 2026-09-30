import { describe, expect, it } from 'vitest';
import { checkGearbox, defaultGearboxInputs, effectiveModulus, SPEC_STEEL, materialProps } from '../index';
import type { GearboxInputs } from '../index';

/** |got - expected| <= 2% of expected (SPEC.md validation tolerance). */
function within2(got: number, expected: number, label: string) {
  const tol = Math.abs(expected) * 0.02;
  expect(Math.abs(got - expected), `${label}: got ${got}, expected ${expected} +/-2%`).toBeLessThanOrEqual(tol);
}

describe('SPEC.md unit case (D = 85, e = 1.3, defaults)', () => {
  const r = checkGearbox(defaultGearboxInputs());

  it('is valid', () => {
    expect(r.valid).toBe(true);
    expect(r.errors).toEqual([]);
  });
  it('E* for steel on 6061 is 57,259 MPa', () => {
    within2(r.derived.EstarRing, 57259, 'E*');
    expect(Math.abs(r.derived.EstarRing - 57259)).toBeLessThan(1);
  });
  it('p0_ring_unit = 118.56', () => within2(r.unit.p0Ring, 118.56, 'p0_ring_unit'));
  it('F_ring_unit = 10.04 N', () => within2(r.unit.FRing, 10.04, 'F_ring_unit'));
  it('p0_in_unit = 89.21', () => within2(r.unit.p0Inner, 89.21, 'p0_in_unit'));
  it('F_in_unit = 20.26 N', () => within2(r.unit.FInner, 20.26, 'F_in_unit'));
  it('min convex rho_a = 6.678 mm', () => within2(r.unit.rhoMinConvex, 6.678, 'rho_a'));
  it('Fb_unit ~ 54.0 N', () => within2(r.unit.Fb, 54.0, 'Fb_unit'));
  it('no cusp', () => expect(r.cusp).toBe(false));
});

interface Case {
  name: string;
  D: number; e: number; discs: number; Treq: number; Tdes: number;
  ringS: number; ringL: number; inS: number; inL: number;
  Fring: number; Finner: number;
  boltLo: number; boltHi: number;
  soTie: number; soCant: number;
  bearPeak: number; L10h: number | null; Rw: number;
}

const CASES: Case[] = [
  { name: 'J2 85, e1.3, 1 disc', D: 85, e: 1.3, discs: 1, Treq: 5.85, Tdes: 8.8,
    ringS: 497, ringL: 327, inS: 374, inL: 246, Fring: 177, Finner: 357, boltLo: 61, boltHi: 122,
    soTie: 57, soCant: 113, bearPeak: 475, L10h: 4632, Rw: 32.9 },
  { name: 'J2 85, e1.6, 2 discs', D: 85, e: 1.6, discs: 2, Treq: 5.85, Tdes: 8.8,
    ringS: 347, ringL: 228, inS: 299, inL: 197, Fring: 79, Finner: 200, boltLo: 53, boltHi: 106,
    soTie: 91, soCant: 182, bearPeak: 229, L10h: 41245, Rw: 32.3 },
  { name: 'J3 70, e1.07, 1 disc', D: 70, e: 1.07, discs: 1, Treq: 2.25, Tdes: 3.4,
    ringS: 352, ringL: 231, inS: 246, inL: 161, Fring: 83, Finner: 175, boltLo: 29, boltHi: 57,
    soTie: 28, soCant: 56, bearPeak: 227, L10h: 42797, Rw: 25.9 },
  { name: 'J1 60, e0.92, 1 disc', D: 60, e: 0.92, discs: 1, Treq: 1.3, Tdes: 2.0,
    ringS: 302, ringL: 196, inS: 197, inL: 128, Fring: 57, Finner: 126, boltLo: 20, boltHi: 39,
    soTie: 20, soCant: 40, bearPeak: 159, L10h: 131975, Rw: 21.2 },
  { name: 'J4 60, e0.92, 1 disc', D: 60, e: 0.92, discs: 1, Treq: 0.3, Tdes: 1.0,
    ringS: 214, ringL: 94, inS: 140, inL: 62, Fring: 28, Finner: 63, boltLo: 10, boltHi: 20,
    soTie: 10, soCant: 20, bearPeak: 80, L10h: null, Rw: 21.2 },
];

function caseInputs(c: Case): GearboxInputs {
  return { ...defaultGearboxInputs(), D: c.D, e: c.e, discs: c.discs, Treq: c.Treq, Tdes: c.Tdes };
}

describe.each(CASES)('SPEC.md full case: $name', (c) => {
  const r = checkGearbox(caseInputs(c));
  it('ring contact strength / life', () => {
    within2(r.loads.p0RingStrength, c.ringS, 'ring strength');
    within2(r.loads.p0RingLife, c.ringL, 'ring life');
  });
  it('inner contact strength / life', () => {
    within2(r.loads.p0InnerStrength, c.inS, 'inner strength');
    within2(r.loads.p0InnerLife, c.inL, 'inner life');
  });
  it('peak ring / inner pin force', () => {
    within2(r.loads.FRingPeak, c.Fring, 'ring force');
    within2(r.loads.FInnerPeak, c.Finner, 'inner force');
  });
  it('bolt bending range', () => {
    within2(r.loads.boltBendingFixed, c.boltLo, 'bolt fixed-fixed');
    within2(r.loads.boltBendingSimple, c.boltHi, 'bolt simply supported');
  });
  it('standoff bending (tie / cantilever)', () => {
    within2(r.loads.standoffBendingTie, c.soTie, 'standoff tie');
    within2(r.loads.standoffBendingCantilever, c.soCant, 'standoff cantilever');
  });
  it('bearing peak load and L10h', () => {
    within2(r.loads.bearingPeak, c.bearPeak, 'bearing peak');
    if (c.L10h !== null) within2(r.loads.L10h, c.L10h, 'L10h');
    else expect(r.loads.L10h).toBeGreaterThan(1e6);
  });
  it('Rw', () => within2(r.derived.Rw, c.Rw, 'Rw'));
});

describe('SPEC.md verdicts', () => {
  it('J2 85 e1.3 1 disc FAILS (ring contact life governs, strength also fails)', () => {
    const r = checkGearbox(caseInputs(CASES[0]));
    expect(r.verdict).toBe('fail');
    expect(r.governing?.id).toBe('ringContactLife');
    // life 327 MPa vs 240 MPa limit; strength 497 vs 461 also fails
    expect(r.governing!.utilization).toBeGreaterThan(1);
    expect(r.checks.find((c) => c.id === 'ringContactStrength')!.status).toBe('fail');
  });
  it('J2 2 discs e1.6: strength and life ring contact both pass the limit', () => {
    const r = checkGearbox(caseInputs(CASES[1]));
    const s = r.checks.find((c) => c.id === 'ringContactStrength')!;
    const l = r.checks.find((c) => c.id === 'ringContactLife')!;
    expect(s.utilization).toBeLessThan(1);
    expect(l.utilization).toBeLessThan(1);
  });
  it('every check has value, limit, finite utilization and a status', () => {
    const r = checkGearbox(caseInputs(CASES[2]));
    expect(r.checks.length).toBeGreaterThanOrEqual(11);
    for (const c of r.checks) {
      expect(Number.isFinite(c.utilization)).toBe(true);
      expect(['ok', 'marginal', 'fail']).toContain(c.status);
      expect(c.limit).toBeGreaterThan(0);
    }
  });
});

describe('E* from the actual pair', () => {
  it('SPEC steel on 6061 = 57,259 MPa', () => {
    const e = effectiveModulus(SPEC_STEEL, materialProps('al-6061'));
    expect(Math.abs(e - 57259)).toBeLessThan(1);
  });
});
