import { describe, expect, it } from 'vitest';
import { asciiText, entityExtents, fmtNum, writeDxf, type DxfEntity } from '../dxf';
import { readDxf } from './dxfReader';

const sample: DxfEntity[] = [
  { type: 'LINE', layer: 'DISC', x1: 0, y1: 0, x2: 10, y2: 5 },
  { type: 'CIRCLE', layer: 'DISC', cx: 1, cy: 2, r: 3 },
  { type: 'POLYLINE', layer: 'HOUSING', closed: true, points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }] },
  { type: 'POLYLINE', layer: 'HOUSING', closed: false, points: [{ x: 0, y: 0 }, { x: 5, y: 5 }] },
  { type: 'TEXT', x: 2, y: -8, height: 2.5, text: 'Dia 5 Ø °' },
];

describe('fmtNum', () => {
  it('uses 6 fixed decimals, no exponent, no negative zero', () => {
    expect(fmtNum(1)).toBe('1.000000');
    expect(fmtNum(-0)).toBe('0.000000');
    expect(fmtNum(-1e-9)).toBe('0.000000');
    expect(fmtNum(1e-7)).toBe('0.000000');
    expect(fmtNum(123456.7890123)).toBe('123456.789012');
    expect(fmtNum(-0.5)).toBe('-0.500000');
    expect(fmtNum(1e-12)).not.toMatch(/e/i);
  });
  it('throws on non-finite numbers', () => {
    expect(() => fmtNum(NaN)).toThrow();
    expect(() => fmtNum(Infinity)).toThrow();
  });
});

describe('asciiText', () => {
  it('reduces to printable ASCII', () => {
    expect(asciiText('Ø 5 ° × ·')).toBe('dia 5 deg x *');
    expect(asciiText('a\nb\tc')).toBe('a b c');
    expect(asciiText('中')).toBe('?');
  });
});

describe('writeDxf structure (R12)', () => {
  const text = writeDxf(sample);
  const d = readDxf(text);

  it('has the sections in order and ends with EOF', () => {
    expect(d.sections).toEqual(['HEADER', 'TABLES', 'BLOCKS', 'ENTITIES']);
    expect(d.endsWithEof).toBe(true);
    expect(text.endsWith('EOF\r\n')).toBe(true);
  });

  it('header has $ACADVER AC1009, $INSUNITS 4 and matching extents', () => {
    expect(d.header['$ACADVER'][0]).toEqual({ code: 1, value: 'AC1009' });
    expect(d.header['$INSUNITS'][0]).toEqual({ code: 70, value: '4' });
    const ext = entityExtents(sample);
    const min = d.header['$EXTMIN'];
    const max = d.header['$EXTMAX'];
    expect(Number(min[0].value)).toBeCloseTo(ext.minX, 6);
    expect(Number(min[1].value)).toBeCloseTo(ext.minY, 6);
    expect(Number(max[0].value)).toBeCloseTo(ext.maxX, 6);
    expect(Number(max[1].value)).toBeCloseTo(ext.maxY, 6);
  });

  it('LAYER table lists layer 0, every used layer and NOTES for text, with the right count', () => {
    const names = d.layers.map((l) => l.name);
    expect(names).toContain('0');
    expect(names).toContain('DISC');
    expect(names).toContain('HOUSING');
    expect(names).toContain('NOTES');
    expect(d.layerCount).toBe(d.layers.length);
    expect(d.layers.every((l) => l.color > 0)).toBe(true);
  });

  it('writes LINE, CIRCLE, POLYLINE with VERTEX and SEQEND, closed flag 1 only for closed', () => {
    const types = d.entities.map((e) => e.type);
    expect(types).toEqual(['LINE', 'CIRCLE', 'POLYLINE', 'POLYLINE', 'TEXT']);
    const polys = d.entities.filter((e) => e.type === 'POLYLINE');
    expect(polys[0].closed).toBe(true);
    expect(polys[0].vertices).toHaveLength(3);
    expect(polys[0].hasSeqend).toBe(true);
    expect(polys[1].closed).toBe(false);
    expect(polys[1].hasSeqend).toBe(true);
    const poly = polys[0].pairs.find((p) => p.code === 66);
    expect(poly?.value).toBe('1');
    const circle = d.entities[1];
    expect([circle.cx, circle.cy, circle.r]).toEqual([1, 2, 3]);
  });

  it('puts TEXT only on NOTES, in ASCII', () => {
    const t = d.entities.find((e) => e.type === 'TEXT')!;
    expect(t.layer).toBe('NOTES');
    expect(t.text).toBe('Dia 5 dia deg');
    for (const e of d.entities) if (e.type !== 'TEXT') expect(e.layer).not.toBe('NOTES');
  });

  it('writes only 6-decimal numbers (no exponent) for float groups', () => {
    for (const p of d.pairs) {
      if ((p.code >= 10 && p.code <= 59) && p.value !== '') expect(p.value).toMatch(/^-?\d+\.\d{6}$/);
    }
  });

  it('uses CRLF consistently, or LF when asked', () => {
    expect(text.includes('\r\n')).toBe(true);
    expect(text.replace(/\r\n/g, '').includes('\n')).toBe(false);
    const lf = writeDxf(sample, { eol: '\n' });
    expect(lf.includes('\r')).toBe(false);
    expect(readDxf(lf).entities).toHaveLength(5);
  });

  it('is deterministic', () => {
    expect(writeDxf(sample)).toBe(text);
  });
});

describe('inch export', () => {
  const mm = readDxf(writeDxf(sample));
  const inch = readDxf(writeDxf(sample, { units: 'in' }));
  it('sets $INSUNITS 1 and divides every coordinate and the text height by 25.4', () => {
    expect(inch.header['$INSUNITS'][0].value).toBe('1');
    const c0 = mm.entities[1], c1 = inch.entities[1];
    expect(c1.r!).toBeCloseTo(c0.r! / 25.4, 6);
    expect(c1.cx!).toBeCloseTo(c0.cx! / 25.4, 6);
    const v0 = mm.entities[2].vertices!, v1 = inch.entities[2].vertices!;
    v0.forEach((v, i) => { expect(v1[i].x).toBeCloseTo(v.x / 25.4, 6); expect(v1[i].y).toBeCloseTo(v.y / 25.4, 6); });
    expect(inch.entities[4].height!).toBeCloseTo(2.5 / 25.4, 6);
    expect(Number(inch.header['$EXTMAX'][0].value)).toBeCloseTo(Number(mm.header['$EXTMAX'][0].value) / 25.4, 6);
  });
});

describe('robustness', () => {
  it('throws instead of writing NaN', () => {
    expect(() => writeDxf([{ type: 'CIRCLE', layer: 'DISC', cx: NaN, cy: 0, r: 1 }])).toThrow();
    expect(() => writeDxf([{ type: 'CIRCLE', layer: 'DISC', cx: 0, cy: 0, r: 0 }])).toThrow();
  });
  it('an empty drawing is still a valid file', () => {
    const d = readDxf(writeDxf([]));
    expect(d.entities).toHaveLength(0);
    expect(d.endsWithEof).toBe(true);
  });
  it('sanitises layer names', () => {
    const d = readDxf(writeDxf([{ type: 'CIRCLE', layer: 'my layer!', cx: 0, cy: 0, r: 1 }]));
    expect(d.entities[0].layer).toBe('MY_LAYER_');
  });
});
