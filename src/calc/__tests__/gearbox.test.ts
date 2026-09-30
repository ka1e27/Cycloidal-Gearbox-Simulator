import { describe, expect, it } from 'vitest';
import {
  checkGearbox, createGearboxModel, defaultGearboxInputs, normalizeGearboxInputs, statusOf, PRESETS,
} from '../index';
import type { GearboxInputs } from '../index';

describe('checks, verdict and governing mode', () => {
  it('status thresholds: <= 0.85 ok, <= 1.0 marginal, > 1.0 fail', () => {
    expect(statusOf(0)).toBe('ok');
    expect(statusOf(0.85)).toBe('ok');
    expect(statusOf(0.8501)).toBe('marginal');
    expect(statusOf(1.0)).toBe('marginal');
    expect(statusOf(1.0001)).toBe('fail');
    expect(statusOf(NaN)).toBe('fail');
  });

  it('verdict is the worst check and governing names it', () => {
    const r = checkGearbox(PRESETS.J3);
    const worst = r.checks.reduce((a, b) => (b.utilization > a.utilization ? b : a));
    expect(r.governing?.id).toBe(worst.id);
    expect(r.maxUtilization).toBeCloseTo(worst.utilization, 12);
    const expected = worst.utilization > 1 ? 'fail' : worst.utilization > 0.85 ? 'marginal' : 'pass';
    expect(r.verdict).toBe(expected);
  });

  it('min-type checks use limit/value (ligament to bore for the default)', () => {
    const r = checkGearbox(defaultGearboxInputs());
    const lig = r.checks.find((c) => c.id === 'ligamentBore')!;
    // Rw 32.9 - dh/2 3.8 - Db/2 9.5 = 19.6 mm vs t_min 2
    expect(lig.value).toBeCloseTo(19.6, 9);
    expect(lig.utilization).toBeCloseTo(2 / 19.6, 9);
    const cusp = r.checks.find((c) => c.id === 'cusp')!;
    expect(cusp.value).toBeCloseTo(6.678, 2);
    expect(cusp.utilization).toBeCloseTo(0.3 / cusp.value, 9);
    expect(cusp.status).toBe('ok');
  });

  it('a pin too large for the lobes is flagged as cusp / undercut and fails', () => {
    const inp: GearboxInputs = { ...defaultGearboxInputs(), D: 50, e: 1.0, rr: 4.5, rw: 2.0, Db: 10 };
    const r = checkGearbox(inp);
    expect(r.valid).toBe(true);
    expect(r.cusp).toBe(true);
    const c = r.checks.find((x) => x.id === 'cusp')!;
    expect(c.status).toBe('fail');
    expect(r.verdict).toBe('fail');
    expect(r.warnings.join(' ')).toMatch(/[Cc]usp|undercut/);
  });

  it('Rw override adds a ligament-to-root check', () => {
    const r = checkGearbox({ ...defaultGearboxInputs(), RwOverride: 34 });
    expect(r.derived.RwIsOverride).toBe(true);
    expect(r.derived.Rw).toBe(34);
    const root = r.checks.find((c) => c.id === 'ligamentRoot')!;
    expect(root.value).toBeCloseTo(32.9 + 2 - 34, 9); // tMin shrinks by the 1.1 mm the pins moved out
    expect(checkGearbox(defaultGearboxInputs()).checks.find((c) => c.id === 'ligamentRoot')).toBeUndefined();
  });

  it('bearing L10h is unbounded (Infinity) at zero torque, utilization 0', () => {
    const r = checkGearbox({ ...defaultGearboxInputs(), Treq: 0, Tdes: 0 });
    expect(r.valid).toBe(true);
    const life = r.checks.find((c) => c.id === 'bearingLife')!;
    expect(life.value).toBe(Infinity);
    expect(life.utilization).toBe(0);
  });

  it('K1 and ratio are derived', () => {
    const r = checkGearbox(defaultGearboxInputs());
    expect(r.derived.K1).toBeCloseTo((1.3 * 18) / 42.5, 12);
    expect(r.derived.ratio).toBe(17);
    expect(r.derived.housingOD).toBeCloseTo(85 + 5 + 8, 12);
  });
});

describe('input validation: never throws, returns errors', () => {
  const bad: [string, Partial<GearboxInputs>][] = [
    ['Zp < 8', { Zp: 6 }],
    ['non-integer Zp', { Zp: 18.5 }],
    ['Zw < 3', { Zw: 2 }],
    ['NaN D', { D: NaN }],
    ['Infinity e', { e: Infinity }],
    ['negative L', { L: -1 }],
    ['zero rr', { rr: 0 }],
    ['discs = 3', { discs: 3 }],
    ['K1 >= 1', { e: 10 }],
    ['pin circle too small', { D: 8 }],
    ['negative torque', { Tdes: -1 }],
  ];
  for (const [name, patch] of bad) {
    it(`${name} -> valid:false with an error message`, () => {
      const r = checkGearbox({ ...defaultGearboxInputs(), ...patch });
      expect(r.valid).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.verdict).toBe('invalid');
      expect(r.checks).toEqual([]);
    });
  }

  it('garbage objects do not throw', () => {
    for (const g of [null, undefined, 5, 'x', {}, [], { Zp: 'a' }]) {
      expect(() => checkGearbox(g as unknown as GearboxInputs)).not.toThrow();
      const r = checkGearbox(g as unknown as GearboxInputs);
      expect(r.valid).toBe(false);
      expect(() => createGearboxModel(g as unknown as GearboxInputs)).not.toThrow();
    }
  });

  it('random fuzz: no exceptions, valid results are finite', () => {
    let seed = 12345;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    for (let k = 0; k < 300; k++) {
      const inp: GearboxInputs = {
        ...defaultGearboxInputs(),
        Zp: 8 + Math.floor(rnd() * 25),
        Zw: 3 + Math.floor(rnd() * 10),
        D: 10 + rnd() * 140,
        e: rnd() * 4,
        L: 1 + rnd() * 15,
        rr: 0.5 + rnd() * 6,
        rw: 0.5 + rnd() * 6,
        Db: rnd() * 40,
        discs: rnd() < 0.5 ? 1 : 2,
        Treq: rnd() * 10,
        Tdes: rnd() * 15,
      };
      const r = checkGearbox(inp, { npf: 600, nth: 60 });
      if (r.valid) {
        for (const c of r.checks) {
          expect(Number.isNaN(c.value)).toBe(false);
          expect(Number.isFinite(c.utilization)).toBe(true);
        }
        expect(Number.isFinite(r.maxUtilization)).toBe(true);
      } else {
        expect(r.errors.length).toBeGreaterThan(0);
      }
    }
  });

  it('normalizeGearboxInputs fills gaps from the defaults', () => {
    const n = normalizeGearboxInputs({ D: 70, outerPin: { shankDia: 4 }, junk: 1, e: 'x' });
    expect(n.D).toBe(70);
    expect(n.e).toBe(1.3);
    expect(n.outerPin.shankDia).toBe(4);
    expect(n.outerPin.boltYield).toBe(640);
    expect(checkGearbox(n).valid).toBe(true);
    expect(normalizeGearboxInputs(null).D).toBe(85);
  });
});

describe('per-theta data for the UI', () => {
  const inp = PRESETS.J3;
  const model = createGearboxModel(inp);

  it('sweep over one revolution has nth points and its max equals the ring p0 results', () => {
    const s = model.result.sweep;
    expect(s.thetaDeg).toHaveLength(240);
    expect(s.thetaDeg[0]).toBe(0);
    expect(s.thetaDeg[239]).toBeCloseTo(358.5, 9);
    expect(Math.max(...s.p0Strength)).toBeCloseTo(model.result.loads.p0RingStrength, 9);
    expect(Math.max(...s.p0Life)).toBeCloseTo(model.result.loads.p0RingLife, 9);
    expect(Math.max(...s.FPeak)).toBeCloseTo(model.result.loads.FRingPeak, 9);
    expect(Math.max(...s.bearingLoad)).toBeCloseTo(model.result.loads.bearingPeak, 9);
    expect(s.limitStrength).toBeCloseTo(1.67 * 276, 9);
  });

  it('per-pin values at a sweep angle match the sweep', () => {
    for (const t of [0, 37, 120, 201]) {
      const theta = (2 * Math.PI * t) / 240;
      const pins = model.pinsAt(theta)!;
      expect(pins).toHaveLength(18);
      const maxP = Math.max(...pins.map((p) => p.p0Strength));
      expect(maxP).toBeCloseTo(model.result.sweep.p0Strength[t], 6);
      const maxF = Math.max(...pins.map((p) => p.force));
      expect(maxF).toBeCloseTo(model.result.sweep.FPeak[t], 6);
      // only loaded pins carry force; roughly half the pins are loaded
      const loaded = pins.filter((p) => p.loaded).length;
      expect(loaded).toBeGreaterThan(3);
      expect(loaded).toBeLessThan(12);
      for (const p of pins) if (!p.loaded) expect(p.force).toBe(0);
    }
  });

  it('drawing geometry is consistent: loaded pins touch the disc profile, nothing overlaps', () => {
    for (const theta of [0, 0.7, 2.1, 4.4]) {
      const d = model.drawingAt(theta, 1440)!;
      expect(d.profile).toHaveLength(1440);
      expect(d.outerPins).toHaveLength(18);
      expect(d.innerHoles).toHaveLength(6);
      expect(d.innerPins).toHaveLength(6);
      expect(d.center.x).toBeCloseTo(1.07 * Math.cos(theta), 12);
      const Rw = model.result.derived.Rw;
      const dh2 = model.result.derived.dh / 2;
      for (let k = 0; k < 6; k++) {
        expect(Math.hypot(d.innerPins[k].x, d.innerPins[k].y)).toBeCloseTo(Rw, 9);
        expect(Math.hypot(d.innerHoles[k].x - d.center.x, d.innerHoles[k].y - d.center.y)).toBeCloseTo(Rw, 9);
        expect(d.innerHoles[k].r).toBeCloseTo(dh2, 9);
        // the pin sits inside its hole, offset by at most e
        const off = Math.hypot(d.innerPins[k].x - d.innerHoles[k].x, d.innerPins[k].y - d.innerHoles[k].y);
        expect(off).toBeLessThanOrEqual(1.07 + 1e-9);
      }
      for (const p of d.outerPins) {
        let dmin = Infinity;
        for (const q of d.profile) dmin = Math.min(dmin, Math.hypot(q.x - p.x, q.y - p.y));
        expect(dmin).toBeGreaterThan(p.r - 0.06); // no interference
        if (p.loaded) expect(dmin).toBeLessThan(p.r + 0.06); // contact
      }
    }
  });

  it('profilePoints are centred on the disc centre and respect the lobe count', () => {
    const pts = model.profilePoints(720)!;
    expect(pts).toHaveLength(720);
    let rmax = 0, rmin = Infinity;
    for (const p of pts) { const r = Math.hypot(p.x, p.y); rmax = Math.max(rmax, r); rmin = Math.min(rmin, r); }
    // pin-centre path radius Rp +/- e, offset inward by rr
    expect(rmax).toBeCloseTo(35 + 1.07 - 2.5, 0);
    expect(rmin).toBeCloseTo(35 - 1.07 - 2.5, 0);
  });

  it('an invalid model returns null drawing data, never throws', () => {
    const m = createGearboxModel({ ...defaultGearboxInputs(), Zp: 2 });
    expect(m.result.valid).toBe(false);
    expect(m.pinsAt(0)).toBeNull();
    expect(m.drawingAt(1)).toBeNull();
    expect(m.profilePoints()).toBeNull();
    expect(model.pinsAt(NaN)).toBeNull();
  });
});

describe('resolution options', () => {
  it('coarse resolution stays within a few percent of the SPEC resolution', () => {
    const full = checkGearbox(PRESETS.J3);
    const coarse = checkGearbox(PRESETS.J3, { npf: 1500, nth: 120 });
    expect(coarse.resolution).toEqual({ npf: 1500, nth: 120 });
    expect(Math.abs(coarse.unit.p0Ring / full.unit.p0Ring - 1)).toBeLessThan(0.03);
    expect(Math.abs(coarse.unit.Fb / full.unit.Fb - 1)).toBeLessThan(0.03);
  });
});
