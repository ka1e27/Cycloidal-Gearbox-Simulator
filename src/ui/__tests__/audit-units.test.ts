// Units audit: exact factors, display policy (zeros kept, inch decimals), typed-input round trips, text
// localisation idempotence, stock-thickness mapping and "the export file stays SI".
import { describe, expect, it } from 'vitest';
import {
  BEARING_NOTE, DISC_STOCK_METAL, DISC_STOCK_POLYMER, MATERIALS, POLYMER_WARNING_LINES, SUPPLIER_DATA_NOTE,
  checkGearbox, deriveGeometry, presetInputs,
} from '../../calc';
import { parseNumberText } from '../components/NumberField';
import { DXF_HELP, HELP, LOCK_HELP, STEP_HINTS } from '../help';
import { PLAIN } from '../plain';
import { defaultSession, exportSession } from '../session';
import {
  FACTORS, IMPERIAL, METRIC, QUANTITIES, UNIT_OPTIONS, fromDisplay, formatQty, inchFraction, inchLengthDecimals, inputText,
  localizeText, makeU, toDisplay, type Quantity, type UnitPrefs,
} from '../units';

const ALL_CONVERTED: UnitPrefs = { length: 'in', mass: 'lb', force: 'lbf', torque: 'lbf·ft', stress: 'psi' };
const ODD: UnitPrefs = { length: 'in', mass: 'kg', force: 'N', torque: 'lbf·in', stress: 'ksi' };

describe('audit: factors are the exact definitions', () => {
  const rel = (a: number, b: number) => Math.abs(a - b) / Math.abs(b);
  it('matches every defined constant', () => {
    expect(FACTORS.length.in).toBe(25.4);
    expect(FACTORS.mass.oz).toBe(28.349523125);
    expect(FACTORS.mass.lb).toBe(453.59237);
    expect(FACTORS.mass.kg).toBe(1000);
    expect(FACTORS.force.lbf).toBe(4.4482216152605);
    expect(rel(FACTORS.torque['lbf·in'], 0.112984829027617)).toBeLessThan(1e-14);
    expect(rel(FACTORS.torque['lbf·ft'], 1.3558179483314)).toBeLessThan(1e-13);
    expect(rel(FACTORS.stress.ksi, 6.894757293168)).toBeLessThan(1e-12);
    expect(rel(FACTORS.stress.psi, 0.006894757293168)).toBeLessThan(1e-12);
    // internal consistency: 1 lbf*ft = 12 lbf*in, 1 ksi = 1000 psi, 1 lb = 16 oz
    expect(rel(FACTORS.torque['lbf·ft'], 12 * FACTORS.torque['lbf·in'])).toBeLessThan(1e-15);
    expect(rel(FACTORS.stress.ksi, 1000 * FACTORS.stress.psi)).toBeLessThan(1e-15);
    expect(rel(FACTORS.mass.lb, 16 * FACTORS.mass.oz)).toBeLessThan(1e-9);
  });

  it('every quantity has a factor of exactly 1 for its SI unit and the option lists agree', () => {
    for (const q of QUANTITIES) {
      expect(Object.keys(FACTORS[q]).sort()).toEqual([...UNIT_OPTIONS[q]].sort());
      expect(FACTORS[q][METRIC[q]]).toBe(1);
    }
  });

  it('spec conversions from the lead brief', () => {
    expect(toDisplay('stress', 497, IMPERIAL)).toBeCloseTo(72.08, 2);
    expect(toDisplay('force', 357, IMPERIAL)).toBeCloseTo(80.26, 2);
    expect(toDisplay('length', 32.9, IMPERIAL)).toBeCloseTo(1.2953, 4);
    expect(toDisplay('torque', 5.85, IMPERIAL)).toBeCloseTo(51.78, 2);
    expect(toDisplay('mass', 250, IMPERIAL)).toBeCloseTo(8.818, 3);
  });
});

describe('audit: display policy (lead request: keep zeros, inch lengths 3 decimals)', () => {
  const L = (mm: number, o = {}) => formatQty('length', mm, IMPERIAL, { unit: true, ...o });

  it('inch lengths are always 3 decimals, 4 below 0.1 in, whatever dp the caller asks for', () => {
    expect(L(32.9, { dp: 1 })).toBe('1.295 in');
    expect(L(98, { dp: 1 })).toBe('3.858 in');
    expect(L(25.4, { dp: 0 })).toBe('1.000 in');
    expect(L(33, { dp: 0 })).toBe('1.299 in');
    expect(L(101.6, { dp: 0, fixed: true })).toBe('4.000 in');
    expect(L(101.6, { dp: 0, trim: true })).toBe('4.000 in'); // inch lengths never trim
    expect(L(25.4 * 1.3, { dp: 1 })).toBe('1.300 in'); // the lead's "1.3 in" example
    expect(L(0)).toBe('0.000 in');
    expect(L(1.3, { dp: 2 })).toBe('0.0512 in'); // eccentricity: 3 significant figures
    expect(L(0.3)).toBe('0.0118 in');
    expect(L(2)).toBe('0.0787 in');
    expect(L(2.54)).toBe('0.1000 in'.replace('0.1000', '0.100')); // exactly 0.100 -> 3 decimals
    expect(L(1.3, { dp: 3 })).toBe('0.0512 in');
    expect(inchLengthDecimals(0.0999, 2)).toBe(4);
    expect(inchLengthDecimals(0.1, 2)).toBe(3);
    expect(inchLengthDecimals(5, 3)).toBe(4); // a caller that asks for mm dp 3 gets inch dp 4
  });

  it('other read-outs keep their zeros too', () => {
    expect(formatQty('length', 98, METRIC, { dp: 1, unit: true })).toBe('98.0 mm');
    expect(formatQty('length', 1.3, METRIC, { dp: 2, unit: true })).toBe('1.30 mm');
    expect(formatQty('torque', 5.85, METRIC, { unit: true })).toBe('5.85 N·m');
    expect(formatQty('torque', 6, METRIC, { unit: true })).toBe('6.00 N·m');
    expect(formatQty('force', 177, IMPERIAL, { dp: 0, unit: true })).toBe('39.8 lbf');
    expect(formatQty('force', 4.4482216152605 * 40, IMPERIAL, { dp: 0, unit: true })).toBe('40.0 lbf');
    expect(formatQty('stress', 6.894757293168361 * 72, IMPERIAL, { dp: 0, unit: true })).toBe('72.0 ksi');
    expect(formatQty('mass', 28.349523125 * 5, IMPERIAL, { dp: 0, unit: true })).toBe('5.0 oz');
    expect(formatQty('mass', 250, METRIC, { dp: 0, unit: true })).toBe('250 g');
    // opt-out for echoes of typed numbers and prose
    expect(formatQty('mass', 250, METRIC, { dp: 1, trim: true, unit: true })).toBe('250 g');
    expect(formatQty('mass', 80.5, METRIC, { dp: 1, trim: true, unit: true })).toBe('80.5 g');
  });

  it('non-finite values never print as NaN', () => {
    for (const q of QUANTITIES) for (const x of [NaN, Infinity, -Infinity, null, undefined]) {
      expect(formatQty(q, x as number, ALL_CONVERTED, { unit: true })).toBe('—');
    }
  });

  it('negative zero and tiny rounding noise print as 0', () => {
    expect(formatQty('torque', -1e-12, METRIC)).toBe('0.00');
    expect(formatQty('length', -1e-9, IMPERIAL, { unit: true })).toBe('0.000 in');
  });

  it('fractions keep their zeros and map to the right millimetres', () => {
    expect(inchFraction(12.7)).toBe('1/2"');
    expect(inchFraction(25.4)).toBe('1"');
    expect(inchFraction(4)).toBe('0.157"');
    expect(inchFraction(5)).toBe('0.197"');
    expect(inchFraction(25.4 * 1.5)).toBe('1 1/2"'.replace('1 1/2"', '3/2"'));
    const want: Record<number, string> = { 3.175: '1/8"', 4.76: '3/16"', 6.35: '1/4"', 9.525: '3/8"', 12.7: '1/2"' };
    for (const s of DISC_STOCK_METAL) expect(inchFraction(s), `${s} mm`).toBe(want[s]);
    // each fraction really is that many inches (within the catalogue rounding of 4.76 vs 4.7625)
    for (const s of DISC_STOCK_METAL) {
      const [n, d] = want[s].replace('"', '').split('/').map(Number);
      expect(Math.abs(s - (25.4 * n) / d)).toBeLessThan(0.005);
    }
    // polymer stock is shown as decimal inches (no fractions)
    for (const s of DISC_STOCK_POLYMER) expect(inchFraction(s)).toMatch(/^\d\.\d{3}"$/);
  });
});

describe('audit: typed input converts to SI exactly once and does not drift', () => {
  const cases: [Quantity, number[]][] = [
    ['length', [0, 1.3, 2, 6.35, 32.9, 85, 150]],
    ['mass', [0, 80, 250, 700, 2667]],
    ['force', [0, 585, 1380, 5600]],
    ['torque', [0, 0.3, 1, 5.85, 8.8]],
    ['stress', [0, 276, 460.9, 640, 69000, 200000]],
  ];
  it('text -> SI -> text is stable for every unit, and the SI value moves only by display rounding', () => {
    for (const [q, values] of cases) {
      for (const unit of UNIT_OPTIONS[q]) {
        const p = { ...METRIC, [q]: unit } as UnitPrefs;
        for (const si of values) {
          const text1 = inputText(q, si, p);
          const typed = parseNumberText(text1);
          expect(typeof typed, `${q} ${unit} ${si} -> "${text1}"`).toBe('number');
          const si1 = fromDisplay(q, typed as number, p); // what NumberField commits: exactly one conversion
          // the committed value is within half a displayed unit of the original
          const dispStep = Math.pow(10, -(text1.split('.')[1]?.length ?? 0)) * FACTORS[q][unit];
          expect(Math.abs(si1 - si), `${q} ${unit} ${si}`).toBeLessThanOrEqual(dispStep * 0.5000001);
          // display of the committed value is the same text (no drift on the next render)
          expect(inputText(q, si1, p), `${q} ${unit} ${si}`).toBe(text1);
          // a second commit of the displayed text changes nothing
          const si2 = fromDisplay(q, parseNumberText(inputText(q, si1, p)) as number, p);
          expect(si2).toBe(si1);
        }
      }
    }
  });

  it('metric typing is exact (no conversion noise at all)', () => {
    for (const [q, values] of cases) {
      for (const si of values) {
        const t = inputText(q, si, METRIC);
        expect(fromDisplay(q, parseNumberText(t) as number, METRIC)).toBe(si);
      }
    }
  });

  it('a typed inch value converts to the exact SI value', () => {
    expect(fromDisplay('length', 3.346, IMPERIAL)).toBeCloseTo(84.9884, 10);
    expect(fromDisplay('length', 0.0512, IMPERIAL)).toBeCloseTo(1.30048, 10);
    expect(fromDisplay('torque', 51.78, IMPERIAL)).toBeCloseTo(5.85, 3);
    expect(fromDisplay('force', 100, IMPERIAL)).toBeCloseTo(444.82216152605, 10);
    expect(fromDisplay('stress', 40, IMPERIAL)).toBeCloseTo(275.79, 2);
  });

  it('eccentricity typed in inches reaches the engine in mm: K1 = e*Zp/Rp uses SI', () => {
    const base = presetInputs('J2');
    const eIn = 0.0512;
    const e = fromDisplay('length', eIn, IMPERIAL);
    const g = deriveGeometry({ ...base, e });
    expect(g.K1).toBeCloseTo((e * base.Zp) / (base.D / 2), 12);
    expect(g.K1).toBeCloseTo((1.30048 * 18) / 42.5, 9);
    // never e*Zp/Rp with e in inches
    expect(g.K1).toBeGreaterThan(0.5);
    const r = checkGearbox({ ...base, e, discs: 1, Treq: 5.85, Tdes: 8.8 });
    expect(r.valid).toBe(true);
  });

  it('number parsing: blank, letters, signs, exponents, comma decimals', () => {
    expect(parseNumberText('')).toBeNull();
    expect(parseNumberText('   ')).toBeNull();
    for (const bad of ['abc', '1.2.3', '--1', '1e', 'NaN', 'Infinity', '1e999', '0x10', '1 2', '€5', '1,234.5', '.', '-', '+']) {
      expect(parseNumberText(bad), bad).toBeUndefined();
    }
    expect(parseNumberText('1,5')).toBe(1.5);
    expect(parseNumberText('-3')).toBe(-3);
    expect(parseNumberText('+3.')).toBe(3);
    expect(parseNumberText('.5')).toBe(0.5);
    expect(parseNumberText('1e-3')).toBe(0.001);
  });
});

describe('audit: text localisation is safe to apply twice and leaves no metric numbers behind', () => {
  const samples: string[] = [
    ...[HELP, LOCK_HELP, DXF_HELP].flatMap((m) => Object.values(m)).flatMap((h) => [h.what, h.why, h.up, h.down, h.typical, h.formula].map((t) => t ?? '')),
    ...Object.values(STEP_HINTS),
    ...Object.values(PLAIN).flatMap((p) => [p.problem, p.fix]),
    ...MATERIALS.map((m) => m.note),
    SUPPLIER_DATA_NOTE, BEARING_NOTE, ...POLYMER_WARNING_LINES,
    'E 200 GPa, ν 0.30: the SPEC contact pair (E* = 57,259 MPa on 6061-T6).',
    'Minimum convex profile radius of curvature must stay above 0.3 mm',
    'Rw override leaves only 1.50 mm between the holes and the lobe root.',
    'Sweeps D from 30 to 120 mm and K1 from 0.40 to 0.85 for your current loads (score ≤ 1).',
    'E must be > 0 MPa', 'density must be > 0 g/cm3', 'T_des floor must be >= 0 N*m', 'Payload must be >= 0 g',
    'The default masses were chosen to give roughly the SPEC torques at J2 (5.85 N·m) and J3 (2.25 N·m).',
  ];
  for (const prefs of [IMPERIAL, ALL_CONVERTED, ODD]) {
    it(`idempotent in ${prefs.length}/${prefs.mass}/${prefs.force}/${prefs.torque}/${prefs.stress}`, () => {
      for (const s of samples) {
        const once = localizeText(s, prefs);
        expect(localizeText(once, prefs), s).toBe(once);
      }
    });
  }

  it('metric text is untouched, including GPa', () => {
    for (const s of samples) expect(localizeText(s, METRIC), s).toBe(s);
  });

  it('converts GPa, ranges and thousands separators correctly', () => {
    expect(localizeText('E 200 GPa', IMPERIAL)).toBe('E 29,007.5 ksi');
    expect(localizeText('E 200 GPa', { ...METRIC, stress: 'psi' })).toBe('E 29,007,548 psi');
    expect(localizeText('Aluminum 69,000 MPa, steel about 200,000 MPa', IMPERIAL)).toBe('Aluminum 10,007.6 ksi, steel about 29,007.5 ksi');
    expect(localizeText('30 to 120 mm', IMPERIAL)).toBe('1.181 to 4.724 in');
    expect(localizeText('1.5 N·m', ALL_CONVERTED)).toBe('1.11 lbf·ft'); // 1.5 / 1.3558 = 1.1063, 2 dp
    expect(localizeText('250 g payload', { ...METRIC, mass: 'kg' })).toBe('0.25 kg payload');
    expect(localizeText('250 g payload', { ...METRIC, mass: 'lb' })).toBe('0.5512 lb payload');
    expect(localizeText('4 mm', IMPERIAL)).toBe('0.157 in');
    expect(localizeText('25.4 mm', IMPERIAL)).toBe('1.000 in');
  });

  it('does not mistake other words, designations or unit-less numbers for quantities', () => {
    const keep = [
      'M3 bolt, 61800 bearing, TMC2209', 'K1 0.40 to 0.85', '18 gives 17:1', 'Density 2.70 g/cm³', 'at 300 rpm for 2,000 h',
      '10×19×5 mm'.replace('mm', 'size'), 'Zp 12 to 26', '55% of the torque', '180° out of phase', 'rad/s²', 'N1', '5 gap', '5 g/s',
    ];
    for (const s of keep) expect(localizeText(s, ALL_CONVERTED), s).toBe(s);
  });
});

describe('audit: units are display-only, the stored and exported session is SI', () => {
  it('export has no unit preferences and unchanged SI numbers', () => {
    const s = defaultSession();
    s.units = { ...IMPERIAL };
    s.arm.payload_g = 250;
    s.gearboxes.J2.D = 85;
    const txt = exportSession(s);
    const o = JSON.parse(txt);
    expect(o.units).toBeUndefined();
    expect(o.arm.payload_g).toBe(250);
    expect(o.arm.joints[1].length_mm).toBe(230);
    expect(o.gearboxes.J2.D).toBe(85);
    expect(o.gearboxes.J2.e).toBe(1.6);
    expect(o.gearboxes.J2.Treq).toBe(5.85);
    expect(o.gearboxes.J2.discMaterial.E).toBe(69000);
    expect(o.gearboxes.J2.outerPin.boltYield).toBe(640);
    expect(o.note).toMatch(/SI/);
    // identical export in metric
    const m = defaultSession();
    const a = JSON.parse(exportSession(m));
    delete a.exportedAt; delete o.exportedAt;
    expect(o).toEqual(a);
  });

  it('makeU: a quantity is converted by its own factor only', () => {
    const u = makeU(ALL_CONVERTED);
    // stress is not a force: 100 MPa in psi, not lbf
    expect(u.f('stress', 100, { dp: 0 })).toBe('14,503.8'.replace('14,503.8', '14,504'));
    expect(u.f('force', 100, { dp: 0 })).toBe('22.5');
    expect(u.f('length', 100, { dp: 0 })).toBe('3.937');
    // a radius is a length (same factor as a diameter)
    expect(u.toDisplay('length', 2.5) * 2).toBeCloseTo(u.toDisplay('length', 5), 12);
  });
});
