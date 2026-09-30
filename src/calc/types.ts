// Shared types for the calculation engine. Units: mm, N, N*m, MPa, g (masses in arm model), deg where named.

import type { InnerPinSpec, MaterialProps, OuterPinSpec } from './materials';

export interface BearingSpec {
  /** Display name, e.g. "61800" */
  name: string;
  /** Dynamic load rating C, N */
  C: number;
  /** Static load rating C0, N */
  C0: number;
}

/** All inputs of one gearbox check. Every field is user-editable. */
export interface GearboxInputs {
  // Geometry
  /** Outer (ring) pins, integer >= 8. Disc lobes Zc = Zp - 1, ratio Zp-1 : 1 */
  Zp: number;
  /** Inner (output) pins, integer >= 3 */
  Zw: number;
  /** Outer pin circle diameter, mm */
  D: number;
  /** Eccentricity, mm (K1 = e*Zp/Rp is derived) */
  e: number;
  /** Disc thickness = contact length, mm */
  L: number;
  /** Outer pin (bushing) radius, mm */
  rr: number;
  /** Inner pin (standoff) radius, mm */
  rw: number;
  /** Disc centre bore = eccentric bearing OD, mm */
  Db: number;
  /** Minimum ligament, mm */
  tMin: number;
  /** Number of discs, 1 or 2 */
  discs: number;
  /** Axial clearance per interface, mm */
  gap: number;
  /** Inner pin circle radius override, mm. null = pushed out as far as the ligament allows. */
  RwOverride: number | null;
  /** Housing wall beyond the outer pins, mm (only used for the housing OD read-out, default 4) */
  wall: number;

  // Materials
  discMaterial: MaterialProps;
  outerPin: OuterPinSpec;
  innerPin: InnerPinSpec;

  // Loads and factors
  /** Required (working) output torque, N*m */
  Treq: number;
  /** Design torque, N*m */
  Tdes: number;
  /** Load concentration factor, strength case */
  Kc: number;
  /** Load concentration factor, life case (after run-in) */
  KcLife: number;
  /** Disc share of torque. null = automatic (1.0 for 1 disc, 0.55 for 2 discs) */
  discShare: number | null;
  bearing: BearingSpec;
  /** Input speed, rpm */
  rpm: number;
  /** Required bearing life, h */
  reqLifeH: number;
}

export type CheckStatus = 'ok' | 'marginal' | 'fail';

export type CheckId =
  | 'ringContactStrength'
  | 'ringContactLife'
  | 'innerContactStrength'
  | 'innerContactLife'
  | 'ligamentBore'
  | 'ligamentHoles'
  | 'ligamentRoot'
  | 'cusp'
  | 'boltBending'
  | 'standoffBending'
  | 'bearingStatic'
  | 'bearingLife';

export interface Check {
  id: CheckId;
  label: string;
  /** Computed value (may be Infinity for L10h at zero load; NaN never appears in a valid result) */
  value: number;
  /** Limit the value is compared with */
  limit: number;
  unit: string;
  /** 'max': value must stay <= limit. 'min': value must stay >= limit. */
  kind: 'max' | 'min';
  /** value/limit for 'max', limit/value for 'min'. Finite, capped at 99. */
  utilization: number;
  /** ok <= 0.85 < marginal <= 1.0 < fail */
  status: CheckStatus;
  /** One-line human explanation of the limit */
  basis: string;
  /** Extra numbers to show as info (e.g. bolt fixed-fixed stress, standoff cantilever stress) */
  info?: Record<string, number>;
}

export type Verdict = 'pass' | 'marginal' | 'fail' | 'invalid';

export interface DerivedGeometry {
  Zc: number;
  ratio: number;
  Rp: number;
  K1: number;
  /** Inner hole diameter, mm */
  dh: number;
  /** Radius of the lobe root (pin centre circle minus e minus rr), mm */
  Rroot: number;
  /** Inner pin circle radius actually used, mm */
  Rw: number;
  RwIsOverride: boolean;
  ligBore: number;
  ligHoles: number;
  /** Ligament between the holes and the lobe root, mm (= tMin unless Rw is overridden) */
  ligRoot: number;
  /** Edge-to-edge clearance between neighbouring outer pins, mm (info, not a SPEC check) */
  pinClearance: number;
  /** Effective contact modulus for the ring pins, MPa */
  EstarRing: number;
  /** Effective contact modulus for the inner pins, MPa */
  EstarInner: number;
  /** Disc share of torque actually used */
  share: number;
  /** Outer pin span between housing plates, mm */
  span: number;
  /** Housing outer diameter = D + 2 rr + 2 wall, mm */
  housingOD: number;
}

/** Values at T = 1 N*m on one disc, Kc = 1 (the SPEC "unit case"). */
export interface UnitResults {
  /** Peak ring Hertz pressure, MPa */
  p0Ring: number;
  /** Peak ring pin force, N */
  FRing: number;
  /** Inner hole Hertz pressure, MPa */
  p0Inner: number;
  /** Peak inner pin force, N */
  FInner: number;
  /** Peak eccentric bearing load, N */
  Fb: number;
  /** Minimum convex actual-profile radius of curvature, mm (Infinity if none) */
  rhoMinConvex: number;
}

export interface ScaledLoads {
  /** Ring contact p0, strength case, MPa */
  p0RingStrength: number;
  p0RingLife: number;
  p0InnerStrength: number;
  p0InnerLife: number;
  /** Peak ring pin force at design torque, N */
  FRingPeak: number;
  /** Peak inner pin force at design torque, N */
  FInnerPeak: number;
  /** Bolt/pin bending, fixed-fixed and simply-supported, MPa */
  boltBendingFixed: number;
  boltBendingSimple: number;
  /** Inner pin bending with tie ring and cantilever, MPa */
  standoffBendingTie: number;
  standoffBendingCantilever: number;
  standoffArm: number;
  /** Bearing peak load (design torque) and working load (required torque), N */
  bearingPeak: number;
  bearingWorking: number;
  L10h: number;
}

export interface MassEstimate {
  /** Profile area minus bore minus holes, mm^2 */
  netAreaMm2: number;
  /** Mass of one disc, g */
  perDisc_g: number;
  /** Mass of all discs, g */
  total_g: number;
}

/** Sweep over one full input revolution, used for the p0-vs-theta chart. */
export interface SweepData {
  /** Input angle, degrees */
  thetaDeg: number[];
  /** Max ring contact p0 over the pins at each theta, strength case, MPa */
  p0Strength: number[];
  /** Same, life case, MPa */
  p0Life: number[];
  /** Max ring pin force at each theta at design torque, N */
  FPeak: number[];
  /** Eccentric bearing load at each theta at design torque, N */
  bearingLoad: number[];
  limitStrength: number;
  limitLife: number;
}

export interface GearboxResult {
  /** False if inputs are unusable; then checks is empty and errors explains why */
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** True if the disc or a pin is a polymer: show the polymer warning card */
  polymerWarning: boolean;
  derived: DerivedGeometry;
  unit: UnitResults;
  loads: ScaledLoads;
  checks: Check[];
  verdict: Verdict;
  /** Check with the highest utilization (the governing failure mode) */
  governing: Check | null;
  /** Highest utilization over all checks (99 when invalid) */
  maxUtilization: number;
  /** Highest utilization over the four contact checks (the solver score) */
  contactScore: number;
  cusp: boolean;
  mass: MassEstimate;
  sweep: SweepData;
  /** Resolution used */
  resolution: { npf: number; nth: number };
}

export interface ResolutionOptions {
  /** Profile samples (SPEC default 6000) */
  npf?: number;
  /** Input-angle steps (SPEC default 240) */
  nth?: number;
}

export interface DiscPin {
  index: number;
  /** Position in the ring frame, mm */
  x: number;
  y: number;
  /** Pin radius, mm */
  r: number;
  loaded: boolean;
  /** Force per N*m of torque on one disc, N (unit case) */
  forceUnit: number;
  /** Force at design torque (Kc*Tdes*share), N */
  force: number;
  /** Hertz pressure at design torque, strength case, MPa (0 when unloaded) */
  p0Strength: number;
  p0Life: number;
}

export interface DiscDrawing {
  theta: number;
  /** Disc centre C = e*u in the ring frame */
  center: { x: number; y: number };
  /** Disc profile polyline in the ring frame (closed, not repeated) */
  profile: { x: number; y: number }[];
  outerPins: DiscPin[];
  /** Holes in the disc (diameter dh) in the ring frame */
  innerHoles: { x: number; y: number; r: number }[];
  /** Output pins in the ring frame */
  innerPins: { x: number; y: number; r: number }[];
  bore: { x: number; y: number; r: number };
  /** Largest pin force at this theta, N (for colour scaling) */
  maxForce: number;
}

export interface GearboxModel {
  inputs: GearboxInputs;
  result: GearboxResult;
  /** Per-pin forces and stresses at input angle theta (rad). Null if the inputs are invalid. */
  pinsAt(theta: number): DiscPin[] | null;
  /** Everything needed to draw the disc at input angle theta (rad). Null if invalid. */
  drawingAt(theta: number, profilePoints?: number): DiscDrawing | null;
  /** Disc profile in the disc frame, centred on the disc centre. */
  profilePoints(n?: number): { x: number; y: number }[] | null;
}
