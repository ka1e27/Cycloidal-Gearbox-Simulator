// Regression: the ring-contact sweep picks the lobe-profile sample of each pin with a floor(). For
// Zp = 11, 16, 21, 26 (Zp - 1 divides 25*t for some input step t) the exact value lands on an integer, and
// the engine used to round theta/Zc differently from reference/cycloidal_disc_check.py (np.linspace gives
// theta = t * (2*pi/nth); the engine computed (t/nth) * 2*pi). That picked the neighbouring curvature sample
// at those steps and moved p0_ring_unit by about 2e-4 (relative) versus the script.
// The expected numbers below were produced by the unmodified Python reference (unit_case, 6000 / 240).

import { describe, expect, it } from 'vitest';
import { checkGearbox, defaultGearboxInputs } from '../index';

describe('ring p0 matches the reference when the profile index lands on a sample boundary (Zp = 11)', () => {
  it('Zp 11, D 71.973, e 2.1688 (python p0_ring_unit 167.615777)', () => {
    const r = checkGearbox({
      ...defaultGearboxInputs(),
      Zp: 11, Zw: 4, D: 71.973, e: 2.1688, L: 4.761, rr: 3.041, rw: 1.061, Db: 10.723, tMin: 1.662,
      discs: 2, Treq: 6.599, Tdes: 9.355,
    });
    expect(r.valid).toBe(true);
    expect(Math.abs(r.unit.p0Ring / 167.615777 - 1)).toBeLessThan(1e-6);
    expect(Math.abs(r.loads.p0RingStrength / 537.691452 - 1)).toBeLessThan(1e-6);
  });

  it('Zp 11, D 109.041, e 3.0672 (python p0_ring_unit 141.878264)', () => {
    const r = checkGearbox({
      ...defaultGearboxInputs(),
      Zp: 11, Zw: 10, D: 109.041, e: 3.0672, L: 4.324, rr: 2.86, rw: 4.06, Db: 29.64, tMin: 1.826,
      discs: 2, Treq: 0.161, Tdes: 0.24, Kc: 2.052, KcLife: 1.701, rpm: 1501.8,
      bearing: { name: 'x', C: 3204.5, C0: 585 },
    });
    expect(r.valid).toBe(true);
    expect(Math.abs(r.unit.p0Ring / 141.878264 - 1)).toBeLessThan(1e-6);
    expect(Math.abs(r.loads.p0RingStrength / 73.8399697 - 1)).toBeLessThan(1e-6);
  });
});
