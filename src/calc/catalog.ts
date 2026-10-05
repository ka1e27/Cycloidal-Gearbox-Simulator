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
