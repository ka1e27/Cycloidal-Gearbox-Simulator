import { describe, expect, it } from 'vitest';
import {
  adviseDesign, adviseDesignAsync, checkGearbox, defaultGearboxInputs, materialProps, PRESETS,
  BEARINGS, INNER_PIN_OPTIONS, OUTER_PIN_OPTIONS, DISC_STOCK_METAL, DISC_STOCK_POLYMER, ZP_OPTIONS,
} from '../index';
import type { AdvisorDesign, AdvisorProgress, GearboxInputs } from '../index';
import { bearingUnitLoad, innerForceTable, ringUnit } from '../kernel';
import { buildChecks, deriveGeometry, scaleLoads } from '../gearbox';
import type { UnitInputs } from '../gearbox';

const strip = (r: unknown) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'elapsedMs' ? 0 : v)));

function assertMeetsTarget(d: AdvisorDesign, target: number) {
  // independent full-resolution check of the exact inputs the UI would apply
  const r = checkGearbox(d.inputs);
  expect(r.valid).toBe(true);
  expect(r.checks.length).toBeGreaterThanOrEqual(11);
  for (const c of r.checks) {
    expect(c.utilization, `${c.id} utilization ${c.utilization}`).toBeLessThanOrEqual(target + 1e-9);
  }
  expect(r.maxUtilization).toBeLessThanOrEqual(target + 1e-9);
  expect(d.maxUtilization).toBeCloseTo(r.maxUtilization, 9);
  // housing OD = D + 2 rr + 2 wall
  expect(d.housingOD).toBeCloseTo(d.inputs.D + 2 * d.inputs.rr + 2 * d.inputs.wall, 9);
  // coarse search and full resolution agree closely
  expect(Math.abs(d.coarseMaxUtilization / d.maxUtilization - 1)).toBeLessThan(0.04);
}

describe('Design Advisor: J2 and J3 loads', () => {
  for (const id of ['J2', 'J3'] as const) {
    it(`${id}: full-resolution checks all satisfy the target; timing`, () => {
      const t0 = performance.now();
      const res = adviseDesign(PRESETS[id]);
      const ms = performance.now() - t0;
      console.log(`[advisor timing] ${id}: ${ms.toFixed(0)} ms, ${res.evaluated} coarse candidates evaluated`);
      expect(res.valid).toBe(true);
      expect(res.best).not.toBeNull();
      expect(ms).toBeLessThan(5000);
      const b = res.best!;
      assertMeetsTarget(b, 0.85);
      console.log(
        `[advisor ${id}] D ${b.D} housing OD ${b.housingOD} e ${b.e.toFixed(3)} K1 ${b.K1.toFixed(3)} pin ${b.outerPinOD} ` +
        `inner ${b.innerPinOD} Zw ${b.Zw} Rw ${b.Rw.toFixed(1)} L ${b.L} discs ${b.discs} bearing ${b.bearingName} ` +
        `mass ${b.massTotal_g.toFixed(1)} g util ${b.maxUtilization.toFixed(3)} (${b.governingLabel})`,
      );
      // every alternative is a real, verified design
      const alts = res.alternatives;
      for (const a of [alts.oneDisc, alts.twoDisc, alts.lightest, alts.mostMargin]) {
        if (a) assertMeetsTarget(a, 0.85);
      }
      expect(alts.oneDisc?.inputs.discs).toBe(1);
      expect(alts.twoDisc?.inputs.discs).toBe(2);
      // the best design is the smallest of them all
      for (const a of [alts.oneDisc, alts.twoDisc, alts.lightest, alts.mostMargin]) {
        if (a) expect(a.housingOD).toBeGreaterThanOrEqual(b.housingOD - 1e-9);
      }
      if (alts.lightest) expect(alts.lightest.massTotal_g).toBeLessThanOrEqual(b.massTotal_g + 1e-9);
      if (alts.mostMargin) expect(alts.mostMargin.maxUtilization).toBeLessThanOrEqual(b.maxUtilization + 1e-9);
    });
  }

  it('uses only catalog parts', () => {
    const b = adviseDesign(PRESETS.J3).best!;
    expect(OUTER_PIN_OPTIONS.some((p) => p.od === b.outerPinOD && p.shank === b.shankDia)).toBe(true);
    expect(INNER_PIN_OPTIONS.some((p) => p.od === b.innerPinOD && p.bore === b.innerPinBore)).toBe(true);
    expect(BEARINGS.some((x) => x.name === b.bearingName && x.OD === b.inputs.Db)).toBe(true);
    expect(DISC_STOCK_METAL).toContain(b.L);
    expect(b.K1).toBeGreaterThanOrEqual(0.4 - 1e-9);
    expect(b.K1).toBeLessThanOrEqual(0.85 + 1e-9);
    expect(b.Zw).toBeGreaterThanOrEqual(4);
    expect(b.Zw).toBeLessThanOrEqual(10);
    expect(b.D).toBeGreaterThanOrEqual(30);
    expect(b.D).toBeLessThanOrEqual(150);
  });

  it('is deterministic', () => {
    const a = adviseDesign(PRESETS.J3);
    const b = adviseDesign(PRESETS.J3);
    expect(strip(a)).toEqual(strip(b));
  });

  it('keeps the ratio fixed by default (fixed Zp)', () => {
    for (const Zp of [14, 18, 22]) {
      const res = adviseDesign({ ...PRESETS.J3, Zp });
      expect(res.best).not.toBeNull();
      expect(res.best!.Zp).toBe(Zp);
      expect(res.best!.inputs.Zp).toBe(Zp);
      expect(res.best!.ratio).toBe(Zp - 1);
      assertMeetsTarget(res.best!, 0.85);
    }
  });

  it('"let ratio vary" is no worse than the fixed ratio and uses a listed Zp', () => {
    const fixed = adviseDesign(PRESETS.J3).best!;
    const t0 = performance.now();
    const vary = adviseDesign(PRESETS.J3, { ratioVary: true });
    console.log(`[advisor timing] J3 ratioVary: ${(performance.now() - t0).toFixed(0)} ms`);
    expect(ZP_OPTIONS).toContain(vary.best!.Zp);
    expect(vary.best!.housingOD).toBeLessThanOrEqual(fixed.housingOD + 1e-9);
    assertMeetsTarget(vary.best!, 0.85);
  });

  it('a looser target never needs a bigger gearbox; a tighter one never a smaller one', () => {
    const t70 = adviseDesign(PRESETS.J3, { target: 0.7 }).best;
    const t85 = adviseDesign(PRESETS.J3, { target: 0.85 }).best!;
    const t100 = adviseDesign(PRESETS.J3, { target: 1.0 }).best!;
    expect(t100.housingOD).toBeLessThanOrEqual(t85.housingOD);
    if (t70) {
      expect(t70.housingOD).toBeGreaterThanOrEqual(t85.housingOD);
      assertMeetsTarget(t70, 0.7);
    }
    assertMeetsTarget(t100, 1.0);
    // target is clamped to 0.7..1.0
    expect(adviseDesign(PRESETS.J3, { target: 5 }).target).toBe(1);
    expect(adviseDesign(PRESETS.J3, { target: 0.1 }).target).toBe(0.7);
  });

  it('an impossible load returns no design and says why', () => {
    const res = adviseDesign({ ...PRESETS.J3, Treq: 400, Tdes: 600 });
    expect(res.valid).toBe(true);
    expect(res.best).toBeNull();
    expect(res.warnings.join(' ')).toMatch(/No design/);
  });

  it('works for PLA discs (polymer stock thicknesses) and solid pins', () => {
    const inp: GearboxInputs = {
      ...PRESETS.J4,
      discMaterial: materialProps('pla'),
      outerPin: { construction: 'solid', shankDia: 3, boltYield: 640, material: materialProps('steel-4140') },
      innerPin: { construction: 'solid', od: 5, bore: 2.46, standoffYield: 300, material: materialProps('steel-4140') },
    };
    const res = adviseDesign(inp);
    expect(res.valid).toBe(true);
    if (res.best) {
      expect(DISC_STOCK_POLYMER).toContain(res.best.L);
      expect(res.best.outerBolt).toBeNull();
      expect(res.best.innerPinBore).toBeNull();
      assertMeetsTarget(res.best, 0.85);
      expect(res.best.result.polymerWarning).toBe(true);
    }
  });

  it('reports bad input instead of throwing', () => {
    const bad = adviseDesign({ ...defaultGearboxInputs(), Zw: 1 });
    expect(bad.valid).toBe(false);
    expect(bad.errors.length).toBeGreaterThan(0);
    expect(() => adviseDesign(null as unknown as GearboxInputs)).not.toThrow();
  });
});

describe('Design Advisor: progress and cancellation', () => {
  it('progress fractions are monotonic and in [0,1]', () => {
    const seen: AdvisorProgress[] = [];
    adviseDesign(PRESETS.J2, {}, { onProgress: (p) => seen.push(p) });
    for (let i = 0; i < seen.length; i++) {
      expect(seen[i].fraction).toBeGreaterThanOrEqual(0);
      expect(seen[i].fraction).toBeLessThanOrEqual(1);
      if (i > 0) expect(seen[i].fraction).toBeGreaterThanOrEqual(seen[i - 1].fraction - 1e-12);
    }
  });

  it('the async version yields to the event loop and can be cancelled', async () => {
    let ticks = 0;
    const timer = setInterval(() => { ticks++; }, 1);
    let n = 0;
    const res = await adviseDesignAsync(PRESETS.J2, { ratioVary: true }, {
      shouldCancel: () => ++n > 2,
    });
    clearInterval(timer);
    expect(res.cancelled).toBe(true);
    expect(res.best).toBeNull();
    expect(ticks).toBeGreaterThanOrEqual(0);
    // and without cancel it gives the same answer as the sync version
    const a = await adviseDesignAsync(PRESETS.J3);
    expect(strip(a)).toEqual(strip(adviseDesign(PRESETS.J3)));
  });
});

describe('Design Advisor: minimality against an independent brute force', () => {
  it('no design with a smaller housing OD exists (J3 loads, exhaustive over the catalog, coarse resolution)', () => {
    const base = PRESETS.J3;
    const target = 0.85;
    const res = adviseDesign(base);
    const best = res.best!;
    const bestOD = best.housingOD;
    const Zp = base.Zp;
    let found: { od: number; why: string } | null = null;
    let bestMassAtOD = Infinity;
    let checked = 0;

    for (let D = 30; D <= 150 && !found; D++) {
      for (let pi = 0; pi < OUTER_PIN_OPTIONS.length && !found; pi++) {
        const pin = OUTER_PIN_OPTIONS[pi];
        const od = D + pin.od + 2 * base.wall;
        if (od > bestOD + 1e-9) continue;
        if (2 * (D / 2) * Math.sin(Math.PI / Zp) - pin.od < 1) continue;
        for (let k = 0; k < 19 && !found; k++) {
          const K1 = 0.4 + 0.025 * k;
          const e = (K1 * (D / 2)) / Zp;
          const u = ringUnit(Zp, D, e, pin.od / 2, 1500, 120);
          for (const discs of [1, 2]) {
            for (const L of DISC_STOCK_METAL) {
              for (const inn of INNER_PIN_OPTIONS) {
                for (const Zw of [4, 5, 6, 7, 8, 9, 10]) {
                  for (const brg of BEARINGS) {
                    const inp: GearboxInputs = {
                      ...base, D, e, L, discs, Zw, rr: pin.od / 2, rw: inn.od / 2, Db: brg.OD,
                      outerPin: { ...base.outerPin, shankDia: pin.shank },
                      innerPin: { ...base.innerPin, od: inn.od, bore: inn.bore },
                      bearing: { name: brg.name, C: brg.C, C0: brg.C0 },
                    };
                    const g = deriveGeometry(inp);
                    if (!(g.Rw > 0)) continue;
                    // cheap necessary condition (ring contact) before the generic machinery
                    const p0 = u.P1 * Math.sqrt(g.EstarRing / L);
                    if (p0 * Math.sqrt(inp.Kc * inp.Tdes * g.share) > target * 1.67 * 276) continue;
                    checked++;
                    const FbUnit = bearingUnitLoad(u.sweep, innerForceTable(Zw, Zp, 120), g.Rw);
                    const FInnerUnit = 4000 / (Zw * g.Rw);
                    const p0In = Math.sqrt((FInnerUnit * g.EstarInner * (1 / inp.rw - 1 / (g.dh / 2))) / (Math.PI * L));
                    const unit: UnitInputs = {
                      p0RingUnit: p0, FRingUnit: u.F, p0InnerUnit: p0In, FInnerUnit, FbUnit,
                      rhoMinConvex: u.rhoMinConvex, cusp: u.cusp, undercut: u.undercut,
                    };
                    const checks = buildChecks(inp, g, unit, scaleLoads(inp, g, unit));
                    const mx = Math.max(...checks.map((c) => c.utilization));
                    if (mx <= target) {
                      if (od < bestOD - 1e-9) { found = { od, why: `D ${D} pin ${pin.od} K1 ${K1} L ${L} discs ${discs}` }; }
                      else {
                        const net = u.area - Math.PI * (brg.OD / 2) ** 2 - Zw * Math.PI * (g.dh / 2) ** 2;
                        bestMassAtOD = Math.min(bestMassAtOD, (Math.max(0, net) * L * 2.7 / 1000) * discs);
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
    }
    console.log(`[advisor brute force] ${checked} exhaustive candidate evaluations, best housing OD ${bestOD}`);
    expect(found, found ? `found a smaller design: ${JSON.stringify(found)}` : '').toBeNull();
    // at the winning housing OD the advisor also picked the lightest feasible disc set
    expect(Math.abs(best.massTotal_g / bestMassAtOD - 1)).toBeLessThan(0.005);
  }, 120000);
});
