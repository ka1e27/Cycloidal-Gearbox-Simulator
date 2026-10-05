// DXF of the integral (machined) ring housing, re-parsed with the test reader (CLAUDE.md Addition 12).
import { describe, expect, it } from 'vitest';
import { PRESETS, checkGearbox, type GearboxInputs } from '../../calc';
import { DEFAULT_EXPORT_OPTIONS, buildDxf, buildParts, normalizeExportOptions, validateExportOptions } from '../parts';
import { readDxf, radiusRange } from './dxfReader';

const integral = (g: GearboxInputs): GearboxInputs => ({ ...g, outerPin: { ...g.outerPin, construction: 'integral' } });

function segmentsCross(a: { x: number; y: number }, b: { x: number; y: number }, c: { x: number; y: number }, d: { x: number; y: number }) {
  const o = (p: typeof a, q: typeof a, r: typeof a) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}
function selfIntersects(pts: { x: number; y: number }[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      if (segmentsCross(pts[i], pts[(i + 1) % n], pts[j], pts[(j + 1) % n])) return true;
    }
  }
  return false;
}
/** Teeth = runs of the closed profile inside the radius halfway between the tooth tips and the root circle. */
function countTeeth(pts: { x: number; y: number }[], mid: number): number {
  const inside = pts.map((p) => Math.hypot(p.x, p.y) < mid);
  let k = 0;
  for (let i = 0; i < inside.length; i++) if (inside[i] && !inside[(i - 1 + inside.length) % inside.length]) k++;
  return k;
}

describe('integral ring housing part', () => {
  for (const [name, g] of [['J2', integral(PRESETS.J2)], ['J3', integral(PRESETS.J3)]] as const) {
    it(`${name}: closed simple tooth profile, ${g.Zp} teeth, radii Rp - rr and R_h, outline and 6 mounting holes`, () => {
      const r = checkGearbox(g);
      const ig = r.derived.integral!;
      const res = buildParts(g, {}, name);
      expect(res.ok).toBe(true);
      const housing = res.parts.find((p) => p.id === 'housing')!;
      expect(housing.title).toBe('Ring housing (integral teeth)');
      expect(housing.quantity).toBe(1);
      const dxf = readDxf(buildDxf(res, 'housing').text);
      const polys = dxf.entities.filter((e) => e.type === 'POLYLINE');
      expect(polys).toHaveLength(1);
      const p = polys[0];
      expect(p.closed).toBe(true);
      expect(p.hasSeqend).toBe(true);
      expect(p.layer).toBe('HOUSING');
      const v = p.vertices!;
      expect(v.length).toBe(res.info!.ringPointCount);
      expect(selfIntersects(v)).toBe(false);
      expect(countTeeth(v, (g.D / 2 - g.rr + ig.Rh) / 2)).toBe(g.Zp);
      const [lo, hi] = radiusRange(v);
      expect(lo).toBeCloseTo(g.D / 2 - g.rr, 5); // the file keeps 6 decimals
      expect(hi).toBeCloseTo(ig.Rh, 5);
      expect(res.info!.ringRoot).toBeCloseTo(ig.Rh, 9);
      // outline at the housing OD, 6 holes of 3.4 mm on the mid-wall circle
      const circles = dxf.entities.filter((e) => e.type === 'CIRCLE');
      const outline = circles.filter((c) => Math.abs(c.r! - r.derived.housingOD / 2) < 1e-6);
      expect(outline).toHaveLength(1);
      const holes = circles.filter((c) => Math.abs(c.r! - 1.7) < 1e-6);
      expect(holes).toHaveLength(6);
      const bc = (ig.Rh + r.derived.housingOD / 2) / 2;
      for (const h of holes) expect(Math.hypot(h.cx!, h.cy!)).toBeCloseTo(bc, 6);
      // notes: the label, quantity and thickness
      const texts = dxf.entities.filter((e) => e.type === 'TEXT').map((e) => e.text ?? '');
      expect(texts.some((t) => t.startsWith('RING HOUSING (INTEGRAL TEETH)') && t.endsWith('make 1'))).toBe(true);
      const thick = ig.toothLength + 2 * g.gap;
      expect(texts.some((t) => t.includes(`thickness ${thick.toFixed(2)}`))).toBe(true);
    });
  }

  it('mounting holes are editable (count 0 removes them) and validated', () => {
    const g = integral(PRESETS.J2);
    const none = buildParts(g, { housingHoleCount: 0 });
    const circ = readDxf(buildDxf(none, 'housing').text).entities.filter((e) => e.type === 'CIRCLE');
    expect(circ).toHaveLength(1);
    const eight = buildParts(g, { housingHoleCount: 8, housingHoleDia: 2.5 });
    expect(readDxf(buildDxf(eight, 'housing').text).entities.filter((e) => e.type === 'CIRCLE' && Math.abs(e.r! - 1.25) < 1e-9)).toHaveLength(8);
    expect(validateExportOptions({ ...DEFAULT_EXPORT_OPTIONS, housingHoleCount: 2.5 }).housingHoleCount).toBeTruthy();
    expect(validateExportOptions({ ...DEFAULT_EXPORT_OPTIONS, housingHoleDia: 0 }).housingHoleDia).toBeTruthy();
    expect(normalizeExportOptions({}).housingHoleCount).toBe(6);
    expect(normalizeExportOptions({ housingHoleDia: 4 }).housingHoleDia).toBe(4);
  });

  it('the pin sheet has no outer pins and the all-parts sheet still lays out', () => {
    const g = integral(PRESETS.J3);
    const res = buildParts(g, {}, 'J3');
    const pins = res.parts.find((p) => p.id === 'pins')!;
    expect(pins.quantity).toBe(g.Zw);
    expect(pins.summary.some((s) => /bushing|Outer pin/i.test(s))).toBe(false);
    const all = readDxf(buildDxf(res, 'all').text);
    expect(all.endsWithEof).toBe(true);
    expect(all.entities.filter((e) => e.type === 'POLYLINE' && e.layer === 'HOUSING')).toHaveLength(1);
  });

  it('bolt + bushing housings are unchanged: two pin plates', () => {
    const res = buildParts(PRESETS.J2);
    const h = res.parts.find((p) => p.id === 'housing')!;
    expect(h.quantity).toBe(2);
    expect(h.title).toBe('Ring-pin housing plate');
    expect(res.info!.ringRoot).toBeNull();
  });
});
