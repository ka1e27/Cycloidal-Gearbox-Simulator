// Part geometry for the DXF export. Pure: GearboxInputs (+ allowances) in, entity lists out. All lengths in mm.
//
// Parts (each drawn about its own origin, one DXF layer per part, labels on NOTES):
//   DISC          profile polyline (SPEC "actual profile" = pin-centre path offset inward by rr + clearance),
//                 centre bore circle, Zw inner holes (dh = 2*rw + 2*e) on radius Rw
//   HOUSING       outline circle at the housing OD, Zp pin holes on the pin circle, optional centre hole
//   OUTPUT_PLATE  Zw holes on radius Rw, outline circle, optional centre hole (output plate and tie plate share it)
//   CAM           bearing-ID circle offset by e from the input-shaft hole (second cam at 180 deg for two discs)
//   PINS          cross-sections: outer bushing (or solid pin), bolt shank, inner standoff (or solid pin)

import {
  BEARINGS,
  INNER_PIN_OPTIONS,
  MATERIALS,
  createGearboxModel,
  type GearboxInputs,
  type GearboxModel,
  type MaterialProps,
} from '../calc';
import {
  DEFAULT_LAYER_COLORS,
  NOTES_LAYER,
  asciiText,
  entityExtents,
  geometryExtents,
  textWidth,
  translateEntities,
  writeDxf,
  type DxfEntity,
  type DxfExtents,
  type DxfLayer,
  type DxfPoint,
  type DxfUnits,
} from './dxf';

// ---------------------------------------------------------------------------
// Options
// ---------------------------------------------------------------------------

export interface ExportOptions {
  /** Unit of the written file. */
  units: DxfUnits;
  /** Profile offset / clearance, mm. Positive shrinks the disc: the profile is offset by rr + clearance. Default 0. */
  profileClearance: number;
  /** Polyline points per lobe. null = choose the count from `maxChordError` instead. Default 120. */
  pointsPerLobe: number | null;
  /** Largest allowed gap between the polyline chords and the true profile, mm (used when pointsPerLobe is null). */
  maxChordError: number;
  /** Extra diameter added to the disc centre bore and the Zw disc holes, mm. Default 0. */
  discHoleClearance: number;
  /** Extra diameter on pin / bolt holes in the plates and on the bushing bore, mm. Default 0.2. */
  pinHoleClearance: number;
  /** Input shaft diameter for the cam, mm. Default 5. */
  shaftDia: number;
  /** Eccentric bearing inner diameter (= cam outside diameter), mm. null = look up the bearing in the catalog. */
  bearingBore: number | null;
  /** Centre hole in the housing plate */
  housingCentreHole: boolean;
  housingCentreDia: number;
  /** Output / tie plate outline diameter, mm. null = 2*Rw + inner pin OD + 2*4 mm. */
  plateOutlineDia: number | null;
  outputCentreHole: boolean;
  outputCentreDia: number;
}

export const DEFAULT_EXPORT_OPTIONS: Readonly<ExportOptions> = Object.freeze({
  units: 'mm',
  profileClearance: 0,
  pointsPerLobe: 120,
  maxChordError: 0.005,
  discHoleClearance: 0,
  pinHoleClearance: 0.2,
  shaftDia: 5,
  bearingBore: null,
  housingCentreHole: false,
  housingCentreDia: 10,
  plateOutlineDia: null,
  outputCentreHole: false,
  outputCentreDia: 10,
});

/** Margin of plate material around the inner pin holes for the default output plate outline, mm (each side). */
export const OUTPUT_PLATE_MARGIN = 4;
/** Hard limits that keep a typed number from producing an absurd file. */
export const EXPORT_LIMITS = { pointsPerLobe: [12, 2000], maxChordError: [0.0005, 1], maxClearance: 50, maxDia: 2000, maxTotalPoints: 100000 } as const;

const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** Fill any missing or non-numeric field from the defaults (for localStorage / hand-edited input). */
export function normalizeExportOptions(raw: unknown): ExportOptions {
  const d: ExportOptions = { ...DEFAULT_EXPORT_OPTIONS };
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const num = <K extends keyof ExportOptions>(k: K) => { if (isNum(r[k])) (d as unknown as Record<string, unknown>)[k] = r[k]; };
  const bool = <K extends keyof ExportOptions>(k: K) => { if (typeof r[k] === 'boolean') (d as unknown as Record<string, unknown>)[k] = r[k]; };
  if (r.units === 'mm' || r.units === 'in') d.units = r.units;
  for (const k of ['profileClearance', 'maxChordError', 'discHoleClearance', 'pinHoleClearance', 'shaftDia', 'housingCentreDia', 'outputCentreDia'] as const) num(k);
  if (r.pointsPerLobe === null || isNum(r.pointsPerLobe)) d.pointsPerLobe = r.pointsPerLobe as number | null;
  if (r.bearingBore === null || isNum(r.bearingBore)) d.bearingBore = r.bearingBore as number | null;
  if (r.plateOutlineDia === null || isNum(r.plateOutlineDia)) d.plateOutlineDia = r.plateOutlineDia as number | null;
  bool('housingCentreHole');
  bool('outputCentreHole');
  return d;
}

/** Messages per field, for inline validation. An empty object means the options are usable. */
export function validateExportOptions(o: ExportOptions): Partial<Record<keyof ExportOptions, string>> {
  const e: Partial<Record<keyof ExportOptions, string>> = {};
  const L = EXPORT_LIMITS;
  if (!isNum(o.profileClearance) || Math.abs(o.profileClearance) > L.maxClearance) e.profileClearance = `Enter a clearance between -${L.maxClearance} and ${L.maxClearance} mm`;
  if (o.pointsPerLobe !== null && (!isNum(o.pointsPerLobe) || o.pointsPerLobe < L.pointsPerLobe[0] || o.pointsPerLobe > L.pointsPerLobe[1])) {
    e.pointsPerLobe = `Points per lobe must be ${L.pointsPerLobe[0]} to ${L.pointsPerLobe[1]}`;
  }
  if (!isNum(o.maxChordError) || o.maxChordError < L.maxChordError[0] || o.maxChordError > L.maxChordError[1]) {
    e.maxChordError = `Chord error must be ${L.maxChordError[0]} to ${L.maxChordError[1]} mm`;
  }
  if (!isNum(o.discHoleClearance) || o.discHoleClearance < -1 || o.discHoleClearance > L.maxClearance) e.discHoleClearance = `Enter a clearance between -1 and ${L.maxClearance} mm`;
  if (!isNum(o.pinHoleClearance) || o.pinHoleClearance < 0 || o.pinHoleClearance > L.maxClearance) e.pinHoleClearance = `Enter a clearance between 0 and ${L.maxClearance} mm`;
  if (!isNum(o.shaftDia) || o.shaftDia <= 0 || o.shaftDia > L.maxDia) e.shaftDia = 'Shaft diameter must be greater than 0';
  if (o.bearingBore !== null && (!isNum(o.bearingBore) || o.bearingBore <= 0 || o.bearingBore > L.maxDia)) e.bearingBore = 'Bearing ID must be greater than 0';
  if (o.plateOutlineDia !== null && (!isNum(o.plateOutlineDia) || o.plateOutlineDia <= 0 || o.plateOutlineDia > L.maxDia)) e.plateOutlineDia = 'Outline diameter must be greater than 0';
  if (o.housingCentreHole && (!isNum(o.housingCentreDia) || o.housingCentreDia <= 0 || o.housingCentreDia > L.maxDia)) e.housingCentreDia = 'Centre hole diameter must be greater than 0';
  if (o.outputCentreHole && (!isNum(o.outputCentreDia) || o.outputCentreDia <= 0 || o.outputCentreDia > L.maxDia)) e.outputCentreDia = 'Centre hole diameter must be greater than 0';
  return e;
}

// ---------------------------------------------------------------------------
// Disc profile
// ---------------------------------------------------------------------------

export interface ProfileResult {
  points: DxfPoint[];
  /** Largest distance between a chord and the true profile at its mid-parameter, mm */
  chordError: number;
  /** Smallest convex-lobe radius of curvature of the offset profile (Infinity if none), mm */
  minLobeRadius: number;
  /** A lobe radius of curvature below 0.3 mm (or an undercut) at this offset */
  cusp: boolean;
  /** The polyline provably does not cross itself (star-shaped about the origin), or an exact test found no crossing */
  simple: boolean;
}

/** SPEC cusp threshold: any 0 < rho_a < 0.3 mm. */
const CUSP_RHO = 0.3;

interface PathSample { x: number; y: number; kt: number }

/** Pin-centre path point and its curvature at parameter p, offset inward by `off`: (X - off*nx, Y - off*ny). */
function profileAt(Zp: number, Rp: number, e: number, off: number, p: number): PathSample {
  const c = Math.cos(p), s = Math.sin(p), cz = Math.cos(Zp * p), sz = Math.sin(Zp * p);
  const X = Rp * c - e * cz, Y = Rp * s - e * sz;
  const dX = -Rp * s + e * Zp * sz, dY = Rp * c - e * Zp * cz;
  const ddX = -Rp * c + e * Zp * Zp * cz, ddY = -Rp * s + e * Zp * Zp * sz;
  const sq = dX * dX + dY * dY;
  const len = Math.sqrt(sq);
  const kt = (dX * ddY - dY * ddX) / (sq * len);
  return { x: X - (off * dY) / len, y: Y + (off * dX) / len, kt };
}

/** Do segments (a,b) and (c,d) properly cross? */
function segmentsCross(a: DxfPoint, b: DxfPoint, c: DxfPoint, d: DxfPoint): boolean {
  const o = (p: DxfPoint, q: DxfPoint, r: DxfPoint) => (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
  const d1 = o(a, b, c), d2 = o(a, b, d), d3 = o(c, d, a), d4 = o(c, d, b);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** Exact O(n^2) self-intersection test of a closed polyline, skipping neighbouring segments. */
function polylineSelfIntersects(pts: readonly DxfPoint[]): boolean {
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % n];
    const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x), minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
    for (let j = i + 2; j < n; j++) {
      if (i === 0 && j === n - 1) continue;
      const c = pts[j], d = pts[(j + 1) % n];
      if (Math.max(c.x, d.x) < minX || Math.min(c.x, d.x) > maxX || Math.max(c.y, d.y) < minY || Math.min(c.y, d.y) > maxY) continue;
      if (segmentsCross(a, b, c, d)) return true;
    }
  }
  return false;
}

/**
 * The disc outline: n points at p = 2*pi*k/n (the engine's sampling, endpoint excluded), counter-clockwise,
 * starting on the +x axis at the lobe root (radius Rp - e - off). With off = rr this is exactly
 * `createGearboxModel(inputs).profilePoints(n)`.
 */
export function discProfile(Zp: number, Rp: number, e: number, off: number, n: number): ProfileResult {
  const pts: DxfPoint[] = [];
  const dp = (2 * Math.PI) / n;
  let minRho = Infinity;
  let cusp = false;
  let chordError = 0;
  let prev: PathSample | null = null;
  let first: PathSample | null = null;
  let angMonotonic = true;
  let lastAng = 0;
  let totalAng = 0;
  for (let k = 0; k <= n; k++) {
    const sm: PathSample = k === n ? (first as PathSample) : profileAt(Zp, Rp, e, off, k * dp);
    if (k === 0) first = sm;
    if (k < n) {
      pts.push({ x: sm.x, y: sm.y });
      if (sm.kt > 0) {
        const rho = 1 / sm.kt - off;
        if (rho < minRho) minRho = rho;
        if (rho < CUSP_RHO) cusp = true;
      }
    }
    // the closing segment (last point back to the first) is measured against the sample at p = 2*pi
    if (prev) {
      const mid = profileAt(Zp, Rp, e, off, (k - 0.5) * dp);
      const dx = sm.x - prev.x, dy = sm.y - prev.y;
      const l = Math.hypot(dx, dy);
      const dist = l > 0 ? Math.abs((mid.x - prev.x) * dy - (mid.y - prev.y) * dx) / l : Math.hypot(mid.x - prev.x, mid.y - prev.y);
      if (dist > chordError) chordError = dist;
    }
    // polar angle must keep increasing for the outline to be star-shaped about the disc centre
    const ang = Math.atan2(sm.y, sm.x);
    if (k > 0) {
      let da = ang - lastAng;
      while (da <= -Math.PI) da += 2 * Math.PI;
      while (da > Math.PI) da -= 2 * Math.PI;
      if (!(da > 0)) angMonotonic = false;
      totalAng += da;
    }
    lastAng = ang;
    prev = sm;
  }
  let simple: boolean;
  if (angMonotonic && Math.abs(totalAng - 2 * Math.PI) < 1e-6) simple = true;
  else if (n <= 6000) simple = !polylineSelfIntersects(pts);
  else simple = false; // cannot prove it cheaply: report as suspect
  if (!Number.isFinite(minRho)) minRho = Infinity;
  return { points: pts, chordError, minLobeRadius: minRho, cusp, simple };
}

/** Points per lobe that keeps the chord error under `tol` mm (the error falls with the square of the count). */
export function pointsPerLobeForChordError(Zp: number, Rp: number, e: number, off: number, tol: number): number {
  const Zc = Zp - 1;
  const lo = EXPORT_LIMITS.pointsPerLobe[0];
  const hi = Math.min(EXPORT_LIMITS.pointsPerLobe[1], Math.floor(EXPORT_LIMITS.maxTotalPoints / Zc));
  let ppl = Math.min(hi, 60);
  for (let i = 0; i < 8; i++) {
    const err = discProfile(Zp, Rp, e, off, ppl * Zc).chordError;
    if (err <= tol || ppl >= hi) break;
    ppl = Math.min(hi, Math.max(ppl + 1, Math.ceil(ppl * Math.sqrt(err / tol) * 1.05)));
  }
  return Math.max(lo, ppl);
}

// ---------------------------------------------------------------------------
// Labels, names
// ---------------------------------------------------------------------------

function sameMaterial(a: MaterialProps, b: MaterialProps): boolean {
  return a.E === b.E && a.nu === b.nu && a.Sy === b.Sy && a.sigmaF === b.sigmaF && a.density === b.density && a.kind === b.kind;
}

/** Library name when the disc material matches an entry exactly, else "custom (metal)". */
export function materialLabel(m: MaterialProps): string {
  const hit = MATERIALS.find((x) => sameMaterial(m, x));
  return hit ? hit.name : `custom ${m.kind}`;
}

/** mm value as short text: 46 -> "46", 0.863 -> "0.863", 1.3 -> "1.3" (at most `dp` decimals, trailing zeros dropped). */
export function trimNum(v: number, dp = 3): string {
  if (!Number.isFinite(v)) return '?';
  return String(parseFloat(v.toFixed(dp)));
}

const fix = (v: number, dp = 2): string => (Number.isFinite(v) ? v.toFixed(dp) : '?');

/** Part ids in sheet order, plus 'all'. */
export type PartId = 'disc' | 'housing' | 'outputPlate' | 'cam' | 'pins';
export const PART_IDS: readonly PartId[] = ['disc', 'housing', 'outputPlate', 'cam', 'pins'];

const PART_META: Record<PartId, { title: string; layer: string; slug: string }> = {
  disc: { title: 'Cycloidal disc', layer: 'DISC', slug: 'cycloid-disc' },
  housing: { title: 'Ring-pin housing plate', layer: 'HOUSING', slug: 'ring-housing-plate' },
  outputPlate: { title: 'Output / tie plate', layer: 'OUTPUT_PLATE', slug: 'output-tie-plate' },
  cam: { title: 'Eccentric cam', layer: 'CAM', slug: 'eccentric-cam' },
  pins: { title: 'Pins, bushings and bolts', layer: 'PINS', slug: 'pins-bushings' },
};

export const EXPORT_LAYERS: DxfLayer[] = [
  ...PART_IDS.map((id) => ({ name: PART_META[id].layer, color: DEFAULT_LAYER_COLORS[PART_META[id].layer] })),
  { name: NOTES_LAYER, color: DEFAULT_LAYER_COLORS[NOTES_LAYER] },
];

export interface PartDrawing {
  id: PartId;
  title: string;
  layer: string;
  /** Entities about the part's own origin (disc centre, plate centre, shaft centre), notes included */
  entities: DxfEntity[];
  /** Bounding box of geometry and notes */
  bbox: DxfExtents;
  /** How many to make */
  quantity: number;
  /** One short line per feature, for the UI */
  summary: string[];
  warnings: string[];
}

export interface ExportInfo {
  Zp: number;
  Zc: number;
  D: number;
  e: number;
  rr: number;
  Rp: number;
  Rw: number;
  dh: number;
  housingOD: number;
  discs: number;
  /** Radius offset used for the disc profile, mm (rr + clearance) */
  profileOffset: number;
  pointsPerLobe: number;
  pointCount: number;
  chordError: number;
  minLobeRadius: number;
}

export interface PartsResult {
  /** False when the inputs cannot be drawn; `errors` says why and `parts` is empty */
  ok: boolean;
  errors: string[];
  /** All part warnings, de-duplicated (cusp, hole breakout, unknown bearing ...) */
  warnings: string[];
  parts: PartDrawing[];
  info: ExportInfo | null;
  /** Used in file names, e.g. "J3_D46_e0.863_Zp18" */
  tag: string;
  label: string;
}

const NOTE_H = 2.5;
const NOTE_LINE = NOTE_H * 1.7;
const NOTE_GAP = 5;
const CELL_GAP = 14;

/** Collects the entities of one part, then appends a text block under it. */
class PartBuilder {
  entities: DxfEntity[] = [];
  summary: string[] = [];
  warnings: string[] = [];
  constructor(readonly layer: string) {}
  circle(cx: number, cy: number, r: number): void {
    if (!(r > 0) || !Number.isFinite(r) || !Number.isFinite(cx) || !Number.isFinite(cy)) return;
    this.entities.push({ type: 'CIRCLE', layer: this.layer, cx, cy, r });
  }
  poly(points: DxfPoint[], closed = true): void {
    this.entities.push({ type: 'POLYLINE', layer: this.layer, points, closed });
  }
  line(x1: number, y1: number, x2: number, y2: number, layer = NOTES_LAYER): void {
    this.entities.push({ type: 'LINE', layer, x1, y1, x2, y2 });
  }
  text(x: number, y: number, text: string, height = NOTE_H): void {
    this.entities.push({ type: 'TEXT', x, y, height, text });
  }
  /** Notes block below the geometry, left-aligned with it. `drop` leaves that many extra mm above the block. */
  notes(lines: string[], drop = 0): void {
    const g = geometryExtents(this.entities);
    const x0 = g.minX;
    let y = g.minY - NOTE_GAP - NOTE_H - drop;
    for (const l of lines) {
      this.text(x0, y, l);
      y -= NOTE_LINE;
    }
  }
  finish(id: PartId, quantity: number): PartDrawing {
    return {
      id,
      title: PART_META[id].title,
      layer: PART_META[id].layer,
      entities: this.entities,
      bbox: entityExtents(this.entities),
      quantity,
      summary: this.summary,
      warnings: this.warnings,
    };
  }
}

function ringOfCircles(b: PartBuilder, count: number, radius: number, dia: number, startDeg = 0): void {
  for (let k = 0; k < count; k++) {
    const a = (2 * Math.PI * k) / count + (startDeg * Math.PI) / 180;
    b.circle(radius * Math.cos(a), radius * Math.sin(a), dia / 2);
  }
}

/** Nominal metric thread size (mm) for the inner standoff: catalog match first, else from the tap bore (about 0.82 x size). */
export function standoffThread(innerBore: number, innerOd: number): { nominal: number; label: string } {
  const hit = INNER_PIN_OPTIONS.find((o) => Math.abs(o.bore - innerBore) < 0.06 && Math.abs(o.od - innerOd) < 0.6)
    ?? INNER_PIN_OPTIONS.find((o) => Math.abs(o.bore - innerBore) < 0.06);
  if (hit) return { nominal: parseFloat(hit.thread.replace(/^M/, '')), label: hit.thread };
  const sizes = [2, 2.5, 3, 4, 5, 6, 8, 10, 12, 16, 20];
  const guess = innerBore / 0.82;
  const nominal = sizes.reduce((best, s) => (Math.abs(s - guess) < Math.abs(best - guess) ? s : best), sizes[0]);
  return { nominal, label: `M${trimNum(nominal, 1)}` };
}

function bearingBoreFor(inputs: GearboxInputs): { bore: number | null; name: string } {
  const named = BEARINGS.find((b) => b.name === inputs.bearing.name);
  if (named && Math.abs(named.OD - inputs.Db) < 0.5) return { bore: named.bore, name: named.name };
  const byOd = BEARINGS.find((b) => Math.abs(b.OD - inputs.Db) < 0.05);
  if (byOd) return { bore: byOd.bore, name: inputs.bearing.name };
  return { bore: null, name: inputs.bearing.name };
}

function fileTag(label: string, D: number, e: number, Zp: number): string {
  const lab = label.replace(/[^A-Za-z0-9-]+/g, '').slice(0, 12) || 'custom';
  return `${lab}_D${trimNum(D, 2)}_e${trimNum(e, 3)}_Zp${Zp}`;
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

/**
 * Build every part for the gearbox inputs. Never throws: unusable inputs give `ok: false` with the engine's errors.
 * Pass the already-built `model` to skip rebuilding the engine model.
 */
export function buildParts(
  inputs: GearboxInputs,
  optionsIn: Partial<ExportOptions> = {},
  label = 'custom',
  model?: GearboxModel,
): PartsResult {
  const o = normalizeExportOptions({ ...DEFAULT_EXPORT_OPTIONS, ...optionsIn });
  const fail = (errors: string[]): PartsResult => ({ ok: false, errors, warnings: [], parts: [], info: null, tag: '', label });
  try {
    const optErr = Object.values(validateExportOptions(o));
    if (optErr.length) return fail(optErr as string[]);
    const m = model ?? createGearboxModel(inputs);
    const r = m.result;
    if (!r.valid) return fail(r.errors.length ? r.errors : ['The gearbox inputs are not valid yet.']);
    const d = r.derived;
    const Zp = inputs.Zp, Zw = inputs.Zw, Zc = d.Zc, e = inputs.e, rr = inputs.rr, Rp = d.Rp;
    const off = rr + o.profileClearance;
    if (!(off > 0)) return fail(['Profile clearance makes the offset (rr + clearance) zero or negative.']);
    if (!(Rp - e - off > 0)) return fail(['Profile offset is too large: the lobe root radius would be zero or negative.']);

    // ---- disc profile
    const maxPpl = Math.max(EXPORT_LIMITS.pointsPerLobe[0], Math.floor(EXPORT_LIMITS.maxTotalPoints / Zc));
    const ppl = o.pointsPerLobe != null
      ? Math.min(maxPpl, Math.max(EXPORT_LIMITS.pointsPerLobe[0], Math.round(o.pointsPerLobe)))
      : pointsPerLobeForChordError(Zp, Rp, e, off, o.maxChordError);
    const prof = discProfile(Zp, Rp, e, off, ppl * Zc);

    const parts: PartDrawing[] = [];
    const tag = fileTag(label, inputs.D, e, Zp);

    // ---- disc
    {
      const b = new PartBuilder('DISC');
      b.poly(prof.points, true);
      const boreD = inputs.Db + o.discHoleClearance;
      const holeD = d.dh + o.discHoleClearance;
      if (inputs.Db > 0) b.circle(0, 0, boreD / 2);
      ringOfCircles(b, Zw, d.Rw, holeD);
      b.summary.push(`Profile: closed polyline, ${prof.points.length} points (${ppl} per lobe, ${Zc} lobes)`);
      if (inputs.Db > 0) b.summary.push(`Centre bore: dia ${fix(boreD)} mm`);
      b.summary.push(`${Zw} inner holes: dia ${fix(holeD)} mm on radius ${fix(d.Rw)} mm`);
      if (r.cusp) {
        b.warnings.push('The engine flags a cusp or undercut on the disc profile (a lobe radius of curvature under 0.3 mm). The profile is exported anyway: check it before cutting.');
      } else if (prof.cusp) {
        b.warnings.push(`With the profile clearance of ${fix(o.profileClearance, 3)} mm a lobe radius of curvature falls to ${fix(prof.minLobeRadius, 3)} mm (a cusp). Exported anyway: check it before cutting.`);
      }
      if (!prof.simple) b.warnings.push('The disc outline may cross itself (a loop at a lobe). Exported anyway: inspect it before cutting.');
      if (inputs.Db > 0 && d.ligBore < 0) b.warnings.push('The bearing bore touches or crosses the inner holes.');
      const notes = [
        `${PART_META.disc.title.toUpperCase()}  ${label}  make ${inputs.discs}${inputs.discs === 2 ? ' (2 discs, 180 deg out of phase)' : ''}`,
        `Zp ${Zp}  Zc ${Zc} lobes  ratio ${Zc}:1  D ${fix(inputs.D)}  e ${fix(e, 3)}  rr ${fix(rr, 3)}  L ${fix(inputs.L, 3)}`,
        `Material ${materialLabel(inputs.discMaterial)}  thickness ${fix(inputs.L, 3)} mm`,
        `Profile offset ${fix(off, 3)} mm (rr ${fix(rr, 3)} + clearance ${fix(o.profileClearance, 3)})`,
        `Profile ${prof.points.length} pts, chord error <= ${fix(prof.chordError, 4)} mm; root R ${fix(Rp - e - off, 3)}  tip R ${fix(Rp + e - off, 3)}`,
        `Bore dia ${fix(boreD)}  ${Zw} holes dia ${fix(holeD)} on R ${fix(d.Rw)}`,
      ];
      b.notes(notes);
      parts.push(b.finish('disc', inputs.discs));
    }

    // ---- housing plate
    {
      const b = new PartBuilder('HOUSING');
      const outer = inputs.outerPin.construction === 'boltBushing';
      const holeD = (outer ? inputs.outerPin.shankDia : 2 * rr) + o.pinHoleClearance;
      const R = d.housingOD / 2;
      b.circle(0, 0, R);
      ringOfCircles(b, Zp, Rp, holeD);
      if (o.housingCentreHole) b.circle(0, 0, o.housingCentreDia / 2);
      b.summary.push(`Outline: circle dia ${fix(d.housingOD)} mm (D + 2*rr + 2*wall)`);
      b.summary.push(`${Zp} pin holes: dia ${fix(holeD)} mm (${outer ? 'bolt shank' : 'pin OD'} + ${fix(o.pinHoleClearance)}) on dia ${fix(inputs.D)} mm`);
      if (o.housingCentreHole) b.summary.push(`Centre hole: dia ${fix(o.housingCentreDia)} mm`);
      if (R < Rp + holeD / 2 + 0.5) b.warnings.push('Housing plate: the outline leaves under 0.5 mm of material outside the pin holes. Increase the wall.');
      if (o.housingCentreHole && o.housingCentreDia / 2 > Rp - holeD / 2 - 0.5) b.warnings.push('Housing plate: the centre hole runs into the pin holes. Make it smaller.');
      b.notes([
        `${PART_META.housing.title.toUpperCase()}  ${label}  make 2 (pins span two plates)`,
        `Outline dia ${fix(d.housingOD)} = D ${fix(inputs.D)} + 2*rr ${fix(rr, 3)} + 2*wall ${fix(inputs.wall)}`,
        `${Zp} holes dia ${fix(holeD)} on D ${fix(inputs.D)}  (${outer ? `bolt shank ${fix(inputs.outerPin.shankDia)}` : `solid pin OD ${fix(2 * rr)}`} + ${fix(o.pinHoleClearance)})`,
        o.housingCentreHole ? `Centre hole dia ${fix(o.housingCentreDia)}` : 'No centre hole',
        `Pin span ${fix(d.span, 3)} mm between plates`,
      ]);
      parts.push(b.finish('housing', 2));
    }

    // ---- output / tie plate
    {
      const b = new PartBuilder('OUTPUT_PLATE');
      const standoff = inputs.innerPin.construction === 'standoff';
      const thread = standoffThread(inputs.innerPin.bore, inputs.innerPin.od);
      const holeD = (standoff ? thread.nominal : 2 * inputs.rw) + o.pinHoleClearance;
      const autoOd = 2 * d.Rw + 2 * inputs.rw + 2 * OUTPUT_PLATE_MARGIN;
      const outlineD = o.plateOutlineDia ?? autoOd;
      b.circle(0, 0, outlineD / 2);
      ringOfCircles(b, Zw, d.Rw, holeD);
      if (o.outputCentreHole) b.circle(0, 0, o.outputCentreDia / 2);
      b.summary.push(`Outline: circle dia ${fix(outlineD)} mm${o.plateOutlineDia == null ? ' (auto: 2*Rw + pin OD + 2*4)' : ''}`);
      b.summary.push(`${Zw} holes: dia ${fix(holeD)} mm (${standoff ? `${thread.label} screw clearance` : 'solid pin OD'} + ${fix(o.pinHoleClearance)}) on radius ${fix(d.Rw)} mm`);
      if (o.outputCentreHole) b.summary.push(`Centre hole: dia ${fix(o.outputCentreDia)} mm`);
      if (outlineD / 2 < d.Rw + holeD / 2 + 0.5) b.warnings.push('Output plate: the outline leaves under 0.5 mm of material outside the holes.');
      if (o.outputCentreHole && o.outputCentreDia / 2 > d.Rw - holeD / 2 - 0.5) b.warnings.push('Output plate: the centre hole runs into the pin holes. Make it smaller.');
      b.notes([
        `${PART_META.outputPlate.title.toUpperCase()}  ${label}  make 2 (output plate + tie plate, same hole pattern)`,
        `Outline dia ${fix(outlineD)}${o.plateOutlineDia == null ? ' (auto)' : ''}`,
        `${Zw} holes dia ${fix(holeD)} on R ${fix(d.Rw)}  (${standoff ? `${thread.label} screw in standoff` : `solid pin OD ${fix(2 * inputs.rw)}`} + ${fix(o.pinHoleClearance)})`,
        o.outputCentreHole ? `Centre hole dia ${fix(o.outputCentreDia)}` : 'No centre hole',
        `Hole angle 0 deg faces +x (disc hole 1 at theta 0)`,
      ]);
      parts.push(b.finish('outputPlate', 2));
    }

    // ---- cam
    {
      const b = new PartBuilder('CAM');
      const bb = bearingBoreFor(inputs);
      const bore = o.bearingBore ?? bb.bore ?? Math.round(inputs.Db * 0.5);
      if (o.bearingBore == null && bb.bore == null) {
        b.warnings.push(`Eccentric cam: bearing "${bb.name}" is not in the catalog, so its inner diameter is assumed to be ${fix(bore, 1)} mm. Set the bearing ID in the manufacturing allowances.`);
      }
      const n = inputs.discs;
      const pitch = bore + 8;
      for (let k = 0; k < n; k++) {
        const ox = k * pitch;
        const sign = k % 2 === 0 ? 1 : -1;
        b.circle(ox, 0, o.shaftDia / 2);
        b.circle(ox + sign * e, 0, bore / 2);
        // eccentricity marker on the NOTES layer
        b.line(ox, 0, ox + sign * e, 0);
        b.line(ox - 1, 0, ox + 1, 0);
        b.line(ox, -1, ox, 1);
      }
      b.summary.push(`Cam outside diameter ${fix(bore)} mm (= bearing ID${o.bearingBore == null ? `, ${bb.name}` : ''}) offset ${fix(e, 3)} mm from the shaft hole`);
      b.summary.push(`Shaft hole dia ${fix(o.shaftDia)} mm`);
      if (n === 2) b.summary.push('Second cam is 180 deg opposite the first');
      if (o.shaftDia / 2 + e >= bore / 2) b.warnings.push('Eccentric cam: the shaft hole breaks through the cam wall. Use a smaller shaft or a bigger bearing.');
      else if (bore / 2 - (o.shaftDia / 2 + e) < 1) b.warnings.push('Eccentric cam: under 1 mm of wall between the shaft hole and the cam outside.');
      b.notes([
        `${PART_META.cam.title.toUpperCase()}  ${label}  make ${n}${n === 2 ? ' (cam 2 is 180 deg from cam 1)' : ''}`,
        `Cam OD ${fix(bore)} (bearing ID)  e ${fix(e, 3)}  shaft hole dia ${fix(o.shaftDia)}`,
        n === 2 ? 'Left: cam 1 (offset +x). Right: cam 2 (offset -x)' : 'Offset is toward +x from the shaft hole',
        `Bearing ${inputs.bearing.name}: ID ${fix(bore)} OD ${fix(inputs.Db)} (disc bore)`,
        'Add a set screw or key as your shaft needs',
      ]);
      parts.push(b.finish('cam', n));
    }

    // ---- pins
    {
      const b = new PartBuilder('PINS');
      const boltBushing = inputs.outerPin.construction === 'boltBushing';
      const standoff = inputs.innerPin.construction === 'standoff';
      const thread = standoffThread(inputs.innerPin.bore, inputs.innerPin.od);
      const items: { tag: string; od: number; id: number | null; text: string }[] = [];
      if (boltBushing) {
        const bushId = inputs.outerPin.shankDia + o.pinHoleClearance;
        items.push({ tag: '1', od: 2 * rr, id: bushId, text: `1  Outer bushing: OD ${fix(2 * rr)}  ID ${fix(bushId)} (shank + ${fix(o.pinHoleClearance)})  disc stack ${fix(inputs.discs * inputs.L + (inputs.discs - 1) * inputs.gap, 2)}  make ${Zp}` });
        items.push({ tag: '2', od: inputs.outerPin.shankDia, id: null, text: `2  Bolt shank (section): dia ${fix(inputs.outerPin.shankDia)}  span ${fix(d.span, 3)} between plates  make ${Zp}` });
      } else {
        items.push({ tag: '1', od: 2 * rr, id: null, text: `1  Outer pin (solid): OD ${fix(2 * rr)}  span ${fix(d.span, 3)} between plates plus plate engagement  make ${Zp}` });
      }
      if (standoff) {
        items.push({ tag: String(items.length + 1), od: inputs.innerPin.od, id: inputs.innerPin.bore, text: `${items.length + 1}  Inner standoff: OD ${fix(inputs.innerPin.od)}  bore ${fix(inputs.innerPin.bore)} (${thread.label} tap)  make ${Zw}` });
      } else {
        items.push({ tag: String(items.length + 1), od: 2 * inputs.rw, id: null, text: `${items.length + 1}  Inner pin (solid): OD ${fix(2 * inputs.rw)}  make ${Zw}` });
      }
      let x = 0;
      for (const it of items) {
        const cx = x + it.od / 2;
        b.circle(cx, 0, it.od / 2);
        if (it.id && it.id > 0) {
          if (it.id < it.od) b.circle(cx, 0, it.id / 2);
          else b.warnings.push(`Pin section ${it.tag}: the bore (${fix(it.id)} mm) is not smaller than the outside diameter.`);
        }
        // short number tag under each circle
        b.text(cx - NOTE_H * 0.4, -it.od / 2 - NOTE_GAP, it.tag);
        b.summary.push(it.text.replace(/^\d+ {2}/, ''));
        x += it.od + 8;
      }
      // the legend sits one text row below the number tags
      b.notes([`${PART_META.pins.title.toUpperCase()}  ${label}  cross-sections (the pins are bought or turned, these are for reference)`, ...items.map((it) => it.text)], NOTE_LINE);
      parts.push(b.finish('pins', Zp + Zw));
    }

    const warnings: string[] = [];
    for (const p of parts) for (const w of p.warnings) if (!warnings.includes(w)) warnings.push(w);

    // make sure nothing non-finite escaped
    for (const p of parts) assertFinite(p.entities);

    return {
      ok: true,
      errors: [],
      warnings,
      parts,
      info: {
        Zp, Zc, D: inputs.D, e, rr, Rp, Rw: d.Rw, dh: d.dh, housingOD: d.housingOD, discs: inputs.discs,
        profileOffset: off, pointsPerLobe: ppl, pointCount: prof.points.length, chordError: prof.chordError, minLobeRadius: prof.minLobeRadius,
      },
      tag,
      label,
    };
  } catch (err) {
    return fail([`DXF export failed: ${err instanceof Error ? err.message : String(err)}`]);
  }
}

function assertFinite(entities: readonly DxfEntity[]): void {
  const bad = (v: number) => !Number.isFinite(v);
  for (const e of entities) {
    const ok = e.type === 'LINE' ? ![e.x1, e.y1, e.x2, e.y2].some(bad)
      : e.type === 'CIRCLE' ? ![e.cx, e.cy, e.r].some(bad)
      : e.type === 'POLYLINE' ? !e.points.some((p) => bad(p.x) || bad(p.y))
      : ![e.x, e.y, e.height].some(bad);
    if (!ok) throw new Error('a drawing coordinate is not finite');
  }
}

// ---------------------------------------------------------------------------
// Sheets and files
// ---------------------------------------------------------------------------

/**
 * Lay parts out in rows without overlap (top-left packed, wrap at `rowWidth` mm) and return the entities.
 * One part keeps its own origin (the part centre stays at 0,0).
 */
export function layoutParts(parts: readonly PartDrawing[], title?: string, rowWidth = 360): DxfEntity[] {
  if (parts.length === 1 && !title) return parts[0].entities;
  const out: DxfEntity[] = [];
  let x = 0;
  let y = 0;
  let rowH = 0;
  const placed: { p: PartDrawing; x: number; y: number }[] = [];
  for (const p of parts) {
    const w = p.bbox.maxX - p.bbox.minX;
    const h = p.bbox.maxY - p.bbox.minY;
    if (x > 0 && x + w > rowWidth) {
      x = 0;
      y -= rowH + CELL_GAP;
      rowH = 0;
    }
    placed.push({ p, x, y });
    x += w + CELL_GAP;
    rowH = Math.max(rowH, h);
  }
  for (const { p, x: cx, y: cy } of placed) {
    // cell top-left at (cx, cy): shift so bbox.minX -> cx and bbox.maxY -> cy
    out.push(...translateEntities(p.entities, cx - p.bbox.minX, cy - p.bbox.maxY));
  }
  if (title) {
    const ext = geometryExtents(out);
    out.push({ type: 'TEXT', x: 0, y: Math.max(ext.maxY, 0) + NOTE_GAP + NOTE_H, height: NOTE_H * 1.4, text: title });
  }
  return out;
}

export type ExportTarget = PartId | 'all';

export function exportFileName(res: PartsResult, target: ExportTarget, units: DxfUnits = 'mm'): string {
  const slug = target === 'all' ? 'cycloid-all-parts' : PART_META[target].slug;
  return `${slug}_${res.tag}${units === 'in' ? '_in' : ''}.dxf`;
}

export interface BuiltDxf {
  filename: string;
  text: string;
  entities: DxfEntity[];
  warnings: string[];
}

/** The DXF text for one part, or for every part on one sheet. Throws only if `res.ok` is false. */
export function buildDxf(res: PartsResult, target: ExportTarget, optionsIn: Partial<ExportOptions> = {}): BuiltDxf {
  if (!res.ok) throw new Error(res.errors[0] ?? 'Nothing to export');
  const o = normalizeExportOptions({ ...DEFAULT_EXPORT_OPTIONS, ...optionsIn });
  const sel = target === 'all' ? res.parts : res.parts.filter((p) => p.id === target);
  const info = res.info;
  const title = target === 'all' && info
    ? `CYCLOIDAL GEARBOX ${res.label}: all parts  Zp ${info.Zp}  Zc ${info.Zc}  D ${fix(info.D)}  e ${fix(info.e, 3)}  rr ${fix(info.rr, 3)}  units ${o.units}`
    : undefined;
  const entities = layoutParts(sel, title);
  const text = writeDxf(entities, { units: o.units, layers: EXPORT_LAYERS });
  return {
    filename: exportFileName(res, target, o.units),
    text,
    entities,
    warnings: sel.flatMap((p) => p.warnings),
  };
}

export { asciiText, textWidth };
