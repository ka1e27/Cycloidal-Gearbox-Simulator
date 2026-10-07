// Material library (CLAUDE.md Addition 2) and contact-mechanics helpers.
// Units: MPa, g/cm^3. Values are approximate: check supplier data.

import { DISC_STOCK_PLATE, DISC_STOCK_PRINTED, outerStandoffBore } from './catalog';

export type MaterialKind = 'metal' | 'polymer';
/**
 * How the disc stock comes: 'plate' (metal plate or machined plastic sheet: 1/8 to 1/2 in) or 'printed' (3D print, any
 * thickness). Optional for older sessions: `materialForm()` falls back to the kind (polymer = printed).
 */
export type MaterialForm = 'plate' | 'printed';
/** Library grouping: metals, composites (laminate sheet), machined plastics (plate / sheet / rod), 3D-printed plastics. */
export type MaterialFamily = 'metal' | 'composite' | 'machined' | 'printed';

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
  /** Stock form for the disc thickness list; missing = from `kind` (see materialForm) */
  form?: MaterialForm;
}

export interface Material extends MaterialProps {
  id: MaterialId;
  name: string;
  note: string;
  family: MaterialFamily;
  form: MaterialForm;
}

export type MaterialId =
  | 'steel-1018'
  | 'steel-4140'
  | 'al-6061'
  | 'al-7075'
  | 'g10'
  | 'hdpe'
  | 'uhmw'
  | 'pom'
  | 'delrin150'
  | 'peek'
  | 'pa66'
  | 'petg'
  | 'pla'
  | 'abs'
  | 'asa'
  | 'pc'
  | 'pa12'
  | 'pa6cf'
  | 'fl-rigid10k'
  | 'fl-tough2000'
  | 'fl-tough1500';

export const MATERIALS: readonly Material[] = [
  {
    id: 'steel-1018',
    name: 'Steel, mild (1018)',
    E: 200000, nu: 0.29, Sy: 370, sigmaF: 190, density: 7.87, kind: 'metal', family: 'metal', form: 'plate',
    note: 'Cold-drawn low-carbon steel. Typical for plain standoffs and dowels.',
  },
  {
    id: 'steel-4140',
    name: 'Steel, alloy (4140 Q&T)',
    E: 205000, nu: 0.29, Sy: 655, sigmaF: 380, density: 7.85, kind: 'metal', family: 'metal', form: 'plate',
    note: 'Quenched and tempered alloy steel. Good for hardened pins and discs.',
  },
  {
    id: 'al-6061',
    name: 'Aluminum 6061-T6',
    E: 69000, nu: 0.33, Sy: 276, sigmaF: 104, density: 2.70, kind: 'metal', family: 'metal', form: 'plate',
    note: 'SPEC default disc material. Sparse contact-fatigue data: treat life results as marginal.',
  },
  {
    id: 'al-7075',
    name: 'Aluminum 7075-T6',
    E: 71700, nu: 0.33, Sy: 503, sigmaF: 160, density: 2.81, kind: 'metal', family: 'metal', form: 'plate',
    note: 'Higher strength than 6061, lower toughness and corrosion resistance.',
  },
  // Composites (laminate sheet): plate stock thicknesses. In-plane (edgewise) properties, since the pins load the
  // disc edge in the plane of the sheet. G10 has no true yield; Sy is a conservative edgewise compressive strength.
  {
    id: 'g10',
    name: 'G10 / FR4 (glass-epoxy laminate)',
    E: 18600, nu: 0.12, Sy: 240, sigmaF: 60, density: 1.85, kind: 'polymer', family: 'composite', form: 'plate',
    note: 'Glass-fiber epoxy sheet: stiff, strong and stable, with little creep. Brittle, abrasive to pins, and the cut edges can delaminate.',
  },
  // Machined plastics (plate, sheet or rod): plate stock thicknesses
  {
    id: 'hdpe',
    name: 'HDPE (machined)',
    E: 1000, nu: 0.46, Sy: 25, sigmaF: 8, density: 0.95, kind: 'polymer', family: 'machined', form: 'plate',
    note: 'Very low friction, cheap, easy to machine; soft and creeps a lot. Best for bushings and light joints.',
  },
  {
    id: 'uhmw',
    name: 'UHMW-PE (machined)',
    E: 700, nu: 0.46, Sy: 20, sigmaF: 7, density: 0.93, kind: 'polymer', family: 'machined', form: 'plate',
    note: 'Outstanding wear and impact resistance, lowest friction; very soft.',
  },
  {
    id: 'pom',
    name: 'Acetal copolymer, POM-C (machined; e.g. Acetron GP)',
    E: 2900, nu: 0.35, Sy: 65, sigmaF: 30, density: 1.41, kind: 'polymer', family: 'machined', form: 'plate',
    note: 'The classic gear plastic and the best value for a cycloidal disc: stiff, low friction, good fatigue, machines cleanly, and no porous core in thick plate (unlike Delrin). About the price of aluminum plate.',
  },
  {
    id: 'delrin150',
    name: 'Delrin 150 (acetal homopolymer, machined)',
    E: 3100, nu: 0.35, Sy: 72, sigmaF: 32, density: 1.42, kind: 'polymer', family: 'machined', form: 'plate',
    note: 'DuPont homopolymer acetal, the usual Delrin rod and plate grade: a little stiffer and stronger than generic POM. Creep under constant load is the main risk; use a hub insert for the bearing and steel sleeves in the inner pin holes.',
  },
  {
    id: 'peek',
    name: 'PEEK, unfilled (machined)',
    E: 3800, nu: 0.4, Sy: 100, sigmaF: 40, density: 1.31, kind: 'polymer', family: 'machined', form: 'plate',
    note: 'High-performance plastic: stronger than acetal, far less creep, and usable to about 250 C. About 10x the price of acetal; worth it mainly for a joint that holds a constant load (the shoulder). Fatigue strength is an estimate.',
  },
  {
    id: 'pa66',
    name: 'Nylon PA66 (machined, moisture-conditioned)',
    E: 2000, nu: 0.39, Sy: 55, sigmaF: 20, density: 1.14, kind: 'polymer', family: 'machined', form: 'plate',
    note: 'Tough with good wear; absorbs water, which softens it.',
  },
  // 3D-printed plastics (100% infill): printed thicknesses
  {
    id: 'petg',
    name: 'PETG (3D printed, 100% infill)',
    E: 2000, nu: 0.38, Sy: 40, sigmaF: 12, density: 1.27, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'Printed polymer. Properties depend strongly on print orientation and settings.',
  },
  {
    id: 'pla',
    name: 'PLA (3D printed, 100% infill)',
    E: 3300, nu: 0.36, Sy: 50, sigmaF: 15, density: 1.24, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'Printed polymer. Glass transition near 60 C, so it softens with friction heat.',
  },
  {
    id: 'abs',
    name: 'ABS (3D printed)',
    E: 2000, nu: 0.35, Sy: 35, sigmaF: 10, density: 1.04, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'Printed polymer. Tougher and more heat resistant than PLA; warps unless printed in an enclosure.',
  },
  {
    id: 'asa',
    name: 'ASA (3D printed)',
    E: 2000, nu: 0.35, Sy: 38, sigmaF: 11, density: 1.07, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'UV-stable ABS.',
  },
  {
    id: 'pc',
    name: 'Polycarbonate (3D printed)',
    E: 2300, nu: 0.37, Sy: 55, sigmaF: 15, density: 1.20, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'Printed polymer. Strong and heat resistant; needs a hot nozzle and an enclosure.',
  },
  {
    id: 'pa12',
    name: 'Nylon PA12 (3D printed, SLS/MJF or FDM)',
    E: 1700, nu: 0.40, Sy: 45, sigmaF: 14, density: 1.01, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'Printed nylon. Tough, good wear; SLS/MJF parts are nearly isotropic, FDM parts are not.',
  },
  {
    id: 'pa6cf',
    name: 'Nylon PA6-CF (3D printed, carbon fiber)',
    E: 6000, nu: 0.35, Sy: 70, sigmaF: 20, density: 1.15, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'Stiff along the print layers, much weaker across them.',
  },
  // Formlabs SLA resins, post-cured. E and tensile strength from the Formlabs data sheets; the resins have no yield
  // point or published fatigue data, so Sy (about 0.75-0.8 x tensile strength), sigmaF (about 0.2-0.25 x), nu and the
  // density are conservative estimates.
  {
    id: 'fl-rigid10k',
    name: 'Formlabs Rigid 10K resin (3D printed, SLA, glass-filled)',
    E: 10000, nu: 0.32, Sy: 50, sigmaF: 15, density: 1.6, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'Very stiff (10 GPa) glass-filled SLA resin with high heat resistance, but brittle (1% elongation): it chips or cracks rather than bending. Data sheet: tensile 65 MPa, E 10 GPa; yield, fatigue, nu and density are estimates.',
  },
  {
    id: 'fl-tough2000',
    name: 'Formlabs Tough 2000 resin (3D printed, SLA)',
    E: 1800, nu: 0.38, Sy: 32, sigmaF: 10, density: 1.2, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'ABS-like SLA resin: stiff for a resin and tough (79% elongation). Softens from about 60 C. Data sheet: tensile 40.4 MPa, E 1.8 GPa; yield, fatigue, nu and density are estimates.',
  },
  {
    id: 'fl-tough1500',
    name: 'Formlabs Tough 1500 resin (3D printed, SLA)',
    E: 1460, nu: 0.4, Sy: 27, sigmaF: 8, density: 1.2, kind: 'polymer', family: 'printed', form: 'printed',
    note: 'PP-like SLA resin: flexible and very tough (155% elongation), but soft. Better for bushings or snap parts than a loaded disc. Data sheet: tensile 34 MPa, E 1.46 GPa; yield, fatigue, nu and density are estimates.',
  },
];

export const MATERIAL_FAMILIES: readonly { id: MaterialFamily; label: string }[] = [
  { id: 'metal', label: 'Metals' },
  { id: 'composite', label: 'Composites' },
  { id: 'machined', label: 'Machined plastics' },
  { id: 'printed', label: '3D-printed plastics' },
];

export const SUPPLIER_DATA_NOTE =
  'Material values are approximate. Check your supplier data and edit any field.';

/**
 * Generic steel used by the SPEC.md defaults for the contact pair (bushing / standoff):
 * E = 200 GPa, nu = 0.30 (this is what gives E* = 57,259 MPa on 6061-T6).
 * It is deliberately not part of MATERIALS (the library lists named materials only).
 */
export const SPEC_STEEL: MaterialProps = {
  E: 200000, nu: 0.30, Sy: 300, sigmaF: 190, density: 7.85, kind: 'metal', form: 'plate',
};

export function getMaterial(id: MaterialId): Material {
  const m = MATERIALS.find((x) => x.id === id);
  if (!m) throw new Error(`unknown material ${id}`);
  return m;
}

/** Copy the editable numeric fields of a library material. */
export function materialProps(id: MaterialId): MaterialProps {
  const m = getMaterial(id);
  return { E: m.E, nu: m.nu, Sy: m.Sy, sigmaF: m.sigmaF, density: m.density, kind: m.kind, form: m.form };
}

/** Stock form of a material: its `form`, or from `kind` when missing or unknown (polymer = printed, metal = plate). */
export function materialForm(m: Pick<MaterialProps, 'kind' | 'form'>): MaterialForm {
  if (m.form === 'plate' || m.form === 'printed') return m.form;
  return m.kind === 'polymer' ? 'printed' : 'plate';
}

/** Disc thickness list for a disc material: plate stock (metals, machined plastics) or the printed list. */
export function discStockFor(m: Pick<MaterialProps, 'kind' | 'form'>): readonly number[] {
  return materialForm(m) === 'printed' ? DISC_STOCK_PRINTED : DISC_STOCK_PLATE;
}

/** Same numbers, kind and stock form (the library entry a set of editable values still matches). */
export function sameMaterialProps(a: MaterialProps, b: MaterialProps): boolean {
  return a.E === b.E && a.nu === b.nu && a.Sy === b.Sy && a.sigmaF === b.sigmaF && a.density === b.density &&
    a.kind === b.kind && materialForm(a) === materialForm(b);
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
  'Creep: polymers deform under sustained load, so contact patches and pin fits relax over time (much less so for G10).',
  'Heat: friction and motor heat soften the part (PLA glass transition is about 60 C; HDPE and UHMW-PE soften from about 80 C).',
  'Print orientation (3D-printed parts): layer adhesion makes strength anisotropic. Orient layers so contact loads act along layers.',
  'Moisture: nylons (PA66, PA12, PA6-CF) absorb water and get softer and weaker.',
  'G10 / FR4: brittle (it cracks rather than yields), abrasive to steel pins and bushings, and the cut edges can delaminate. Its dust is a lung irritant: waterjet it or machine it wet with extraction.',
  'The Hertz pressure limits used here are only a rough screen for polymers, not a validated criterion.',
];

// ---------------------------------------------------------------------------
// Pin construction options and their bending limits
// ---------------------------------------------------------------------------

/**
 * 'integral': no pins, the teeth are machined into the housing (CLAUDE.md Addition 12).
 * 'shoulderBolt': a ground shoulder screw is the pin (no bushing): it bends and contacts as a solid pin of d = 2 rr
 * made of SHOULDER_BOLT_STEEL; the size comes from SHOULDER_BOLT_OPTIONS (catalog.ts).
 * 'standoff': a round female-female standoff is the pin (no bushing): it bends as a hollow round (OD 2 rr, the tapped bore
 * from OUTER_STANDOFF_OPTIONS) of the chosen standoff material (`standoffMaterial`) and contacts with that material.
 */
export type OuterPinConstruction = 'boltBushing' | 'solid' | 'shoulderBolt' | 'standoff' | 'integral';
export const OUTER_PIN_CONSTRUCTIONS: readonly OuterPinConstruction[] = ['boltBushing', 'solid', 'shoulderBolt', 'standoff', 'integral'];

/**
 * Alloy steel of a class 12.9 shoulder screw (ground shoulder): fixed, independent of the library.
 * Sy 1080 MPa (12.9 yield), sigma_f 450 MPa (estimate), so the bending limit is min(0.4 Sy, sigma_f) = 432 MPa.
 */
export const SHOULDER_BOLT_STEEL: MaterialProps = {
  E: 205000, nu: 0.29, Sy: 1080, sigmaF: 450, density: 7.85, kind: 'metal', form: 'plate',
};

/** Materials of a round outer standoff ('standoff' construction). */
export type StandoffMaterialId = 'stainless' | 'aluminum' | 'brass';
export const STANDOFF_MATERIAL_IDS: readonly StandoffMaterialId[] = ['stainless', 'aluminum', 'brass'];
export const DEFAULT_STANDOFF_MATERIAL: StandoffMaterialId = 'stainless';
/** Stainless 303/304 standoff stock (annealed bar): E 193 GPa, Sy 215, sigma_f 240. */
export const STANDOFF_STAINLESS: MaterialProps = {
  E: 193000, nu: 0.29, Sy: 215, sigmaF: 240, density: 8.0, kind: 'metal', form: 'plate',
};
/** Free-machining brass C360: E 97 GPa, Sy 310, sigma_f 140. */
export const STANDOFF_BRASS: MaterialProps = {
  E: 97000, nu: 0.31, Sy: 310, sigmaF: 140, density: 8.5, kind: 'metal', form: 'plate',
};
export const STANDOFF_MATERIAL_LABEL: Record<StandoffMaterialId, string> = {
  stainless: 'Stainless steel 303/304',
  aluminum: 'Aluminum 6061-T6',
  brass: 'Brass C360',
};

export function isStandoffMaterialId(x: unknown): x is StandoffMaterialId {
  return typeof x === 'string' && (STANDOFF_MATERIAL_IDS as readonly string[]).includes(x);
}

/** The properties of a standoff material (a missing or unknown id = stainless). Fresh copy each call. */
export function standoffMaterialProps(id: StandoffMaterialId | string | undefined | null): MaterialProps {
  const k = isStandoffMaterialId(id) ? id : DEFAULT_STANDOFF_MATERIAL;
  if (k === 'aluminum') return materialProps('al-6061');
  return { ...(k === 'brass' ? STANDOFF_BRASS : STANDOFF_STAINLESS) };
}

export type InnerPinConstruction = 'standoff' | 'solid';

export interface OuterPinSpec {
  construction: OuterPinConstruction;
  /** boltBushing: unthreaded bolt shank diameter, mm (bending section) */
  shankDia: number;
  /** boltBushing: bolt yield strength, MPa (class 8.8 = 640) */
  boltYield: number;
  /**
   * Contact material. For boltBushing this is the bushing (E, nu for E*); for solid it is the pin
   * material and also supplies bending strength (Sy, sigmaF). Not used by an integral ring (see housingMaterial) or a
   * shoulder bolt (always SHOULDER_BOLT_STEEL).
   */
  material: MaterialProps;
  /** integral: the housing material the teeth are machined from (contact and tooth root). Missing = aluminum 6061-T6. */
  housingMaterial?: MaterialProps;
  /** integral: radial clearance between the disc's farthest reach and the housing wall (root circle), mm. Missing = 0.3. */
  rootClearance?: number;
  /** integral: end-mill radius, which leaves a fillet where each tooth meets the root circle, mm. Missing = 1.5. */
  toolRadius?: number;
  /** standoff: the catalog entry (OUTER_STANDOFF_OPTIONS id; it tells two threads of one OD apart). Missing = first of that OD. */
  standoffId?: string;
  /** standoff: its material. Missing = stainless. */
  standoffMaterial?: StandoffMaterialId;
  /**
   * standoff: the ends sit in milled pockets of the standoff OD in both plates (true, the default) or the standoff is only
   * screwed on through clearance holes (false). Sets the default bolt hole play (0.02 vs 0.1 mm) and the DXF.
   */
  pocketLocated?: boolean;
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
  return p.construction === 'boltBushing' ? p.shankDia : 2 * rr;
}

/** The material of the outer pin body (bending and contact): the shoulder bolt steel, the standoff material, else `material`. */
export function outerPinMaterial(p: Pick<OuterPinSpec, 'construction' | 'material' | 'standoffMaterial'>): MaterialProps {
  if (p.construction === 'shoulderBolt') return SHOULDER_BOLT_STEEL;
  if (p.construction === 'standoff') return standoffMaterialProps(p.standoffMaterial);
  return p.material;
}

/** Outer standoff fields with their defaults filled (stainless, located in pockets). */
export function outerStandoffSpecOf(p: Pick<OuterPinSpec, 'standoffId' | 'standoffMaterial' | 'pocketLocated'>): {
  standoffId: string | null; standoffMaterial: StandoffMaterialId; pocketLocated: boolean;
} {
  return {
    standoffId: typeof p.standoffId === 'string' ? p.standoffId : null,
    standoffMaterial: isStandoffMaterialId(p.standoffMaterial) ? p.standoffMaterial : DEFAULT_STANDOFF_MATERIAL,
    pocketLocated: p.pocketLocated !== false,
  };
}

/** An aluminum alloy by its numbers (metal, E 60 to 80 GPa): 6061, 7075 or an edited copy. */
export function isAluminumLike(m: Pick<MaterialProps, 'kind' | 'E'>): boolean {
  return m.kind === 'metal' && m.E >= 60000 && m.E <= 80000;
}

export const STANDOFF_GALLING_WARNING =
  'Aluminum standoffs on an aluminum disc gall (like metals slide and pick up). Use stainless or brass standoffs, a plastic disc, or hard-anodize the disc.';

/** Aluminum outer standoffs sliding on an aluminum disc: the pair galls. */
export function standoffGalls(inp: { discMaterial: Pick<MaterialProps, 'kind' | 'E'>; outerPin: Pick<OuterPinSpec, 'construction' | 'standoffMaterial'> }): boolean {
  return inp.outerPin.construction === 'standoff' && outerStandoffSpecOf(inp.outerPin).standoffMaterial === 'aluminum' &&
    isAluminumLike(inp.discMaterial);
}

/** Outer pin bending stress limit, MPa: 0.4*Sy_bolt, or min(0.4*Sy, sigmaF) for a solid pin, a shoulder bolt or a standoff. */
export function outerPinBendingLimit(p: OuterPinSpec): number {
  if (p.construction === 'boltBushing') return 0.4 * p.boltYield;
  const m = outerPinMaterial(p);
  return Math.min(0.4 * m.Sy, m.sigmaF);
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

/** Outer pin section modulus, mm^3: solid round of the bending diameter; a standoff: hollow, pi (OD^4 - bore^4) / (32 OD). */
export function outerPinSectionModulus(p: OuterPinSpec, rr: number): number {
  const d = outerPinBendingDia(p, rr);
  if (p.construction === 'standoff') {
    const b = outerStandoffBore(rr, p.standoffId);
    return (Math.PI * (d ** 4 - b ** 4)) / (32 * d);
  }
  return (Math.PI * d * d * d) / 32;
}

/** Outer pin second moment of area, mm^4 (pin bending stiffness): pi d^4 / 64, hollow for a standoff. */
export function outerPinSecondMoment(p: OuterPinSpec, rr: number): number {
  const d = outerPinBendingDia(p, rr);
  const b = p.construction === 'standoff' ? outerStandoffBore(rr, p.standoffId) : 0;
  return (Math.PI * (d ** 4 - b ** 4)) / 64;
}
