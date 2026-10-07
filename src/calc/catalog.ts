// Catalogs used by the Design Advisor (CLAUDE.md Addition 3). Units: mm, N.

/** Bearing series: ultra-thin 67xx (4 mm wide), thin-section 618xx, standard deep-groove 60xx. */
export type BearingSeries = '67' | '618' | '60';

export interface BearingEntry {
  name: string;
  /** Series, for grouping the pickers */
  series: BearingSeries;
  /** Bore, mm */
  bore: number;
  /** Outer diameter, mm (= disc centre bore Db) */
  OD: number;
  /** Width, mm */
  width: number;
  /** Dynamic rating C, N (approximate: verify on the datasheet) */
  C: number;
  /** Static rating C0, N (approximate: verify on the datasheet) */
  C0: number;
}

/**
 * Eccentric bearing catalog. New entries are appended (never inserted): saved Design Advisor locks store a catalog
 * index. Use BEARING_SERIES / bearingsBySeries() for display order.
 */
export const BEARINGS: readonly BearingEntry[] = [
  { name: '61800', series: '618', bore: 10, OD: 19, width: 5, C: 1380, C0: 585 },
  { name: '61801', series: '618', bore: 12, OD: 21, width: 5, C: 1430, C0: 670 },
  { name: '61802', series: '618', bore: 15, OD: 24, width: 5, C: 1560, C0: 800 },
  { name: '61803', series: '618', bore: 17, OD: 26, width: 5, C: 1680, C0: 930 },
  { name: '61804', series: '618', bore: 20, OD: 32, width: 7, C: 2700, C0: 1500 },
  { name: '6000', series: '60', bore: 10, OD: 26, width: 8, C: 4550, C0: 1960 },
  { name: '6001', series: '60', bore: 12, OD: 28, width: 8, C: 5100, C0: 2360 },
  { name: '6002', series: '60', bore: 15, OD: 32, width: 9, C: 5600, C0: 2850 },
  // Ultra-thin 67xx: 4 mm wide, lower ratings (approximate)
  { name: '6700', series: '67', bore: 10, OD: 15, width: 4, C: 855, C0: 435 },
  { name: '6701', series: '67', bore: 12, OD: 18, width: 4, C: 925, C0: 530 },
  { name: '6702', series: '67', bore: 15, OD: 21, width: 4, C: 940, C0: 585 },
  { name: '6703', series: '67', bore: 17, OD: 23, width: 4, C: 1000, C0: 655 },
  { name: '6704', series: '67', bore: 20, OD: 27, width: 4, C: 1040, C0: 730 },
  { name: '6705', series: '67', bore: 25, OD: 32, width: 4, C: 1100, C0: 840 },
  { name: '6706', series: '67', bore: 30, OD: 37, width: 4, C: 1120, C0: 900 },
];

/** Series in display order (thinnest first), with the group label the pickers show. */
export const BEARING_SERIES: readonly { id: BearingSeries; label: string }[] = [
  { id: '67', label: 'Ultra-thin 67xx (4 mm wide)' },
  { id: '618', label: 'Thin 618xx' },
  { id: '60', label: 'Standard 60xx' },
];

/** Catalog indices grouped by series, in BEARING_SERIES order (bore ascending inside a series). */
export function bearingsBySeries(): { id: BearingSeries; label: string; indices: number[] }[] {
  return BEARING_SERIES.map((s) => ({
    ...s,
    indices: BEARINGS.map((b, i) => ({ b, i })).filter((x) => x.b.series === s.id)
      .sort((a, b) => a.b.bore - b.b.bore || a.b.OD - b.b.OD).map((x) => x.i),
  }));
}

export const BEARING_NOTE = 'Bearing ratings are approximate: verify C and C0 on the manufacturer datasheet.';

export interface OuterPinOption {
  /** Pin / bushing outer diameter, mm */
  od: number;
  /** Bolt size label */
  bolt: string;
  /** Bolt shank diameter, mm */
  shank: number;
}

export const OUTER_PIN_OPTIONS: readonly OuterPinOption[] = [
  { od: 3, bolt: 'M2', shank: 2.0 },
  { od: 4, bolt: 'M2.5', shank: 2.5 },
  { od: 5, bolt: 'M3', shank: 3.0 },
  { od: 6, bolt: 'M4', shank: 4.0 },
  { od: 8, bolt: 'M5', shank: 5.0 },
  { od: 10, bolt: 'M6', shank: 6.0 },
];

export type UnitSystem = 'metric' | 'inch';

export interface ShoulderBoltOption {
  /** Stable id, e.g. 'm6' or 'in-1/4' */
  id: string;
  system: UnitSystem;
  /** Nominal shoulder diameter, mm (the checks use this; rr = dia / 2) */
  dia: number;
  /** Shoulder size label, e.g. '6 mm' or '1/4"' */
  label: string;
  /** Thread at the end of the shoulder, e.g. 'M5' or '#10-24' */
  thread: string;
  /** Tap drill for the thread, mm (the far plate hole) */
  tapDrill: number;
  /**
   * Shoulder diameter deviations from nominal, mm (both negative: ground undersize). The diameter lies in
   * [dia + lower, dia + upper], e.g. upper -0.013, lower -0.038.
   */
  upper: number;
  lower: number;
}

const MET = { upper: -0.013, lower: -0.038 } as const;
/** -0.0005 / -0.002 in */
const INCH = { upper: -0.0005 * 25.4, lower: -0.002 * 25.4 } as const;

/**
 * Ground shoulder screws (alloy steel, class 12.9 / ASTM A574 class): shoulder dia -> thread and diameter tolerance.
 * Metric -0.013/-0.038 mm (ISO 7379 style), inch -0.0005/-0.002 in. Tap drills: ISO coarse 75%, inch number / letter drills.
 * New entries are appended (advisor locks may store an index).
 */
export const SHOULDER_BOLT_OPTIONS: readonly ShoulderBoltOption[] = [
  { id: 'm4', system: 'metric', dia: 4, label: '4 mm', thread: 'M3', tapDrill: 2.5, ...MET },
  { id: 'm5', system: 'metric', dia: 5, label: '5 mm', thread: 'M4', tapDrill: 3.3, ...MET },
  { id: 'm6', system: 'metric', dia: 6, label: '6 mm', thread: 'M5', tapDrill: 4.2, ...MET },
  { id: 'm8', system: 'metric', dia: 8, label: '8 mm', thread: 'M6', tapDrill: 5.0, ...MET },
  { id: 'm10', system: 'metric', dia: 10, label: '10 mm', thread: 'M8', tapDrill: 6.8, ...MET },
  { id: 'in-1/8', system: 'inch', dia: 3.175, label: '1/8"', thread: '#4-40', tapDrill: 2.26, ...INCH },
  { id: 'in-3/16', system: 'inch', dia: 4.763, label: '3/16"', thread: '#8-32', tapDrill: 3.454, ...INCH },
  { id: 'in-1/4', system: 'inch', dia: 6.35, label: '1/4"', thread: '#10-24', tapDrill: 3.797, ...INCH },
  { id: 'in-5/16', system: 'inch', dia: 7.938, label: '5/16"', thread: '1/4-20', tapDrill: 5.105, ...INCH },
  { id: 'in-3/8', system: 'inch', dia: 9.525, label: '3/8"', thread: '5/16-18', tapDrill: 6.528, ...INCH },
];

/** Shoulder bolts of one unit system, diameter ascending. */
export function shoulderBoltsOf(system: UnitSystem): ShoulderBoltOption[] {
  return SHOULDER_BOLT_OPTIONS.filter((o) => o.system === system).sort((a, b) => a.dia - b.dia);
}

/** The shoulder bolt whose nominal diameter is 2 rr (to 0.002 mm), or null for a non-catalog size. */
export function shoulderBoltFor(rr: number): ShoulderBoltOption | null {
  return SHOULDER_BOLT_OPTIONS.find((o) => Math.abs(o.dia - 2 * rr) < 2e-3) ?? null;
}

/** Diameter band of a shoulder (catalog, or the metric band for a non-catalog size): mean undersize and half band, mm (diametral). */
export function shoulderBandOf(rr: number): { meanUndersize: number; halfBand: number; option: ShoulderBoltOption | null } {
  const o = shoulderBoltFor(rr);
  const upper = o ? o.upper : MET.upper, lower = o ? o.lower : MET.lower;
  return { meanUndersize: -(upper + lower) / 2, halfBand: (upper - lower) / 2, option: o };
}

export interface OuterStandoffOption {
  /** Stable id, e.g. 'so-m3' or 'so-in-1/4-8' */
  id: string;
  system: UnitSystem;
  /** Nominal round OD, mm (the checks use this; rr = od / 2) */
  od: number;
  /** OD label, e.g. '5 mm' or '1/4"' */
  label: string;
  /** Female thread at both ends, e.g. 'M3' or '#8-32' */
  thread: string;
  /** Tapped bore (tap drill), mm: the hollow bending section */
  bore: number;
  /** Screw clearance hole for the thread (normal fit), mm */
  clearanceHole: number;
}

/**
 * Round female-female standoffs used as OUTER pins (no bushing): OD -> thread, with the tapped bore so bending uses a
 * hollow section. Metric bores match INNER_PIN_OPTIONS; inch bores are the number tap drills. Append only (advisor locks
 * may store an index).
 */
export const OUTER_STANDOFF_OPTIONS: readonly OuterStandoffOption[] = [
  { id: 'so-m2.5', system: 'metric', od: 4.5, label: '4.5 mm', thread: 'M2.5', bore: 2.05, clearanceHole: 2.9 },
  { id: 'so-m3', system: 'metric', od: 5, label: '5 mm', thread: 'M3', bore: 2.46, clearanceHole: 3.4 },
  { id: 'so-m4', system: 'metric', od: 6, label: '6 mm', thread: 'M4', bore: 3.24, clearanceHole: 4.5 },
  { id: 'so-m5', system: 'metric', od: 8, label: '8 mm', thread: 'M5', bore: 4.13, clearanceHole: 5.5 },
  { id: 'so-in-3/16', system: 'inch', od: 4.763, label: '3/16"', thread: '#4-40', bore: 2.261, clearanceHole: 3.264 },
  { id: 'so-in-1/4-6', system: 'inch', od: 6.35, label: '1/4"', thread: '#6-32', bore: 2.705, clearanceHole: 3.797 },
  { id: 'so-in-1/4-8', system: 'inch', od: 6.35, label: '1/4"', thread: '#8-32', bore: 3.454, clearanceHole: 4.496 },
  { id: 'so-in-5/16', system: 'inch', od: 7.938, label: '5/16"', thread: '#10-32', bore: 4.039, clearanceHole: 5.105 },
];

/** Outer standoffs of one unit system, OD ascending (then the larger thread). */
export function outerStandoffsOf(system: UnitSystem): OuterStandoffOption[] {
  return OUTER_STANDOFF_OPTIONS.filter((o) => o.system === system).sort((a, b) => a.od - b.od || a.bore - b.bore);
}

/**
 * The outer standoff of a gearbox: the stored id when its OD is 2 rr (to 0.002 mm), else the first catalog entry of that
 * OD, else null (a non-catalog size).
 */
export function outerStandoffFor(rr: number, id?: string | null): OuterStandoffOption | null {
  const byId = id ? OUTER_STANDOFF_OPTIONS.find((o) => o.id === id) : undefined;
  if (byId && Math.abs(byId.od - 2 * rr) < 2e-3) return byId;
  return OUTER_STANDOFF_OPTIONS.find((o) => Math.abs(o.od - 2 * rr) < 2e-3) ?? null;
}

/** Bore of a non-catalog outer standoff, as a fraction of its OD (about M3 in 5 mm). */
export const STANDOFF_FALLBACK_BORE_RATIO = 0.5;

/** Tapped bore of the outer standoff, mm: the catalog bore, or 0.5 OD for a non-catalog size. */
export function outerStandoffBore(rr: number, id?: string | null): number {
  const o = outerStandoffFor(rr, id);
  return o ? o.bore : STANDOFF_FALLBACK_BORE_RATIO * 2 * rr;
}

export interface InnerPinOption {
  /** Standoff / pin outer diameter, mm */
  od: number;
  /** Standoff bore, mm (thread minor / tap bore) */
  bore: number;
  thread: string;
}

export const INNER_PIN_OPTIONS: readonly InnerPinOption[] = [
  { od: 4.5, bore: 2.05, thread: 'M2.5' },
  { od: 5, bore: 2.46, thread: 'M3' },
  { od: 7, bore: 3.24, thread: 'M4' },
  { od: 8, bore: 4.13, thread: 'M5' },
  { od: 10, bore: 4.9, thread: 'M6' },
];

/** Disc thickness options, mm. 1/8, 3/16, 1/4, 3/8, 1/2 inch plate (metals and machined plastics). */
export const DISC_STOCK_METAL: readonly number[] = [3.175, 4.76, 6.35, 9.525, 12.7];
/** 3D-printed discs: any thickness prints, these are round numbers. */
export const DISC_STOCK_POLYMER: readonly number[] = [4, 5, 6, 8, 10, 12];
/** Same lists by stock form (`materialForm()` of the disc material). */
export const DISC_STOCK_PLATE = DISC_STOCK_METAL;
export const DISC_STOCK_PRINTED = DISC_STOCK_POLYMER;

/** Zp values the advisor tries when "let ratio vary" is on. */
export const ZP_OPTIONS: readonly number[] = [12, 14, 16, 18, 20, 22, 24, 26];

export const ZW_OPTIONS: readonly number[] = [4, 5, 6, 7, 8, 9, 10];

/** Advisor search grid */
export const ADVISOR_D_MIN = 30;
export const ADVISOR_D_MAX = 150;
export const ADVISOR_K1_MIN = 0.4;
export const ADVISOR_K1_MAX = 0.85;
export const ADVISOR_K1_STEP = 0.025;
