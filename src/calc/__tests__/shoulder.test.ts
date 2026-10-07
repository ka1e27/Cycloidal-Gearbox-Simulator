// Shoulder bolt outer pins ('shoulderBolt'): a ground shoulder screw is the pin, no bushing.
import { describe, expect, it } from 'vitest';
import {
  PRESETS, SHOULDER_BOLT_OPTIONS, SHOULDER_BOLT_STEEL, adviseDesign, analyzeTolerance, applyFix, checkGearbox, defaultGearboxInputs,
  defaultToleranceSpec, effectiveModulus, fittedClearances, materialProps, matchProcess, normalizeGearboxInputs, outerPinBendingLimit,
  processSpec, ringContactMaterial, ringTolOf, shoulderBandOf, shoulderBoltFor, suggestFixes, toleranceOf, validateGearboxInputs,
  type GearboxInputs,
} from '../index';

const shoulder = (g: GearboxInputs, dia = 6): GearboxInputs => ({ ...g, rr: dia / 2, outerPin: { ...g.outerPin, construction: 'shoulderBolt' } });

describe('shoulder bolt: material and checks', () => {
  it('fixed 12.9 steel: limit min(0.4 Sy, sigma_f) = 432 MPa, contact partner is the bolt steel whatever material is stored', () => {
    expect(SHOULDER_BOLT_STEEL).toMatchObject({ E: 205000, nu: 0.29, Sy: 1080, sigmaF: 450, kind: 'metal' });
    const g = shoulder({ ...PRESETS.J2, outerPin: { ...PRESETS.J2.outerPin, material: materialProps('pla') } });
    expect(outerPinBendingLimit(g.outerPin)).toBe(432);
    expect(ringContactMaterial(g.outerPin)).toBe(SHOULDER_BOLT_STEEL);
    expect(validateGearboxInputs(g).errors).toEqual([]);
    expect(checkGearbox(g).polymerWarning).toBe(false);
  });

  it('J2, 6 mm shoulder, 6061 disc: bending on d = 6 mm, hand-computed', () => {
    const g = shoulder(PRESETS.J2);
    const r = checkGearbox(g);
    expect(r.valid).toBe(true);
    const b = r.checks.find((c) => c.id === 'boltBending')!;
    expect(b.label).toBe('Shoulder bolt bending');
    // simply supported, central load: sigma = F span / 4 / (pi d^3 / 32), F = per-disc peak ring force
    const F = r.loads.FRingPeak, span = r.derived.span;
    const hand = (F * span / 4) / (Math.PI * 6 ** 3 / 32);
    expect(b.value).toBeCloseTo(hand, 9);
    expect(b.value).toBeGreaterThan(12.5);
    expect(b.value).toBeLessThan(14); // about 13 MPa (79.4 N x 14.2 mm / 4 / 21.2 mm^3)
    expect(b.limit).toBe(432);
    expect(b.utilization).toBeCloseTo(hand / 432, 9);
    // E* from 12.9 steel on 6061-T6
    const es = 1 / ((1 - 0.29 ** 2) / 205000 + (1 - 0.33 ** 2) / 69000);
    expect(r.derived.EstarRing).toBeCloseTo(es, 6);
    // contact limits: the weaker of disc and bolt = the disc, same as a steel bushing
    const bolt = checkGearbox({ ...g, outerPin: { ...g.outerPin, construction: 'solid', material: SHOULDER_BOLT_STEEL } });
    for (const id of ['ringContactStrength', 'ringContactLife'] as const) {
      expect(r.checks.find((c) => c.id === id)!.value).toBeCloseTo(bolt.checks.find((c) => c.id === id)!.value, 9);
      expect(r.checks.find((c) => c.id === id)!.limit).toBe(bolt.checks.find((c) => c.id === id)!.limit);
    }
  });

  it('a non-catalog shoulder warns but still checks', () => {
    const r = checkGearbox(shoulder(PRESETS.J3, 7));
    expect(r.valid).toBe(true);
    expect(r.warnings.some((w) => /not a catalog shoulder bolt/.test(w))).toBe(true);
  });
});

describe('shoulder bolt: catalog and band', () => {
  it('metric and inch sizes with their threads and bands', () => {
    expect(SHOULDER_BOLT_OPTIONS.filter((o) => o.system === 'metric').map((o) => `${o.dia}:${o.thread}`)).toEqual(['4:M3', '5:M4', '6:M5', '8:M6', '10:M8']);
    expect(SHOULDER_BOLT_OPTIONS.filter((o) => o.system === 'inch').map((o) => `${o.dia}:${o.thread}`))
      .toEqual(['3.175:#4-40', '4.763:#8-32', '6.35:#10-24', '7.938:1/4-20', '9.525:5/16-18']);
    expect(shoulderBoltFor(3)!.thread).toBe('M5');
    expect(shoulderBoltFor(6.35 / 2)!.thread).toBe('#10-24');
    // metric -0.013 / -0.038: mean undersize 0.0255, half band 0.0125 (diametral)
    const m = shoulderBandOf(3);
    expect(m.meanUndersize).toBeCloseTo(0.0255, 12);
    expect(m.halfBand).toBeCloseTo(0.0125, 12);
    // inch -0.0005 / -0.002 in = -0.0127 / -0.0508 mm
    const i = shoulderBandOf(6.35 / 2);
    expect(i.meanUndersize).toBeCloseTo((0.0127 + 0.0508) / 2, 12);
    expect(i.halfBand).toBeCloseTo((0.0508 - 0.0127) / 2, 12);
  });
});

describe('shoulder bolt: tolerances', () => {
  const g = shoulder(PRESETS.J2);

  it('ring kind: radial gap = mean undersize / 2, random part = half band', () => {
    const r = ringTolOf(g);
    expect(r.integral).toBe(false);
    expect(r.shoulder!.undersize).toBeCloseTo(0.01275, 12);
    expect(r.shoulder!.pinDiaTol).toBeCloseTo(0.0125, 12);
  });

  it('default spec: CNC mill with reamed holes; the stack subtracts the undersize', () => {
    const t = toleranceOf(g);
    expect(t.holePlay).toBe(0.005);
    // 0.02 profile + 0.02 position + 0.005 hole + 0.0125/2 band + 0.01 ecc - 0.01275 undersize = 0.0485 -> 0.050
    expect(fittedClearances(t, ringTolOf(g)).profileClearance).toBeCloseTo(0.05, 12);
    expect(t.profileClearance).toBeCloseTo(0.05, 12);
    expect(matchProcess(t, ringTolOf(g))).toBe('mill');
    // bolt + bushing defaults are unchanged
    expect(defaultToleranceSpec(false)).toMatchObject({ holePlay: 0.1, profileClearance: 0.155, innerHoleClearance: 0.07 });
  });

  it('design and worst backlash equal a solid pin with the gaps written out by hand', () => {
    const t = toleranceOf(g);
    const a = analyzeTolerance({ ...g, tolerance: t }, { trials: 60, sensitivity: false });
    expect(a.valid).toBe(true);
    expect(a.spec.bushingPlay).toBe(0);
    expect(a.spec.pinDiaTol).toBeCloseTo(0.0125, 12);
    // a solid pin of the same size: bushing play p gives p/2 (design) and p (worst), so p = undersize puts the same
    // deterministic gap in the worst build, and p = 2 undersize in the design build
    const solid: GearboxInputs = { ...g, outerPin: { ...g.outerPin, construction: 'solid', material: SHOULDER_BOLT_STEEL } };
    const worstRef = analyzeTolerance({ ...solid, tolerance: { ...t, bushingPlay: 0.01275, pinDiaTol: 0.0125 } }, { trials: 60, sensitivity: false });
    const desRef = analyzeTolerance({ ...solid, tolerance: { ...t, bushingPlay: 2 * 0.01275, pinDiaTol: 0.0125 } }, { trials: 60, sensitivity: false });
    expect(a.backlash.worst.total).toBeCloseTo(worstRef.backlash.worst.total, 9);
    expect(a.backlash.design.total).toBeCloseTo(desRef.backlash.design.total, 9);
    // the band adds backlash over a perfect (zero-tolerance) shoulder
    const zero = analyzeTolerance({ ...solid, tolerance: { ...t, bushingPlay: 0, pinDiaTol: 0 } }, { trials: 60, sensitivity: false });
    expect(a.backlash.design.total).toBeGreaterThan(zero.backlash.design.total);
    // binding uses the stack less the undersize
    expect(a.binding.requiredProfileClearance).toBeCloseTo(0.0485, 9);
    // the sensitivity has no bushing play term, and the pin diameter term carries the undersize
    const s = analyzeTolerance({ ...g, tolerance: t }, { trials: 60, sensitivityTrials: 10 });
    expect(s.sensitivity!.backlash.some((x) => x.term === 'bushingPlay')).toBe(false);
    expect(s.sensitivity!.backlash.find((x) => x.term === 'pinDiaTol')!.value).toBeGreaterThan(0);
  });

  it('a stored spec keeps its values; the analysis overrides only the play and the band', () => {
    const t = { ...processSpec('router'), holePlay: 0.005 };
    const a = analyzeTolerance({ ...g, tolerance: t }, { trials: 40, sensitivity: false });
    expect(t.bushingPlay).toBe(0.025);
    expect(a.spec.bushingPlay).toBe(0);
    expect(a.spec.pinDiaTol).toBeCloseTo(0.0125, 12);
    expect(a.spec.profileError).toBe(t.profileError);
  });
});

describe('shoulder bolt: advisor', () => {
  for (const [sys, list] of [['metric', [4, 5, 6, 8, 10]], ['inch', [3.175, 4.763, 6.35, 7.938, 9.525]]] as const) {
    it(`J3 picks a ${sys} shoulder and passes at full resolution`, () => {
      const res = adviseDesign(shoulder(PRESETS.J3), { shoulderSystem: sys });
      expect(res.valid).toBe(true);
      const b = res.best!;
      expect(list).toContain(b.outerPinOD);
      expect(b.outerBolt).toBe(shoulderBoltFor(b.outerPinOD / 2)!.thread);
      expect(b.inputs.outerPin.construction).toBe('shoulderBolt');
      const r = checkGearbox(b.inputs);
      expect(r.valid).toBe(true);
      expect(r.maxUtilization).toBeLessThanOrEqual(0.85 + 1e-9);
      expect(r.maxUtilization).toBeCloseTo(b.maxUtilization, 9);
    });
  }

  it('a catalog lock indexes the shoulder list', () => {
    const i = SHOULDER_BOLT_OPTIONS.findIndex((o) => o.id === 'm8');
    const res = adviseDesign(shoulder(PRESETS.J3), { locks: { outerPin: { kind: 'catalog', index: i } } });
    expect(res.best!.outerPinOD).toBe(8);
    expect(res.best!.outerBolt).toBe('M6');
    expect(adviseDesign(shoulder(PRESETS.J3), { locks: { outerPin: { kind: 'catalog', index: 10 } } }).valid).toBe(false);
  });
});

describe('shoulder bolt: fixes', () => {
  it('offers the next larger shoulder (same unit system) and no material fix', () => {
    // J2 with a 4 mm shoulder on a 6061 disc: the ring contact governs and fails
    const g: GearboxInputs = shoulder(PRESETS.J2, 4);
    const r0 = checkGearbox(g);
    expect(r0.governing!.id).toMatch(/^ringContact/);
    expect(r0.maxUtilization).toBeGreaterThan(0.85);
    const rep = suggestFixes(g);
    expect(rep.valid).toBe(true);
    const f = rep.fixes.find((x) => x.field === 'rr')!;
    expect(f).toBeDefined();
    expect(f.label).toBe('Shoulder bolt size');
    expect([5, 6, 8, 10]).toContain(f.toValue);
    expect(rep.fixes.some((x) => x.field === 'outerPin.material' || x.field === 'outerPin.boltYield')).toBe(false);
    const after = checkGearbox(applyFix(g, f));
    expect(after.maxUtilization).toBeCloseTo(f.newMaxUtil, 12);
    expect(applyFix(g, f).outerPin.construction).toBe('shoulderBolt');
  });

  it('inch shoulders step to the next inch size', () => {
    const g: GearboxInputs = shoulder(PRESETS.J2, 3.175);
    const f = suggestFixes(g).fixes.find((x) => x.field === 'rr');
    expect(f).toBeDefined();
    expect([4.763, 6.35, 7.938, 9.525]).toContain(f!.toValue);
  });
});

describe('shoulder bolt: sessions', () => {
  it('old sessions load unchanged; a shoulder bolt session round-trips', () => {
    const old = JSON.parse(JSON.stringify(defaultGearboxInputs()));
    expect(normalizeGearboxInputs(old)).toEqual(defaultGearboxInputs());
    const s = normalizeGearboxInputs(JSON.parse(JSON.stringify(shoulder(PRESETS.J2))));
    expect(s.outerPin.construction).toBe('shoulderBolt');
    expect(s.rr).toBe(3);
    expect(checkGearbox(s).verdict).toBe(checkGearbox(shoulder(PRESETS.J2)).verdict);
    // an unknown construction is an input error, not a crash
    const bad = normalizeGearboxInputs({ ...old, outerPin: { ...old.outerPin, construction: 'rivet' } });
    expect(validateGearboxInputs(bad).errors.some((e) => /construction/.test(e))).toBe(true);
  });

  it('effectiveModulus helper agrees with the E* of the check', () => {
    const g = shoulder(PRESETS.J3);
    expect(checkGearbox(g).derived.EstarRing).toBeCloseTo(effectiveModulus(SHOULDER_BOLT_STEEL, g.discMaterial), 9);
  });
});
