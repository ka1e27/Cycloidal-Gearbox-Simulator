import { describe, expect, it } from 'vitest';
import {
  MATERIALS, checkGearbox, defaultGearboxInputs, effectiveModulus, getMaterial, materialProps,
  outerPinBendingLimit, innerPinBendingLimit, SPEC_STEEL,
} from '../index';
import type { GearboxInputs } from '../index';

describe('material library', () => {
  it('has the six Addition 2 materials with the specified numbers', () => {
    expect(MATERIALS.map((m) => m.id)).toEqual(['steel-1018', 'steel-4140', 'al-6061', 'al-7075', 'petg', 'pla']);
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
