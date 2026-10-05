// Ultra-thin 67xx eccentric bearings: catalog entries, grouping by series, and the Design Advisor picking one only when
// it passes (here because the centre bore, i.e. the ligament to the bore, is what limits the size).
import { describe, expect, it } from 'vitest';
import {
  BEARINGS, BEARING_SERIES, adviseDesign, bearingsBySeries, checkGearbox, presetInputs,
} from '../index';

describe('bearing catalog', () => {
  it('has the seven 67xx entries (bore x OD x width, C, C0) with the approximate ratings', () => {
    const want: [string, number, number, number, number, number][] = [
      ['6700', 10, 15, 4, 855, 435],
      ['6701', 12, 18, 4, 925, 530],
      ['6702', 15, 21, 4, 940, 585],
      ['6703', 17, 23, 4, 1000, 655],
      ['6704', 20, 27, 4, 1040, 730],
      ['6705', 25, 32, 4, 1100, 840],
      ['6706', 30, 37, 4, 1120, 900],
    ];
    for (const [name, bore, OD, width, C, C0] of want) {
      const b = BEARINGS.find((x) => x.name === name);
      expect(b, name).toBeDefined();
      expect([b!.bore, b!.OD, b!.width, b!.C, b!.C0, b!.series], name).toEqual([bore, OD, width, C, C0, '67']);
    }
  });

  it('keeps the original eight at their indices (saved advisor locks store an index)', () => {
    expect(BEARINGS.slice(0, 8).map((b) => b.name)).toEqual(['61800', '61801', '61802', '61803', '61804', '6000', '6001', '6002']);
    expect(BEARINGS.length).toBe(15);
  });

  it('groups by series for the pickers: ultra-thin 67xx, thin 618xx, standard 60xx, bore ascending', () => {
    expect(BEARING_SERIES.map((s) => s.label)).toEqual(['Ultra-thin 67xx (4 mm wide)', 'Thin 618xx', 'Standard 60xx']);
    const g = bearingsBySeries();
    expect(g.map((x) => x.indices.map((i) => BEARINGS[i].name))).toEqual([
      ['6700', '6701', '6702', '6703', '6704', '6705', '6706'],
      ['61800', '61801', '61802', '61803', '61804'],
      ['6000', '6001', '6002'],
    ]);
    // every catalog bearing is in exactly one group
    expect(g.flatMap((x) => x.indices).sort((a, b) => a - b)).toEqual(BEARINGS.map((_, i) => i));
    // thinner and smaller OD for the same bore, lower ratings
    const b6700 = BEARINGS.find((b) => b.name === '6700')!, b61800 = BEARINGS[0];
    expect(b6700.bore).toBe(b61800.bore);
    expect(b6700.OD).toBeLessThan(b61800.OD);
    expect(b6700.C).toBeLessThan(b61800.C);
    expect(b6700.C0).toBeLessThan(b61800.C0);
  });
});

describe('advisor with thin bearings', () => {
  it('a 67xx wins when the bore is the constraint (light load): smaller housing than with a 61800, and it passes', () => {
    const inp = { ...presetInputs('J3'), Treq: 0.33, Tdes: 0.5 };
    const free = adviseDesign(inp);
    const with61800 = adviseDesign(inp, { locks: { bearing: { kind: 'catalog', index: 0 } } });
    expect(free.best).not.toBeNull();
    expect(with61800.best).not.toBeNull();
    const b = free.best!;
    expect(b.bearingName).toMatch(/^67/);
    expect(b.inputs.Db).toBe(BEARINGS.find((x) => x.name === b.bearingName)!.OD);
    expect(b.housingOD).toBeLessThan(with61800.best!.housingOD);
    // verified at full resolution: every check <= target, the bearing checks included
    const r = checkGearbox(b.inputs);
    expect(r.maxUtilization).toBeLessThanOrEqual(0.85 + 1e-9);
    expect(r.checks.find((c) => c.id === 'bearingStatic')!.utilization).toBeLessThanOrEqual(0.85 + 1e-9);
    // with 61800 the bore ligament is what holds the size: the 6700's 4 mm smaller OD is what frees it
    const lig = with61800.best!.result.checks.find((c) => c.id === 'ligamentBore')!;
    expect(lig.utilization).toBeGreaterThan(0.6);
  });

  it('the advisor picks a 67xx only when it passes: every preset pick passes its bearing checks at full resolution', () => {
    for (const id of ['J1', 'J2', 'J3', 'J4'] as const) {
      const r = adviseDesign(presetInputs(id));
      expect(r.best, id).not.toBeNull();
      const res = checkGearbox(r.best!.inputs);
      for (const c of res.checks) expect(c.utilization, `${id} ${c.id} (${r.best!.bearingName})`).toBeLessThanOrEqual(0.85 + 1e-9);
    }
  });
});
