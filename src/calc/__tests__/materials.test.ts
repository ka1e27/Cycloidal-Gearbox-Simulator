import { describe, expect, it } from 'vitest';
import {
  MATERIALS, checkGearbox, defaultGearboxInputs, effectiveModulus, getMaterial, materialProps,
  outerPinBendingLimit, innerPinBendingLimit, SPEC_STEEL, POLYMER_WARNING_LINES, DISC_STOCK_METAL, DISC_STOCK_POLYMER,
  discStockFor, materialForm, normalizeGearboxInputs, adviseDesign, presetInputs,
} from '../index';
import type { GearboxInputs, MaterialId } from '../index';

describe('material library', () => {
  it('has the Addition 2 materials with the specified numbers, then the added plastics, ordered by family', () => {
    expect(MATERIALS.map((m) => m.id)).toEqual([
      'steel-1018', 'steel-4140', 'al-6061', 'al-7075',
      'g10',
      'hdpe', 'uhmw', 'pom', 'delrin150', 'peek', 'pa66',
      'petg', 'pla', 'abs', 'asa', 'pc', 'pa12', 'pa6cf',
      'fl-rigid10k', 'fl-tough2000', 'fl-tough1500',
    ]);
    const al = getMaterial('al-6061');
    expect([al.E, al.nu, al.Sy, al.sigmaF, al.density]).toEqual([69000, 0.33, 276, 104, 2.7]);
    const pla = getMaterial('pla');
    expect([pla.E, pla.nu, pla.Sy, pla.sigmaF, pla.density, pla.kind]).toEqual([3300, 0.36, 50, 15, 1.24, 'polymer']);
    expect(getMaterial('petg').kind).toBe('polymer');
    expect(getMaterial('steel-4140').kind).toBe('metal');
    for (const m of MATERIALS) expect(m.note.length).toBeGreaterThan(5);
  });
});

describe('E* from the actual pair', () => {
  it('steel (E 200 GPa, nu 0.30) on 6061-T6 = 57,259 MPa', () => {
    expect(effectiveModulus(SPEC_STEEL, materialProps('al-6061'))).toBeCloseTo(57259, 0);
  });
  it('library 1018 steel on 6061 is within 0.3% of that', () => {
    const e = effectiveModulus(materialProps('steel-1018'), materialProps('al-6061'));
    expect(Math.abs(e - 57259) / 57259).toBeLessThan(0.003);
  });
  it('steel on PLA: hand computed', () => {
    const want = 1 / ((1 - 0.3 ** 2) / 200000 + (1 - 0.36 ** 2) / 3300);
    const e = effectiveModulus(SPEC_STEEL, materialProps('pla'));
    expect(e).toBeCloseTo(want, 6);
    expect(e).toBeGreaterThan(3600);
    expect(e).toBeLessThan(3800);
  });
  it('is used by the gearbox check: a PLA disc follows sqrt(E*) and the PLA limits', () => {
    const al = checkGearbox(defaultGearboxInputs());
    const pla: GearboxInputs = { ...defaultGearboxInputs(), discMaterial: materialProps('pla') };
    const r = checkGearbox(pla);
    expect(r.valid).toBe(true);
    const eStar = effectiveModulus(SPEC_STEEL, materialProps('pla'));
    expect(r.derived.EstarRing).toBeCloseTo(eStar, 6);
    // unit p0 scales with sqrt(E*)
    expect(r.unit.p0Ring / al.unit.p0Ring).toBeCloseTo(Math.sqrt(eStar / al.derived.EstarRing), 6);
    // limits come from PLA: 1.67*50 and 0.577*15/0.25
    const s = r.checks.find((c) => c.id === 'ringContactStrength')!;
    const l = r.checks.find((c) => c.id === 'ringContactLife')!;
    expect(s.limit).toBeCloseTo(83.5, 6);
    expect(l.limit).toBeCloseTo((0.577 * 15) / 0.25, 6);
    expect(r.polymerWarning).toBe(true);
    expect(al.polymerWarning).toBe(false);
  });
});

describe('pin construction and bending limits', () => {
  it('SPEC steel bolt / standoff limits: 0.4 x 640 and 0.5 x 300', () => {
    const d = defaultGearboxInputs();
    expect(outerPinBendingLimit(d.outerPin)).toBeCloseTo(256, 9);
    expect(innerPinBendingLimit(d.innerPin)).toBeCloseTo(150, 9);
  });

  it('solid outer pin: d = 2 rr, limit min(0.4 Sy, sigma_f) of the pin material', () => {
    const inp: GearboxInputs = {
      ...defaultGearboxInputs(),
      outerPin: { construction: 'solid', shankDia: 3, boltYield: 640, material: materialProps('steel-4140') },
    };
    const r = checkGearbox(inp);
    const bolt = r.checks.find((c) => c.id === 'boltBending')!;
    // 4140: min(0.4*655 = 262, 380) = 262
    expect(bolt.limit).toBeCloseTo(262, 9);
    // stress from d = 2*rr = 5 mm solid: Z = pi d^3 / 32
    const Z = (Math.PI * 5 ** 3) / 32;
    const span = 6.35 + 2 * 0.5;
    expect(r.loads.boltBendingSimple).toBeCloseTo((r.loads.FRingPeak * span) / 4 / Z, 6);
    expect(r.loads.boltBendingFixed).toBeCloseTo((r.loads.FRingPeak * span) / 8 / Z, 6);
    // a solid 5 mm pin is much stiffer in bending than a 3 mm shank
    const base = checkGearbox(defaultGearboxInputs());
    expect(r.loads.boltBendingSimple).toBeLessThan(base.loads.boltBendingSimple * 0.25);
  });

  it('solid pin made of a weak polymer is limited by sigma_f', () => {
    const inp: GearboxInputs = {
      ...defaultGearboxInputs(),
      outerPin: { construction: 'solid', shankDia: 3, boltYield: 640, material: materialProps('pla') },
    };
    // PLA: min(0.4*50 = 20, 15) = 15 MPa
    expect(outerPinBendingLimit(inp.outerPin)).toBeCloseTo(15, 9);
    const r = checkGearbox(inp);
    expect(r.checks.find((c) => c.id === 'boltBending')!.limit).toBeCloseTo(15, 9);
    // contact limit also follows the weaker pin
    expect(r.checks.find((c) => c.id === 'ringContactStrength')!.limit).toBeCloseTo(1.67 * 50, 9);
    expect(r.polymerWarning).toBe(true);
  });

  it('solid inner pin: solid section d = 2 rw, limit min(0.5 Sy, sigma_f)', () => {
    const inp: GearboxInputs = {
      ...defaultGearboxInputs(),
      innerPin: { construction: 'solid', od: 5, bore: 2.46, standoffYield: 300, material: materialProps('steel-1018') },
    };
    const r = checkGearbox(inp);
    const so = r.checks.find((c) => c.id === 'standoffBending')!;
    expect(so.limit).toBeCloseTo(Math.min(0.5 * 370, 190), 9); // 185
    const Z = (Math.PI * 5 ** 3) / 32;
    const arm = 0.5 + 6.35 / 2;
    expect(r.loads.standoffBendingCantilever).toBeCloseTo((r.loads.FInnerPeak * arm) / Z, 6);
    expect(r.loads.standoffBendingTie).toBeCloseTo((r.loads.FInnerPeak * arm) / Z / 2, 6);
  });
});

describe('disc mass estimate', () => {
  it('equals (profile area - bore - holes) x L x density', () => {
    const r = checkGearbox(defaultGearboxInputs());
    const m = r.mass;
    const holes = 6 * Math.PI * (r.derived.dh / 2) ** 2;
    const bore = Math.PI * 9.5 ** 2;
    expect(m.netAreaMm2 + holes + bore).toBeGreaterThan(Math.PI * 35 ** 2); // profile ~ 40 mm radius
    expect(m.perDisc_g).toBeCloseTo((m.netAreaMm2 * 6.35 * 2.7) / 1000, 9);
    expect(m.perDisc_g).toBeGreaterThan(40);
    expect(m.perDisc_g).toBeLessThan(80);
    const two = checkGearbox({ ...defaultGearboxInputs(), discs: 2 });
    expect(two.mass.total_g).toBeCloseTo(2 * m.perDisc_g, 9);
    const pla = checkGearbox({ ...defaultGearboxInputs(), discMaterial: materialProps('pla') });
    expect(pla.mass.perDisc_g / m.perDisc_g).toBeCloseTo(1.24 / 2.7, 9);
  });
});

describe('added plastics (machined and 3D printed)', () => {
  const table: [string, number, number, number, number, number, 'plate' | 'printed'][] = [
    // id, E, nu, Sy, sigmaF, density, form
    ['hdpe', 1000, 0.46, 25, 8, 0.95, 'plate'],
    ['uhmw', 700, 0.46, 20, 7, 0.93, 'plate'],
    ['pom', 2900, 0.35, 65, 30, 1.41, 'plate'],
    ['delrin150', 3100, 0.35, 72, 32, 1.42, 'plate'],
    ['peek', 3800, 0.4, 100, 40, 1.31, 'plate'],
    ['pa66', 2000, 0.39, 55, 20, 1.14, 'plate'],
    ['abs', 2000, 0.35, 35, 10, 1.04, 'printed'],
    ['asa', 2000, 0.35, 38, 11, 1.07, 'printed'],
    ['pc', 2300, 0.37, 55, 15, 1.20, 'printed'],
    ['pa12', 1700, 0.40, 45, 14, 1.01, 'printed'],
    ['pa6cf', 6000, 0.35, 70, 20, 1.15, 'printed'],
    ['fl-rigid10k', 10000, 0.32, 50, 15, 1.6, 'printed'],
    ['fl-tough2000', 1800, 0.38, 32, 10, 1.2, 'printed'],
    ['fl-tough1500', 1460, 0.4, 27, 8, 1.2, 'printed'],
  ];
  it('property table: numbers, kind polymer, stock form, family, machined / printed in the name, a note', () => {
    for (const [id, E, nu, Sy, sf, rho, form] of table) {
      const m = getMaterial(id as MaterialId);
      expect([m.E, m.nu, m.Sy, m.sigmaF, m.density], id).toEqual([E, nu, Sy, sf, rho]);
      expect(m.kind, id).toBe('polymer');
      expect(m.form, id).toBe(form);
      expect(m.family, id).toBe(form === 'plate' ? 'machined' : 'printed');
      expect(m.name, id).toMatch(form === 'plate' ? /machined/ : /3D printed/);
      expect(m.note.length, id).toBeGreaterThan(5);
      expect(materialProps(id as MaterialId).form, id).toBe(form);
    }
    // metals are plate, the original printed ones printed
    for (const m of MATERIALS) if (m.kind === 'metal') expect([m.family, m.form]).toEqual(['metal', 'plate']);
    expect(getMaterial('petg').form).toBe('printed');
    expect(getMaterial('pla').form).toBe('printed');
    // families are contiguous, in the order metals, composites, machined, printed
    const order = ['metal', 'composite', 'machined', 'printed'];
    const fams = MATERIALS.map((m) => order.indexOf(m.family));
    expect(fams.every((f) => f >= 0)).toBe(true);
    expect(fams).toEqual([...fams].sort((a, b) => a - b));
  });

  it('G10 / FR4: in-plane laminate values, plate stock, own family, warning line', () => {
    const m = getMaterial('g10');
    expect([m.E, m.nu, m.Sy, m.sigmaF, m.density]).toEqual([18600, 0.12, 240, 60, 1.85]);
    expect([m.kind, m.family, m.form]).toEqual(['polymer', 'composite', 'plate']);
    expect(discStockFor(materialProps('g10'))).toEqual([3.175, 4.76, 6.35, 9.525, 12.7]);
    expect(POLYMER_WARNING_LINES.some((l) => /G10/.test(l))).toBe(true);
    // contact limits follow the usual formulas: 1.67 x Sy and 0.577 x sigmaF / 0.25
    const r = checkGearbox({ ...defaultGearboxInputs(), discMaterial: materialProps('g10') });
    const ring = r.checks.find((c) => c.id === 'ringContactLife')!;
    expect(ring.limit).toBeCloseTo((0.577 * 60) / 0.25, 6);
    expect(r.polymerWarning).toBe(true);
  });

  it('E* for steel on POM: hand computed 3,256 MPa, used by the check', () => {
    const want = 1 / ((1 - 0.3 ** 2) / 200000 + (1 - 0.35 ** 2) / 2900);
    const e = effectiveModulus(SPEC_STEEL, materialProps('pom'));
    expect(e).toBeCloseTo(want, 6);
    expect(e).toBeCloseTo(3255.8, 0);
    const r = checkGearbox({ ...defaultGearboxInputs(), discMaterial: materialProps('pom') });
    expect(r.derived.EstarRing).toBeCloseTo(want, 6);
  });

  it('every added plastic disc (or pin) shows the polymer warning and uses its own limits', () => {
    for (const [id, , , Sy, sf] of table) {
      const r = checkGearbox({ ...defaultGearboxInputs(), discMaterial: materialProps(id as MaterialId) });
      expect(r.valid, id).toBe(true);
      expect(r.polymerWarning, id).toBe(true);
      const s = r.checks.find((c) => c.id === 'ringContactStrength')!;
      const l = r.checks.find((c) => c.id === 'ringContactLife')!;
      expect(s.limit, id).toBeCloseTo(1.67 * Sy, 9);
      expect(l.limit, id).toBeCloseTo((0.577 * sf) / 0.25, 9);
    }
    const d = defaultGearboxInputs();
    const pin = checkGearbox({ ...d, outerPin: { ...d.outerPin, construction: 'solid', material: materialProps('hdpe') } });
    expect(pin.polymerWarning).toBe(true);
    expect(POLYMER_WARNING_LINES.some((l) => /creep/i.test(l))).toBe(true);
  });

  it('stock lists by form: plate (metals, machined plastics) and printed', () => {
    expect(discStockFor(materialProps('al-6061'))).toEqual(DISC_STOCK_METAL);
    expect(discStockFor(materialProps('pom'))).toEqual(DISC_STOCK_METAL);
    expect(discStockFor(materialProps('hdpe'))).toEqual([3.175, 4.76, 6.35, 9.525, 12.7]);
    expect(discStockFor(materialProps('pla'))).toEqual(DISC_STOCK_POLYMER);
    expect(discStockFor(materialProps('pa6cf'))).toEqual([4, 5, 6, 8, 10, 12]);
    // a material without a form (older sessions) follows its kind
    expect(materialForm({ kind: 'polymer' })).toBe('printed');
    expect(materialForm({ kind: 'metal' })).toBe('plate');
    expect(materialForm({ kind: 'polymer', form: 'plate' })).toBe('plate');
    // normalize: a saved PLA disc without a form stays printed (it does not inherit the default 6061's plate)
    const plaNoForm: Record<string, unknown> = { ...materialProps('pla') };
    delete plaNoForm.form;
    expect(normalizeGearboxInputs({ ...defaultGearboxInputs(), discMaterial: plaNoForm }).discMaterial.form).toBe('printed');
    expect(normalizeGearboxInputs({ ...defaultGearboxInputs(), discMaterial: materialProps('hdpe') }).discMaterial.form).toBe('plate');
    expect(normalizeGearboxInputs({ ...defaultGearboxInputs(), discMaterial: { ...materialProps('pom'), form: 'bogus' } }).discMaterial.form).toBe('printed');
  });

  it('the advisor searches the stock list of the disc form: machined POM gets plate sizes, printed PLA print sizes', () => {
    const base = { ...presetInputs('J3'), Treq: 0.3, Tdes: 0.5 };
    const pom = adviseDesign({ ...base, discMaterial: materialProps('pom') });
    const pla = adviseDesign({ ...base, discMaterial: materialProps('pla') });
    expect(pom.best).not.toBeNull();
    expect(pla.best).not.toBeNull();
    expect(DISC_STOCK_METAL).toContain(pom.best!.L);
    expect(DISC_STOCK_POLYMER).toContain(pla.best!.L);
  });
});
