import { describe, expect, it } from 'vitest';
import { PRESETS, createGearboxModel, defaultGearboxInputs, withTolerance, type GearboxInputs } from '../../calc';
import {
  DEFAULT_EXPORT_OPTIONS,
  EXPORT_LAYERS,
  buildDxf,
  buildParts,
  discProfile,
  exportFileName,
  normalizeExportOptions,
  standoffThread,
  validateExportOptions,
  type PartId,
} from '../parts';
import { readDxf, radiusRange, type ReadEntity } from './dxfReader';

const J2 = PRESETS.J2;
const J3 = PRESETS.J3;

function read(inputs: GearboxInputs, id: PartId | 'all', opts = {}) {
  const res = buildParts(inputs, opts, 'J');
  return { res, dxf: readDxf(buildDxf(res, id, opts).text) };
}
/** The profile clearance is a gearbox input now (tolerance.profileClearance, CLAUDE.md Addition 13). */
const pc = (inp: GearboxInputs, c: number) => withTolerance(inp, { profileClearance: c, innerHoleClearance: 0 });
/** The exact SPEC geometry: no profile or inner hole clearance (a gearbox without a spec gets the fitted CNC mill ones). */
const exact = (inp: GearboxInputs) => pc(inp, 0);
const circles = (es: ReadEntity[]) => es.filter((e) => e.type === 'CIRCLE');

function bboxOf(es: ReadEntity[]) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const e of es) {
    const pts = e.type === 'POLYLINE' ? e.vertices! : e.type === 'CIRCLE' ? [{ x: e.cx! - e.r!, y: e.cy! - e.r! }, { x: e.cx! + e.r!, y: e.cy! + e.r! }] : [];
    for (const p of pts) { minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x); minY = Math.min(minY, p.y); maxY = Math.max(maxY, p.y); }
  }
  return { minX, minY, maxX, maxY };
}

describe('disc part', () => {
  it('polyline is closed with 120 points per lobe and radius extremes Rp-e-rr, Rp+e-rr', () => {
    for (const inp of [J2, J3, defaultGearboxInputs()]) {
      const { res, dxf } = read(exact(inp), 'disc');
      const polys = dxf.entities.filter((e) => e.type === 'POLYLINE');
      expect(polys).toHaveLength(1);
      expect(polys[0].closed).toBe(true);
      expect(polys[0].hasSeqend).toBe(true);
      expect(polys[0].vertices).toHaveLength((inp.Zp - 1) * 120);
      expect(res.info!.pointCount).toBe((inp.Zp - 1) * 120);
      const Rp = inp.D / 2;
      const [lo, hi] = radiusRange(polys[0].vertices!);
      const tol = res.info!.chordError + 1e-6;
      expect(Math.abs(lo - (Rp - inp.e - inp.rr))).toBeLessThanOrEqual(tol);
      expect(Math.abs(hi - (Rp + inp.e - inp.rr))).toBeLessThanOrEqual(tol);
      expect(res.info!.chordError).toBeLessThan(0.005);
    }
  });

  it('matches the engine profilePoints exactly at zero clearance', () => {
    const m = createGearboxModel(J2);
    const eng = m.profilePoints(2040)!;
    const mine = discProfile(J2.Zp, J2.D / 2, J2.e, J2.rr, 2040).points;
    expect(mine).toHaveLength(eng.length);
    let max = 0;
    for (let i = 0; i < eng.length; i++) max = Math.max(max, Math.hypot(eng[i].x - mine[i].x, eng[i].y - mine[i].y));
    expect(max).toBeLessThan(1e-9);
  });

  it('has a centre bore Db and Zw holes dh = 2rw + 2e (+ the inner hole clearance) on radius Rw', () => {
    const { res, dxf } = read(withTolerance(J2, { innerHoleClearance: 0 }), 'disc');
    const cs = circles(dxf.entities);
    expect(cs).toHaveLength(1 + J2.Zw);
    const bore = cs.find((c) => Math.hypot(c.cx!, c.cy!) < 1e-9)!;
    expect(bore.r! * 2).toBeCloseTo(J2.Db, 6);
    const holes = cs.filter((c) => c !== bore);
    const dh = 2 * J2.rw + 2 * J2.e;
    for (const [k, h] of holes.entries()) {
      expect(h.r! * 2).toBeCloseTo(dh, 6);
      expect(Math.hypot(h.cx!, h.cy!)).toBeCloseTo(res.info!.Rw, 6);
      const ang = Math.atan2(h.cy!, h.cx!);
      const want = (2 * Math.PI * k) / J2.Zw;
      expect(Math.cos(ang - want)).toBeCloseTo(1, 6);
    }
    for (const c of cs) expect(c.layer).toBe('DISC');
  });

  it('profile clearance shrinks the profile by exactly the clearance', () => {
    const base = read(exact(J3), 'disc').dxf.entities.find((e) => e.type === 'POLYLINE')!.vertices!;
    const shr = read(pc(J3, 0.15), 'disc', { profileClearance: 0.7 /* ignored: the input wins */ }).dxf.entities.find((e) => e.type === 'POLYLINE')!.vertices!;
    expect(shr).toHaveLength(base.length);
    const [lo0, hi0] = radiusRange(base);
    const [lo1, hi1] = radiusRange(shr);
    expect(lo0 - lo1).toBeCloseTo(0.15, 4);
    expect(hi0 - hi1).toBeCloseTo(0.15, 3);
    // every shrunken point lies 0.15 mm from the base profile (inside it)
    for (let k = 0; k < shr.length; k += 37) {
      let best = Infinity;
      for (let j = 0; j < base.length; j++) {
        const a = base[j], b = base[(j + 1) % base.length];
        const dx = b.x - a.x, dy = b.y - a.y;
        const t = Math.max(0, Math.min(1, ((shr[k].x - a.x) * dx + (shr[k].y - a.y) * dy) / (dx * dx + dy * dy)));
        best = Math.min(best, Math.hypot(shr[k].x - a.x - t * dx, shr[k].y - a.y - t * dy));
      }
      expect(best).toBeCloseTo(0.15, 3);
    }
  });

  it('disc bore clearance widens the bore; the inner holes take the inner hole clearance input', () => {
    const { dxf } = read(withTolerance(J3, { innerHoleClearance: 0.07 }), 'disc', { discHoleClearance: 0.1 });
    const cs = circles(dxf.entities);
    expect(Math.min(...cs.map((c) => c.r! * 2))).toBeCloseTo(2 * J3.rw + 2 * J3.e + 0.07, 6);
    expect(Math.max(...cs.map((c) => c.r! * 2))).toBeCloseTo(J3.Db + 0.1, 6);
    // a gearbox without a tolerance spec uses the default: the CNC mill's fitted 0.07 mm
    const d0 = circles(read(J3, 'disc').dxf.entities);
    expect(Math.min(...d0.map((c) => c.r! * 2))).toBeCloseTo(2 * J3.rw + 2 * J3.e + 0.07, 6);
  });

  it('the pin hole clearance is twice the hole play input (reamed holes: 0.01 mm)', () => {
    const r = buildParts(withTolerance(J3, { holePlay: 0.005 }), { pinHoleClearance: 0.4 /* ignored */ }, 'J3');
    const housing = r.parts.find((p) => p.id === 'housing')!;
    const holes = housing.entities.filter((e) => e.type === 'CIRCLE' && Math.abs(Math.hypot(e.cx, e.cy) - J3.D / 2) < 1e-6);
    expect(holes).toHaveLength(J3.Zp);
    for (const h of holes) if (h.type === 'CIRCLE') expect(2 * h.r).toBeCloseTo(J3.outerPin.shankDia + 0.01, 9);
  });

  it('chord-error mode honours the tolerance', () => {
    const res = buildParts(J2, { pointsPerLobe: null, maxChordError: 0.002 }, 'J2');
    expect(res.info!.chordError).toBeLessThanOrEqual(0.002);
    expect(res.info!.pointsPerLobe).toBeGreaterThan(120);
  });

  it('the outline does not cross itself', () => {
    expect(read(J2, 'disc').res.warnings.some((w) => /cross/i.test(w))).toBe(false);
  });

  it('warns but still exports when there is a cusp', () => {
    // a clearance that sharpens the lobe tips past the 0.3 mm limit
    const r = buildParts(pc(J3, 4.9), {}, 'J3');
    expect(r.ok).toBe(true);
    expect(r.warnings.join(' ')).toMatch(/cusp/i);
    expect(readDxf(buildDxf(r, 'disc').text).entities.some((e) => e.type === 'POLYLINE')).toBe(true);
    // a geometry the engine itself flags
    const bad: GearboxInputs = { ...defaultGearboxInputs(), D: 40, e: 3.2, rr: 1.5, rw: 1, Db: 8, Zw: 4 };
    const m = createGearboxModel(bad);
    if (m.result.valid && m.result.cusp) {
      const rb = buildParts(bad, {}, 'bad', m);
      expect(rb.ok).toBe(true);
      expect(rb.warnings.join(' ')).toMatch(/cusp/i);
    }
  });
});

describe('housing plate', () => {
  it('has the outline at the housing OD and Zp holes on the pin circle (bolt shank + 0.2)', () => {
    const { res, dxf } = read(J3, 'housing');
    const cs = circles(dxf.entities);
    const outline = cs.reduce((a, b) => (a.r! > b.r! ? a : b));
    expect(outline.r! * 2).toBeCloseTo(J3.D + 2 * J3.rr + 2 * J3.wall, 6);
    expect(outline.r! * 2).toBeCloseTo(res.info!.housingOD, 6);
    const holes = cs.filter((c) => c !== outline);
    expect(holes).toHaveLength(J3.Zp);
    for (const h of holes) {
      expect(Math.hypot(h.cx!, h.cy!)).toBeCloseTo(J3.D / 2, 6);
      expect(h.r! * 2).toBeCloseTo(J3.outerPin.shankDia + 0.2, 6);
    }
    for (const c of cs) expect(c.layer).toBe('HOUSING');
  });
  it('uses pin OD + clearance for solid pins, and adds the optional centre hole', () => {
    const solid: GearboxInputs = { ...J3, outerPin: { ...J3.outerPin, construction: 'solid' } };
    const { dxf } = read(solid, 'housing', { housingCentreHole: true, housingCentreDia: 12 });
    const cs = circles(dxf.entities);
    expect(cs).toHaveLength(J3.Zp + 2);
    const pinHoles = cs.filter((c) => Math.abs(Math.hypot(c.cx!, c.cy!) - J3.D / 2) < 1e-6);
    expect(pinHoles).toHaveLength(J3.Zp);
    for (const h of pinHoles) expect(h.r! * 2).toBeCloseTo(2 * J3.rr + 0.2, 6);
    expect(cs.some((c) => Math.abs(c.r! * 2 - 12) < 1e-6 && Math.hypot(c.cx!, c.cy!) < 1e-9)).toBe(true);
  });
});

describe('output / tie plate', () => {
  it('has Zw clearance holes on Rw and the default outline 2*Rw + pin OD + 8', () => {
    const { res, dxf } = read(J3, 'outputPlate');
    const cs = circles(dxf.entities);
    const outline = cs.reduce((a, b) => (a.r! > b.r! ? a : b));
    expect(outline.r! * 2).toBeCloseTo(2 * res.info!.Rw + 2 * J3.rw + 8, 6);
    const holes = cs.filter((c) => c !== outline);
    expect(holes).toHaveLength(J3.Zw);
    for (const h of holes) {
      expect(Math.hypot(h.cx!, h.cy!)).toBeCloseTo(res.info!.Rw, 6);
      expect(h.r! * 2).toBeCloseTo(3.2, 6); // M3 screw + 0.2
    }
  });
  it('honours an outline override and the centre hole', () => {
    const { dxf } = read(J3, 'outputPlate', { plateOutlineDia: 70, outputCentreHole: true, outputCentreDia: 8 });
    const cs = circles(dxf.entities);
    expect(cs.some((c) => Math.abs(c.r! * 2 - 70) < 1e-9)).toBe(true);
    expect(cs.some((c) => Math.abs(c.r! * 2 - 8) < 1e-9)).toBe(true);
  });
  it('finds the thread size from the standoff', () => {
    expect(standoffThread(2.46, 5)).toEqual({ nominal: 3, label: 'M3' });
    expect(standoffThread(3.24, 7).label).toBe('M4');
    expect(standoffThread(6.5, 12).nominal).toBe(8);
  });
});

describe('cam and pins', () => {
  it('cam: bearing ID circle offset e from the shaft hole; second cam at 180 deg for 2 discs', () => {
    const { dxf } = read(J2, 'cam');
    const cs = circles(dxf.entities);
    expect(cs).toHaveLength(4);
    const shafts = cs.filter((c) => Math.abs(c.r! * 2 - 5) < 1e-9);
    const cams = cs.filter((c) => Math.abs(c.r! * 2 - 10) < 1e-9); // 61800 bore
    expect(shafts).toHaveLength(2);
    expect(cams).toHaveLength(2);
    const off = cams.map((c, i) => c.cx! - shafts[i].cx!);
    expect(off[0]).toBeCloseTo(J2.e, 6);
    expect(off[1]).toBeCloseTo(-J2.e, 6);
    expect(cams[0].layer).toBe('CAM');
    const t = dxf.entities.filter((e) => e.type === 'TEXT').map((e) => e.text).join('|');
    expect(t).toMatch(/180 deg/);
  });
  it('one cam for one disc', () => {
    expect(circles(read(J3, 'cam').dxf.entities)).toHaveLength(2);
  });
  it('pins: bushing OD/ID, bolt shank, standoff OD/bore on PINS, labelled on NOTES', () => {
    const { dxf } = read(J3, 'pins');
    const cs = circles(dxf.entities);
    const dia = cs.map((c) => +(c.r! * 2).toFixed(4)).sort((a, b) => a - b);
    expect(dia).toEqual([2.46, 3, 3.2, 5, 5]);
    expect(cs.every((c) => c.layer === 'PINS')).toBe(true);
    const text = dxf.entities.filter((e) => e.type === 'TEXT');
    expect(text.length).toBeGreaterThan(3);
    expect(text.every((t) => t.layer === 'NOTES')).toBe(true);
    expect(text.map((t) => t.text).join('|')).toMatch(/Outer bushing.*make 18/);
  });
});

describe('all parts sheet', () => {
  const { res, dxf } = read(J2, 'all');
  it('has one layer per part plus NOTES, each used', () => {
    const names = dxf.layers.map((l) => l.name);
    for (const l of EXPORT_LAYERS) expect(names).toContain(l.name);
    const used = new Set(dxf.entities.map((e) => e.layer));
    for (const l of ['DISC', 'HOUSING', 'OUTPUT_PLATE', 'CAM', 'PINS', 'NOTES']) expect(used.has(l)).toBe(true);
  });
  it('lays parts out without overlap', () => {
    const boxes = res.parts.map((p) => ({ id: p.id, ...bboxOf(dxf.entities.filter((e) => e.layer === p.layer)) }));
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        const a = boxes[i], b = boxes[j];
        const apart = a.maxX < b.minX || b.maxX < a.minX || a.maxY < b.minY || b.maxY < a.minY;
        expect(apart, `${a.id} vs ${b.id}`).toBe(true);
      }
    }
  });
  it('labels every part on NOTES with its key dimensions and make-N', () => {
    const all = dxf.entities.filter((e) => e.type === 'TEXT').map((e) => e.text!).join('\n');
    expect(all).toMatch(/CYCLOIDAL DISC.*make 2/);
    expect(all).toMatch(/Zp 18.*Zc 17.*D 85\.00.*e 1\.600.*rr 2\.500.*L 6\.350/);
    expect(all).toMatch(/Aluminum 6061-T6/);
    expect(all).toMatch(/RING-PIN HOUSING PLATE.*make 2/);
    expect(all).toMatch(/OUTPUT \/ TIE PLATE.*make 2/);
    expect(all).toMatch(/ECCENTRIC CAM.*make 2/);
    expect(all).toMatch(/units mm/);
  });
  it('part geometry keeps its dimensions after translation', () => {
    const disc = dxf.entities.find((e) => e.type === 'POLYLINE' && e.layer === 'DISC')!;
    const bb = bboxOf([disc]);
    expect(bb.maxX - bb.minX).toBeGreaterThan(2 * (42.5 - 1.6 - 2.5));
    expect(bb.maxX - bb.minX).toBeLessThan(2 * (42.5 + 1.6 - 2.5) + 1e-6);
  });
});

describe('units, finiteness, extents', () => {
  it('inch export is mm / 25.4 for every vertex and circle', () => {
    const res = buildParts(J2, {}, 'J2');
    const mm = readDxf(buildDxf(res, 'all', { units: 'mm' }).text);
    const inch = readDxf(buildDxf(res, 'all', { units: 'in' }).text);
    expect(inch.header['$INSUNITS'][0].value).toBe('1');
    expect(mm.header['$INSUNITS'][0].value).toBe('4');
    expect(inch.entities).toHaveLength(mm.entities.length);
    mm.entities.forEach((e, i) => {
      const f = inch.entities[i];
      if (e.type === 'CIRCLE') {
        expect(f.r!).toBeCloseTo(e.r! / 25.4, 6);
        expect(f.cx!).toBeCloseTo(e.cx! / 25.4, 6);
      } else if (e.type === 'POLYLINE') {
        e.vertices!.forEach((v, k) => {
          expect(f.vertices![k].x).toBeCloseTo(v.x / 25.4, 5);
          expect(f.vertices![k].y).toBeCloseTo(v.y / 25.4, 5);
        });
      }
    });
  });

  it('no NaN / Infinity anywhere, and $EXTMIN/$EXTMAX enclose the geometry', () => {
    for (const inp of [J2, J3, PRESETS.J1, PRESETS.J4, defaultGearboxInputs()]) {
      const res = buildParts(inp, {}, 'x');
      expect(res.ok).toBe(true);
      for (const id of [...res.parts.map((p) => p.id), 'all'] as const) {
        const text = buildDxf(res, id).text;
        expect(text).not.toMatch(/NaN|Infinity|undefined/);
        const d = readDxf(text);
        const minX = Number(d.header['$EXTMIN'][0].value), minY = Number(d.header['$EXTMIN'][1].value);
        const maxX = Number(d.header['$EXTMAX'][0].value), maxY = Number(d.header['$EXTMAX'][1].value);
        const bb = bboxOf(d.entities);
        expect(minX).toBeLessThanOrEqual(bb.minX + 1e-6);
        expect(minY).toBeLessThanOrEqual(bb.minY + 1e-6);
        expect(maxX).toBeGreaterThanOrEqual(bb.maxX - 1e-6);
        expect(maxY).toBeGreaterThanOrEqual(bb.maxY - 1e-6);
      }
    }
  });

  it('extents are exact for the disc-only geometry plus its notes', () => {
    const res = buildParts(J3, {}, 'x');
    const d = readDxf(buildDxf(res, 'disc').text);
    const bb = bboxOf(d.entities);
    // the polyline reaches +x and -x lobe extremes; extents may be wider only because of the text block
    expect(Number(d.header['$EXTMAX'][0].value)).toBeGreaterThanOrEqual(bb.maxX);
    expect(Number(d.header['$EXTMIN'][0].value)).toBeLessThanOrEqual(bb.minX);
    expect(Number(d.header['$EXTMAX'][1].value)).toBeCloseTo(bb.maxY, 3);
  });

  it('invalid inputs give ok:false and an error, never a throw', () => {
    const res = buildParts({ ...J3, Zp: 3 }, {}, 'bad');
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
    expect(() => buildDxf(res, 'all')).toThrow();
    expect(buildParts({ ...J3, D: NaN }, {}, 'bad').ok).toBe(false);
    expect(buildParts(pc(J3, 60), {}, 'bad').ok).toBe(false);
  });

  it('file names are descriptive', () => {
    const res = buildParts({ ...J3, D: 46, e: 0.863 }, {}, 'J3');
    expect(exportFileName(res, 'disc')).toBe('cycloid-disc_J3_D46_e0.863_Zp18.dxf');
    expect(exportFileName(res, 'all', 'in')).toBe('cycloid-all-parts_J3_D46_e0.863_Zp18_in.dxf');
  });

  it('option helpers', () => {
    expect(normalizeExportOptions({ profileClearance: 'x', units: 'in', pointsPerLobe: null })).toMatchObject({ profileClearance: 0, units: 'in', pointsPerLobe: null });
    expect(validateExportOptions({ ...DEFAULT_EXPORT_OPTIONS, shaftDia: 0 }).shaftDia).toBeTruthy();
    expect(Object.keys(validateExportOptions({ ...DEFAULT_EXPORT_OPTIONS }))).toHaveLength(0);
  });
});

function fnv1a(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
const GOLDEN_J2_DISC_HASH = '0e6d0177';
const GOLDEN_J2_DISC_LENGTH = 148913;

describe('golden: J2 SPEC case (D 85, e 1.6, rr 2.5, 2 discs)', () => {
  // recorded before the inner holes took the tolerance input: with an inner hole clearance of 0 the file is unchanged
  const res = buildParts(exact(J2), {}, 'J2');
  const text = buildDxf(res, 'disc').text;
  const d = readDxf(text);
  it('disc DXF matches the recorded structure and numbers', () => {
    expect(d.sections).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']);
    expect(d.entities.map((e) => e.type).slice(0, 2)).toEqual(['POLYLINE', 'CIRCLE']);
    expect(d.entities.filter((e) => e.type === 'CIRCLE')).toHaveLength(7);
    const poly = d.entities[0].vertices!;
    expect(poly).toHaveLength(2040);
    // first vertex is the lobe root on +x: Rp - e - rr = 42.5 - 1.6 - 2.5
    expect(poly[0].x).toBeCloseTo(38.4, 6);
    expect(poly[0].y).toBeCloseTo(0, 6);
    expect(res.info).toMatchObject({ Zc: 17, Rw: 32.3, dh: 8.2, housingOD: 98, profileOffset: 2.5, pointCount: 2040 });
    expect(res.info!.minLobeRadius).toBeCloseTo(5.5851, 3);
    expect(res.info!.chordError).toBeCloseTo(0.004085, 5);
    const dias = d.entities.filter((e) => e.type === 'CIRCLE').map((c) => +(c.r! * 2).toFixed(6)).sort((a, b) => a - b);
    expect(dias).toEqual([8.2, 8.2, 8.2, 8.2, 8.2, 8.2, 19]);
  });
  it('header excerpt is exact', () => {
    expect(text.split('\r\n').slice(0, 14)).toEqual([
      '  0', 'SECTION', '  2', 'HEADER', '  9', '$ACADVER', '  1', 'AC1009', '  9', '$INSUNITS', ' 70', '4', '  9', '$EXTMIN',
    ]);
  });
  it('whole-file fingerprint is stable (update only on an intended format change)', () => {
    expect(text.length).toBe(GOLDEN_J2_DISC_LENGTH);
    expect(fnv1a(text)).toBe(GOLDEN_J2_DISC_HASH);
  });
});

// The user's own file: compared only when it is present on this machine (read-only).
// (node:fs is reached through process.getBuiltinModule so the browser tsconfig needs no node types)
interface NodeFs { existsSync(p: string): boolean; readFileSync(p: string, enc: 'utf8'): string }
const nodeFs = (globalThis as unknown as { process?: { getBuiltinModule?: (n: string) => unknown } }).process?.getBuiltinModule?.('node:fs') as NodeFs | undefined;
const existsSync = (p: string) => !!nodeFs && nodeFs.existsSync(p);
const readFileSync = (p: string, enc: 'utf8') => nodeFs!.readFileSync(p, enc);
const USER_FILE = 'C:/Users/kyleg/Downloads/cycloid_85mm_17to1.dxf';
describe.skipIf(!existsSync(USER_FILE))('comparison with the user DXF cycloid_85mm_17to1.dxf', () => {
  it('is the same curve as ours for D 85, Zp 18, e 1.3, rr 3.0 (2000 points, 5-decimal rounding only)', () => {
    const d = readDxf(readFileSync(USER_FILE, 'utf8'));
    const poly = d.entities.find((e) => e.type === 'POLYLINE')!;
    expect(poly.closed).toBe(true);
    const theirs = poly.vertices!;
    expect(theirs).toHaveLength(2000);
    const mine = discProfile(18, 42.5, 1.3, 3.0, 2000).points;
    // theirs is mirrored (clockwise) with the same start: vertex k matches our vertex (n - k) mod n
    let max = 0;
    for (let k = 0; k < 2000; k++) {
      const m = mine[(2000 - k) % 2000];
      max = Math.max(max, Math.hypot(m.x - theirs[k].x, m.y - theirs[k].y));
    }
    expect(max).toBeLessThan(1e-5);
    const [lo, hi] = radiusRange(theirs);
    expect(lo).toBeCloseTo(38.2, 5);
    expect(hi).toBeCloseTo(40.8, 5);
  });
});
