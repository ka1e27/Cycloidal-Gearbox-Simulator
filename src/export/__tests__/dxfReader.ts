// Minimal R12 ASCII DXF reader for the tests (and nothing else): pairs of group code / value lines.

export interface Pair { code: number; value: string }
export interface ReadEntity {
  type: string;
  layer: string;
  pairs: Pair[];
  /** POLYLINE only */
  vertices?: { x: number; y: number }[];
  closed?: boolean;
  hasSeqend?: boolean;
  /** CIRCLE */
  cx?: number; cy?: number; r?: number;
  /** TEXT */
  text?: string; height?: number;
  x?: number; y?: number;
  /** LINE */
  x1?: number; y1?: number; x2?: number; y2?: number;
}
export interface ReadDxf {
  pairs: Pair[];
  sections: string[];
  header: Record<string, Pair[]>;
  layers: { name: string; color: number }[];
  layerCount: number;
  entities: ReadEntity[];
  endsWithEof: boolean;
}

export function readDxf(text: string): ReadDxf {
  const lines = text.split(/\r?\n/);
  if (lines[lines.length - 1] === '') lines.pop();
  if (lines.length % 2 !== 0) throw new Error('odd number of lines');
  const pairs: Pair[] = [];
  for (let i = 0; i < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error(`bad group code at line ${i + 1}: "${lines[i]}"`);
    pairs.push({ code, value: lines[i + 1] });
  }
  const sections: string[] = [];
  const header: Record<string, Pair[]> = {};
  const layers: { name: string; color: number }[] = [];
  let layerCount = -1;
  const entities: ReadEntity[] = [];
  let i = 0;
  let curSection = '';
  let table = '';
  let curVar = '';
  let curEnt: ReadEntity | null = null;
  let curPoly: ReadEntity | null = null;
  let curLayer: { name: string; color: number } | null = null;
  const flush = () => { if (curEnt) { entities.push(curEnt); curEnt = null; } };
  while (i < pairs.length) {
    const p = pairs[i];
    if (p.code === 0 && p.value === 'SECTION') {
      const nm = pairs[i + 1];
      if (nm.code !== 2) throw new Error('SECTION without name');
      curSection = nm.value;
      sections.push(curSection);
      i += 2;
      continue;
    }
    if (p.code === 0 && p.value === 'ENDSEC') { flush(); curSection = ''; i++; continue; }
    if (p.code === 0 && p.value === 'EOF') { i++; return { pairs, sections, header, layers, layerCount, entities, endsWithEof: i === pairs.length }; }
    if (curSection === 'HEADER') {
      if (p.code === 9) { curVar = p.value; header[curVar] = []; } else header[curVar].push(p);
    } else if (curSection === 'TABLES') {
      if (p.code === 0 && p.value === 'TABLE') { table = pairs[i + 1].value; if (table === 'LAYER') layerCount = Number(pairs[i + 2].value); }
      if (p.code === 0 && p.value === 'ENDTAB') { table = ''; curLayer = null; }
      if (table === 'LAYER') {
        if (p.code === 0 && p.value === 'LAYER') { curLayer = { name: '', color: 0 }; layers.push(curLayer); }
        else if (curLayer && p.code === 2) curLayer.name = p.value;
        else if (curLayer && p.code === 62) curLayer.color = Number(p.value);
      }
    } else if (curSection === 'ENTITIES') {
      if (p.code === 0) {
        if (p.value === 'VERTEX') {
          if (!curPoly) throw new Error('VERTEX outside POLYLINE');
          const v = { x: NaN, y: NaN };
          let j = i + 1;
          while (j < pairs.length && pairs[j].code !== 0) {
            if (pairs[j].code === 10) v.x = Number(pairs[j].value);
            if (pairs[j].code === 20) v.y = Number(pairs[j].value);
            j++;
          }
          curPoly.vertices!.push(v);
          i = j;
          continue;
        }
        if (p.value === 'SEQEND') {
          if (!curPoly) throw new Error('SEQEND outside POLYLINE');
          curPoly.hasSeqend = true;
          curPoly = null;
          // swallow its layer pair
          let j = i + 1;
          while (j < pairs.length && pairs[j].code !== 0) j++;
          i = j;
          continue;
        }
        flush();
        curEnt = { type: p.value, layer: '', pairs: [] };
        if (p.value === 'POLYLINE') { curEnt.vertices = []; curPoly = curEnt; }
      } else if (curEnt) {
        curEnt.pairs.push(p);
        const v = p.value;
        switch (p.code) {
          case 8: curEnt.layer = v; break;
          case 70: if (curEnt.type === 'POLYLINE') curEnt.closed = (Number(v) & 1) === 1; break;
          case 10: if (curEnt.type === 'CIRCLE') curEnt.cx = Number(v); else if (curEnt.type === 'LINE') curEnt.x1 = Number(v); else if (curEnt.type === 'TEXT') curEnt.x = Number(v); break;
          case 20: if (curEnt.type === 'CIRCLE') curEnt.cy = Number(v); else if (curEnt.type === 'LINE') curEnt.y1 = Number(v); else if (curEnt.type === 'TEXT') curEnt.y = Number(v); break;
          case 11: curEnt.x2 = Number(v); break;
          case 21: curEnt.y2 = Number(v); break;
          case 40: if (curEnt.type === 'CIRCLE') curEnt.r = Number(v); else if (curEnt.type === 'TEXT') curEnt.height = Number(v); break;
          case 1: curEnt.text = v; break;
        }
      }
    }
    i++;
  }
  throw new Error('no EOF');
}

/** Closed-polyline outline of a PartsResult-style entity list: radius extremes about the origin. */
export function radiusRange(pts: { x: number; y: number }[]): [number, number] {
  let lo = Infinity, hi = -Infinity;
  for (const p of pts) { const r = Math.hypot(p.x, p.y); lo = Math.min(lo, r); hi = Math.max(hi, r); }
  return [lo, hi];
}
