// Round standoffs as the OUTER pins ('standoff'): no bushing, hollow bending section, the disc slides on the OD.
import { describe, expect, it } from 'vitest';
import {
  OUTER_STANDOFF_OPTIONS, PRESETS, STANDOFF_GALLING_WARNING, adviseDesign, analyzeTolerance, applyFix, checkGearbox,
  defaultGearboxInputs, defaultToleranceSpec, effectiveModulus, fitClearances, fittedClearances, materialProps, matchProcess,
  normalizeGearboxInputs, outerPinBendingLimit, outerStandoffFor, outerStandoffsOf, processSpec, ringContactMaterial, ringTolOf,
  standoffGalls, standoffMaterialProps, suggestFixes, toleranceOf, validateGearboxInputs, withStandoffPockets,
  type GearboxInputs, type StandoffMaterialId,
} from '../index';

const standoff = (g: GearboxInputs, id = 'so-m3', mat: StandoffMaterialId = 'stainless', pocketLocated = true): GearboxInputs => {
  const o = OUTER_STANDOFF_OPTIONS.find((x) => x.id === id)!;
  return { ...g, rr: o.od / 2, outerPin: { ...g.outerPin, construction: 'standoff', standoffId: id, standoffMaterial: mat, pocketLocated } };
};
const delrin = (g: GearboxInputs): GearboxInputs => ({ ...g, discMaterial: materialProps('pom') });
const ARCMIN = (180 * 60) / Math.PI;

describe('outer standoff: material and checks', () => {
  it('materials: stainless default, aluminum from the library, brass; limits min(0.4 Sy, sigma_f)', () => {
    expect(standoffMaterialProps(undefined)).toMatchObject({ E: 193000, nu: 0.29, Sy: 215, sigmaF: 240, density: 8.0 });
    expect(standoffMaterialProps('brass')).toMatchObject({ E: 97000, nu: 0.31, Sy: 310, sigmaF: 140, density: 8.5 });
    expect(standoffMaterialProps('aluminum')).toEqual(materialProps('al-6061'));
    const g = standoff(PRESETS.J2);
    expect(outerPinBendingLimit(g.outerPin)).toBeCloseTo(86, 12);
    expect(outerPinBendingLimit(standoff(PRESETS.J2, 'so-m3', 'brass').outerPin)).toBeCloseTo(124, 12);
    expect(outerPinBendingLimit(standoff(PRESETS.J2, 'so-m3', 'aluminum').outerPin)).toBe(104);
    // a missing material is stainless
    const { standoffMaterial: _m, ...op } = g.outerPin;
    expect(outerPinBendingLimit({ ...op })).toBeCloseTo(86, 12);
    expect(ringContactMaterial(g.outerPin)).toMatchObject({ E: 193000, nu: 0.29 });
  });

  it('J2, 5 mm M3 stainless standoff: hollow bending hand-computed', () => {
    const g = standoff(PRESETS.J2);
    const r = checkGearbox(g);
    expect(r.valid).toBe(true);
    expect(validateGearboxInputs(g).warnings.some((w) => /standoff/.test(w))).toBe(false);
    const b = r.checks.find((c) => c.id === 'boltBending')!;
    expect(b.label).toBe('Outer standoff bending');
    const F = r.loads.FRingPeak, span = r.derived.span;
    const Z = (Math.PI * (5 ** 4 - 2.46 ** 4)) / (32 * 5); // 11.55 mm^3
    expect(Z).toBeCloseTo(11.553, 3);
    const hand = (F * span / 4) / Z;
    expect(b.value).toBeCloseTo(hand, 9);
    expect(b.value).toBeGreaterThan(23);
    expect(b.value).toBeLessThan(25.5);
    expect(b.limit).toBeCloseTo(86, 12);
    // E* from stainless on 6061-T6; contact limits = the weaker of disc and standoff (the disc here)
    const es = 1 / ((1 - 0.29 ** 2) / 193000 + (1 - 0.33 ** 2) / 69000);
    expect(r.derived.EstarRing).toBeCloseTo(es, 6);
    const solid = checkGearbox({ ...g, outerPin: { ...g.outerPin, construction: 'solid', material: standoffMaterialProps('stainless') } });
    for (const id of ['ringContactStrength', 'ringContactLife'] as const) {
      expect(r.checks.find((c) => c.id === id)!.value).toBeCloseTo(solid.checks.find((c) => c.id === id)!.value, 9);
      expect(r.checks.find((c) => c.id === id)!.limit).toBe(solid.checks.find((c) => c.id === id)!.limit);
    }
    // a brass standoff: the weaker brass sets the contact limits on a steel disc
    const steelDisc = { ...g, discMaterial: materialProps('steel-4140') };
    const br = checkGearbox(standoff(steelDisc, 'so-m3', 'brass'));
    const brSolid = checkGearbox({ ...steelDisc, outerPin: { ...steelDisc.outerPin, construction: 'solid', material: standoffMaterialProps('brass') } });
    expect(br.checks.find((c) => c.id === 'ringContactStrength')!.limit).toBe(brSolid.checks.find((c) => c.id === 'ringContactStrength')!.limit);
    expect(br.derived.EstarRing).toBeCloseTo(effectiveModulus(standoffMaterialProps('brass'), steelDisc.discMaterial), 9);
  });

  it('two threads of one OD: the id picks the bore', () => {
    const six = checkGearbox(standoff(PRESETS.J2, 'so-in-1/4-6')).checks.find((c) => c.id === 'boltBending')!.value;
    const eight = checkGearbox(standoff(PRESETS.J2, 'so-in-1/4-8')).checks.find((c) => c.id === 'boltBending')!.value;
    expect(eight).toBeGreaterThan(six);
    expect(outerStandoffFor(6.35 / 2, 'so-in-1/4-8')!.thread).toBe('#8-32');
    // a stale id (OD changed) falls back to the first entry of the new OD
    expect(outerStandoffFor(3, 'so-in-1/4-8')!.id).toBe('so-m4');
  });

  it('a non-catalog OD warns and bends with a bore of half the OD', () => {
    const g = { ...standoff(PRESETS.J3), rr: 3.5 };
    const r = checkGearbox(g);
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => /not a catalog round standoff/.test(w))).toBe(true);
    const b = r.checks.find((c) => c.id === 'boltBending')!;
    const Z = (Math.PI * (7 ** 4 - 3.5 ** 4)) / (32 * 7);
    expect(b.value).toBeCloseTo((r.loads.FRingPeak * r.derived.span / 4) / Z, 9);
  });

  it('aluminum standoffs on an aluminum disc: the galling warning, not on Delrin or with stainless', () => {
    const al = standoff(PRESETS.J2, 'so-m3', 'aluminum');
    expect(standoffGalls(al)).toBe(true);
    expect(checkGearbox(al).warnings).toContain(STANDOFF_GALLING_WARNING);
    expect(standoffGalls(delrin(al))).toBe(false);
    expect(standoffGalls(standoff(PRESETS.J2))).toBe(false);
    expect(standoffGalls({ ...al, discMaterial: materialProps('al-7075') })).toBe(true);
    expect(checkGearbox(standoff(PRESETS.J2)).warnings).not.toContain(STANDOFF_GALLING_WARNING);
  });
});

describe('outer standoff: catalog', () => {
  it('metric and inch sizes', () => {
    expect(outerStandoffsOf('metric').map((o) => `${o.od}:${o.thread}`)).toEqual(['4.5:M2.5', '5:M3', '6:M4', '8:M5']);
    expect(outerStandoffsOf('inch').map((o) => `${o.od}:${o.thread}`)).toEqual(['4.763:#4-40', '6.35:#6-32', '6.35:#8-32', '7.938:#10-32']);
    for (const o of OUTER_STANDOFF_OPTIONS) {
      expect(o.bore).toBeGreaterThan(0);
      expect(o.bore).toBeLessThan(o.od);
      expect(o.clearanceHole).toBeGreaterThan(o.bore);
    }
  });
});

describe('outer standoff: tolerances', () => {
  it('ring kind and default spec: no bushing play, pin diameter ± 0.05, hole play 0.02 (pockets) or 0.1 (clearance holes)', () => {
    const p = standoff(PRESETS.J2), c = standoff(PRESETS.J2, 'so-m3', 'stainless', false);
    expect(ringTolOf(p)).toEqual({ integral: false, shoulder: null, standoff: { pocketLocated: true } });
    const tp = toleranceOf(p), tc = toleranceOf(c);
    expect(tp.holePlay).toBe(0.02);
    expect(tc.holePlay).toBe(0.1);
    expect(tp.pinDiaTol).toBe(0.05);
    expect(tc.pinDiaTol).toBe(0.05);
    // worst stack: 0.02 profile + 0.02 position + hole + 0.05/2 dia + 0.01 ecc (no bushing play)
    expect(fittedClearances(tp, ringTolOf(p)).profileClearance).toBeCloseTo(0.095, 12);
    expect(fittedClearances(tc, ringTolOf(c)).profileClearance).toBeCloseTo(0.175, 12);
    expect(matchProcess(tp, ringTolOf(p))).toBe('mill');
    expect(matchProcess(tc, ringTolOf(c))).toBe('mill');
    // the pin diameter tolerance stays editable: an edited value is used, and the spec becomes custom
    const edited = { ...tp, pinDiaTol: 0.02 };
    const a = analyzeTolerance({ ...p, tolerance: edited }, { trials: 40, sensitivity: false });
    expect(a.spec.pinDiaTol).toBe(0.02);
    expect(a.spec.bushingPlay).toBe(0);
    expect(matchProcess(edited, ringTolOf(p))).toBe(null);
    // bolt + bushing defaults are unchanged
    expect(defaultToleranceSpec(false)).toMatchObject({ holePlay: 0.1, pinDiaTol: 0.01, profileClearance: 0.155 });
  });

  it('equals a solid pin with no bushing play; pockets give less backlash than clearance holes', () => {
    const p = standoff(PRESETS.J2);
    const t = toleranceOf(p);
    const a = analyzeTolerance({ ...p, tolerance: t }, { trials: 60, sensitivity: false });
    const solid: GearboxInputs = { ...p, outerPin: { ...p.outerPin, construction: 'solid', material: standoffMaterialProps('stainless') } };
    const ref = analyzeTolerance({ ...solid, tolerance: { ...t, bushingPlay: 0 } }, { trials: 60, sensitivity: false });
    expect(a.backlash.worst.total).toBeCloseTo(ref.backlash.worst.total, 9);
    expect(a.backlash.design.total).toBeCloseTo(ref.backlash.design.total, 9);
    const c = withStandoffPockets({ ...p, tolerance: t }, false);
    expect(c.outerPin.pocketLocated).toBe(false);
    expect(c.tolerance!.holePlay).toBe(0.1);
    expect(c.tolerance!.profileClearance).toBeCloseTo(0.175, 12);
    const ac = analyzeTolerance(c, { trials: 60, sensitivity: false });
    expect(ac.backlash.worst.total).toBeGreaterThan(a.backlash.worst.total);
    // the sensitivity has no bushing play term
    const s = analyzeTolerance({ ...p, tolerance: t }, { trials: 60, sensitivityTrials: 10 });
    expect(s.sensitivity!.backlash.some((x) => x.term === 'bushingPlay')).toBe(false);
    // a missing spec follows the switch on its own; a custom spec keeps its clearances
    expect(withStandoffPockets(p, false).tolerance).toBeUndefined();
    const custom = withStandoffPockets({ ...p, tolerance: { ...t, profileClearance: 0.3 } }, false);
    expect(custom.tolerance).toMatchObject({ holePlay: 0.1, profileClearance: 0.3 });
  });

  it('lead ballpark: J2 Delrin disc, CNC mill, statistical 1 %: p95 backlash pockets vs clearance holes', () => {
    const run = (pocket: boolean) => {
      const g = delrin(standoff(PRESETS.J2, 'so-m3', 'stainless', pocket));
      const spec = fitClearances(g, processSpec('mill', { integral: ringTolOf(g), keep: { fitMode: 'statistical' } }));
      const a = analyzeTolerance({ ...g, tolerance: spec });
      return { p95: a.backlash.mc.p95 * ARCMIN, clr: spec.profileClearance, bend: checkGearbox(g).checks.find((c) => c.id === 'boltBending')!.value };
    };
    const p = run(true), c = run(false);
    expect(p.p95).toBeLessThan(c.p95);
    // lead's model: about 25.7' (pockets) and 38.9' (clearance holes); this engine gives 25.7' and 39.2'
    expect(p.p95).toBeGreaterThan(23);
    expect(p.p95).toBeLessThan(28.5);
    expect(c.p95).toBeGreaterThan(35);
    expect(c.p95).toBeLessThan(43);
    expect(p.bend).toBeGreaterThan(23);
    expect(p.bend).toBeLessThan(25);
  });
});

describe('outer standoff: advisor', () => {
  for (const [sys, list] of [['metric', [4.5, 5, 6, 8]], ['inch', [4.763, 6.35, 7.938]]] as const) {
    it(`J3 picks a ${sys} standoff and passes at full resolution`, () => {
      const res = adviseDesign(standoff(PRESETS.J3), { shoulderSystem: sys });
      expect(res.valid).toBe(true);
      const b = res.best!;
      expect(list).toContain(b.outerPinOD);
      const so = outerStandoffFor(b.outerPinOD / 2, b.inputs.outerPin.standoffId)!;
      expect(so.system).toBe(sys);
      expect(b.outerBolt).toBe(so.thread);
      expect(b.inputs.outerPin.construction).toBe('standoff');
      expect(b.inputs.outerPin.standoffMaterial).toBe('stainless');
      const r = checkGearbox(b.inputs);
      expect(r.maxUtilization).toBeLessThanOrEqual(0.85 + 1e-9);
      expect(r.maxUtilization).toBeCloseTo(b.maxUtilization, 9);
    });
  }

  it('a catalog lock indexes the standoff list (the thread too)', () => {
    const i = OUTER_STANDOFF_OPTIONS.findIndex((o) => o.id === 'so-in-1/4-8');
    const res = adviseDesign(standoff(PRESETS.J3), { locks: { outerPin: { kind: 'catalog', index: i } } });
    expect(res.best!.outerPinOD).toBe(6.35);
    expect(res.best!.outerBolt).toBe('#8-32');
    expect(res.best!.inputs.outerPin.standoffId).toBe('so-in-1/4-8');
    expect(adviseDesign(standoff(PRESETS.J3), { locks: { outerPin: { kind: 'catalog', index: OUTER_STANDOFF_OPTIONS.length } } }).valid).toBe(false);
  });
});

describe('outer standoff: fixes', () => {
  const slender = (pocketLocated = true) => delrin(standoff({
    ...PRESETS.J2, L: 12.7, Treq: PRESETS.J2.Treq * 1.5, Tdes: PRESETS.J2.Tdes * 1.5,
  }, 'so-m2.5', 'stainless', pocketLocated));

  it('bending governs: the next larger standoff and a stronger material', () => {
    // J2 at 1.5x torque, two 12.7 mm Delrin discs (long span), 4.5 mm M2.5 stainless standoffs: bending governs (about 1.09)
    const g = slender();
    const r0 = checkGearbox(g);
    expect(r0.governing!.id).toBe('boltBending');
    const rep = suggestFixes(g);
    expect(rep.valid).toBe(true);
    const size = rep.fixes.find((x) => x.field === 'rr')!;
    expect(size.label).toBe('Outer standoff size');
    expect([5, 6, 8]).toContain(size.toValue);
    const after = applyFix(g, size);
    expect(after.outerPin.construction).toBe('standoff');
    expect(after.outerPin.standoffId).toBe(outerStandoffFor(size.toValue! / 2)!.id);
    expect(checkGearbox(after).maxUtilization).toBeCloseTo(size.newMaxUtil, 12);
    // stainless 86 MPa -> aluminum 104 (util about 0.90, above the target) -> brass 124 (about 0.76)
    const mat = rep.fixes.find((x) => x.field === 'outerPin.standoffMaterial')!;
    expect(mat).toBeDefined();
    expect(applyFix(g, mat).outerPin.standoffMaterial).toBe('brass');
    expect(mat.passesTarget).toBe(true);
    // on an aluminum disc, aluminum standoffs are never offered (galling)
    const alDisc = { ...g, discMaterial: materialProps('al-6061') };
    const alRep = suggestFixes(alDisc);
    expect(alRep.fixes.filter((x) => x.field === 'outerPin.standoffMaterial').every((x) => applyFix(alDisc, x).outerPin.standoffMaterial !== 'aluminum')).toBe(true);
    expect(rep.fixes.some((x) => x.field === 'outerPin.material' || x.field === 'outerPin.boltYield')).toBe(false);
  });

  it('locate in pockets, offered with the tolerance Kc', () => {
    const base = slender(false);
    const g: GearboxInputs = { ...base, tolerance: toleranceOf(base), useToleranceKc: true };
    const a = analyzeTolerance(g, { trials: 100, sensitivity: false });
    const rep = suggestFixes(g, { toleranceKc: { Kc: a.kc.strength.p95, KcLife: a.kc.life.p95 }, processTrials: 60 });
    expect(rep.valid).toBe(true);
    const f = rep.fixes.find((x) => x.label === 'Standoff location');
    expect(f).toBeDefined();
    const after = applyFix(g, f!);
    expect(after.outerPin.pocketLocated).toBe(true);
    expect(toleranceOf(after).holePlay).toBe(0.02);
    // no reamed-hole fix for standoffs
    expect(rep.fixes.some((x) => x.label === 'Outer pin holes')).toBe(false);
  });
});

describe('outer standoff: sessions', () => {
  it('old sessions load unchanged; a standoff session round-trips; garbage fields are dropped', () => {
    const old = JSON.parse(JSON.stringify(defaultGearboxInputs()));
    expect(normalizeGearboxInputs(old)).toEqual(defaultGearboxInputs());
    expect('standoffMaterial' in normalizeGearboxInputs(old).outerPin).toBe(false);
    const s = normalizeGearboxInputs(JSON.parse(JSON.stringify(standoff(PRESETS.J2, 'so-in-1/4-8', 'brass', false))));
    expect(s.outerPin).toMatchObject({ construction: 'standoff', standoffId: 'so-in-1/4-8', standoffMaterial: 'brass', pocketLocated: false });
    expect(checkGearbox(s).maxUtilization).toBeCloseTo(checkGearbox(standoff(PRESETS.J2, 'so-in-1/4-8', 'brass', false)).maxUtilization, 12);
    const bad = normalizeGearboxInputs({ ...old, outerPin: { ...old.outerPin, construction: 'standoff', standoffId: 'nope', standoffMaterial: 'gold', pocketLocated: 'yes' } });
    expect(bad.outerPin.standoffId).toBeUndefined();
    expect(bad.outerPin.standoffMaterial).toBeUndefined();
    expect(bad.outerPin.pocketLocated).toBeUndefined();
    expect(validateGearboxInputs(bad).errors).toEqual([]);
    // an invalid material id that reaches the engine directly is an input error
    expect(validateGearboxInputs({ ...standoff(PRESETS.J2), outerPin: { ...standoff(PRESETS.J2).outerPin, standoffMaterial: 'gold' as never } }).errors
      .some((e) => /Standoff material/.test(e))).toBe(true);
  });
});
