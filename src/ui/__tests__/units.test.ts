import { describe, expect, it } from 'vitest';
import {
  FACTORS,
  IMPERIAL,
  METRIC,
  decimals,
  formatQty,
  fromDisplay,
  inchFraction,
  inputText,
  localizeText,
  makeU,
  niceStep,
  normalizeUnits,
  systemOf,
  toDisplay,
  QUANTITIES,
  UNIT_OPTIONS,
  type Quantity,
  type UnitPrefs,
} from '../units';

describe('unit factors', () => {
  it('uses the exact definitions', () => {
    expect(FACTORS.length.in).toBe(25.4);
    expect(FACTORS.mass.oz).toBe(28.349523125);
    expect(FACTORS.mass.lb).toBe(453.59237);
    expect(FACTORS.mass.kg).toBe(1000);
    expect(FACTORS.force.lbf).toBe(4.4482216152605);
    expect(FACTORS.torque['lbf·in']).toBeCloseTo(0.112984829, 9);
    expect(FACTORS.torque['lbf·ft']).toBeCloseTo(12 * 0.112984829, 8);
    expect(FACTORS.stress.ksi).toBeCloseTo(6.894757293, 9);
    expect(FACTORS.stress.psi).toBeCloseTo(0.006894757293, 12);
  });

  it('converts known values', () => {
    expect(toDisplay('length', 25.4, IMPERIAL)).toBe(1);
    expect(toDisplay('length', 85, IMPERIAL)).toBeCloseTo(3.3464567, 6);
    expect(toDisplay('mass', 453.59237, IMPERIAL)).toBeCloseTo(16, 9);
    expect(toDisplay('force', 4.4482216152605, IMPERIAL)).toBeCloseTo(1, 12);
    expect(toDisplay('torque', 0.112984829, IMPERIAL)).toBeCloseTo(1, 7);
    expect(toDisplay('stress', 6.894757293, IMPERIAL)).toBeCloseTo(1, 9);
    expect(toDisplay('length', 85, METRIC)).toBe(85);
  });

  it('round-trips every quantity in every unit', () => {
    for (const q of QUANTITIES) {
      for (const u of UNIT_OPTIONS[q]) {
        const prefs = { ...METRIC, [q]: u } as UnitPrefs;
        for (const si of [0, 0.0123, 1, 85, 6.35, 1234.5678, 1e5]) {
          const back = fromDisplay(q, toDisplay(q, si, prefs), prefs);
          expect(Math.abs(back - si)).toBeLessThanOrEqual(Math.abs(si) * 1e-12);
        }
      }
    }
  });
});

describe('unit systems', () => {
  it('detects metric, imperial and custom', () => {
    expect(systemOf(METRIC)).toBe('metric');
    expect(systemOf(IMPERIAL)).toBe('imperial');
    expect(systemOf({ ...METRIC, length: 'in' })).toBe('custom');
  });

  it('normalizes garbage to metric', () => {
    expect(normalizeUnits(null)).toEqual(METRIC);
    expect(normalizeUnits('x')).toEqual(METRIC);
    expect(normalizeUnits({ length: 'furlong', mass: 'lb', torque: 5 })).toEqual({ ...METRIC, mass: 'lb' });
    expect(normalizeUnits(JSON.parse(JSON.stringify(IMPERIAL)))).toEqual(IMPERIAL);
  });
});

describe('formatting', () => {
  it('uses sensible precision per unit', () => {
    expect(decimals('length', METRIC)).toBe(2);
    expect(decimals('length', IMPERIAL)).toBe(3);
    expect(decimals('stress', METRIC)).toBe(0);
    expect(decimals('stress', IMPERIAL)).toBe(1);
    expect(decimals('torque', IMPERIAL)).toBe(2);
    expect(decimals('force', IMPERIAL)).toBe(2);
    expect(decimals('mass', IMPERIAL)).toBe(2);
  });

  it('formats values with and without units', () => {
    expect(formatQty('length', 85, METRIC, { unit: true })).toBe('85.00 mm');
    expect(formatQty('length', 85, METRIC, { unit: true, trim: true })).toBe('85 mm');
    expect(formatQty('length', 85, IMPERIAL, { unit: true })).toBe('3.346 in');
    expect(formatQty('stress', 497, METRIC, { dp: 0, unit: true })).toBe('497 MPa');
    expect(formatQty('stress', 497, IMPERIAL, { dp: 0, unit: true })).toBe('72.1 ksi');
    expect(formatQty('torque', 5.85, IMPERIAL, { unit: true })).toBe('51.78 lbf·in');
    expect(formatQty('force', 177, IMPERIAL, { dp: 0, unit: true })).toBe('39.8 lbf');
    expect(formatQty('mass', 154, IMPERIAL, { dp: 0, unit: true })).toBe('5.4 oz');
    expect(formatQty('torque', 5.85, METRIC, { fixed: true })).toBe('5.85');
    expect(formatQty('force', 19, METRIC, { fixed: true })).toBe('19.0');
  });

  it('small values keep about three significant figures', () => {
    expect(formatQty('length', 1.3, IMPERIAL)).toBe('0.0512');
    expect(formatQty('length', 0.5, IMPERIAL)).toBe('0.0197');
    expect(formatQty('length', 0.8625, METRIC)).toBe('0.863');
  });

  it('never prints NaN or Infinity', () => {
    for (const q of QUANTITIES) {
      for (const x of [NaN, Infinity, -Infinity, null, undefined]) {
        expect(formatQty(q, x as number, IMPERIAL, { unit: true })).toBe('—');
      }
    }
  });

  it('input text is rounded for display but the stored SI value is not touched', () => {
    const si = 85;
    const txt = inputText('length', si, IMPERIAL);
    expect(txt).toBe('3.346');
    // typing exactly what is shown stores the converted value, not the original 85
    expect(fromDisplay('length', Number(txt), IMPERIAL)).toBeCloseTo(84.9884, 4);
    // an unedited field keeps the exact SI value: nothing in here mutates it
    expect(si).toBe(85);
    expect(inputText('length', 85, METRIC)).toBe('85');
    expect(inputText('length', null, METRIC)).toBe('');
  });

  it('gives tidy arrow-key steps', () => {
    expect(niceStep('length', 1, METRIC)).toBe(1);
    expect(niceStep('length', 1, IMPERIAL)).toBe(0.05);
    expect(niceStep('length', 0.25, IMPERIAL)).toBe(0.01);
    expect(niceStep('torque', 0.1, IMPERIAL)).toBe(1);
  });

  it('shows stock thickness as fractions', () => {
    expect(inchFraction(3.175)).toBe('1/8"');
    expect(inchFraction(4.76)).toBe('3/16"');
    expect(inchFraction(6.35)).toBe('1/4"');
    expect(inchFraction(9.525)).toBe('3/8"');
    expect(inchFraction(12.7)).toBe('1/2"');
    expect(inchFraction(4)).toBe('0.157"');
  });
});

describe('localizeText', () => {
  it('leaves metric text alone', () => {
    const s = 'D must be > 0 mm and Tdes >= 1.5 N*m';
    expect(localizeText(s, METRIC)).toBe(s);
  });

  it('converts numbers that carry a metric unit', () => {
    expect(localizeText('t_min must be >= 2 mm', IMPERIAL)).toBe('t_min must be >= 0.0787 in');
    expect(localizeText('Payload must be >= 0 g', IMPERIAL)).toBe('Payload must be >= 0 oz');
    expect(localizeText('Typical 60 to 85 mm for this arm', IMPERIAL)).toBe('Typical 2.362 to 3.346 in for this arm');
    expect(localizeText('T_des floor must be >= 0 N*m', IMPERIAL)).toBe('T_des floor must be >= 0 lbf·in');
    expect(localizeText('6061-T6: 276 MPa.', IMPERIAL)).toBe('6061-T6: 40 ksi.');
  });

  it('does not touch densities, gaps or unit-less numbers', () => {
    const s = 'Density 2.70 g/cm³, gap 0.5, K1 0.40 to 0.85, 18 gives 17:1';
    expect(localizeText(s, IMPERIAL)).toBe(s);
  });
});

describe('makeU', () => {
  it('binds the preferences', () => {
    const u = makeU(IMPERIAL);
    expect(u.sym('length')).toBe('in');
    expect(u.fu('length', 25.4)).toBe('1.000 in');
    expect(u.fromDisplay('length', 1)).toBe(25.4);
    const all: Quantity[] = QUANTITIES;
    expect(all.length).toBe(5);
  });
});

describe('tooltip and message texts follow the unit choice', () => {
  it('leaves no metric number-with-unit behind in imperial mode', async () => {
    const { HELP, LOCK_HELP, DXF_HELP } = await import('../help');
    const entries = [
      ...Object.entries(HELP).map(([k, h]) => [`HELP.${k}`, h] as const),
      ...Object.entries(LOCK_HELP).map(([k, h]) => [`LOCK_HELP.${k}`, h] as const),
      ...Object.entries(DXF_HELP).map(([k, h]) => [`DXF_HELP.${k}`, h] as const),
    ];
    for (const [key, h] of entries) {
      for (const text of [h.what, h.why, h.up, h.down, h.typical, h.formula].map((t) => t ?? '')) {
        const out = localizeText(text, IMPERIAL);
        expect(out, `${key}: ${out}`).not.toMatch(/\d\s?(mm|MPa|N·m|N\*m)(?![\w/])/);
        expect(out, `${key}: ${out}`).not.toMatch(/\d\s?(g|N)(?![\w/²³])/);
      }
    }
  });
});
