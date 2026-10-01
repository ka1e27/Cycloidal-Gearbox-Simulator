// Design Advisor, ratio restricted by the motor (CLAUDE.md Addition 8): `zpSet` limits the searched Zp.
import { describe, expect, it } from 'vitest';
import { adviseDesign, checkGearbox, PRESETS, motorZpSet, recommendRatio } from '../index';

const J2 = PRESETS.J2;
const J3 = PRESETS.J3;

describe('advisor zpSet', () => {
  it('searches only the given Zp values, reports them, and does not count Zp as locked', () => {
    const t0 = performance.now();
    const r = adviseDesign(J3, { zpSet: [14, 15, 16, 17] });
    const ms = performance.now() - t0;
    console.log(`[advisor zpSet timing] J3 Zp 14..17: ${ms.toFixed(0)} ms, ${r.evaluated} evaluated`);
    expect(r.valid).toBe(true);
    expect(r.zpSearched).toEqual([14, 15, 16, 17]);
    expect(r.locked).not.toContain('Zp');
    expect([14, 15, 16, 17]).toContain(r.best!.Zp);
    expect(r.best!.ratio).toBe(r.best!.Zp - 1);
    const chk = checkGearbox(r.best!.inputs);
    expect(chk.maxUtilization).toBeLessThanOrEqual(0.85 + 1e-9);
    for (const a of Object.values(r.alternatives)) if (a) expect([14, 15, 16, 17]).toContain(a.Zp);
  });

  it('a one-value set equals locking that Zp', () => {
    const viaSet = adviseDesign(J3, { zpSet: [16] });
    const viaLock = adviseDesign(J3, { locks: { Zp: 16 } });
    expect(viaSet.best!.housingOD).toBe(viaLock.best!.housingOD);
    expect(viaSet.best!.D).toBe(viaLock.best!.D);
    expect(viaSet.best!.Zp).toBe(16);
    expect(viaSet.locked).not.toContain('Zp');
    expect(viaLock.locked).toContain('Zp');
  });

  it('the set is never worse than any single member (it contains them)', () => {
    const a = adviseDesign(J3, { zpSet: [12] }).best!;
    const b = adviseDesign(J3, { zpSet: [24] }).best!;
    const both = adviseDesign(J3, { zpSet: [12, 24] }).best!;
    expect(both.housingOD).toBeLessThanOrEqual(Math.min(a.housingOD, b.housingOD) + 1e-9);
  });

  it('J2 from a 0.45 N·m motor: only Zp 25 and 26 are searched; Zp is always at least 25', () => {
    const rec = recommendRatio({ Treq: J2.Treq, Tdes: J2.Tdes }, { Tpeak_Nm: 0.45, efficiency: 0.85 });
    const z = motorZpSet(rec);
    expect(z.zps).toEqual([25, 26]);
    const t0 = performance.now();
    const r = adviseDesign(J2, { zpSet: z.zps });
    console.log(`[advisor zpSet timing] J2 Zp 25..26: ${(performance.now() - t0).toFixed(0)} ms, best ${r.best ? r.best.housingOD.toFixed(1) + ' mm Zp ' + r.best.Zp : 'none'}`);
    if (r.best) expect([25, 26]).toContain(r.best.Zp);
  });

  it('the full 12..26 set (15 values) stays fast enough', () => {
    const zps = Array.from({ length: 15 }, (_, i) => 12 + i);
    const t0 = performance.now();
    const r = adviseDesign(J3, { zpSet: zps });
    const ms = performance.now() - t0;
    console.log(`[advisor zpSet timing] J3 Zp 12..26 (15 values): ${ms.toFixed(0)} ms, ${r.evaluated} evaluated`);
    expect(r.best).not.toBeNull();
    expect(ms).toBeLessThan(15000);
  });

  it('infeasible within the set: closest design, a Zp hint, and a motor warning', () => {
    const hard = { ...J2, Treq: 40, Tdes: 60 };
    const t0 = performance.now();
    const r = adviseDesign(hard, { zpSet: [25, 26] });
    console.log(`[advisor zpSet timing] hopeless load, Zp 25..26: ${(performance.now() - t0).toFixed(0)} ms, ${r.relaxHints.length} hints`);
    expect(r.best).toBeNull();
    expect(r.closest).not.toBeNull();
    expect([25, 26]).toContain(r.closest!.Zp);
    expect(r.warnings.join(' ')).toMatch(/limited to Zp 25 to 26 by the motor/);
    // releasing the ratio is offered like any other lock (if it helps)
    for (const h of r.relaxHints) expect(['Zp', 'D', 'e', 'outerPin', 'innerPin', 'Zw', 'L', 'discs', 'bearing', 'maxHousingOD']).toContain(h.key);
  });

  it('a lock on Zp wins over zpSet; junk values are dropped; an empty set is ignored', () => {
    const w = adviseDesign(J3, { zpSet: [14, 15], locks: { Zp: 20 } });
    expect(w.best!.Zp).toBe(20);
    expect(w.zpSearched).toBeNull();
    expect(w.locked).toContain('Zp');
    const junk = adviseDesign(J3, { zpSet: [14.5, NaN, 3, 500, 16, 16] as number[] });
    expect(junk.zpSearched).toEqual([16]);
    expect(junk.best!.Zp).toBe(16);
    const empty = adviseDesign(J3, { zpSet: [] });
    expect(empty.zpSearched).toBeNull();
    expect(empty.best!.Zp).toBe(J3.Zp);
    expect(empty.locked).toEqual(['Zp']);
  });

  it('without zpSet nothing changes', () => {
    const a = adviseDesign(J3);
    expect(a.zpSearched).toBeNull();
    expect(a.locked).toEqual(['Zp']);
  });
});
