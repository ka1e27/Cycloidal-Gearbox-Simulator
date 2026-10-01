// Pure ASCII DXF writer. Default flavour is R12 (AC1009): the format that waterjet / laser CAM, Fusion 360,
// SolidWorks and Inkscape all import most reliably. No dependency, no DOM, no Date: the same entities always
// produce the same text.
//
// Entities are given in millimetres. Choose `units: 'in'` to divide every coordinate (and text height) by 25.4
// and write $INSUNITS 1 instead of 4.
//
// R12 supports LINE, CIRCLE, POLYLINE / VERTEX / SEQEND and TEXT (all used here). Text is only ever written
// on the NOTES layer so a CAM import can switch the annotations off in one go.

export type DxfUnits = 'mm' | 'in';

export const IN_MM = 25.4;
/** The one layer allowed to carry TEXT. */
export const NOTES_LAYER = 'NOTES';

export interface DxfPoint {
  x: number;
  y: number;
}

export type DxfEntity =
  | { type: 'LINE'; layer: string; x1: number; y1: number; x2: number; y2: number }
  | { type: 'CIRCLE'; layer: string; cx: number; cy: number; r: number }
  | { type: 'POLYLINE'; layer: string; points: DxfPoint[]; closed: boolean }
  /** TEXT has no layer field: it is always written on NOTES. `x, y` is the lower-left of the first character. */
  | { type: 'TEXT'; x: number; y: number; height: number; text: string };

export interface DxfLayer {
  name: string;
  /** AutoCAD colour index (1 red, 2 yellow, 3 green, 4 cyan, 5 blue, 6 magenta, 7 white, 8 grey) */
  color: number;
}

export interface DxfOptions {
  /** Unit of the written file. Entities are always supplied in mm. Default 'mm'. */
  units?: DxfUnits;
  /** Layers to declare in the LAYER table. Layers used by entities but not listed are added (colour 7). */
  layers?: DxfLayer[];
  /** Line ending. Default CRLF, as AutoCAD writes it; LF is fine for every reader tested. */
  eol?: '\r\n' | '\n';
}

export interface DxfExtents {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

// ---------------------------------------------------------------------------
// Number and text formatting
// ---------------------------------------------------------------------------

/** Decimals written for every coordinate and dimension. */
export const DXF_DECIMALS = 6;

/** Fixed 6 decimals, never exponent notation, never "-0.000000". Non-finite input throws. */
export function fmtNum(v: number): string {
  if (!Number.isFinite(v)) throw new Error(`DXF export: non-finite number (${String(v)})`);
  let s = v.toFixed(DXF_DECIMALS);
  // toFixed switches to exponent form at 1e21; no drawing comes near that, but keep the promise anyway
  if (/e/i.test(s)) s = '0.000000';
  if (/^-0\.0+$/.test(s)) s = s.slice(1);
  return s;
}

/**
 * R12 text is single-byte, so reduce a label to printable ASCII: the usual engineering symbols become words
 * or plain letters, everything else non-ASCII becomes '?', and control characters (newlines) become spaces.
 */
export function asciiText(s: string): string {
  const map: Record<string, string> = {
    'Ø': 'dia ', 'ø': 'dia ', '⌀': 'dia ', '°': ' deg', '×': 'x', '·': '*', '−': '-', '–': '-', '—': '-',
    '±': '+/-', 'θ': 'theta', 'ρ': 'rho', 'κ': 'kappa', '≤': '<=', '≥': '>=', 'Σ': 'sum', 'µ': 'u', 'μ': 'u', '’': "'", '“': '"', '”': '"',
  };
  let out = '';
  for (const ch of s) {
    if (map[ch] !== undefined) out += map[ch];
    else if (ch >= ' ' && ch <= '~') out += ch;
    else if (ch === '\n' || ch === '\r' || ch === '\t') out += ' ';
    else out += '?';
  }
  return out.replace(/\s+/g, ' ').trim();
}

// ---------------------------------------------------------------------------
// Extents
// ---------------------------------------------------------------------------

/** Approximate width of a TEXT string for extents and layout: R12 STANDARD style averages about 0.8 x height per glyph. */
export function textWidth(text: string, height: number): number {
  return asciiText(text).length * height * 0.8;
}

/** Bounding box of all entities (text counted by its estimated width). Empty drawings give all zeros. */
export function entityExtents(entities: readonly DxfEntity[]): DxfExtents {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  const add = (x: number, y: number) => {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
  };
  for (const e of entities) {
    switch (e.type) {
      case 'LINE': add(e.x1, e.y1); add(e.x2, e.y2); break;
      case 'CIRCLE': add(e.cx - e.r, e.cy - e.r); add(e.cx + e.r, e.cy + e.r); break;
      case 'POLYLINE': for (const p of e.points) add(p.x, p.y); break;
      case 'TEXT': add(e.x, e.y); add(e.x + textWidth(e.text, e.height), e.y + e.height); break;
    }
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
  return { minX, minY, maxX, maxY };
}

/** Same, but only the cutting geometry (no TEXT). Used to place parts. */
export function geometryExtents(entities: readonly DxfEntity[]): DxfExtents {
  return entityExtents(entities.filter((e) => e.type !== 'TEXT'));
}

/** A translated copy of the entities. */
export function translateEntities(entities: readonly DxfEntity[], dx: number, dy: number): DxfEntity[] {
  return entities.map((e): DxfEntity => {
    switch (e.type) {
      case 'LINE': return { ...e, x1: e.x1 + dx, y1: e.y1 + dy, x2: e.x2 + dx, y2: e.y2 + dy };
      case 'CIRCLE': return { ...e, cx: e.cx + dx, cy: e.cy + dy };
      case 'POLYLINE': return { ...e, points: e.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
      case 'TEXT': return { ...e, x: e.x + dx, y: e.y + dy };
    }
  });
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/** Colour per layer used by this app (ACI numbers). Anything else gets 7. */
export const DEFAULT_LAYER_COLORS: Record<string, number> = {
  DISC: 5,
  HOUSING: 3,
  OUTPUT_PLATE: 4,
  CAM: 6,
  PINS: 30,
  [NOTES_LAYER]: 8,
};

/** Layer names are upper-case ASCII letters, digits, '_' and '-' only (the R12 safe set). */
export function safeLayerName(name: string): string {
  const s = name.toUpperCase().replace(/[^A-Z0-9_$-]/g, '_').slice(0, 31);
  return s === '' ? '0' : s;
}

/**
 * Write a complete R12 ASCII DXF: HEADER ($ACADVER AC1009, $INSUNITS, $EXTMIN, $EXTMAX), TABLES (LTYPE CONTINUOUS,
 * LAYER, STYLE STANDARD), an empty BLOCKS section and ENTITIES. Polylines are POLYLINE / VERTEX / SEQEND with
 * flag 1 when closed. Throws on a non-finite coordinate rather than writing a broken file.
 */
export function writeDxf(entities: readonly DxfEntity[], options: DxfOptions = {}): string {
  const units: DxfUnits = options.units ?? 'mm';
  const eol = options.eol ?? '\r\n';
  const k = units === 'in' ? 1 / IN_MM : 1;
  const out: string[] = [];
  const g = (code: number, value: string | number) => {
    out.push(String(code).padStart(3, ' '));
    out.push(typeof value === 'number' ? fmtNum(value) : value);
  };
  const gi = (code: number, value: number) => {
    out.push(String(code).padStart(3, ' '));
    out.push(String(Math.trunc(value)));
  };
  const n = (v: number) => v * k;

  // Layers: declared ones first, then any layer an entity uses that was not declared. Layer 0 always exists.
  const layerMap = new Map<string, number>();
  layerMap.set('0', 7);
  for (const l of options.layers ?? []) layerMap.set(safeLayerName(l.name), l.color);
  const layerOf = (e: DxfEntity): string => (e.type === 'TEXT' ? NOTES_LAYER : safeLayerName(e.layer));
  for (const e of entities) {
    const name = layerOf(e);
    if (!layerMap.has(name)) layerMap.set(name, DEFAULT_LAYER_COLORS[name] ?? 7);
  }

  const ext = entityExtents(entities);

  // HEADER
  g(0, 'SECTION');
  g(2, 'HEADER');
  g(9, '$ACADVER');
  g(1, 'AC1009');
  g(9, '$INSUNITS');
  gi(70, units === 'in' ? 1 : 4);
  g(9, '$EXTMIN');
  g(10, n(ext.minX));
  g(20, n(ext.minY));
  g(30, 0);
  g(9, '$EXTMAX');
  g(10, n(ext.maxX));
  g(20, n(ext.maxY));
  g(30, 0);
  g(0, 'ENDSEC');

  // TABLES
  g(0, 'SECTION');
  g(2, 'TABLES');
  g(0, 'TABLE');
  g(2, 'LTYPE');
  gi(70, 1);
  g(0, 'LTYPE');
  g(2, 'CONTINUOUS');
  gi(70, 0);
  g(3, 'Solid line');
  gi(72, 65);
  gi(73, 0);
  g(40, 0);
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'LAYER');
  gi(70, layerMap.size);
  for (const [name, color] of layerMap) {
    g(0, 'LAYER');
    g(2, name);
    gi(70, 0);
    gi(62, color);
    g(6, 'CONTINUOUS');
  }
  g(0, 'ENDTAB');
  g(0, 'TABLE');
  g(2, 'STYLE');
  gi(70, 1);
  g(0, 'STYLE');
  g(2, 'STANDARD');
  gi(70, 0);
  g(40, 0);
  g(41, 1);
  g(50, 0);
  gi(71, 0);
  g(42, 0.2);
  g(3, 'txt');
  g(4, '');
  g(0, 'ENDTAB');
  g(0, 'ENDSEC');

  // BLOCKS (empty; some R12 readers insist on the section)
  g(0, 'SECTION');
  g(2, 'BLOCKS');
  g(0, 'ENDSEC');

  // ENTITIES
  g(0, 'SECTION');
  g(2, 'ENTITIES');
  for (const e of entities) {
    const layer = layerOf(e);
    switch (e.type) {
      case 'LINE':
        g(0, 'LINE');
        g(8, layer);
        g(10, n(e.x1)); g(20, n(e.y1)); g(30, 0);
        g(11, n(e.x2)); g(21, n(e.y2)); g(31, 0);
        break;
      case 'CIRCLE':
        if (!(e.r > 0)) throw new Error('DXF export: circle radius must be positive');
        g(0, 'CIRCLE');
        g(8, layer);
        g(10, n(e.cx)); g(20, n(e.cy)); g(30, 0);
        g(40, n(e.r));
        break;
      case 'POLYLINE':
        g(0, 'POLYLINE');
        g(8, layer);
        gi(66, 1);
        g(10, 0); g(20, 0); g(30, 0);
        gi(70, e.closed ? 1 : 0);
        for (const p of e.points) {
          g(0, 'VERTEX');
          g(8, layer);
          g(10, n(p.x)); g(20, n(p.y)); g(30, 0);
        }
        g(0, 'SEQEND');
        g(8, layer);
        break;
      case 'TEXT':
        g(0, 'TEXT');
        g(8, layer);
        g(10, n(e.x)); g(20, n(e.y)); g(30, 0);
        g(40, n(e.height));
        g(1, asciiText(e.text));
        break;
    }
  }
  g(0, 'ENDSEC');
  g(0, 'EOF');
  return out.join(eol) + eol;
}
