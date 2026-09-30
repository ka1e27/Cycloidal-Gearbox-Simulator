// Catalogs used by the Design Advisor (CLAUDE.md Addition 3). Units: mm, N.

export interface BearingEntry {
  name: string;
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

export const BEARINGS: readonly BearingEntry[] = [
  { name: '61800', bore: 10, OD: 19, width: 5, C: 1380, C0: 585 },
  { name: '61801', bore: 12, OD: 21, width: 5, C: 1430, C0: 670 },
  { name: '61802', bore: 15, OD: 24, width: 5, C: 1560, C0: 800 },
  { name: '61803', bore: 17, OD: 26, width: 5, C: 1680, C0: 930 },
  { name: '61804', bore: 20, OD: 32, width: 7, C: 2700, C0: 1500 },
  { name: '6000', bore: 10, OD: 26, width: 8, C: 4550, C0: 1960 },
  { name: '6001', bore: 12, OD: 28, width: 8, C: 5100, C0: 2360 },
  { name: '6002', bore: 15, OD: 32, width: 9, C: 5600, C0: 2850 },
];

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

/** Disc thickness options, mm. 1/8, 3/16, 1/4, 3/8, 1/2 inch plate for metals. */
export const DISC_STOCK_METAL: readonly number[] = [3.175, 4.76, 6.35, 9.525, 12.7];
export const DISC_STOCK_POLYMER: readonly number[] = [4, 5, 6, 8, 10, 12];

/** Zp values the advisor tries when "let ratio vary" is on. */
export const ZP_OPTIONS: readonly number[] = [12, 14, 16, 18, 20, 22, 24, 26];

export const ZW_OPTIONS: readonly number[] = [4, 5, 6, 7, 8, 9, 10];

/** Advisor search grid */
export const ADVISOR_D_MIN = 30;
export const ADVISOR_D_MAX = 150;
export const ADVISOR_K1_MIN = 0.4;
export const ADVISOR_K1_MAX = 0.85;
export const ADVISOR_K1_STEP = 0.025;
