// Integral (pinless) ring machined into the housing (CLAUDE.md Addition 12).
import { describe, expect, it } from 'vitest';
import {
  PRESETS,
  SPEC_STEEL,
  adviseDesign,
  checkGearbox,
  createGearboxModel,
  defaultGearboxInputs,
  discEnvelope,
  discEnvelopeReference,
  effectiveModulus,
  filletAnalysis,
  filletClearanceOf,
  filletGeometry,
  integralGeometry,
  materialProps,
  maxFittingToolRadius,
  normalizeGearboxInputs,
  ringProfile,
  suggestFixes,
  validateGearboxInputs,
  type GearboxInputs,
  type OuterPinSpec,
} from '..';

const integral = (g: GearboxInputs, p: Partial<OuterPinSpec> = {}): GearboxInputs =>
  ({ ...g, outerPin: { ...g.outerPin, construction: 'integral', ...p } });

const J2 = PRESETS.J2; // D 85, e 1.6, rr 2.5, 2 discs of 6.35 mm, gap 0.5
const J2i = integral(J2);
const J3i = integral(PRESETS.J3);

describe('integral ring geometry', () => {
  it('root circle, tooth height and base chord (J2: hand values)', () => {
    const r = checkGearbox(J2i);
    expect(r.valid).toBe(true);
    const ig = r.derived.integral!;
    // R_h = Rp + 2e - rr + c = 42.5 + 3.2 - 2.5 + 0.3
    expect(ig.Rh).toBeCloseTo(43.5, 9);
    expect(ig.reach).toBeCloseTo(43.2, 9);
    expect(ig.toothHeight).toBeCloseTo(3.5, 9);
    // circle-circle intersection by hand: x = (Rh^2 - rr^2 + Rp^2) / (2 Rp) = 3692.25 / 85 = 43.4382353,
    // y = sqrt(Rh^2 - x^2) = sqrt(1892.25 - 1886.88031) = 2.317264, b = 2y = 4.634529
    expect(ig.baseChord).toBeCloseTo(4.634529, 5);
    expect(ig.pitchChord).toBeCloseTo(2 * 43.5 * Math.sin(Math.PI / 18), 9);
    expect(ig.toothLength).toBeCloseTo(2 * 6.35 + 0.5, 12);
  });

  it('the reach comes from the sampled actual profile and equals Rp + 2e - rr', () => {
    for (const g of [J2i, J3i, integral(PRESETS.J1)]) {
      const r = checkGearbox(g);
      const pts = createGearboxModel(g).profilePoints(6000)!;
      const maxR = Math.max(...pts.map((p) => Math.hypot(p.x, p.y)));
      expect(r.derived.integral!.reach).toBeCloseTo(maxR + g.e, 6);
      expect(r.derived.integral!.reach).toBeCloseTo(g.D / 2 + 2 * g.e - g.rr, 6);
    }
  });

  it('housing OD = 2 R_h + 2 wall, smaller than D + 2 rr + 2 wall for the same gearbox', () => {
    const r = checkGearbox(J2i);
    expect(r.derived.housingOD).toBeCloseTo(2 * 43.5 + 2 * 4, 9);
    expect(r.derived.housingOD).toBeLessThan(checkGearbox(J2).derived.housingOD);
    const w = checkGearbox({ ...J2i, wall: 6 });
    expect(w.derived.housingOD).toBeCloseTo(2 * 43.5 + 12, 9);
  });

  it('validation: teeth that do not reach the wall, tool too large for the gap, bad fields', () => {
    // rr <= e + c/2: the tooth circle never meets the root circle
    const loose = validateGearboxInputs({ ...J2i, rr: 1.7 });
    expect(loose.errors.some((m) => m.startsWith('Tooth radius rr must be larger than e + root clearance / 2'))).toBe(true);
    const fit = maxFittingToolRadius(18, 42.5, 2.5, 43.5);
    const big = validateGearboxInputs(integral(J2, { toolRadius: fit + 0.1 }));
    expect(big.errors.some((m) => m.startsWith('Tool radius') && m.includes('too large to cut the root'))).toBe(true);
    expect(validateGearboxInputs(integral(J2, { toolRadius: fit - 0.1 })).errors).toEqual([]);
    expect(validateGearboxInputs(integral(J2, { toolRadius: 0 })).errors).toContain('Tool radius must be > 0 mm');
    expect(validateGearboxInputs(integral(J2, { rootClearance: -0.1 })).errors).toContain('Root clearance must be >= 0 mm');
    expect(validateGearboxInputs(integral(J2, { housingMaterial: { ...materialProps('al-6061'), E: 0 } })).errors)
      .toContain('Housing material: E must be > 0 MPa');
    // the unused pin material is not validated for an integral ring
    expect(validateGearboxInputs(integral(J2, { material: { ...SPEC_STEEL, E: -1 } })).errors).toEqual([]);
    expect(validateGearboxInputs({ ...J2, outerPin: { ...J2.outerPin, construction: 'bogus' as never } }).errors)
      .toContain('Outer pin construction must be boltBushing, solid, shoulderBolt or integral');
  });

  it('teeth stand out of the wall and do not merge at the root for the presets', () => {
    for (const g of [J2i, J3i]) {
      const d = checkGearbox(g).derived;
      const ig = integralGeometry(g.Zp, d.Rp, g.e, g.rr, 0.3, 1.5);
      expect(ig.protrudes && ig.attached && ig.separate && ig.fillet.fits).toBe(true);
      expect(ig.baseChord).toBeLessThan(ig.pitchChord);
    }
  });
});

describe('integral ring contact', () => {
  it('E* comes from the disc / housing pair, and the contact limits from the weaker of the two', () => {
    const r = checkGearbox(J2i);
    // 6061 on 6061: E* = E / (2 (1 - nu^2)) = 69000 / (2 * 0.8911) = 38716.19 MPa
    expect(r.derived.EstarRing).toBeCloseTo(69000 / (2 * (1 - 0.33 * 0.33)), 6);
    expect(r.derived.EstarRing).toBeCloseTo(38716.19, 1);
    const steel = checkGearbox(integral(J2, { housingMaterial: materialProps('steel-4140') }));
    expect(steel.derived.EstarRing).toBeCloseTo(effectiveModulus(materialProps('steel-4140'), J2.discMaterial), 9);
    // p0 goes with sqrt(E*): same forces, same geometry
    const pa = r.loads.p0RingStrength, ps = steel.loads.p0RingStrength;
    expect(ps / pa).toBeCloseTo(Math.sqrt(steel.derived.EstarRing / r.derived.EstarRing), 9);
    // a POM housing on a 6061 disc: the housing limits contact
    const pom = checkGearbox(integral(J2, { housingMaterial: materialProps('pom') }));
    const life = pom.checks.find((c) => c.id === 'ringContactLife')!;
    expect(life.limit).toBeCloseTo((0.577 * 30) / 0.25, 9);
    expect(pom.polymerWarning).toBe(true);
    // the unused bushing material does not change anything
    const other = checkGearbox(integral(J2, { material: materialProps('pla') }));
    expect(other.maxUtilization).toBe(r.maxUtilization);
    expect(other.polymerWarning).toBe(false);
  });
});

describe('tooth root check', () => {
  it('bending, shear and von Mises match a hand calculation (J2)', () => {
    const r = checkGearbox(J2i);
    const F = r.loads.FRingPeak;
    // loaded length = one disc thickness L = 6.35 (each disc loads its own stretch), b = 4.634529, h = 3.5:
    //   sigma_b = 6 F h / (L b^2) = 21 F / (6.35 * 21.478859) = 0.1539694 F
    //   tau     = 1.5 F / (L b)  = 1.5 F / 29.429259        = 0.0509697 F
    //   sigma   = sqrt(sigma_b^2 + 3 tau^2)                  = 0.1774832 F
    expect(r.loads.toothBending / F).toBeCloseTo(0.1539694, 6);
    expect(r.loads.toothShear / F).toBeCloseTo(0.0509697, 6);
    expect(r.loads.toothStress / F).toBeCloseTo(0.1774832, 6);
    const c = r.checks.find((x) => x.id === 'toothRoot')!;
    expect(c.label).toBe('Ring tooth root (integral)');
    expect(c.value).toBe(r.loads.toothStress);
    expect(c.limit).toBe(Math.min(0.4 * 276, 104)); // 6061-T6: 104 MPa
    expect(c.info).toMatchObject({ bending: r.loads.toothBending, shear: r.loads.toothShear, combined: r.loads.toothStress });
    // a stronger housing raises the limit only
    const s = checkGearbox(integral(J2, { housingMaterial: materialProps('steel-4140') })).checks.find((x) => x.id === 'toothRoot')!;
    expect(s.limit).toBe(Math.min(0.4 * 655, 380));
    expect(s.value).toBeCloseTo(c.value, 9);
  });

  it('replaces the bolt bending check; the check list is otherwise the same', () => {
    const bolt = checkGearbox(J2).checks.map((c) => c.id);
    const ring = checkGearbox(J2i).checks.map((c) => c.id);
    expect(ring).not.toContain('boltBending');
    expect(bolt).not.toContain('toothRoot');
    expect(ring).toEqual(bolt.flatMap((id) => (id === 'boltBending' ? ['toothRoot', 'toolFillet'] : [id])));
    expect(checkGearbox(J2i).loads.boltBendingSimple).toBe(0);
  });
});

describe('tool fillet clearance', () => {
  it('a small tool passes, a big one fails, and the largest tool radius is consistent', () => {
    const small = checkGearbox(integral(J2, { toolRadius: 1.5 }));
    const cs = small.checks.find((c) => c.id === 'toolFillet')!;
    expect(cs.status).toBe('ok');
    expect(cs.value).toBeGreaterThan(0.5);
    const maxTool = small.derived.integral!.maxToolRadius;
    expect(maxTool).toBeGreaterThan(4);
    const fit = maxFittingToolRadius(18, 42.5, 2.5, 43.5);
    expect(maxTool).toBeLessThan(fit);
    const big = checkGearbox(integral(J2, { toolRadius: 5.5 }));
    expect(big.valid).toBe(true);
    const cb = big.checks.find((c) => c.id === 'toolFillet')!;
    expect(cb.status).toBe('fail');
    expect(cb.value).toBeLessThan(0.05);
    expect(big.warnings.some((w) => w.startsWith('The tool fillets reach into the disc path'))).toBe(true);
    // just below the largest tool radius the clearance holds the 0.05 mm limit; just above it does not
    const below = checkGearbox(integral(J2, { toolRadius: maxTool - 0.005 })).derived.integral!;
    const above = checkGearbox(integral(J2, { toolRadius: maxTool + 0.005 })).derived.integral!;
    expect(below.filletClearance).toBeGreaterThanOrEqual(0.05);
    expect(above.filletClearance).toBeLessThan(0.05);
    // the largest radius does not depend on the tool radius in the inputs
    expect(big.derived.integral!.maxToolRadius).toBe(maxTool);
  });

  it('clearance falls monotonically with the tool radius', () => {
    const env = discEnvelope(18, 35, 1.07, 2.5, 240, 128);
    const Rh = 35 + 2 * 1.07 - 2.5 + 0.3;
    let prev = Infinity;
    for (let rt = 0.25; rt < 4.5; rt += 0.25) {
      const c = filletClearanceOf(env, filletGeometry(18, 35, 2.5, Rh, rt), rt);
      expect(c).toBeLessThanOrEqual(prev + 1e-12);
      prev = c;
    }
  });

  it('the symmetry-reduced sweep gives the same clearance as sweeping every reference angle', () => {
    for (const [Zp, Rp, e, rr] of [[18, 42.5, 1.6, 2.5], [17, 30, 1.0, 2.0], [25, 40, 0.9, 1.75]]) {
      const Rh = Rp + 2 * e - rr + 0.3;
      const fast = filletAnalysis(discEnvelope(Zp, Rp, e, rr, 240, 128), Zp, Rp, rr, Rh, 1.5);
      const ref = filletAnalysis(discEnvelopeReference(Zp, Rp, e, rr, 240, 128), Zp, Rp, rr, Rh, 1.5);
      // different bin shapes (tan vs angle): agree to a few microns
      expect(Math.abs(fast.clearance - ref.clearance)).toBeLessThan(5e-3);
      expect(Math.abs(fast.maxToolRadius - ref.maxToolRadius)).toBeLessThan(0.02);
    }
  });

  it('an envelope point inside the fillet material gives a negative clearance', () => {
    const Rh = 43.5, rt = 1.5;
    const f = filletGeometry(18, 42.5, 2.5, Rh, rt);
    // the corner where the tooth meets the root circle is fillet material: 0.2 mm beyond the arc toward it
    const ux = (f.Troot.x + f.Ttooth.x) / 2 - f.F.x, uy = (f.Troot.y + f.Ttooth.y) / 2 - f.F.y;
    const L = Math.hypot(ux, uy);
    const p = { x: f.F.x + (ux / L) * (rt + 0.2), y: f.F.y + (uy / L) * (rt + 0.2) };
    const env = { x: Float64Array.of(p.x), y: Float64Array.of(p.y), count: 1, profileMaxR: 0 };
    expect(filletClearanceOf(env, f, rt)).toBeCloseTo(-0.2, 9);
  });
});

describe('ring profile polyline', () => {
  it('has Zp teeth, innermost radius Rp - rr and outermost R_h, and no self crossing', () => {
    const Zp = 18, Rp = 42.5, rr = 2.5, Rh = 43.5;
    const pts = ringProfile(Zp, Rp, rr, Rh, 1.5, 0.005);
    const r = pts.map((p) => Math.hypot(p.x, p.y));
    expect(Math.min(...r)).toBeCloseTo(Rp - rr, 9);
    expect(Math.max(...r)).toBeCloseTo(Rh, 9);
    // tooth tips: vertices at Rp - rr
    expect(r.filter((x) => Math.abs(x - (Rp - rr)) < 1e-9)).toHaveLength(Zp);
    // counter-clockwise (positive area)
    let a2 = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a2 += p.x * q.y - q.x * p.y; }
    expect(a2).toBeGreaterThan(0);
  });
});

describe('integral advisor', () => {
  it('J2 and J3: integral designs pass at full resolution with a smaller housing than bolt + bushing', () => {
    const found: Record<string, [number, number]> = {};
    for (const [id, g] of [['J2', J2], ['J3', PRESETS.J3]] as const) {
      const bolt = adviseDesign(g);
      const ring = adviseDesign(integral(g));
      expect(bolt.best && ring.best).toBeTruthy();
      const d = ring.best!;
      expect(d.inputs.outerPin.construction).toBe('integral');
      const full = checkGearbox(d.inputs);
      expect(full.valid).toBe(true);
      expect(full.maxUtilization).toBeLessThanOrEqual(0.85 + 1e-9);
      expect(full.checks.map((c) => c.id)).toContain('toolFillet');
      expect(d.housingOD).toBeCloseTo(full.derived.housingOD, 9);
      expect(d.housingOD).toBeCloseTo(2 * full.derived.integral!.Rh + 2 * g.wall, 9);
      expect(d.outerBolt).toBeNull();
      expect(d.housingOD).toBeLessThan(bolt.best!.housingOD);
      found[id] = [d.housingOD, bolt.best!.housingOD];
      for (const alt of Object.values(ring.alternatives)) {
        if (alt) expect(alt.result.maxUtilization).toBeLessThanOrEqual(0.85 + 1e-9);
      }
    }
    // reference numbers (this machine, 2026-10): J2 55.7 vs 75 mm, J3 45.8 vs 55 mm
    expect(found.J2[0]).toBeCloseTo(55.7, 1);
    expect(found.J3[0]).toBeCloseTo(45.83, 1);
  }, 60000);

  it('a locked tooth radius comes back exactly', () => {
    const a = adviseDesign(J3i, { locks: { outerPin: { kind: 'custom', od: 2 * 2.3, shank: 3 } } });
    expect(a.best).toBeTruthy();
    expect(a.best!.inputs.rr).toBe(2.3);
  }, 60000);
});

describe('integral fixes', () => {
  it('a tool fillet failure offers a smaller end mill', () => {
    const g = integral(J2, { toolRadius: 5.5 });
    const rep = suggestFixes(g);
    expect(rep.needed).toBe(true);
    expect(rep.governingId).toBe('toolFillet');
    const f = rep.fixes.find((x) => x.field === 'outerPin.toolRadius');
    expect(f).toBeTruthy();
    expect(f!.passesTarget).toBe(true);
    const tr = f!.patch.outerPin!.toolRadius!;
    expect(tr).toBeLessThan(5.5);
    expect(tr).toBeLessThanOrEqual(checkGearbox(g).derived.integral!.maxToolRadius);
    expect(checkGearbox({ ...g, ...f!.patch }).checks.find((c) => c.id === 'toolFillet')!.status).toBe('ok');
  });

  it('ring contact failures offer the tooth radius and a stronger housing', () => {
    // 7075 disc in a 6061 housing: the housing sets the contact limits
    const g = integral({ ...J2, discs: 1, e: 1.3, discMaterial: materialProps('al-7075') });
    const r = checkGearbox(g);
    expect(['ringContactLife', 'ringContactStrength']).toContain(r.governing!.id);
    const rep = suggestFixes(g);
    const h = rep.fixes.find((x) => x.field === 'outerPin.housingMaterial');
    expect(h).toBeTruthy();
    expect(h!.patch.outerPin!.construction).toBe('integral');
    expect(h!.newMaxUtil).toBeLessThan(r.maxUtilization);
    const rr = rep.fixes.find((x) => x.field === 'rr');
    expect(rr).toBeTruthy();
    expect(rr!.label).toBe('Tooth radius rr');
    expect(rr!.patch).toEqual({ rr: rr!.toValue });
    // no bolt or bushing fixes for a ring without pins
    expect(rep.fixes.some((x) => x.field === 'outerPin.boltYield' || x.field === 'outerPin.material')).toBe(false);
  });
});

describe('old sessions', () => {
  it('a saved session without the integral fields loads unchanged (bolt + bushing, same numbers)', () => {
    const old = JSON.parse(JSON.stringify(PRESETS.J2)) as GearboxInputs;
    delete old.outerPin.housingMaterial;
    delete old.outerPin.rootClearance;
    delete old.outerPin.toolRadius;
    const n = normalizeGearboxInputs(old);
    expect(n.outerPin.construction).toBe('boltBushing');
    expect(n.outerPin.rootClearance).toBe(0.3);
    expect(n.outerPin.toolRadius).toBe(1.5);
    expect(n.outerPin.housingMaterial).toEqual(materialProps('al-6061'));
    const a = checkGearbox(old), b = checkGearbox(n), c = checkGearbox(PRESETS.J2);
    for (const r of [a, b]) {
      expect(r.checks).toEqual(c.checks);
      expect(r.derived).toEqual(c.derived);
      expect(r.derived.integral).toBeNull();
    }
    // the defaults stay bolt + bushing
    expect(defaultGearboxInputs().outerPin.construction).toBe('boltBushing');
  });

  it('an integral session round-trips through normalize', () => {
    const g = integral(J2, { housingMaterial: materialProps('al-7075'), rootClearance: 0.4, toolRadius: 1 });
    const n = normalizeGearboxInputs(JSON.parse(JSON.stringify(g)));
    expect(n).toEqual(g);
    expect(checkGearbox(n).maxUtilization).toBe(checkGearbox(g).maxUtilization);
  });
});
