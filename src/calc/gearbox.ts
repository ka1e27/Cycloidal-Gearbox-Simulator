// The SPEC.md gearbox check: derived geometry, profile, ring/inner contact, bearing, scaling,
// every pass/fail check, verdict and governing mode. Pure TypeScript, never throws.

import {
  effectiveModulus,
  innerPinBendingLimit,
  innerPinSectionModulus,
  outerPinBendingLimit,
  outerPinSectionModulus,
  type MaterialProps,
} from './materials';
import {
  bearingUnitLoad,
  computeProfile,
  CUSP_RHO,
  innerForceTable,
  pinStateAtTheta,
  ringSweep,
} from './kernel';
import type {
  Check,
  CheckId,
  CheckStatus,
  DerivedGeometry,
  DiscDrawing,
  DiscPin,
  GearboxInputs,
  GearboxModel,
  GearboxResult,
  MassEstimate,
  ResolutionOptions,
  ScaledLoads,
  SweepData,
  UnitResults,
  Verdict,
} from './types';

export const DEFAULT_NPF = 6000;
export const DEFAULT_NTH = 240;
export const GREEN_LIMIT = 0.85;
/** Utilization assigned to a check that cannot be evaluated or is hopeless. */
export const UTIL_CAP = 99;
const EPS = 1e-9;

export function statusOf(util: number): CheckStatus {
  if (!(util <= 1 + EPS)) return 'fail';
  return util <= GREEN_LIMIT + EPS ? 'ok' : 'marginal';
}

export function discShareOf(discs: number, override: number | null | undefined): number {
  if (override != null && Number.isFinite(override) && override > 0) return override;
  return discs === 2 ? 0.55 : 1.0;
}

/** Hertz contact limits (strength = line-contact yield onset, life = subsurface shear fatigue). */
export function contactLimits(
  disc: MaterialProps, pin: MaterialProps, pinIsSolid: boolean,
): { strength: number; life: number; governedBy: 'disc' | 'pin' } {
  const sy = pinIsSolid ? Math.min(disc.Sy, pin.Sy) : disc.Sy;
  const sf = pinIsSolid ? Math.min(disc.sigmaF, pin.sigmaF) : disc.sigmaF;
  return {
    strength: 1.67 * sy,
    life: (0.577 * sf) / 0.25,
    governedBy: pinIsSolid && (pin.Sy < disc.Sy || pin.sigmaF < disc.sigmaF) ? 'pin' : 'disc',
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function checkMaterial(name: string, m: MaterialProps | undefined, errors: string[]) {
  if (!m) { errors.push(`${name}: material missing`); return; }
  if (!fin(m.E) || m.E <= 0) errors.push(`${name}: E must be > 0 MPa`);
  if (!fin(m.nu) || m.nu <= -1 || m.nu >= 0.5) errors.push(`${name}: Poisson ratio must be in (-1, 0.5)`);
  if (!fin(m.Sy) || m.Sy <= 0) errors.push(`${name}: yield strength must be > 0 MPa`);
  if (!fin(m.sigmaF) || m.sigmaF <= 0) errors.push(`${name}: fatigue strength must be > 0 MPa`);
  if (!fin(m.density) || m.density <= 0) errors.push(`${name}: density must be > 0 g/cm3`);
}

/** Hard input errors (non-empty = cannot compute) and soft warnings. Never throws. */
export function validateGearboxInputs(inp: GearboxInputs): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    const num = (v: unknown, name: string, cond: (x: number) => boolean, msg: string) => {
      if (!fin(v)) errors.push(`${name} is not a number`);
      else if (!cond(v)) errors.push(`${name} ${msg}`);
    };
    num(inp.Zp, 'Zp', (x) => Number.isInteger(x) && x >= 8 && x <= 200, 'must be an integer from 8 to 200');
    num(inp.Zw, 'Zw', (x) => Number.isInteger(x) && x >= 3 && x <= 60, 'must be an integer from 3 to 60');
    num(inp.D, 'D', (x) => x > 0, 'must be > 0 mm');
    num(inp.e, 'e', (x) => x > 0, 'must be > 0 mm');
    num(inp.L, 'L', (x) => x > 0, 'must be > 0 mm');
    num(inp.rr, 'rr', (x) => x > 0, 'must be > 0 mm');
    num(inp.rw, 'rw', (x) => x > 0, 'must be > 0 mm');
    num(inp.Db, 'Db', (x) => x >= 0, 'must be >= 0 mm');
    num(inp.tMin, 't_min', (x) => x >= 0, 'must be >= 0 mm');
    num(inp.discs, 'discs', (x) => x === 1 || x === 2, 'must be 1 or 2');
    num(inp.gap, 'gap', (x) => x >= 0, 'must be >= 0 mm');
    num(inp.wall, 'wall', (x) => x >= 0, 'must be >= 0 mm');
    num(inp.Treq, 'T_req', (x) => x >= 0, 'must be >= 0 N*m');
    num(inp.Tdes, 'T_des', (x) => x >= 0, 'must be >= 0 N*m');
    num(inp.Kc, 'Kc', (x) => x > 0, 'must be > 0');
    num(inp.KcLife, 'Kc_life', (x) => x > 0, 'must be > 0');
    num(inp.rpm, 'Input speed', (x) => x > 0, 'must be > 0 rpm');
    num(inp.reqLifeH, 'Required life', (x) => x >= 0, 'must be >= 0 h');
    if (inp.discShare != null) num(inp.discShare, 'Disc share', (x) => x > 0 && x <= 1, 'must be in (0, 1]');
    if (inp.RwOverride != null) num(inp.RwOverride, 'Rw override', (x) => x > 0, 'must be > 0 mm');
    if (!inp.bearing) errors.push('Bearing ratings missing');
    else {
      num(inp.bearing.C, 'Bearing C', (x) => x > 0, 'must be > 0 N');
      num(inp.bearing.C0, 'Bearing C0', (x) => x > 0, 'must be > 0 N');
    }
    checkMaterial('Disc material', inp.discMaterial, errors);
    if (!inp.outerPin) errors.push('Outer pin spec missing');
    else {
      checkMaterial('Outer pin material', inp.outerPin.material, errors);
      if (inp.outerPin.construction === 'boltBushing') {
        num(inp.outerPin.shankDia, 'Bolt shank diameter', (x) => x > 0, 'must be > 0 mm');
        num(inp.outerPin.boltYield, 'Bolt yield', (x) => x > 0, 'must be > 0 MPa');
      } else if (inp.outerPin.construction !== 'solid') errors.push('Outer pin construction must be boltBushing or solid');
    }
    if (!inp.innerPin) errors.push('Inner pin spec missing');
    else {
      checkMaterial('Inner pin material', inp.innerPin.material, errors);
      if (inp.innerPin.construction === 'standoff') {
        num(inp.innerPin.od, 'Standoff OD', (x) => x > 0, 'must be > 0 mm');
        num(inp.innerPin.bore, 'Standoff bore', (x) => x >= 0, 'must be >= 0 mm');
        num(inp.innerPin.standoffYield, 'Standoff yield', (x) => x > 0, 'must be > 0 MPa');
        if (fin(inp.innerPin.od) && fin(inp.innerPin.bore) && inp.innerPin.bore >= inp.innerPin.od) {
          errors.push('Standoff bore must be smaller than its OD');
        }
      } else if (inp.innerPin.construction !== 'solid') errors.push('Inner pin construction must be standoff or solid');
    }
    if (errors.length) return { errors, warnings };

    const Rp = inp.D / 2;
    const K1 = (inp.e * inp.Zp) / Rp;
    if (K1 >= 1) errors.push(`K1 = e*Zp/Rp = ${K1.toFixed(2)} must be < 1 (profile degenerates)`);
    const dh = 2 * inp.rw + 2 * inp.e;
    const Rroot = Rp - inp.e - inp.rr;
    if (!(Rroot > 0)) errors.push('Outer pin circle is too small: lobe root radius <= 0');
    const Rw = inp.RwOverride ?? Rroot - dh / 2 - inp.tMin;
    if (!(Rw > 0)) errors.push('Inner pin circle radius Rw <= 0: geometry infeasible (pins too large for this D)');
    if (errors.length) return { errors, warnings };

    if (K1 < 0.4 || K1 > 0.85) warnings.push(`K1 = ${K1.toFixed(2)} is outside the usual 0.40 to 0.85 range.`);
    if (inp.Tdes < inp.Treq) warnings.push('T_des is below T_req.');
    if (inp.Kc < 1 || inp.KcLife < 1) warnings.push('Kc below 1 assumes better than perfect load sharing.');
    if (2 * inp.rr > 2 * Rp * Math.sin(Math.PI / inp.Zp) - 1) {
      warnings.push('Neighbouring outer pins are less than 1 mm apart edge to edge.');
    }
  } catch (err) {
    errors.push(`Input could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

export function deriveGeometry(inp: GearboxInputs): DerivedGeometry {
  const Zc = inp.Zp - 1;
  const Rp = inp.D / 2;
  const dh = 2 * inp.rw + 2 * inp.e;
  const Rroot = Rp - inp.e - inp.rr;
  const RwAuto = Rroot - dh / 2 - inp.tMin;
  const Rw = inp.RwOverride != null ? inp.RwOverride : RwAuto;
  const share = discShareOf(inp.discs, inp.discShare);
  return {
    Zc,
    ratio: Zc,
    Rp,
    K1: (inp.e * inp.Zp) / Rp,
    dh,
    Rroot,
    Rw,
    RwIsOverride: inp.RwOverride != null,
    ligBore: Rw - dh / 2 - inp.Db / 2,
    ligHoles: 2 * Rw * Math.sin(Math.PI / inp.Zw) - dh,
    ligRoot: Rroot - (Rw + dh / 2),
    pinClearance: 2 * Rp * Math.sin(Math.PI / inp.Zp) - 2 * inp.rr,
    EstarRing: effectiveModulus(inp.outerPin.material, inp.discMaterial),
    EstarInner: effectiveModulus(inp.innerPin.material, inp.discMaterial),
    share,
    span: inp.discs * inp.L + (inp.discs + 1) * inp.gap,
    housingOD: inp.D + 2 * inp.rr + 2 * inp.wall,
  };
}

// ---------------------------------------------------------------------------
// Scaling and checks
// ---------------------------------------------------------------------------

function mkCheck(
  id: CheckId, label: string, value: number, limit: number, unit: string,
  kind: 'max' | 'min', basis: string, info?: Record<string, number>,
): Check {
  let util: number;
  if (!Number.isFinite(value) && value !== Infinity) util = UTIL_CAP;
  else if (kind === 'max') util = limit > 0 ? value / limit : UTIL_CAP;
  else if (limit <= 0) util = 0;
  else util = value > 0 ? limit / value : UTIL_CAP;
  if (!(util >= 0)) util = UTIL_CAP;
  util = Math.min(util, UTIL_CAP);
  return { id, label, value, limit, unit, kind, utilization: util, status: statusOf(util), basis, info };
}

export interface UnitInputs {
  p0RingUnit: number;
  FRingUnit: number;
  p0InnerUnit: number;
  FInnerUnit: number;
  FbUnit: number;
  rhoMinConvex: number;
  cusp: boolean;
  undercut: boolean;
}

export function scaleLoads(inp: GearboxInputs, g: DerivedGeometry, u: UnitInputs): ScaledLoads {
  const s = g.share;
  const sStr = Math.sqrt(inp.Kc * inp.Tdes * s);
  const sLife = Math.sqrt(inp.KcLife * inp.Treq * s);
  const FRingPeak = u.FRingUnit * inp.Kc * inp.Tdes * s;
  const FInnerPeak = u.FInnerUnit * inp.Kc * inp.Tdes * s;
  const Zo = outerPinSectionModulus(inp.outerPin, inp.rr);
  const Zi = innerPinSectionModulus(inp.innerPin, inp.rw);
  const standoffArm = inp.gap + (inp.discs - 1) * (inp.L + inp.gap) + inp.L / 2;
  const so = (FInnerPeak * standoffArm) / Zi;
  const bearingPeak = u.FbUnit * inp.Tdes * s;
  const bearingWorking = u.FbUnit * inp.Treq * s;
  const L10h = bearingWorking > 0
    ? (Math.pow(inp.bearing.C / bearingWorking, 3) * 1e6) / (60 * inp.rpm)
    : Infinity;
  return {
    p0RingStrength: u.p0RingUnit * sStr,
    p0RingLife: u.p0RingUnit * sLife,
    p0InnerStrength: u.p0InnerUnit * sStr,
    p0InnerLife: u.p0InnerUnit * sLife,
    FRingPeak,
    FInnerPeak,
    boltBendingFixed: (FRingPeak * g.span) / 8 / Zo,
    boltBendingSimple: (FRingPeak * g.span) / 4 / Zo,
    standoffBendingTie: so / 2,
    standoffBendingCantilever: so,
    standoffArm,
    bearingPeak,
    bearingWorking,
    L10h,
  };
}

export function buildChecks(
  inp: GearboxInputs, g: DerivedGeometry, u: UnitInputs, l: ScaledLoads,
): Check[] {
  const ringLim = contactLimits(inp.discMaterial, inp.outerPin.material, inp.outerPin.construction === 'solid');
  const inLim = contactLimits(inp.discMaterial, inp.innerPin.material, inp.innerPin.construction === 'solid');
  const boltLim = outerPinBendingLimit(inp.outerPin);
  const soLim = innerPinBendingLimit(inp.innerPin);
  const checks: Check[] = [
    mkCheck('ringContactStrength', 'Ring contact, strength', l.p0RingStrength, ringLim.strength, 'MPa', 'max',
      '1.67 x Sy: line-contact yield onset'),
    mkCheck('ringContactLife', 'Ring contact, life', l.p0RingLife, ringLim.life, 'MPa', 'max',
      '0.577 x sigma_f / 0.25: subsurface shear (0.25 p0) vs shear fatigue'),
    mkCheck('innerContactStrength', 'Inner hole contact, strength', l.p0InnerStrength, inLim.strength, 'MPa', 'max',
      '1.67 x Sy: line-contact yield onset'),
    mkCheck('innerContactLife', 'Inner hole contact, life', l.p0InnerLife, inLim.life, 'MPa', 'max',
      '0.577 x sigma_f / 0.25: subsurface shear (0.25 p0) vs shear fatigue'),
    mkCheck('ligamentBore', 'Ligament to bore', g.ligBore, inp.tMin, 'mm', 'min',
      'At least t_min between the inner holes and the centre bore'),
    mkCheck('ligamentHoles', 'Ligament between holes', g.ligHoles, inp.tMin, 'mm', 'min',
      'At least t_min between neighbouring inner holes'),
  ];
  if (g.RwIsOverride) {
    checks.push(mkCheck('ligamentRoot', 'Ligament to lobe root', g.ligRoot, inp.tMin, 'mm', 'min',
      'At least t_min between the inner holes and the lobe root (Rw is overridden)'));
  }
  // Cusp / undercut
  {
    const base = mkCheck('cusp', 'Cusp / undercut', u.rhoMinConvex, CUSP_RHO, 'mm', 'min',
      'Minimum convex profile radius of curvature must stay above 0.3 mm');
    if (u.undercut) { base.utilization = UTIL_CAP; base.status = 'fail'; }
    else if (u.cusp && base.status !== 'fail') { base.utilization = 1.0001; base.status = 'fail'; }
    checks.push(base);
  }
  checks.push(
    mkCheck('boltBending', inp.outerPin.construction === 'solid' ? 'Outer pin bending' : 'Outer bolt bending',
      l.boltBendingSimple, boltLim, 'MPa', 'max',
      inp.outerPin.construction === 'solid'
        ? 'Simply-supported value vs min(0.4 Sy, sigma_f) of the pin material'
        : 'Simply-supported value vs 0.4 x bolt yield (fatigue)',
      { fixedFixed: l.boltBendingFixed, simplySupported: l.boltBendingSimple }),
    mkCheck('standoffBending', inp.innerPin.construction === 'solid' ? 'Inner pin bending' : 'Inner standoff bending',
      l.standoffBendingTie, soLim, 'MPa', 'max',
      inp.innerPin.construction === 'solid'
        ? 'Tie-ring value vs min(0.5 Sy, sigma_f) of the pin material'
        : 'Tie-ring value vs 0.5 x standoff yield',
      { tieRing: l.standoffBendingTie, cantilever: l.standoffBendingCantilever }),
    mkCheck('bearingStatic', 'Bearing static', l.bearingPeak, inp.bearing.C0, 'N', 'max',
      'Peak eccentric bearing load (design torque) vs static rating C0'),
    mkCheck('bearingLife', 'Bearing life (L10h)', l.L10h, inp.reqLifeH, 'h', 'min',
      'L10h at the required torque and input speed vs required hours'),
  );
  return checks;
}

function worst(checks: Check[]): { max: number; governing: Check | null; verdict: Verdict } {
  let gov: Check | null = null;
  let max = 0;
  for (const c of checks) {
    if (gov === null || c.utilization > max) { gov = c; max = c.utilization; }
  }
  const verdict: Verdict = gov === null ? 'invalid' : gov.status === 'ok' ? 'pass' : gov.status === 'marginal' ? 'marginal' : 'fail';
  return { max, governing: gov, verdict };
}

// ---------------------------------------------------------------------------
// Empty / invalid result
// ---------------------------------------------------------------------------

function nanGeometry(): DerivedGeometry {
  const n = NaN;
  return {
    Zc: n, ratio: n, Rp: n, K1: n, dh: n, Rroot: n, Rw: n, RwIsOverride: false, ligBore: n, ligHoles: n,
    ligRoot: n, pinClearance: n, EstarRing: n, EstarInner: n, share: n, span: n, housingOD: n,
  };
}

function invalidResult(errors: string[], warnings: string[], derived?: DerivedGeometry, res?: { npf: number; nth: number }): GearboxResult {
  const n = NaN;
  return {
    valid: false,
    errors,
    warnings,
    polymerWarning: false,
    derived: derived ?? nanGeometry(),
    unit: { p0Ring: n, FRing: n, p0Inner: n, FInner: n, Fb: n, rhoMinConvex: n },
    loads: {
      p0RingStrength: n, p0RingLife: n, p0InnerStrength: n, p0InnerLife: n, FRingPeak: n, FInnerPeak: n,
      boltBendingFixed: n, boltBendingSimple: n, standoffBendingTie: n, standoffBendingCantilever: n,
      standoffArm: n, bearingPeak: n, bearingWorking: n, L10h: n,
    },
    checks: [],
    verdict: 'invalid',
    governing: null,
    maxUtilization: UTIL_CAP,
    contactScore: UTIL_CAP,
    cusp: false,
    mass: { netAreaMm2: n, perDisc_g: n, total_g: n },
    sweep: { thetaDeg: [], p0Strength: [], p0Life: [], FPeak: [], bearingLoad: [], limitStrength: n, limitLife: n },
    resolution: res ?? { npf: DEFAULT_NPF, nth: DEFAULT_NTH },
  };
}

function isPolymer(inp: GearboxInputs): boolean {
  return inp.discMaterial.kind === 'polymer' ||
    inp.outerPin.material.kind === 'polymer' ||
    inp.innerPin.material.kind === 'polymer';
}

export function estimateMass(inp: GearboxInputs, g: DerivedGeometry, profileArea: number): MassEstimate {
  const net = profileArea - Math.PI * (inp.Db / 2) ** 2 - inp.Zw * Math.PI * (g.dh / 2) ** 2;
  const netA = Math.max(0, net);
  const perDisc = (netA * inp.L * inp.discMaterial.density) / 1000; // mm^3 -> cm^3 -> g
  return { netAreaMm2: net, perDisc_g: perDisc, total_g: perDisc * inp.discs };
}

// ---------------------------------------------------------------------------
// Main entry points
// ---------------------------------------------------------------------------

function resolveRes(opts?: ResolutionOptions): { npf: number; nth: number } {
  const npf = opts?.npf != null && Number.isFinite(opts.npf) ? Math.max(200, Math.floor(opts.npf)) : DEFAULT_NPF;
  const nth = opts?.nth != null && Number.isFinite(opts.nth) ? Math.max(12, Math.floor(opts.nth)) : DEFAULT_NTH;
  return { npf, nth };
}

/** Run the full SPEC.md check. Never throws: bad input gives `valid: false` with `errors`. */
export function checkGearbox(inputs: GearboxInputs, opts?: ResolutionOptions): GearboxResult {
  const res = resolveRes(opts);
  try {
    const v = validateGearboxInputs(inputs);
    if (v.errors.length) {
      const g = safeDerived(inputs);
      return invalidResult(v.errors, v.warnings, g, res);
    }
    return analyze(inputs, res, v.warnings).result;
  } catch (err) {
    return invalidResult([`Calculation failed: ${err instanceof Error ? err.message : String(err)}`], [], undefined, res);
  }
}

function safeDerived(inp: GearboxInputs): DerivedGeometry | undefined {
  try {
    const g = deriveGeometry(inp);
    return g;
  } catch {
    return undefined;
  }
}

interface Analysis {
  result: GearboxResult;
  Rp: number;
  kappaA: Float64Array;
  npf: number;
}

function analyze(inp: GearboxInputs, res: { npf: number; nth: number }, warnings: string[]): Analysis {
  const { npf, nth } = res;
  const g = deriveGeometry(inp);
  const prof = computeProfile(inp.Zp, g.Rp, inp.e, inp.rr, npf);
  const sw = ringSweep(inp.Zp, g.Rp, inp.e, inp.rr, prof.kappaA, npf, nth);
  const gt = innerForceTable(inp.Zw, inp.Zp, nth);
  const fbArr = new Float64Array(nth);
  const FbUnit = bearingUnitLoad(sw, gt, g.Rw, fbArr);

  const FInnerUnit = 4000 / (inp.Zw * g.Rw);
  const invRin = 1 / inp.rw - 1 / (g.dh / 2);
  const p0InnerUnit = Math.sqrt((FInnerUnit * g.EstarInner * invRin) / (Math.PI * inp.L));
  const p0RingUnit = sw.P1 * Math.sqrt(g.EstarRing / inp.L);

  const u: UnitInputs = {
    p0RingUnit, FRingUnit: sw.F, p0InnerUnit, FInnerUnit, FbUnit,
    rhoMinConvex: prof.rhoMinConvex, cusp: prof.cusp, undercut: prof.undercut,
  };
  const loads = scaleLoads(inp, g, u);
  const checks = buildChecks(inp, g, u, loads);
  const w = worst(checks);
  let contactScore = 0;
  for (const c of checks) {
    if (c.id === 'ringContactStrength' || c.id === 'ringContactLife' ||
        c.id === 'innerContactStrength' || c.id === 'innerContactLife') {
      contactScore = Math.max(contactScore, c.utilization);
    }
  }

  const allWarn = warnings.slice();
  if (prof.undercut) allWarn.push('Profile undercut: the pin radius exceeds the local path radius of curvature.');
  else if (prof.cusp) allWarn.push('Cusp risk: a convex lobe radius of curvature below 0.3 mm.');
  if (g.RwIsOverride && g.ligRoot < inp.tMin - EPS) {
    allWarn.push(`Rw override leaves only ${g.ligRoot.toFixed(2)} mm between the holes and the lobe root.`);
  }
  if (g.pinClearance < 1) allWarn.push('Outer pins nearly touch: edge clearance below 1 mm.');
  const polymer = isPolymer(inp);
  const mass = estimateMass(inp, g, prof.area);
  if (mass.netAreaMm2 < 0) allWarn.push('Disc net area is negative: holes and bore exceed the profile area.');

  const sStr = Math.sqrt(inp.Kc * inp.Tdes * g.share);
  const sLife = Math.sqrt(inp.KcLife * inp.Treq * g.share);
  const kE = Math.sqrt(g.EstarRing / inp.L);
  const ringLim = contactLimits(inp.discMaterial, inp.outerPin.material, inp.outerPin.construction === 'solid');
  const sweep: SweepData = {
    thetaDeg: [], p0Strength: [], p0Life: [], FPeak: [], bearingLoad: [],
    limitStrength: ringLim.strength, limitLife: ringLim.life,
  };
  for (let t = 0; t < nth; t++) {
    sweep.thetaDeg.push((360 * t) / nth);
    sweep.p0Strength.push(sw.maxP1[t] * kE * sStr);
    sweep.p0Life.push(sw.maxP1[t] * kE * sLife);
    sweep.FPeak.push(sw.maxF[t] * inp.Kc * inp.Tdes * g.share);
    sweep.bearingLoad.push(fbArr[t] * inp.Tdes * g.share);
  }

  // Non-finite guard: flag instead of propagating NaN into the UI
  const errors: string[] = [];
  const probe: [string, number][] = [
    ['ring contact', p0RingUnit], ['inner contact', p0InnerUnit], ['bearing load', FbUnit],
    ['bolt bending', loads.boltBendingSimple], ['standoff bending', loads.standoffBendingTie],
  ];
  for (const [name, val] of probe) if (!Number.isFinite(val)) errors.push(`${name} result is not finite`);
  if (errors.length) {
    return {
      result: invalidResult(errors, allWarn, g, res),
      Rp: g.Rp, kappaA: prof.kappaA, npf,
    };
  }

  const result: GearboxResult = {
    valid: true,
    errors: [],
    warnings: allWarn,
    polymerWarning: polymer,
    derived: g,
    unit: {
      p0Ring: p0RingUnit, FRing: sw.F, p0Inner: p0InnerUnit, FInner: FInnerUnit, Fb: FbUnit,
      rhoMinConvex: prof.rhoMinConvex,
    } satisfies UnitResults,
    loads,
    checks,
    verdict: w.verdict,
    governing: w.governing,
    maxUtilization: w.max,
    contactScore,
    cusp: prof.cusp,
    mass,
    sweep,
    resolution: res,
  };
  return { result, Rp: g.Rp, kappaA: prof.kappaA, npf };
}

// ---------------------------------------------------------------------------
// Model with per-theta data (slider / drawing)
// ---------------------------------------------------------------------------

/**
 * Check plus everything the UI needs for the theta slider: per-pin forces, drawing geometry,
 * profile points. Build once per input change and call pinsAt/drawingAt as the slider moves.
 */
export function createGearboxModel(inputs: GearboxInputs, opts?: ResolutionOptions): GearboxModel {
  const res = resolveRes(opts);
  let analysis: Analysis | null = null;
  let result: GearboxResult;
  try {
    const v = validateGearboxInputs(inputs);
    if (v.errors.length) {
      result = invalidResult(v.errors, v.warnings, safeDerived(inputs), res);
    } else {
      analysis = analyze(inputs, res, v.warnings);
      result = analysis.result;
      if (!result.valid) analysis = null;
    }
  } catch (err) {
    result = invalidResult([`Calculation failed: ${err instanceof Error ? err.message : String(err)}`], [], undefined, res);
  }

  const drawCache = new Map<number, { x: number; y: number }[]>();
  function discFramePoints(n: number): { x: number; y: number }[] | null {
    if (!result.valid) return null;
    let pts = drawCache.get(n);
    if (!pts) {
      const d = result.derived;
      const p = computeProfile(inputs.Zp, d.Rp, inputs.e, inputs.rr, n, true);
      pts = [];
      for (let k = 0; k < n; k++) pts.push({ x: p.px![k], y: p.py![k] });
      drawCache.set(n, pts);
    }
    return pts;
  }

  function pinsAt(theta: number): DiscPin[] | null {
    if (!analysis || !result.valid || !Number.isFinite(theta)) return null;
    try {
      const d = result.derived;
      const st = pinStateAtTheta(inputs.Zp, d.Rp, inputs.e, inputs.rr, analysis.kappaA, analysis.npf, theta);
      const scaleF = inputs.Kc * inputs.Tdes * d.share;
      const kE = Math.sqrt(d.EstarRing / inputs.L);
      const sStr = Math.sqrt(scaleF);
      const sLife = Math.sqrt(inputs.KcLife * inputs.Treq * d.share);
      const out: DiscPin[] = [];
      for (let i = 0; i < inputs.Zp; i++) {
        out.push({
          index: i, x: st.Qx[i], y: st.Qy[i], r: inputs.rr,
          loaded: st.loaded[i] === 1,
          forceUnit: st.F[i],
          force: st.F[i] * scaleF,
          p0Strength: st.P1[i] * kE * sStr,
          p0Life: st.P1[i] * kE * sLife,
        });
      }
      return out;
    } catch {
      return null;
    }
  }

  function drawingAt(theta: number, profilePoints = 720): DiscDrawing | null {
    const pins = pinsAt(theta);
    const pts = discFramePoints(Math.max(60, Math.floor(profilePoints)));
    if (!pins || !pts) return null;
    const d = result.derived;
    const Zc = d.Zc;
    const cx = inputs.e * Math.cos(theta), cy = inputs.e * Math.sin(theta);
    const rot = -theta / Zc;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const profile = pts.map((p) => ({ x: cr * p.x - sr * p.y + cx, y: sr * p.x + cr * p.y + cy }));
    const innerHoles: DiscDrawing['innerHoles'] = [];
    const innerPins: DiscDrawing['innerPins'] = [];
    for (let k = 0; k < inputs.Zw; k++) {
      const ang = (2 * Math.PI * k) / inputs.Zw - theta / Zc;
      const px = d.Rw * Math.cos(ang), py = d.Rw * Math.sin(ang);
      innerHoles.push({ x: cx + px, y: cy + py, r: d.dh / 2 });
      innerPins.push({ x: px, y: py, r: inputs.rw });
    }
    let maxForce = 0;
    for (const p of pins) if (p.force > maxForce) maxForce = p.force;
    return {
      theta, center: { x: cx, y: cy }, profile, outerPins: pins, innerHoles, innerPins,
      bore: { x: cx, y: cy, r: inputs.Db / 2 }, maxForce,
    };
  }

  return {
    inputs,
    result,
    pinsAt,
    drawingAt,
    profilePoints: (n = 720) => discFramePoints(Math.max(60, Math.floor(n))),
  };
}
