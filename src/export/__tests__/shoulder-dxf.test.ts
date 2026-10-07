// DXF of a shoulder bolt ring: reamed shoulder holes in one plate, tap-drill holes in the far plate, and the notes.
import { describe, expect, it } from 'vitest';
import { PRESETS, toleranceOf, type GearboxInputs } from '../../calc';
import { buildDxf, buildParts } from '../parts';
import { readDxf } from './dxfReader';

const shoulder = (g: GearboxInputs, dia: number): GearboxInputs => ({ ...g, rr: dia / 2, outerPin: { ...g.outerPin, construction: 'shoulderBolt' } });

describe('shoulder bolt housing plates', () => {
  for (const [dia, thread, tap] of [[6, 'M5', 4.2], [6.35, '#10-24', 3.797]] as const) {
    it(`J2, ${dia} mm shoulder: ${PRESETS.J2.Zp} reamed holes + ${PRESETS.J2.Zp} tap holes for ${thread}`, () => {
      const g = shoulder(PRESETS.J2, dia);
      expect(toleranceOf(g).holePlay).toBe(0.005);
      const res = buildParts(g, {}, 'J2');
      expect(res.ok).toBe(true);
      const housing = res.parts.find((p) => p.id === 'housing')!;
      expect(housing.quantity).toBe(2);
      const dxf = readDxf(buildDxf(res, 'housing').text);
      const circles = dxf.entities.filter((e) => e.type === 'CIRCLE' && e.layer === 'HOUSING');
      const near = (a: number, b: number) => Math.abs(a - b) < 1e-4;
      // shoulder + reamed allowance 0.01 mm (2 x the reamed hole play), on the pin circle of plate 1 (centre 0, 0)
      const reamed = circles.filter((c) => near(2 * c.r!, dia + 0.01));
      expect(reamed).toHaveLength(g.Zp);
      for (const c of reamed) expect(Math.hypot(c.cx!, c.cy!)).toBeCloseTo(g.D / 2, 4);
      const taps = circles.filter((c) => near(2 * c.r!, tap));
      expect(taps).toHaveLength(g.Zp);
      const off = taps[0].cx! - (g.D / 2); // plate 2 centre: tap hole 0 sits at +x
      for (const c of taps) expect(Math.hypot(c.cx! - off, c.cy!)).toBeCloseTo(g.D / 2, 4);
      expect(off).toBeGreaterThan(0);
      // two outlines
      const outlines = circles.filter((c) => c.r! > g.D / 2 + 1);
      expect(outlines).toHaveLength(2);
      const text = dxf.entities.filter((e) => e.type === 'TEXT').map((e) => e.text).join('\n');
      expect(text).toContain(`Far plate: tap for ${thread}`);
      expect(text).toContain('set plate spacing with the housing ring, not the shoulder length');
      expect(housing.summary.some((s) => s.includes('ream'))).toBe(true);
      // the pins sheet lists the shoulder bolts
      const pins = res.parts.find((p) => p.id === 'pins')!;
      expect(pins.summary.some((s) => s.includes('Shoulder bolt') && s.includes(thread) && s.includes(`make ${g.Zp}`))).toBe(true);
      expect(pins.summary.some((s) => /bushing/i.test(s) && !/no bushing/i.test(s))).toBe(false);
      expect(pins.quantity).toBe(g.Zp + g.Zw);
    });
  }

  it('a drilled hole play gives a warning to ream', () => {
    const g = shoulder(PRESETS.J3, 5);
    const res = buildParts({ ...g, tolerance: { ...toleranceOf(g), holePlay: 0.1 } }, {}, 'J3');
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => /reamed holes/.test(w))).toBe(true);
  });
});
