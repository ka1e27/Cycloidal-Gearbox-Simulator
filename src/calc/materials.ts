// Material library (CLAUDE.md Addition 2) and contact-mechanics helpers.
// Units: MPa, g/cm^3. Values are approximate: check supplier data.

export type MaterialKind = 'metal' | 'polymer';

/** Plain numeric material properties, all editable by the user. */
export interface MaterialProps {
  /** Young's modulus, MPa */
  E: number;
  /** Poisson's ratio */
  nu: number;
  /** Yield strength, MPa */
  Sy: number;
  /** Fatigue strength at 1e7 cycles, MPa */
  sigmaF: number;
  /** Density, g/cm^3 */
  density: number;
  kind: MaterialKind;
}

export interface Material extends MaterialProps {
  id: MaterialId;
  name: string;
  note: string;
}

export type MaterialId =
  | 'steel-1018'
  | 'steel-4140'
  | 'al-6061'
  | 'al-7075'
  | 'petg'
  | 'pla';

export const MATERIALS: readonly Material[] = [
  {
    id: 'steel-1018',
    name: 'Steel, mild (1018)',
    E: 200000, nu: 0.29, Sy: 370, sigmaF: 190, density: 7.87, kind: 'metal',
    note: 'Cold-drawn low-carbon steel. Typical for plain standoffs and dowels.',
  },
  {
    id: 'steel-4140',
    name: 'Steel, alloy (4140 Q&T)',
    E: 205000, nu: 0.29, Sy: 655, sigmaF: 380, density: 7.85, kind: 'metal',
    note: 'Quenched and tempered alloy steel. Good for hardened pins and discs.',
  },
  {
    id: 'al-6061',
    name: 'Aluminum 6061-T6',
    E: 69000, nu: 0.33, Sy: 276, sigmaF: 104, density: 2.70, kind: 'metal',
    note: 'SPEC default disc material. Sparse contact-fatigue data: treat life results as marginal.',
  },
  {
    id: 'al-7075',
    name: 'Aluminum 7075-T6',
    E: 71700, nu: 0.33, Sy: 503, sigmaF: 160, density: 2.81, kind: 'metal',
    note: 'Higher strength than 6061, lower toughness and corrosion resistance.',
  },
  {
    id: 'petg',
    name: 'PETG (3D printed, 100% infill)',
    E: 2000, nu: 0.38, Sy: 40, sigmaF: 12, density: 1.27, kind: 'polymer',
    note: 'Printed polymer. Properties depend strongly on print orientation and settings.',
  },
  {
    id: 'pla',
    name: 'PLA (3D printed, 100% infill)',
    E: 3300, nu: 0.36, Sy: 50, sigmaF: 15, density: 1.24, kind: 'polymer',
    note: 'Printed polymer. Glass transition near 60 C, so it softens with friction heat.',
  },
];

export const SUPPLIER_DATA_NOTE =
  'Material values are approximate. Check your supplier data and edit any field.';

/**
 * Generic steel used by the SPEC.md defaults for the contact pair (bushing / standoff):
 * E = 200 GPa, nu = 0.30 (this is what gives E* = 57,259 MPa on 6061-T6).
 * It is deliberately not part of MATERIALS (the library lists the six Addition 2 entries).
 */
export const SPEC_STEEL: MaterialProps = {
  E: 200000, nu: 0.30, Sy: 300, sigmaF: 190, density: 7.85, kind: 'metal',
};

export function getMaterial(id: MaterialId): Material {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown material ${id}`);
  return m;
}

/** Copy the editable numeric fields of a library material. */
export function materialProps(id: MaterialId): MaterialProps {
  const m = getMaterial(id);
  return { E: m.E, nu: m.nu, Sy: m.Sy, sigmaF: m.sigmaF, density: m.density, kind: m.kind };
}

/**
 * Effective contact modulus of a pin/disc pair (SPEC.md):
 * E* = 1 / ((1 - nu_pin^2)/E_pin + (1 - nu_disc^2)/E_disc).
 * Returns NaN if the inputs are not usable (never throws).
 */
export function effectiveModulus(
  pin: Pick<MaterialProps, 'E' | 'nu'>,
  disc: Pick<MaterialProps, 'E' | 'nu'>,
): number {
  const a = (1 - pin.nu * pin.nu) / pin.E;
  const b = (1 - disc.nu * disc.nu) / disc.E;
  const s = a + b;
  return s > 0 && Number.isFinite(s) ? 1 / s : NaN;
}

export const POLYMER_WARNING_LINES: readonly string[] = [
  'Creep: polymers deform under sustained load, so contact patches and pin fits relax over time.',
  'Heat: friction and motor heat soften the part (PLA glass transition is about 60 C).',
  'Print orientation: layer adhesion makes strength anisotropic. Orient layers so contact loads act along layers.',
  'The Hertz pressure limits used here are only a rough screen for polymers, not a validated criterion.',
];

// ---------------------------------------------------------------------------
// Pin construction options and their bending limits
// ---------------------------------------------------------------------------

export type OuterPinConstruction = 'boltBushing' | 'solid';
export type InnerPinConstruction = 'standoff' | 'solid';

export interface OuterPinSpec {
  construction: OuterPinConstruction;
  /** boltBushing: unthreaded bolt shank diameter, mm (bending section) */
  shankDia: number;
  /** boltBushing: bolt yield strength, MPa (class 8.8 = 640) */
  boltYield: number;
  /**
   * Contact material. For boltBushing this is the bushing (E, nu for E*); for solid it is the pin
   * material and also supplies bending strength (Sy, sigmaF).
   */
  material: MaterialProps;
}

export interface InnerPinSpec {
  construction: InnerPinConstruction;
  /** standoff: outer diameter, mm (bending section) */
  od: number;
  /** standoff: bore diameter, mm */
  bore: number;
  /** standoff: yield strength, MPa */
  standoffYield: number;
  /** Contact material (standoff steel or the solid pin material). */
  material: MaterialProps;
}

/** Outer pin bending section diameter: shank for bolt+bushing, 2*rr for a solid pin. */
export function outerPinBendingDia(p: OuterPinSpec, rr: number): number {
  return p.construction === 'solid' ? 2 * rr : p.shankDia;
}

/** Outer pin bending stress limit, MPa: 0.4*Sy_bolt, or min(0.4*Sy, sigmaF) for a solid pin. */
export function outerPinBendingLimit(p: OuterPinSpec): number {
  return p.construction === 'solid'
    ? Math.min(0.4 * p.material.Sy, p.material.sigmaF)
    : 0.4 * p.boltYield;
}

/** Inner pin section modulus, mm^3 (hollow standoff or solid round). */
export function innerPinSectionModulus(p: InnerPinSpec, rw: number): number {
  if (p.construction === 'solid') return (Math.PI * Math.pow(2 * rw, 3)) / 32;
  return (Math.PI * (Math.pow(p.od, 4) - Math.pow(p.bore, 4))) / (32 * p.od);
}

/** Inner pin bending stress limit, MPa: 0.5*Sy_standoff, or min(0.5*Sy, sigmaF) for a solid pin. */
export function innerPinBendingLimit(p: InnerPinSpec): number {
  return p.construction === 'solid'
    ? Math.min(0.5 * p.material.Sy, p.material.sigmaF)
    : 0.5 * p.standoffYield;
}

/** Outer pin section modulus, mm^3 (solid round of the bending diameter). */
export function outerPinSectionModulus(p: OuterPinSpec, rr: number): number {
  const d = outerPinBendingDia(p, rr);
  return (Math.PI * d * d * d) / 32;
}
