// Audit: materials table vs CLAUDE.md Addition 2, E* from the real pair, and "does the advisor's pick
// actually pass checkGearbox at full resolution and never violate the target".
import { describe, expect, it } from 'vitest';
import {
  MATERIALS, SPEC_STEEL, adviseDesign, checkGearbox, computeArm, defaultArmInputs, effectiveModulus,
  JOINT_IDS, materialProps, presetInputs,
  type AdvisorDesign, type GearboxInputs, type JointId, type MaterialId,
} from '../../calc';

describe('audit: material library matches CLAUDE.md', () => {
  const want: Record<string, [number, number, number, number, number, string]> = {
    // id: E, nu, Sy, sigmaF, density, kind
    'steel-1018': [200000, 0.29, 370, 190, 7.87, 'metal'],
    'steel-4140': [205000, 0.29, 655, 380, 7.85, 'metal'],
    'al-6061': [69000, 0.33, 276, 104, 2.70, 'metal'],
    'al-7075': [71700, 0.33, 503, 160, 2.81, 'metal'],
    petg: [2000, 0.38, 40, 12, 1.27, 'polymer'],
    pla: [3300, 0.36, 50, 15, 1.24, 'polymer'],
    // more plastics (machined and 3D printed)
    hdpe: [1000, 0.46, 25, 8, 0.95, 'polymer'],
    uhmw: [700, 0.46, 20, 7, 0.93, 'polymer'],
    pom: [2900, 0.35, 65, 30, 1.41, 'polymer'],
    delrin150: [3100, 0.35, 72, 32, 1.42, 'polymer'],
    peek: [3800, 0.4, 100, 40, 1.31, 'polymer'],
    pa66: [2000, 0.39, 55, 20, 1.14, 'polymer'],
    abs: [2000, 0.35, 35, 10, 1.04, 'polymer'],
    asa: [2000, 0.35, 38, 11, 1.07, 'polymer'],
    pc: [2300, 0.37, 55, 15, 1.20, 'polymer'],
    pa12: [1700, 0.40, 45, 14, 1.01, 'polymer'],
    pa6cf: [6000, 0.35, 70, 20, 1.15, 'polymer'],
    'fl-rigid10k': [10000, 0.32, 50, 15, 1.6, 'polymer'],
    'fl-tough2000': [1800, 0.38, 32, 10, 1.2, 'polymer'],
    'fl-tough1500': [1460, 0.4, 27, 8, 1.2, 'polymer'],
    // composite laminate (in-plane values)
    g10: [18600, 0.12, 240, 60, 1.85, 'polymer'],
  };
  it('has exactly the listed materials (Addition 2 plus the added plastics) with the listed numbers', () => {
    expect(MATERIALS.map((m) => m.id).sort()).toEqual(Object.keys(want).sort());
    for (const m of MATERIALS) {
      const [E, nu, Sy, sf, rho, kind] = want[m.id];
      expect([m.E, m.nu, m.Sy, m.sigmaF, m.density, m.kind], m.id).toEqual([E, nu, Sy, sf, rho, kind]);
      expect(m.note.length).toBeGreaterThan(10);
    }
  });

  it('E* is computed from the actual disc/pin pair (and ring vs inner pair separately)', () => {
    const e = (pin: { E: number; nu: number }, disc: { E: number; nu: number }) =>
      1 / ((1 - pin.nu ** 2) / pin.E + (1 - disc.nu ** 2) / disc.E);
    const al = materialProps('al-6061');
    expect(effectiveModulus(SPEC_STEEL, al)).toBeCloseTo(57259, -1);
    const pla = materialProps('pla');
    const petg = materialProps('petg');
    const s4140 = materialProps('steel-4140');
    const base = presetInputs('J3');
    const cases: [GearboxInputs, number, number][] = [
      [{ ...base, discMaterial: pla }, e(SPEC_STEEL, pla), e(SPEC_STEEL, pla)],
      [{ ...base, discMaterial: petg, outerPin: { ...base.outerPin, construction: 'solid', material: s4140 } },
        e(s4140, petg), e(SPEC_STEEL, petg)],
      [{ ...base, innerPin: { ...base.innerPin, construction: 'solid', material: pla } },
        e(SPEC_STEEL, al), e(pla, al)],
    ];
    for (const [inp, ring, inner] of cases) {
      const r = checkGearbox(inp);
      expect(r.valid, r.errors.join()).toBe(true);
      expect(r.derived.EstarRing / ring).toBeCloseTo(1, 12);
      expect(r.derived.EstarInner / inner).toBeCloseTo(1, 12);
    }
  });
});

const arm = computeArm(defaultArmInputs());

interface Combo {
  name: string;
  disc: MaterialId;
  solidPins?: MaterialId;
  loadScale?: number;
  target?: number;
  ratioVary?: boolean;
}
const COMBOS: Combo[] = [
  { name: '6061 default', disc: 'al-6061' },
  { name: '7075', disc: 'al-7075' },
  { name: 'mild steel disc', disc: 'steel-1018' },
  { name: '4140 disc', disc: 'steel-4140' },
  { name: 'PETG x0.25 load', disc: 'petg', loadScale: 0.25 },
  { name: 'PLA x0.25 load', disc: 'pla', loadScale: 0.25 },
  { name: '6061 + solid 4140 pins', disc: 'al-6061', solidPins: 'steel-4140' },
  { name: 'PETG + solid PLA pins x0.2', disc: 'petg', solidPins: 'pla', loadScale: 0.2 },
  { name: '6061 target 0.70', disc: 'al-6061', target: 0.7 },
  { name: '6061 x1.5 load target 1.00', disc: 'al-6061', loadScale: 1.5, target: 1.0 },
];

function build(joint: JointId, c: Combo): GearboxInputs {
  const i = JOINT_IDS.indexOf(joint);
  const s = c.loadScale ?? 1;
  const base = presetInputs(joint);
  const g: GearboxInputs = {
    ...base,
    Treq: arm.joints[i].Treq * s, Tdes: arm.joints[i].Tdes * s,
    discMaterial: materialProps(c.disc),
  };
  if (c.solidPins) {
    g.outerPin = { ...g.outerPin, construction: 'solid', material: materialProps(c.solidPins) };
    g.innerPin = { ...g.innerPin, construction: 'solid', material: materialProps(c.solidPins) };
  }
  return g;
}

describe('audit: advisor designs really pass checkGearbox at full resolution', () => {
  const rows: string[] = [];
  for (const combo of COMBOS) {
    for (const joint of JOINT_IDS) {
      it(`${combo.name} / ${joint}`, () => {
        const inputs = build(joint, combo);
        const target = combo.target ?? 0.85;
        const res = adviseDesign(inputs, { target, ratioVary: combo.ratioVary });
        expect(res.valid, res.errors.join()).toBe(true);
        const designs: AdvisorDesign[] = [res.best, res.alternatives.oneDisc, res.alternatives.twoDisc,
          res.alternatives.lightest, res.alternatives.mostMargin].filter((d): d is AdvisorDesign => !!d);
        if (!res.best) {
          expect(designs.length).toBe(0);
          rows.push(`${combo.name}|${joint}|none (${res.evaluated} evaluated)`);
          return;
        }
        for (const d of designs) {
          const r = checkGearbox(d.inputs); // full SPEC resolution by default
          expect(r.valid, `${d.slot}: ${r.errors.join()}`).toBe(true);
          // every single check, not just the reported max
          for (const c of r.checks) expect(c.utilization, `${d.slot} ${c.id}`).toBeLessThanOrEqual(target + 1e-9);
          expect(r.maxUtilization).toBeLessThanOrEqual(target + 1e-9);
          expect(r.cusp).toBe(false);
          // the design must carry the caller's loads and materials, and the housing OD formula must hold
          expect(d.inputs.Treq).toBe(inputs.Treq);
          expect(d.inputs.Tdes).toBe(inputs.Tdes);
          expect(d.inputs.discMaterial).toEqual(inputs.discMaterial);
          expect(d.inputs.outerPin.material).toEqual(inputs.outerPin.material);
          expect(d.inputs.outerPin.construction).toBe(inputs.outerPin.construction);
          expect(d.housingOD).toBeCloseTo(d.D + 2 * d.inputs.rr + 2 * inputs.wall, 12);
          expect(d.result.maxUtilization).toBeCloseTo(r.maxUtilization, 9);
          // stock thickness list depends on the disc kind
          const polymer = inputs.discMaterial.kind === 'polymer';
          const okL = polymer ? [4, 5, 6, 8, 10, 12] : [3.175, 4.76, 6.35, 9.525, 12.7];
          expect(okL).toContain(d.L);
          expect(d.inputs.Zp).toBe(inputs.Zp); // ratio fixed by default
          // best has the smallest housing OD of everything reported
          expect(d.housingOD).toBeGreaterThanOrEqual(res.best.housingOD - 1e-9);
        }
        rows.push(`${combo.name}|${joint}|OD ${res.best.housingOD.toFixed(1)} D ${res.best.D} e ${res.best.e.toFixed(3)} ` +
          `${res.best.discs}d L ${res.best.L} util ${res.best.maxUtilization.toFixed(3)} ${res.best.bearingName} ` +
          `${res.elapsedMs.toFixed(0)}ms`);
      });
    }
  }
  it('prints the table', () => {
    // eslint-disable-next-line no-console
    console.log('\n' + rows.join('\n'));
  });

  it('ratioVary designs also pass at full resolution', () => {
    const inputs = build('J3', { name: 'rv', disc: 'al-6061' });
    const res = adviseDesign(inputs, { ratioVary: true });
    expect(res.best).not.toBeNull();
    for (const d of [res.best!, res.alternatives.oneDisc, res.alternatives.twoDisc].filter(Boolean) as AdvisorDesign[]) {
      const r = checkGearbox(d.inputs);
      expect(r.valid).toBe(true);
      expect(r.maxUtilization).toBeLessThanOrEqual(0.85 + 1e-9);
    }
  });
});

describe('audit: the coarse search does not hide a smaller design', () => {
  for (const [combo, joint] of [[COMBOS[0], 'J2'], [COMBOS[0], 'J3'], [COMBOS[1], 'J2'], [COMBOS[5], 'J2'], [COMBOS[8], 'J3']] as [Combo, JointId][]) {
    it(`${combo.name} / ${joint}: same best housing OD with 4x coarse resolution`, () => {
      const inputs = build(joint, combo);
      const target = combo.target ?? 0.85;
      const a = adviseDesign(inputs, { target });
      const b = adviseDesign(inputs, { target, npfCoarse: 6000, nthCoarse: 240 });
      expect(a.best).not.toBeNull();
      expect(b.best).not.toBeNull();
      expect(a.best!.housingOD).toBe(b.best!.housingOD);
    });
  }

  it('reports no design (and no stale alternatives) when the target cannot be met', () => {
    const inputs = { ...build('J2', COMBOS[0]), Treq: 400, Tdes: 600 };
    const r = adviseDesign(inputs, { target: 0.7 });
    expect(r.valid).toBe(true);
    expect(r.best).toBeNull();
    expect(r.alternatives.oneDisc ?? r.alternatives.twoDisc ?? r.alternatives.lightest ?? r.alternatives.mostMargin).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/No design/);
  });

  it('invalid inputs give an error result, not an exception', () => {
    const r = adviseDesign({ ...build('J2', COMBOS[0]), Zp: 3 });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
  });
});
