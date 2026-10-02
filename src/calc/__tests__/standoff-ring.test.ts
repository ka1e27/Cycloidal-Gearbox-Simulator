// Inner standoffs fixed at the output face and tied at the far end by a floating ring (bolted = clamped tip,
// or pinned tip). Reference values from scripts/parity/standoff/standoff_ref.py (closed form, validated against an
// exact-constraint FEM in standoff_fem2.py). See scripts/parity/standoff/README.md.
import { describe, expect, it } from 'vitest';
import {
  checkGearbox,
  defaultGearboxInputs,
  innerPinSectionModulus,
  normalizeGearboxInputs,
  PRESETS,
  validateGearboxInputs,
} from '../index';
import { ringStandoffMoment, standoffRingSweep, standoffRingUnit, standoffStations } from '../kernel';
import type { GearboxInputs, InnerPinSupport } from '../types';

const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);

/** Deterministic PRNG (mulberry32) so the property test is reproducible. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** The reference sine-law pin forces at one input angle (the reference unit_case / pin_loads of the lead's scripts). */
function pinLoads(Zw: number, Zp: number, Rw: number, th: number) {
  const Zc = Zp - 1;
  const ux = Math.cos(th), uy = Math.sin(th);
  const rx: number[] = [], ry: number[] = [], tq: number[] = [];
  for (let j = 0; j < Zw; j++) {
    const chi = (2 * Math.PI * j) / Zw - th / Zc;
    rx.push(Rw * Math.cos(chi)); ry.push(Rw * Math.sin(chi));
    tq.push(Rw * (Math.cos(chi) * -uy - Math.sin(chi) * -ux));
  }
  let s2 = 0;
  for (const q of tq) if (q < 0) s2 += q * q;
  const F = tq.map((q) => (q < 0 && s2 > 0 ? (1000 * Math.abs(q)) / s2 : 0));
  return { rx, ry, Px: F.map((f) => f * ux), Py: F.map((f) => f * uy) };
}

// name, Zp, discs, Rw, clamped, pinned, cantilever unit (F_in_unit * arm) or null
const REF: [string, number, number, number, number, number, number | null][] = [
  ['J2 85/e1.3 1 disc', 18, 1, 32.9, 40.336879, 55.075355, 74.468085],
  ['J2 85/e1.6 2 discs', 18, 2, 32.3, 51.031442, 93.531433, 217.234262],
  ['J3 70/e1.07 1 disc', 18, 1, 35 - 1.07 - 2.5 - (5 + 2.14) / 2 - 2, 51.317994, 70.0688, null],
  ['J1 60/e0.92 1 disc', 18, 1, 30 - 0.92 - 2.5 - (5 + 1.84) / 2 - 2, 62.716604, 85.632286, null],
];

describe('tied standoff moment: lead reference values (Zw 6, L 6.35, gap 0.5, ratio 17, nth 240)', () => {
  for (const [name, Zp, discs, Rw, clamped, pinned, cant] of REF) {
    it(name, () => {
      const s = standoffRingSweep(6, Zp, 240, discs, 6.35, 0.5, Rw);
      expect(rel(s.clamped, clamped), 'clamped').toBeLessThan(1e-6);
      expect(rel(s.pinned, pinned), 'pinned').toBeLessThan(1e-6);
      const c = standoffRingUnit(6, Zp, 240, discs, 6.35, 0.5, Rw);
      expect(rel(c.clamped, clamped), 'cached clamped').toBeLessThan(1e-6);
      expect(rel(c.pinned, pinned), 'cached pinned').toBeLessThan(1e-6);
      if (cant !== null) {
        const arm = 0.5 + (discs - 1) * (6.35 + 0.5) + 6.35 / 2;
        expect(rel((4000 / (6 * Rw)) * arm, cant), 'cantilever unit').toBeLessThan(1e-6);
      }
    });
  }

  it('the engine reports the same unit moments and scales them by Kc * T_des * share / Z', () => {
    for (const [id, Rw, clamped, pinned] of [['J2', 32.3, 51.031442, 93.531433], ['J3', 25.86, 51.317994, 70.0688]] as const) {
      const r = checkGearbox(PRESETS[id]);
      expect(r.derived.Rw).toBeCloseTo(Rw, 9);
      expect(rel(r.unit.MRingClamped, clamped)).toBeLessThan(1e-6);
      expect(rel(r.unit.MRingPinned, pinned)).toBeLessThan(1e-6);
      const inp = PRESETS[id];
      const k = (inp.Kc * inp.Tdes * r.derived.share) / innerPinSectionModulus(inp.innerPin, inp.rw);
      expect(rel(r.loads.standoffBendingRingClamped, clamped * k)).toBeLessThan(1e-6);
      expect(rel(r.loads.standoffBendingRingPinned, pinned * k)).toBeLessThan(1e-6);
    }
  });
});

describe('tied standoff moment: properties', () => {
  it('clamped <= pinned <= cantilever unit at every theta (random geometries)', () => {
    const rnd = rng(20261001);
    let n = 0;
    for (let c = 0; c < 300; c++) {
      const Zw = 3 + Math.floor(rnd() * 10);           // 3..12
      const Zp = 8 + Math.floor(rnd() * 23);           // 8..30
      const discs = rnd() < 0.5 ? 1 : 2;
      const L = 2 + rnd() * 13;
      const gap = rnd() * 2;
      const Rw = 5 + rnd() * 60;
      const nth = 240;
      const s = standoffRingSweep(Zw, Zp, nth, discs, L, gap, Rw, true);
      const arm = gap + (discs - 1) * (L + gap) + L / 2;
      const cant = (4000 / (Zw * Rw)) * arm;
      for (let t = 0; t < nth; t++) {
        const ctx = `Zw ${Zw} Zp ${Zp} discs ${discs} L ${L} gap ${gap} Rw ${Rw} t ${t}`;
        expect(s.clampedTheta![t], ctx).toBeLessThanOrEqual(s.pinnedTheta![t] * (1 + 1e-12) + 1e-12);
        expect(s.pinnedTheta![t], ctx).toBeLessThanOrEqual(cant * (1 + 1e-12));
        n++;
      }
      expect(s.clamped).toBe(Math.max(...s.clampedTheta!));
      expect(s.pinned).toBe(Math.max(...s.pinnedTheta!));
    }
    expect(n).toBe(300 * 240);
  });

  it('the fast sweep equals the general closed form at every theta', () => {
    const rnd = rng(7);
    for (let c = 0; c < 40; c++) {
      const Zw = 3 + Math.floor(rnd() * 10), Zp = 8 + Math.floor(rnd() * 23), discs = rnd() < 0.5 ? 1 : 2;
      const L = 2 + rnd() * 13, gap = rnd() * 2, Rw = 5 + rnd() * 60, nth = 60;
      const s = standoffRingSweep(Zw, Zp, nth, discs, L, gap, Rw, true);
      const { H, a, sign } = standoffStations(discs, L, gap);
      for (let t = 0; t < nth; t++) {
        const p = pinLoads(Zw, Zp, Rw, (2 * Math.PI * t) / nth);
        const loads = a.map((ak, k) => ({ a: ak, Px: p.Px.map((v) => sign[k] * v), Py: p.Py.map((v) => sign[k] * v) }));
        const mc = ringStandoffMoment(p.rx, p.ry, loads, H, 'clamped');
        const mp = ringStandoffMoment(p.rx, p.ry, loads, H, 'pinned');
        expect(Math.abs(s.clampedTheta![t] - mc)).toBeLessThanOrEqual(1e-9 * Math.max(1, mc));
        expect(Math.abs(s.pinnedTheta![t] - mp)).toBeLessThanOrEqual(1e-9 * Math.max(1, mp));
      }
    }
  });

  it('the moment scales exactly as 1/Rw (what the cache and the advisor rely on)', () => {
    const a = standoffRingSweep(7, 19, 240, 2, 9.525, 0.8, 1);
    const b = standoffRingSweep(7, 19, 240, 2, 9.525, 0.8, 23.7);
    expect(rel(b.clamped * 23.7, a.clamped)).toBeLessThan(1e-12);
    expect(rel(b.pinned * 23.7, a.pinned)).toBeLessThan(1e-12);
  });

  it('equal parallel loads give the fixed-guided textbook value max(P a - P a^2/(2H), P a^2/(2H)); pinned gives P a', () => {
    const rnd = rng(42);
    for (let c = 0; c < 50; c++) {
      const Zw = 3 + Math.floor(rnd() * 10);
      const Rw = 5 + rnd() * 40;
      const H = 3 + rnd() * 30;
      const a = rnd() * H;
      const P = 1 + rnd() * 500;
      const dir = rnd() * 2 * Math.PI;
      const rx: number[] = [], ry: number[] = [];
      for (let j = 0; j < Zw; j++) { rx.push(Rw * Math.cos((2 * Math.PI * j) / Zw)); ry.push(Rw * Math.sin((2 * Math.PI * j) / Zw)); }
      const Px = new Array(Zw).fill(P * Math.cos(dir)), Py = new Array(Zw).fill(P * Math.sin(dir));
      const m = ringStandoffMoment(rx, ry, [{ a, Px, Py }], H, 'clamped');
      const book = Math.max(P * a - (P * a * a) / (2 * H), (P * a * a) / (2 * H));
      expect(rel(m, book), `a ${a} H ${H}`).toBeLessThan(1e-12);
      // with the tips free to rotate, a rigid ring moving with every pin adds nothing: plain cantilever P a
      expect(rel(ringStandoffMoment(rx, ry, [{ a, Px, Py }], H, 'pinned'), P * a)).toBeLessThan(1e-12);
    }
  });
});

describe('inner pin bending check uses the selected support model', () => {
  const J2 = defaultGearboxInputs(); // SPEC J2 85 / e1.3, 1 disc, T 5.85 / 8.8
  const run = (support: InnerPinSupport) => checkGearbox({ ...J2, innerPinSupport: support });

  it('default is the bolted tie ring; SPEC heuristic and cantilever values stay in the result unchanged', () => {
    const r = checkGearbox(J2);
    expect(J2.innerPinSupport).toBe('ringClamped');
    expect(r.innerPinSupport).toBe('ringClamped');
    // SPEC validation numbers (57 / 113 MPa) are kept as fields
    expect(Math.abs(r.loads.standoffBendingTie / 57 - 1)).toBeLessThan(0.02);
    expect(Math.abs(r.loads.standoffBendingCantilever / 113 - 1)).toBeLessThan(0.02);
    const Z = innerPinSectionModulus(J2.innerPin, J2.rw);
    const sc = (40.336879 * J2.Kc * J2.Tdes) / Z, sp = (55.075355 * J2.Kc * J2.Tdes) / Z;
    expect(rel(r.loads.standoffBendingRingClamped, sc)).toBeLessThan(1e-6);
    expect(rel(r.loads.standoffBendingRingPinned, sp)).toBeLessThan(1e-6);
    const chk = r.checks.find((c) => c.id === 'standoffBending')!;
    expect(chk.value).toBe(r.loads.standoffBendingRingClamped);
    expect(chk.limit).toBe(150);
    expect(chk.basis).toMatch(/^Recessed standoffs \+ bolted tie ring: fixed at the output face, tips tied by a floating ring/);
    expect(chk.info).toEqual({
      ringClamped: r.loads.standoffBendingRingClamped, ringPinned: r.loads.standoffBendingRingPinned,
      cantilever: r.loads.standoffBendingCantilever, specTieRing: r.loads.standoffBendingTie,
    });
    expect(Math.round(sc)).toBe(61);
    expect(Math.round(sp)).toBe(84);
  });

  it('pinned and cantilever models pick their value; nothing else changes', () => {
    const base = run('ringClamped'), pin = run('ringPinned'), cant = run('cantilever');
    const so = (r: typeof base) => r.checks.find((c) => c.id === 'standoffBending')!;
    expect(so(pin).value).toBe(base.loads.standoffBendingRingPinned);
    expect(so(cant).value).toBe(base.loads.standoffBendingCantilever);
    expect(so(pin).basis).toMatch(/tips free to rotate/);
    expect(so(cant).basis).toMatch(/^No tie ring/);
    for (const r of [pin, cant]) {
      for (const c of r.checks) {
        if (c.id === 'standoffBending') continue;
        const b = base.checks.find((x) => x.id === c.id)!;
        expect(c.value, c.id).toBe(b.value);
        expect(c.utilization, c.id).toBe(b.utilization);
      }
    }
  });

  it('solid pins use the same models with the solid section', () => {
    const inp: GearboxInputs = { ...J2, innerPin: { ...J2.innerPin, construction: 'solid' } };
    const r = checkGearbox(inp);
    const Z = (Math.PI * (2 * J2.rw) ** 3) / 32;
    expect(rel(r.checks.find((c) => c.id === 'standoffBending')!.value, (40.336879 * J2.Kc * J2.Tdes) / Z)).toBeLessThan(1e-6);
  });

  it('linear in torque', () => {
    const a = checkGearbox({ ...J2, Tdes: 2 }), b = checkGearbox({ ...J2, Tdes: 6 });
    expect(rel(b.loads.standoffBendingRingClamped, 3 * a.loads.standoffBendingRingClamped)).toBeLessThan(1e-12);
    expect(rel(b.loads.standoffBendingRingPinned, 3 * a.loads.standoffBendingRingPinned)).toBeLessThan(1e-12);
  });

  it('normalizes: older sessions (no field) and garbage get the bolted ring; validation rejects garbage', () => {
    const old = JSON.parse(JSON.stringify(J2));
    delete old.innerPinSupport;
    expect(normalizeGearboxInputs(old).innerPinSupport).toBe('ringClamped');
    expect(normalizeGearboxInputs({ ...old, innerPinSupport: 'banana' }).innerPinSupport).toBe('ringClamped');
    expect(normalizeGearboxInputs({ ...old, innerPinSupport: 7 }).innerPinSupport).toBe('ringClamped');
    expect(normalizeGearboxInputs({ ...old, innerPinSupport: 'ringPinned' }).innerPinSupport).toBe('ringPinned');
    expect(normalizeGearboxInputs({ ...old, innerPinSupport: 'cantilever' }).innerPinSupport).toBe('cantilever');
    // an engine caller that omits it gets the default
    const r = checkGearbox(old as GearboxInputs);
    expect(r.valid).toBe(true);
    expect(r.innerPinSupport).toBe('ringClamped');
    const bad = { ...J2, innerPinSupport: 'banana' as unknown as InnerPinSupport };
    expect(validateGearboxInputs(bad).errors).toContain('Inner pin support must be ringClamped, ringPinned or cantilever');
    expect(checkGearbox(bad).valid).toBe(false);
  });
});
