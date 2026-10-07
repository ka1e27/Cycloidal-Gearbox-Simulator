// DXF of a round outer standoff ring: pockets of the standoff OD (or clearance holes only), the notes and the pins sheet.
import { describe, expect, it } from 'vitest';
import { OUTER_STANDOFF_OPTIONS, PRESETS, toleranceOf, type GearboxInputs } from '../../calc';
import { buildDxf, buildParts, normalizeExportOptions, validateExportOptions } from '../parts';
import { readDxf } from './dxfReader';

const standoff = (g: GearboxInputs, id: string, pocketLocated = true): GearboxInputs => {
  const o = OUTER_STANDOFF_OPTIONS.find((x) => x.id === id)!;
  return { ...g, rr: o.od / 2, outerPin: { ...g.outerPin, construction: 'standoff', standoffId: id, standoffMaterial: 'stainless', pocketLocated } };
};
const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;

function housingOf(g: GearboxInputs, opts = {}) {
  const res = buildParts(g, opts, 'J2');
  expect(res.ok).toBe(true);
  const housing = res.parts.find((p) => p.id === 'housing')!;
  const dxf = readDxf(buildDxf(res, 'housing', opts).text);
  const circles = dxf.entities.filter((e) => e.type === 'CIRCLE' && e.layer === 'HOUSING');
  const text = dxf.entities.filter((e) => e.type === 'TEXT').map((e) => e.text).join('\n');
  return { res, housing, circles, text };
}

describe('outer standoff housing plates', () => {
  for (const [id, thread, clr] of [['so-m3', 'M3', 3.4], ['so-in-1/4-8', '#8-32', 4.496]] as const) {
    it(`J2, ${id} in pockets: ${PRESETS.J2.Zp} pockets of OD + 0.04 and ${PRESETS.J2.Zp} ${thread} clearance holes`, () => {
      const g = standoff(PRESETS.J2, id);
      const od = 2 * g.rr;
      expect(toleranceOf(g).holePlay).toBe(0.02);
      const { res, housing, circles, text } = housingOf(g);
      expect(housing.quantity).toBe(2);
      // pocket = OD + the pin hole allowance (2 x hole play 0.02)
      const pockets = circles.filter((c) => near(2 * c.r!, od + 0.04));
      expect(pockets).toHaveLength(g.Zp);
      for (const c of pockets) expect(Math.hypot(c.cx!, c.cy!)).toBeCloseTo(g.D / 2, 4);
      const holes = circles.filter((c) => near(2 * c.r!, clr));
      expect(holes).toHaveLength(g.Zp);
      for (let i = 0; i < g.Zp; i++) {
        expect(holes[i].cx!).toBeCloseTo(pockets[i].cx!, 9);
        expect(holes[i].cy!).toBeCloseTo(pockets[i].cy!, 9);
      }
      expect(circles.filter((c) => c.r! > g.D / 2 + 1)).toHaveLength(1);
      expect(text).toContain('1.50 mm deep');
      expect(text).toContain(`for ${thread} screws`);
      expect(text).toContain('Standoff length sets plate spacing (+/-0.1 mm typical); check the axial gaps or set spacing with the housing ring');
      expect(text).toContain('Round standoffs only, not hex');
      // the pins sheet lists the standoffs (hollow section)
      const pins = res.parts.find((p) => p.id === 'pins')!;
      expect(pins.summary.some((s) => s.includes('Outer standoff') && s.includes(thread) && s.includes(`make ${g.Zp}`))).toBe(true);
      expect(pins.summary.some((s) => /bushing/i.test(s) && !/no bushing/i.test(s))).toBe(false);
      expect(pins.quantity).toBe(g.Zp + g.Zw);
    });
  }

  it('clearance holes only when not in pockets', () => {
    const g = standoff(PRESETS.J2, 'so-m3', false);
    expect(toleranceOf(g).holePlay).toBe(0.1);
    const { circles, text } = housingOf(g);
    expect(circles.filter((c) => near(2 * c.r!, 3.4))).toHaveLength(g.Zp);
    expect(circles.filter((c) => near(2 * c.r!, 5 + 0.2))).toHaveLength(0);
    expect(circles.filter((c) => near(2 * c.r!, 5.04))).toHaveLength(0);
    expect(text).toContain('through clearance holes (no pockets)');
    expect(text).not.toContain('deep');
  });

  it('pocket depth: 1/16" in an inch file, or the typed value', () => {
    const g = standoff(PRESETS.J2, 'so-m3');
    expect(housingOf(g, { units: 'in' }).text).toContain('(0.0625 in) deep');
    expect(housingOf(g, { standoffPocketDepth: 2 }).text).toContain('2.00 mm deep');
    expect(normalizeExportOptions({ standoffPocketDepth: 3 }).standoffPocketDepth).toBe(3);
    expect(normalizeExportOptions({ standoffPocketDepth: 'x' }).standoffPocketDepth).toBe(null);
    expect(validateExportOptions(normalizeExportOptions({ standoffPocketDepth: -1 })).standoffPocketDepth).toBeTruthy();
  });

  it('a non-catalog OD warns and draws no screw holes', () => {
    const g = { ...standoff(PRESETS.J2, 'so-m3'), rr: 3.5 };
    const { res, circles } = housingOf(g);
    expect(res.warnings.some((w) => /not a catalog round standoff/.test(w))).toBe(true);
    expect(circles.filter((c) => near(2 * c.r!, 7.04))).toHaveLength(g.Zp);
    expect(circles.filter((c) => c.r! < 3)).toHaveLength(0);
  });
});
