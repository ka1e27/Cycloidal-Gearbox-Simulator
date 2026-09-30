import { describe, expect, it } from 'vitest';
import { computeArm, defaultArmInputs, normalizeArmInputs } from '../index';

describe('normalizeArmInputs', () => {
  it('returns the defaults for garbage', () => {
    for (const bad of [null, undefined, 5, 'x', [], {}]) {
      expect(normalizeArmInputs(bad)).toEqual(defaultArmInputs());
    }
  });

  it('keeps valid numbers, replaces bad ones, survives a JSON round trip', () => {
    const a = defaultArmInputs();
    a.payload_g = 500;
    a.alpha[2] = 7;
    a.override[1] = { Treq: 6, Tdes: null };
    const back = normalizeArmInputs(JSON.parse(JSON.stringify(a)));
    expect(back).toEqual(a);
    const messy = normalizeArmInputs({
      jointMass_g: [1, 'x', null, 4], SF: 'abc', payload_g: 12, override: [{ Treq: 'z', Tdes: 2 }, 7],
    });
    expect(messy.jointMass_g).toEqual([1, 700, 577, 4, 120]);
    expect(messy.SF).toBe(1.5);
    expect(messy.payload_g).toBe(12);
    expect(messy.override[0]).toEqual({ Treq: null, Tdes: 2 });
    expect(messy.override[1]).toEqual({ Treq: null, Tdes: null });
    expect(computeArm(messy).valid).toBe(true);
  });
});
