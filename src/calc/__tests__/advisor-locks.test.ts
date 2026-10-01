// Design Advisor locks (CLAUDE.md Addition 6): locked values come back exactly, free ones are optimized under the
// same constraints, impossible locks give a correct `closest` design and relax hints that are true.
import { describe, expect, it } from 'vitest';
import {
  adviseDesign, adviseDesignAsync, checkGearbox, PRESETS, BEARINGS, INNER_PIN_OPTIONS, OUTER_PIN_OPTIONS,
  validateAdvisorLocks,
} from '../index';
import type { AdvisorDesign, AdvisorLocks, AdvisorOptions, AdvisorProgress, AdvisorResult, GearboxInputs } from '../index';

const strip = (r: unknown) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'elapsedMs' ? 0 : v)));
const J2 = PRESETS.J2;
const J3 = PRESETS.J3;
const TARGET = 0.85;

/** Independent full-resolution check of the exact inputs the UI would apply. */
function assertPasses(d: AdvisorDesign, target = TARGET) {
  const r = checkGearbox(d.inputs);
  expect(r.valid, r.errors.join()).toBe(true);
  for (const c of r.checks) expect(c.utilization, `${c.id} ${c.utilization}`).toBeLessThanOrEqual(target + 1e-9);
  expect(d.maxUtilization).toBeCloseTo(r.maxUtilization, 9);
  expect(d.housingOD).toBeCloseTo(d.inputs.D + 2 * d.inputs.rr + 2 * d.inputs.wall, 9);
}

function timed(label: string, f: () => AdvisorResult): AdvisorResult {
  const t0 = performance.now();
  const r = f();
  const ms = performance.now() - t0;
  const what = r.best
    ? `best housing ${r.best.housingOD.toFixed(1)} mm, util ${r.best.maxUtilization.toFixed(3)}`
    : `no pass; closest util ${r.closest?.maxUtilization.toFixed(3) ?? 'none'} (${r.closest?.governingLabel ?? '-'}); ${r.relaxHints.length} hints`;
  console.log(`[advisor locks timing] ${label}: ${ms.toFixed(0)} ms, ${r.evaluated} evaluated, ${what}`);
  return r;
}

describe('locks: values come back exactly and the rest is optimized', () => {
  const free = adviseDesign(J3);
  const fb = free.best!;

  it('the default run (nothing locked) is unchanged and reports the ratio as the only fixed variable', () => {
    expect(free.locked).toEqual(['Zp']);
    expect(free.closest).toBeNull();
    expect(free.relaxHints).toEqual([]);
    expect(free.maxHousingOD).toBeNull();
    assertPasses(fb);
  });

  it('D (any value, not only whole mm)', () => {
    const r = timed('D=60.37', () => adviseDesign(J3, { locks: { D: 60.37 } }));
    expect(r.best!.D).toBe(60.37);
    expect(r.best!.inputs.D).toBe(60.37);
    assertPasses(r.best!);
    expect(r.locked).toContain('D');
    for (const a of Object.values(r.alternatives)) if (a) expect(a.D).toBe(60.37);
  });

  it('e locked with D free: D is searched on its grid and K1 follows', () => {
    const r = timed('e=1.1', () => adviseDesign(J3, { locks: { e: 1.1 } }));
    const b = r.best!;
    expect(b.e).toBe(1.1);
    expect(Number.isInteger(b.D)).toBe(true);
    expect(b.K1).toBeCloseTo((1.1 * J3.Zp) / (b.D / 2), 12);
    assertPasses(b);
  });

  it('e and D both locked: K1 is derived', () => {
    const r = adviseDesign(J3, { locks: { e: 1.0, D: 70.25 } });
    expect(r.best!.e).toBe(1.0);
    expect(r.best!.D).toBe(70.25);
    expect(r.best!.K1).toBeCloseTo((1.0 * J3.Zp) / (70.25 / 2), 12);
    assertPasses(r.best!);
  });

  it('ratio: a locked Zp wins over ratioVary; free ratio with ratioVary', () => {
    const r = adviseDesign(J3, { ratioVary: true, locks: { Zp: 22 } });
    expect(r.best!.Zp).toBe(22);
    expect(r.best!.ratio).toBe(21);
    expect(r.locked).toContain('Zp');
    assertPasses(r.best!);
    const v = adviseDesign(J3, { ratioVary: true });
    expect(v.locked).not.toContain('Zp');
  });

  it('outer pin: catalog entry and custom OD (+ shank for bolt + bushing)', () => {
    const cat = adviseDesign(J3, { locks: { outerPin: { kind: 'catalog', index: 3 } } }).best!;
    expect(cat.outerPinOD).toBe(OUTER_PIN_OPTIONS[3].od);
    expect(cat.shankDia).toBe(OUTER_PIN_OPTIONS[3].shank);
    expect(cat.outerBolt).toBe(OUTER_PIN_OPTIONS[3].bolt);
    expect(cat.inputs.rr).toBe(OUTER_PIN_OPTIONS[3].od / 2);
    assertPasses(cat);
    const cus = adviseDesign(J3, { locks: { outerPin: { kind: 'custom', od: 5.5, shank: 3.5 } } }).best!;
    expect(cus.outerPinOD).toBe(5.5);
    expect(cus.inputs.rr).toBe(2.75);
    expect(cus.shankDia).toBe(3.5);
    expect(cus.inputs.outerPin.shankDia).toBe(3.5);
    expect(cus.outerCustom).toBe(true);
    assertPasses(cus);
  });

  it('inner pin: catalog entry and custom OD / bore', () => {
    const cat = adviseDesign(J3, { locks: { innerPin: { kind: 'catalog', index: 2 } } }).best!;
    expect(cat.innerPinOD).toBe(INNER_PIN_OPTIONS[2].od);
    expect(cat.innerPinBore).toBe(INNER_PIN_OPTIONS[2].bore);
    assertPasses(cat);
    const cus = adviseDesign(J3, { locks: { innerPin: { kind: 'custom', od: 6, bore: 3 } } }).best!;
    expect(cus.inputs.rw).toBe(3);
    expect(cus.inputs.innerPin.od).toBe(6);
    expect(cus.inputs.innerPin.bore).toBe(3);
    expect(cus.innerCustom).toBe(true);
    assertPasses(cus);
  });

  it('Zw, discs and L (any thickness)', () => {
    const r = timed('Zw=8 discs=2 L=7.3', () => adviseDesign(J3, { locks: { Zw: 8, discs: 2, L: 7.3 } }));
    const b = r.best!;
    expect(b.Zw).toBe(8);
    expect(b.discs).toBe(2);
    expect(b.L).toBe(7.3);
    expect(b.inputs.Zw).toBe(8);
    expect(b.inputs.discs).toBe(2);
    expect(b.inputs.L).toBe(7.3);
    assertPasses(b);
    expect(r.alternatives.oneDisc).toBeNull();
    expect(r.alternatives.twoDisc?.discs).toBe(2);
    const one = adviseDesign(J3, { locks: { discs: 1 } }).best!;
    expect(one.discs).toBe(1);
  });

  it('bearing: catalog entry and custom ID / OD / C / C0', () => {
    const cat = adviseDesign(J3, { locks: { bearing: { kind: 'catalog', index: 5 } } }).best!;
    expect(cat.bearingName).toBe(BEARINGS[5].name);
    expect(cat.inputs.Db).toBe(BEARINGS[5].OD);
    assertPasses(cat);
    const cus = adviseDesign(J3, {
      locks: { bearing: { kind: 'custom', name: 'MyBrg', bore: 12, OD: 22, C: 3000, C0: 1400 } },
    }).best!;
    expect(cus.bearingName).toBe('MyBrg');
    expect(cus.inputs.Db).toBe(22);
    expect(cus.inputs.bearing).toEqual({ name: 'MyBrg', C: 3000, C0: 1400 });
    expect(cus.bearingBore).toBe(12);
    expect(cus.bearingCustom).toBe(true);
    assertPasses(cus);
  });

  it('maximum housing OD is a constraint that is respected', () => {
    const lim = fb.housingOD + 12;
    const r = adviseDesign(J3, { locks: { maxHousingOD: lim } });
    expect(r.best!.housingOD).toBeLessThanOrEqual(lim + 1e-9);
    expect(r.best!.housingOD).toBeCloseTo(fb.housingOD, 9); // the unconstrained optimum already fits
    for (const a of Object.values(r.alternatives)) if (a) expect(a.housingOD).toBeLessThanOrEqual(lim + 1e-9);
    expect(r.maxHousingOD).toBe(lim);
  });

  it('locking most variables to the free answer returns that answer', () => {
    // lock everything except D and e (the free answer's own other values)
    const locks: AdvisorLocks = {
      outerPin: { kind: 'catalog', index: OUTER_PIN_OPTIONS.findIndex((p) => p.od === fb.outerPinOD) },
      innerPin: { kind: 'catalog', index: INNER_PIN_OPTIONS.findIndex((p) => p.od === fb.innerPinOD) },
      Zw: fb.Zw, L: fb.L, discs: fb.discs as 1 | 2,
      bearing: { kind: 'catalog', index: BEARINGS.findIndex((b) => b.name === fb.bearingName) },
    };
    const r = adviseDesign(J3, { locks });
    expect(r.best!.D).toBe(fb.D);
    expect(r.best!.e).toBe(fb.e);
    expect(strip(r.best!.inputs)).toEqual(strip(fb.inputs));
  });

  it('every returned design (alternatives too) passes checkGearbox at full resolution, many lock mixes', () => {
    const mixes: AdvisorLocks[] = [
      { discs: 2 }, { L: 9.525 }, { Zw: 6, discs: 1 }, { D: 80 }, { e: 1.4 }, { bearing: { kind: 'catalog', index: 6 } },
      { D: 75, L: 6.35, discs: 2 }, { outerPin: { kind: 'catalog', index: 4 }, innerPin: { kind: 'catalog', index: 3 } },
    ];
    for (const locks of mixes) {
      const r = adviseDesign(J2, { locks });
      expect(r.valid).toBe(true);
      if (!r.best) continue;
      for (const d of [r.best, r.alternatives.oneDisc, r.alternatives.twoDisc, r.alternatives.lightest, r.alternatives.mostMargin]) {
        if (d) assertPasses(d);
      }
      if (locks.D !== undefined) expect(r.best.D).toBe(locks.D);
      if (locks.e !== undefined) expect(r.best.e).toBe(locks.e);
      if (locks.L !== undefined) expect(r.best.L).toBe(locks.L);
      if (locks.discs !== undefined) expect(r.best.discs).toBe(locks.discs);
      if (locks.Zw !== undefined) expect(r.best.Zw).toBe(locks.Zw);
    }
  });
});

describe('locks: everything locked is just a gearbox check', () => {
  const lockAll = (d: AdvisorDesign): AdvisorLocks => ({
    Zp: d.Zp, D: d.D, e: d.e,
    outerPin: { kind: 'catalog', index: OUTER_PIN_OPTIONS.findIndex((p) => p.od === d.outerPinOD) },
    innerPin: { kind: 'catalog', index: INNER_PIN_OPTIONS.findIndex((p) => p.od === d.innerPinOD) },
    Zw: d.Zw, L: d.L, discs: d.discs as 1 | 2,
    bearing: { kind: 'catalog', index: BEARINGS.findIndex((b) => b.name === d.bearingName) },
  });

  it('equals checkGearbox of those inputs (passing design)', () => {
    const fb = adviseDesign(J3).best!;
    const r = timed('all locked (passing)', () => adviseDesign(J3, { locks: lockAll(fb) }));
    expect(r.best).not.toBeNull();
    expect(r.evaluated).toBe(1);
    const plain = checkGearbox(fb.inputs);
    expect(strip(r.best!.result)).toEqual(strip(plain));
    expect(strip(r.best!.inputs)).toEqual(strip(fb.inputs));
    expect(r.locked.length).toBe(9);
  });

  it('a failing fully locked design returns it as `closest` with the plain check result and no best', () => {
    const inp = { ...J3, Treq: 40, Tdes: 60 };
    const fb = adviseDesign(J3).best!;
    const r = adviseDesign(inp, { locks: lockAll(fb) });
    expect(r.best).toBeNull();
    const plain = checkGearbox({ ...fb.inputs, Treq: 40, Tdes: 60 });
    expect(plain.maxUtilization).toBeGreaterThan(TARGET);
    expect(strip(r.closest!.result)).toEqual(strip(plain));
    expect(r.closest!.governingLabel).toBe(plain.governing!.label);
    // custom values, any numbers: still a plain check
    const cust = adviseDesign(J3, {
      locks: {
        Zp: 18, D: 63.3, e: 1.07,
        outerPin: { kind: 'custom', od: 4.4, shank: 2.9 }, innerPin: { kind: 'custom', od: 5.2, bore: 2.2 },
        Zw: 7, L: 8.1, discs: 1, bearing: { kind: 'custom', name: 'X', OD: 20, C: 2000, C0: 1000, bore: 9 },
      },
    });
    const ref = checkGearbox({
      ...J3, Zp: 18, D: 63.3, e: 1.07, rr: 2.2, rw: 2.6, Zw: 7, L: 8.1, discs: 1, Db: 20,
      RwOverride: null, discShare: null,
      outerPin: { ...J3.outerPin, shankDia: 2.9 }, innerPin: { ...J3.innerPin, od: 5.2, bore: 2.2 },
      bearing: { name: 'X', C: 2000, C0: 1000 },
    });
    const got = (cust.best ?? cust.closest)!;
    expect(strip(got.result)).toEqual(strip(ref));
  });

  it('a geometrically impossible fully locked design explains itself', () => {
    const r = adviseDesign(J3, {
      locks: { Zp: 18, D: 30, e: 1.0, outerPin: { kind: 'catalog', index: 5 }, innerPin: { kind: 'catalog', index: 4 }, Zw: 6, L: 6.35, discs: 1, bearing: { kind: 'catalog', index: 4 } },
    });
    expect(r.valid).toBe(true);
    expect(r.best).toBeNull();
    expect(r.closest).toBeNull();
    expect(r.warnings.join(' ')).toMatch(/do not make a valid gearbox/);
  });
});

describe('locks: locking D to the advisor\'s own answer reproduces the design', () => {
  for (const [name, inp] of [['J2', J2], ['J3', J3]] as const) {
    it(name, () => {
      const free = adviseDesign(inp);
      const b = free.best!;
      const again = adviseDesign(inp, { locks: { D: b.D } });
      expect(strip(again.best)).toEqual(strip(b));
      for (const a of Object.values(again.alternatives)) if (a) expect(a.D).toBe(b.D);
      const viaE = adviseDesign(inp, { locks: { D: b.D, e: b.e } });
      expect(strip(viaE.best!.inputs)).toEqual(strip(b.inputs));
    });
  }
});

describe('locks: unreachable targets give the closest design and verified relax hints', () => {
  // J3 with D locked at 40 mm: the pin circle is too small for the catalog inner pins / bearings
  const small = adviseDesign(J3, { locks: { D: 40 } });
  // J2 loads squeezed into a thin single-disc plate at D = 55: contact stress governs
  const thin = adviseDesign(J2, { locks: { D: 55, L: 3.175, discs: 1 } });
  // cases where releasing a single lock helps
  const hintCases: [string, GearboxInputs, AdvisorLocks, AdvisorResult][] = [
    ['J2 D=55 discs=1', J2, { D: 55, discs: 1 }, adviseDesign(J2, { locks: { D: 55, discs: 1 } })],
    ['J3 D=50 L=4.76 discs=1 Zw=4', J3, { D: 50, L: 4.76, discs: 1, Zw: 4 }, adviseDesign(J3, { locks: { D: 50, L: 4.76, discs: 1, Zw: 4 } })],
    ['J3 D=40', J3, { D: 40 }, small],
  ];

  it('both cases are infeasible and report a closest design with its governing check', () => {
    for (const r of [small, thin]) {
      expect(r.valid).toBe(true);
      expect(r.best).toBeNull();
      expect(r.closest).not.toBeNull();
      const c = r.closest!;
      expect(c.slot).toBe('closest');
      expect(c.maxUtilization).toBeGreaterThan(TARGET);
      expect(c.governingLabel.length).toBeGreaterThan(3);
      expect(strip(c.result)).toEqual(strip(checkGearbox(c.inputs)));
      expect(r.warnings.join(' ')).toMatch(/closest design/);
    }
    expect(small.closest!.D).toBe(40);
    expect(thin.closest!.D).toBe(55);
    expect(thin.closest!.L).toBe(3.175);
    expect(thin.closest!.discs).toBe(1);
  });

  /** Seeded sample of designs inside the locks, checked at full resolution. */
  function sampleMin(inp: GearboxInputs, locks: AdvisorLocks, n: number, seed: number): number {
    let s = seed;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    const pick = <T,>(a: readonly T[]) => a[Math.floor(rnd() * a.length)];
    let min = Infinity;
    for (let i = 0; i < n; i++) {
      const D = locks.D ?? 30 + Math.floor(rnd() * 121);
      const K1 = 0.4 + 0.025 * Math.floor(rnd() * 19);
      const Zp = locks.Zp ?? inp.Zp;
      const e = locks.e ?? (K1 * (D / 2)) / Zp;
      const op = pick(OUTER_PIN_OPTIONS), ip = pick(INNER_PIN_OPTIONS), br = pick(BEARINGS);
      const L = locks.L ?? pick([3.175, 4.76, 6.35, 9.525, 12.7]);
      const g: GearboxInputs = {
        ...inp, Zp, D, e, L, rr: op.od / 2, rw: ip.od / 2, Db: br.OD, Zw: locks.Zw ?? 4 + Math.floor(rnd() * 7),
        discs: locks.discs ?? (rnd() < 0.5 ? 1 : 2), RwOverride: null, discShare: null,
        outerPin: { ...inp.outerPin, shankDia: op.shank }, innerPin: { ...inp.innerPin, od: ip.od, bore: ip.bore },
        bearing: { name: br.name, C: br.C, C0: br.C0 },
      };
      const r = checkGearbox(g);
      if (r.valid && r.maxUtilization < min) min = r.maxUtilization;
    }
    return min;
  }

  it('no sampled design within the locks has a lower max utilization than `closest`', () => {
    const a = sampleMin(J3, { D: 40 }, 2500, 7);
    const b = sampleMin(J2, { D: 55, L: 3.175, discs: 1 }, 2500, 11);
    console.log(`[advisor locks closest] J3 D=40: closest ${small.closest!.maxUtilization.toFixed(4)}, sample min ${a.toFixed(4)}; ` +
      `J2 thin: closest ${thin.closest!.maxUtilization.toFixed(4)}, sample min ${b.toFixed(4)}`);
    expect(small.closest!.maxUtilization).toBeLessThanOrEqual(a + 1e-9);
    expect(thin.closest!.maxUtilization).toBeLessThanOrEqual(b + 1e-9);
  }, 120000);

  it('relax hints are verified true statements', () => {
    for (const [name, inp, locks, r] of hintCases) {
      expect(r.best, name).toBeNull();
      expect(r.relaxHints.length, name).toBeGreaterThan(0);
      for (const h of r.relaxHints) {
        // the design passes at full resolution ...
        assertPasses(h.design);
        // ... keeps every lock except the released one ...
        const kept: [string, number | undefined, number][] = [
          ['D', locks.D, h.design.D], ['L', locks.L, h.design.L], ['discs', locks.discs, h.design.discs], ['Zw', locks.Zw, h.design.Zw],
        ];
        for (const [k, want, got] of kept) if (want !== undefined && h.key !== k) expect(got, `${h.key} hint keeps ${k}`).toBe(want);
        expect(h.text).toMatch(/^(Unlock|Raise)/);
        expect(h.text).toContain(h.value.split(' ')[0]);
        // ... and re-running the advisor with exactly that lock released finds a passing design
        const rel: AdvisorLocks = { ...locks };
        if (h.key !== 'Zp' && h.key !== 'maxHousingOD') delete rel[h.key];
        const re = adviseDesign(inp, { locks: rel, ratioVary: h.key === 'Zp' });
        expect(re.best, `${h.key}: releasing it really gives a design`).not.toBeNull();
        expect(re.best!.housingOD).toBeCloseTo(h.design.housingOD, 6);
      }
      // hints name distinct, currently locked variables
      const keys = r.relaxHints.map((h) => h.key);
      expect(new Set(keys).size).toBe(keys.length);
      for (const k of keys) expect([...r.locked, 'maxHousingOD']).toContain(k);
    }
    console.log('[advisor locks hints]' + hintCases.flatMap(([n, , , r]) => r.relaxHints.map((h) => ' // ' + n + ': ' + h.text)).join(''));
  }, 120000);

  it('a lock that was NOT hinted really does not help on its own', () => {
    for (const [, inp, locks, r] of [...hintCases, ['thin', J2, { D: 55, L: 3.175, discs: 1 }, thin] as [string, GearboxInputs, AdvisorLocks, AdvisorResult]]) {
      const hinted = new Set(r.relaxHints.map((h) => h.key));
      for (const k of r.locked) {
        if (k === 'Zp') continue; // the ratio re-run is the 8x search; covered by the hint test above
        if (hinted.has(k)) continue;
        const rel: AdvisorLocks = { ...locks };
        delete rel[k];
        const re = adviseDesign(inp, { locks: rel, hints: false, closest: false });
        expect(re.best, `${k} was not hinted but releasing it gives a design`).toBeNull();
      }
    }
  }, 120000);

  it('housing limit too small: hint says how far to raise it', () => {
    const fb = adviseDesign(J3).best!;
    const r = adviseDesign(J3, { locks: { maxHousingOD: fb.housingOD - 8 } });
    expect(r.best).toBeNull();
    const h = r.relaxHints.find((x) => x.key === 'maxHousingOD');
    expect(h).toBeDefined();
    expect(h!.design.housingOD).toBeCloseTo(fb.housingOD, 6);
    expect(h!.text).toMatch(/^Raise the housing limit/);
    expect(r.closest!.housingOD).toBeLessThanOrEqual(fb.housingOD - 8 + 1e-9);
  });

  it('the default unlocked impossible case returns a closest design, and hints/closest can be switched off', () => {
    const hard = { ...J3, Treq: 400, Tdes: 600 };
    const r = timed('impossible loads, nothing locked', () => adviseDesign(hard));
    expect(r.best).toBeNull();
    expect(r.closest).not.toBeNull();
    expect(r.warnings.join(' ')).toMatch(/No design/);
    const off = adviseDesign(hard, { closest: false, hints: false });
    expect(off.closest).toBeNull();
    expect(off.relaxHints).toEqual([]);
  }, 60000);
});

describe('locks: validation, determinism, progress, cancel', () => {
  it('rejects nonsense lock values with clear messages (never throws)', () => {
    const bad: AdvisorLocks[] = [
      { Zp: 3 }, { Zp: 18.5 }, { D: -1 }, { D: NaN }, { e: 0 }, { L: 0 }, { Zw: 2 }, { Zw: 2.5 },
      { discs: 3 as unknown as 1 }, { outerPin: { kind: 'catalog', index: 99 } }, { outerPin: { kind: 'custom', od: 0, shank: 3 } },
      { outerPin: { kind: 'custom', od: 5, shank: 0 } }, { innerPin: { kind: 'custom', od: 5, bore: 5 } },
      { bearing: { kind: 'custom', OD: 20, C: 0, C0: 100 } }, { bearing: { kind: 'custom', OD: 20, C: 100, C0: 100, bore: 25 } },
      { maxHousingOD: 0 },
    ];
    for (const locks of bad) {
      const r = adviseDesign(J3, { locks });
      expect(r.valid, JSON.stringify(locks)).toBe(false);
      expect(r.errors.length).toBeGreaterThan(0);
      expect(r.errors[0]).toMatch(/^Locked /);
    }
    expect(validateAdvisorLocks(J3, { D: 60 })).toEqual([]);
    expect(validateAdvisorLocks(J3, undefined)).toEqual([]);
  });

  it('is deterministic with locks, with an infeasible case (closest + hints) included', () => {
    for (const opts of [{ locks: { D: 61.5, discs: 2 as const } }, { locks: { D: 40 } }, { locks: { e: 1.2 }, ratioVary: true }] as AdvisorOptions[]) {
      const a = adviseDesign(J3, opts);
      const b = adviseDesign(J3, opts);
      expect(strip(a)).toEqual(strip(b));
    }
  });

  it('progress is monotonic in [0,1], including the closest and hints phases', () => {
    const seen: AdvisorProgress[] = [];
    adviseDesign(J3, { locks: { D: 40 } }, { onProgress: (p) => seen.push(p) });
    adviseDesign({ ...J3, Treq: 60, Tdes: 90 }, {}, { onProgress: (p) => seen.push(p) });
    const phases = new Set(seen.map((p) => p.phase));
    console.log('[advisor locks] progress phases seen:', [...phases].join(', '));
    for (const run of [seen]) {
      for (const p of run) {
        expect(p.fraction).toBeGreaterThanOrEqual(0);
        expect(p.fraction).toBeLessThanOrEqual(1);
      }
    }
    // each run is monotonic on its own: split where the fraction drops back to the start
    let prev = 0;
    let drops = 0;
    for (const p of seen) {
      if (p.fraction < prev - 1e-12) { drops++; }
      prev = p.fraction;
    }
    expect(drops).toBeLessThanOrEqual(1);
  }, 60000);

  it('can be cancelled in the closest / hints phases (async)', async () => {
    let n = 0;
    const res = await adviseDesignAsync({ ...J3, Treq: 60, Tdes: 90 }, { locks: { D: 45 } }, { shouldCancel: () => ++n > 6 });
    expect(res.cancelled).toBe(true);
    expect(res.best).toBeNull();
    const a = await adviseDesignAsync(J3, { locks: { D: 40 } });
    expect(strip(a)).toEqual(strip(adviseDesign(J3, { locks: { D: 40 } })));
  }, 60000);
});

describe('locks: timings for several lock combinations (logged)', () => {
  const combos: [string, GearboxInputs, AdvisorOptions][] = [
    ['nothing locked (ratio fixed)', J2, {}],
    ['ratio free', J2, { ratioVary: true }],
    ['only e locked, D free', J2, { locks: { e: 1.2 } }],
    ['only D locked', J2, { locks: { D: 70 } }],
    ['L + discs locked', J2, { locks: { L: 9.525, discs: 2 } }],
    ['pins + bearing locked', J2, { locks: { outerPin: { kind: 'catalog', index: 4 }, innerPin: { kind: 'catalog', index: 3 }, bearing: { kind: 'catalog', index: 6 } } }],
    ['D + e locked', J2, { locks: { D: 70, e: 1.3 } }],
    ['7 of 9 locked (D, e free)', J2, { locks: { Zw: 6, L: 9.525, discs: 2, outerPin: { kind: 'catalog', index: 4 }, innerPin: { kind: 'catalog', index: 3 }, bearing: { kind: 'catalog', index: 6 } } }],
    ['infeasible: D=40', J3, { locks: { D: 40 } }],
    ['infeasible: thin plate', J2, { locks: { D: 55, L: 3.175, discs: 1 } }],
  ];
  for (const [label, inp, opts] of combos) {
    it(label, () => {
      const t0 = performance.now();
      const r = timed(label, () => adviseDesign(inp, opts));
      expect(r.valid).toBe(true);
      expect(performance.now() - t0).toBeLessThan(15000);
    }, 60000);
  }
});
