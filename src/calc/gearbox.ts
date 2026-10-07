// The SPEC.md gearbox check: derived geometry, profile, ring/inner contact, bearing, scaling,
// every pass/fail check, verdict and governing mode. Pure TypeScript, never throws.

import {
  effectiveModulus,
  innerPinBendingLimit,
  innerPinSectionModulus,
  outerPinBendingLimit,
  outerPinSectionModulus,
  OUTER_PIN_CONSTRUCTIONS,
  type MaterialProps,
} from './materials';
import { shoulderBoltFor } from './catalog';
import {
  bearingUnitLoad,
  computeProfile,
  CUSP_RHO,
  innerForceTable,
  pinStateAtTheta,
  ringSweep,
  standoffRingUnit,
} from './kernel';
import {
  discEnvelope,
  filletAnalysis,
  FILLET_CLEARANCE_MIN,
  integralGeometry,
  integralGeometryErrors,
  integralSpecOf,
  ringContactMaterial,
  ringProfile,
  toothLength,
  toothRootStress,
} from './integral';
import { DEFAULT_INNER_PIN_SUPPORT, INNER_PIN_SUPPORTS } from './types';
import { resolveKc, type ResolvedKc } from './toleranceKc';
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
  InnerPinSupport,
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

/**
 * Hertz contact limits (strength = line-contact yield onset 1.67 Sy, life = subsurface shear fatigue
 * 0.577 sigma_f / 0.25). The contact is between the pin part (bushing / standoff / solid pin) and the disc,
 * so the weaker of the two sets the limit. With steel on 6061-T6 the disc governs, which gives the SPEC
 * values (460.9 and 240.0 MPa).
 */
export function contactLimits(
  disc: MaterialProps, pin: MaterialProps,
): { strength: number; life: number; governedBy: 'disc' | 'pin' } {
  return {
    strength: 1.67 * Math.min(disc.Sy, pin.Sy),
    life: (0.577 * Math.min(disc.sigmaF, pin.sigmaF)) / 0.25,
    governedBy: pin.Sy < disc.Sy || pin.sigmaF < disc.sigmaF ? 'pin' : 'disc',
  };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function checkMaterial(name: string, m: MaterialProps | undefined, errors: string[]) {
  if (!m) { errors.push(`${name}: material missing`); return; }
  const rangeErr = (v: unknown, what: string, unit: string, max: number, lowMsg: string) => {
    if (!fin(v) || v <= 0) errors.push(`${name}: ${what} ${lowMsg}`);
    else if (v > max) errors.push(`${name}: ${what} must be at most ${max} ${unit}`);
  };
  rangeErr(m.E, 'E', 'MPa', 1e7, 'must be > 0 MPa');
  if (!fin(m.nu) || m.nu <= -1 || m.nu >= 0.5) errors.push(`${name}: Poisson ratio must be in (-1, 0.5)`);
  rangeErr(m.Sy, 'yield strength', 'MPa', 1e6, 'must be > 0 MPa');
  rangeErr(m.sigmaF, 'fatigue strength', 'MPa', 1e6, 'must be > 0 MPa');
  rangeErr(m.density, 'density', 'g/cm3', 100, 'must be > 0 g/cm3');
}

/** Largest accepted values, so that no input can push a result to Infinity (SI units as entered). */
export const GEARBOX_MAX = {
  D: 1e4, e: 1e3, L: 1e3, rr: 1e3, rw: 1e3, Db: 1e4, tMin: 1e3, gap: 1e3, wall: 1e3,
  torque: 1e6, K: 100, rpm: 1e6, hours: 1e9, Rw: 1e4, bearingN: 1e9, strengthMPa: 1e6,
  pinDia: 1e3,
} as const;

/** Hard input errors (non-empty = cannot compute) and soft warnings. Never throws. */
export function validateGearboxInputs(inp: GearboxInputs): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    /** Lower-bound messages are stable text; an upper bound adds its own "must be at most" message. */
    const num = (v: unknown, name: string, cond: (x: number) => boolean, msg: string, max?: number, unit = '') => {
      if (!fin(v)) errors.push(`${name} is not a number`);
      else if (!cond(v)) errors.push(`${name} ${msg}`);
      else if (max !== undefined && v > max) errors.push(`${name} must be at most ${max}${unit ? ' ' + unit : ''}`);
    };
    const M = GEARBOX_MAX;
    num(inp.Zp, 'Zp', (x) => Number.isInteger(x) && x >= 8 && x <= 200, 'must be an integer from 8 to 200');
    num(inp.Zw, 'Zw', (x) => Number.isInteger(x) && x >= 3 && x <= 60, 'must be an integer from 3 to 60');
    num(inp.D, 'D', (x) => x > 0, 'must be > 0 mm', M.D, 'mm');
    num(inp.e, 'e', (x) => x > 0, 'must be > 0 mm', M.e, 'mm');
    num(inp.L, 'L', (x) => x > 0, 'must be > 0 mm', M.L, 'mm');
    num(inp.rr, 'rr', (x) => x > 0, 'must be > 0 mm', M.rr, 'mm');
    num(inp.rw, 'rw', (x) => x > 0, 'must be > 0 mm', M.rw, 'mm');
    num(inp.Db, 'Db', (x) => x >= 0, 'must be >= 0 mm', M.Db, 'mm');
    num(inp.tMin, 't_min', (x) => x >= 0, 'must be >= 0 mm', M.tMin, 'mm');
    num(inp.discs, 'discs', (x) => x === 1 || x === 2, 'must be 1 or 2');
    num(inp.gap, 'gap', (x) => x >= 0, 'must be >= 0 mm', M.gap, 'mm');
    num(inp.wall, 'wall', (x) => x >= 0, 'must be >= 0 mm', M.wall, 'mm');
    num(inp.Treq, 'T_req', (x) => x >= 0, 'must be >= 0 N*m', M.torque, 'N*m');
    num(inp.Tdes, 'T_des', (x) => x >= 0, 'must be >= 0 N*m', M.torque, 'N*m');
    num(inp.Kc, 'Kc', (x) => x > 0, 'must be > 0', M.K);
    num(inp.KcLife, 'Kc_life', (x) => x > 0, 'must be > 0', M.K);
    num(inp.rpm, 'Input speed', (x) => x > 0, 'must be > 0 rpm', M.rpm, 'rpm');
    num(inp.reqLifeH, 'Required life', (x) => x >= 0, 'must be >= 0 h', M.hours, 'h');
    if (inp.discShare != null) num(inp.discShare, 'Disc share', (x) => x > 0 && x <= 1, 'must be in (0, 1]');
    if (inp.RwOverride != null) num(inp.RwOverride, 'Rw override', (x) => x > 0, 'must be > 0 mm', M.Rw, 'mm');
    if (!inp.bearing) errors.push('Bearing ratings missing');
    else {
      num(inp.bearing.C, 'Bearing C', (x) => x > 0, 'must be > 0 N', M.bearingN, 'N');
      num(inp.bearing.C0, 'Bearing C0', (x) => x > 0, 'must be > 0 N', M.bearingN, 'N');
    }
    checkMaterial('Disc material', inp.discMaterial, errors);
    if (!inp.outerPin) errors.push('Outer pin spec missing');
    else {
      if (inp.outerPin.construction === 'integral') {
        // the pin / bushing material is not used: the housing is the contact partner
        const ig = integralSpecOf(inp.outerPin);
        checkMaterial('Housing material', ig.housingMaterial, errors);
        num(ig.rootClearance, 'Root clearance', (x) => x >= 0, 'must be >= 0 mm', M.gap, 'mm');
        num(ig.toolRadius, 'Tool radius', (x) => x > 0, 'must be > 0 mm', M.rr, 'mm');
      } else if (inp.outerPin.construction !== 'shoulderBolt') {
        // a shoulder bolt is always SHOULDER_BOLT_STEEL: its stored material is not used
        checkMaterial('Outer pin material', inp.outerPin.material, errors);
      }
      if (inp.outerPin.construction === 'boltBushing') {
        num(inp.outerPin.shankDia, 'Bolt shank diameter', (x) => x > 0, 'must be > 0 mm', M.pinDia, 'mm');
        num(inp.outerPin.boltYield, 'Bolt yield', (x) => x > 0, 'must be > 0 MPa', M.strengthMPa, 'MPa');
      } else if (!OUTER_PIN_CONSTRUCTIONS.includes(inp.outerPin.construction)) {
        errors.push('Outer pin construction must be boltBushing, solid, shoulderBolt or integral');
      }
    }
    if (!inp.innerPin) errors.push('Inner pin spec missing');
    else {
      checkMaterial('Inner pin material', inp.innerPin.material, errors);
      if (inp.innerPin.construction === 'standoff') {
        num(inp.innerPin.od, 'Standoff OD', (x) => x > 0, 'must be > 0 mm', M.pinDia, 'mm');
        num(inp.innerPin.bore, 'Standoff bore', (x) => x >= 0, 'must be >= 0 mm', M.pinDia, 'mm');
        num(inp.innerPin.standoffYield, 'Standoff yield', (x) => x > 0, 'must be > 0 MPa', M.strengthMPa, 'MPa');
        if (fin(inp.innerPin.od) && fin(inp.innerPin.bore) && inp.innerPin.bore >= inp.innerPin.od) {
          errors.push('Standoff bore must be smaller than its OD');
        }
      } else if (inp.innerPin.construction !== 'solid') errors.push('Inner pin construction must be standoff or solid');
    }
    if (inp.innerPinSupport !== undefined && !INNER_PIN_SUPPORTS.includes(inp.innerPinSupport)) {
      errors.push('Inner pin support must be ringClamped, ringPinned or cantilever');
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
    if (inp.outerPin.construction === 'integral' && K1 < 1) {
      const ig = integralSpecOf(inp.outerPin);
      errors.push(...integralGeometryErrors(inp.Zp, Rp, inp.e, inp.rr, ig.rootClearance, ig.toolRadius));
    }
    if (errors.length) return { errors, warnings };

    if (K1 < 0.4 || K1 > 0.85) warnings.push(`K1 = ${K1.toFixed(2)} is outside the usual 0.40 to 0.85 range.`);
    if (inp.Tdes < inp.Treq) warnings.push('T_des is below T_req.');
    if (inp.Kc < 1 || inp.KcLife < 1) warnings.push('Kc below 1 assumes better than perfect load sharing.');
    if (inp.outerPin.construction === 'shoulderBolt' && !shoulderBoltFor(inp.rr)) {
      warnings.push(`rr = ${inp.rr} mm is not a catalog shoulder bolt (shoulder ${(2 * inp.rr).toFixed(3)} mm): pick a size so the thread and the tolerance band are known.`);
    }
    if (inp.outerPin.construction !== 'integral' && 2 * inp.rr > 2 * Rp * Math.sin(Math.PI / inp.Zp) - 1) {
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

/**
 * Derived geometry. `reach` (integral ring only) is the disc's farthest reach in the ring frame from the sampled actual
 * profile (max radius + e); without it the exact analytic value Rp + 2e - rr is used.
 */
export function deriveGeometry(inp: GearboxInputs, reach?: number): DerivedGeometry {
  const Zc = inp.Zp - 1;
  const Rp = inp.D / 2;
  const dh = 2 * inp.rw + 2 * inp.e;
  const Rroot = Rp - inp.e - inp.rr;
  const RwAuto = Rroot - dh / 2 - inp.tMin;
  const Rw = inp.RwOverride != null ? inp.RwOverride : RwAuto;
  const share = discShareOf(inp.discs, inp.discShare);
  let integral: DerivedGeometry['integral'] = null;
  if (inp.outerPin.construction === 'integral') {
    const spec = integralSpecOf(inp.outerPin);
    const ig = integralGeometry(inp.Zp, Rp, inp.e, inp.rr, spec.rootClearance, spec.toolRadius, reach);
    integral = {
      Rh: ig.Rh, reach: ig.reach, rootClearance: spec.rootClearance, toolRadius: spec.toolRadius,
      toothHeight: ig.toothHeight, baseChord: ig.baseChord, pitchChord: ig.pitchChord,
      toothLength: toothLength(inp.discs, inp.L, inp.gap), filletClearance: NaN, maxToolRadius: NaN,
    };
  }
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
    EstarRing: effectiveModulus(ringContactMaterial(inp.outerPin), inp.discMaterial),
    EstarInner: effectiveModulus(inp.innerPin.material, inp.discMaterial),
    share,
    span: inp.discs * inp.L + (inp.discs + 1) * inp.gap,
    housingOD: integral ? 2 * integral.Rh + 2 * inp.wall : inp.D + 2 * inp.rr + 2 * inp.wall,
    integral,
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
  /** Tied-standoff peak bending moments per N*m on one disc (Kc = 1), N*mm: bolted ring and pinned tips */
  MRingClamped: number;
  MRingPinned: number;
}

/** The inner pin support model in effect (a missing value, e.g. from an older session, is the bolted tie ring). */
export function innerPinSupportOf(inp: Pick<GearboxInputs, 'innerPinSupport'>): InnerPinSupport {
  const v = inp.innerPinSupport;
  return v !== undefined && INNER_PIN_SUPPORTS.includes(v) ? v : DEFAULT_INNER_PIN_SUPPORT;
}

/** One-line description of each inner pin support model (check basis and UI). */
export const INNER_PIN_SUPPORT_TEXT: Record<InnerPinSupport, string> = {
  ringClamped: 'Recessed standoffs + bolted tie ring: fixed at the output face, tips tied by a floating ring',
  ringPinned: 'Recessed standoffs + tie ring, tips free to rotate: fixed at the output face, tips tied by a floating ring',
  cantilever: 'No tie ring: each pin is a cantilever fixed at the output face',
};

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
  const torque = inp.Kc * inp.Tdes * s;
  const ringC = (u.MRingClamped * torque) / Zi;
  const ringP = (u.MRingPinned * torque) / Zi;
  const model = innerPinSupportOf(inp);
  const used = model === 'ringClamped' ? ringC : model === 'ringPinned' ? ringP : so;
  const bearingPeak = u.FbUnit * inp.Tdes * s;
  const bearingWorking = u.FbUnit * inp.Treq * s;
  const ig = inp.outerPin.construction === 'integral' ? g.integral : null;
  const tooth = ig
    // each disc presses on its own L-long stretch of the tooth, so the peak (per-disc) force acts over one disc thickness
    ? toothRootStress(FRingPeak, inp.L, ig.baseChord, ig.toothHeight, integralSpecOf(inp.outerPin).housingMaterial)
    : null;
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
    // no bolt in an integral ring: reported as 0, and the check is replaced by the tooth root check
    boltBendingFixed: tooth ? 0 : (FRingPeak * g.span) / 8 / Zo,
    boltBendingSimple: tooth ? 0 : (FRingPeak * g.span) / 4 / Zo,
    toothBending: tooth ? tooth.bending : 0,
    toothShear: tooth ? tooth.shear : 0,
    toothStress: tooth ? tooth.vonMises : 0,
    standoffBendingTie: so / 2,
    standoffBendingCantilever: so,
    standoffArm,
    standoffBendingRingClamped: ringC,
    standoffBendingRingPinned: ringP,
    standoffBending: used,
    bearingPeak,
    bearingWorking,
    L10h,
  };
}

export function buildChecks(
  inp: GearboxInputs, g: DerivedGeometry, u: UnitInputs, l: ScaledLoads,
): Check[] {
  const integral = inp.outerPin.construction === 'integral' && g.integral ? g.integral : null;
  const ringLim = contactLimits(inp.discMaterial, ringContactMaterial(inp.outerPin));
  const inLim = contactLimits(inp.discMaterial, inp.innerPin.material);
  const boltLim = outerPinBendingLimit(inp.outerPin);
  const ringPart = integral ? 'disc and housing' : 'disc and pin part';
  const soLim = innerPinBendingLimit(inp.innerPin);
  const checks: Check[] = [
    mkCheck('ringContactStrength', 'Ring contact, strength', l.p0RingStrength, ringLim.strength, 'MPa', 'max',
      `1.67 x Sy of the weaker of ${ringPart}: line-contact yield onset`),
    mkCheck('ringContactLife', 'Ring contact, life', l.p0RingLife, ringLim.life, 'MPa', 'max',
      `0.577 x sigma_f / 0.25 (weaker of ${ringPart}): subsurface shear (0.25 p0) vs shear fatigue`),
    mkCheck('innerContactStrength', 'Inner hole contact, strength', l.p0InnerStrength, inLim.strength, 'MPa', 'max',
      '1.67 x Sy of the weaker of disc and pin part: line-contact yield onset'),
    mkCheck('innerContactLife', 'Inner hole contact, life', l.p0InnerLife, inLim.life, 'MPa', 'max',
      '0.577 x sigma_f / 0.25 (weaker of disc and pin part): subsurface shear (0.25 p0) vs shear fatigue'),
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
  if (integral) {
    // no pins or bolts: the tooth root and the tool fillets are checked instead (CLAUDE.md Addition 12)
    const housing = integralSpecOf(inp.outerPin).housingMaterial;
    checks.push(
      mkCheck('toothRoot', 'Ring tooth root (integral)', l.toothStress, Math.min(0.4 * housing.Sy, housing.sigmaF), 'MPa', 'max',
        'Peak ring force on one tooth as a short cantilever (working length x base chord, tooth height as the lever): von Mises of bending and shear vs min(0.4 Sy, sigma_f) of the housing',
        {
          bending: l.toothBending, shear: l.toothShear, combined: l.toothStress,
          baseChord: integral.baseChord, toothHeight: integral.toothHeight, toothLength: integral.toothLength,
        }),
      mkCheck('toolFillet', 'Tool fillet clearance', integral.filletClearance, FILLET_CLEARANCE_MIN, 'mm', 'min',
        'Smallest gap between the swept disc and the end-mill fillets at the tooth roots (negative = the fillet cuts into the disc path)',
        { toolRadius: integral.toolRadius, maxToolRadius: integral.maxToolRadius }),
    );
  } else {
    checks.push(
      mkCheck('boltBending',
        inp.outerPin.construction === 'solid' ? 'Outer pin bending'
          : inp.outerPin.construction === 'shoulderBolt' ? 'Shoulder bolt bending' : 'Outer bolt bending',
        l.boltBendingSimple, boltLim, 'MPa', 'max',
        inp.outerPin.construction === 'solid'
          ? 'Simply-supported value vs min(0.4 Sy, sigma_f) of the pin material'
          : inp.outerPin.construction === 'shoulderBolt'
            ? 'Simply-supported value on the shoulder (d = 2 rr) vs min(0.4 Sy, sigma_f) of the class 12.9 shoulder bolt steel'
            : 'Simply-supported value vs 0.4 x bolt yield (fatigue)',
        { fixedFixed: l.boltBendingFixed, simplySupported: l.boltBendingSimple }),
    );
  }
  checks.push(
    mkCheck('standoffBending', inp.innerPin.construction === 'solid' ? 'Inner pin bending' : 'Inner standoff bending',
      l.standoffBending, soLim, 'MPa', 'max',
      `${INNER_PIN_SUPPORT_TEXT[innerPinSupportOf(inp)]}. Peak bending vs ${inp.innerPin.construction === 'solid'
        ? 'min(0.5 Sy, sigma_f) of the pin material'
        : '0.5 x standoff yield'}`,
      {
        ringClamped: l.standoffBendingRingClamped, ringPinned: l.standoffBendingRingPinned,
        cantilever: l.standoffBendingCantilever, specTieRing: l.standoffBendingTie,
      }),
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
    ligRoot: n, pinClearance: n, EstarRing: n, EstarInner: n, share: n, span: n, housingOD: n, integral: null,
  };
}

function typedKc(inp: GearboxInputs | undefined): ResolvedKc {
  const Kc = inp && fin(inp.Kc) ? inp.Kc : NaN, KcLife = inp && fin(inp.KcLife) ? inp.KcLife : NaN;
  return { source: 'typed', Kc, KcLife, typedKc: Kc, typedKcLife: KcLife };
}

function invalidResult(errors: string[], warnings: string[], derived?: DerivedGeometry, res?: { npf: number; nth: number }, kc?: ResolvedKc): GearboxResult {
  const n = NaN;
  return {
    valid: false,
    errors,
    warnings,
    polymerWarning: false,
    derived: derived ?? nanGeometry(),
    unit: { p0Ring: n, FRing: n, p0Inner: n, FInner: n, Fb: n, rhoMinConvex: n, MRingClamped: n, MRingPinned: n },
    loads: {
      p0RingStrength: n, p0RingLife: n, p0InnerStrength: n, p0InnerLife: n, FRingPeak: n, FInnerPeak: n,
      boltBendingFixed: n, boltBendingSimple: n, toothBending: n, toothShear: n, toothStress: n, standoffBendingTie: n, standoffBendingCantilever: n,
      standoffArm: n, standoffBendingRingClamped: n, standoffBendingRingPinned: n, standoffBending: n,
      bearingPeak: n, bearingWorking: n, L10h: n,
    },
    checks: [],
    innerPinSupport: DEFAULT_INNER_PIN_SUPPORT,
    verdict: 'invalid',
    governing: null,
    maxUtilization: UTIL_CAP,
    contactScore: UTIL_CAP,
    cusp: false,
    mass: { netAreaMm2: n, perDisc_g: n, total_g: n },
    sweep: { thetaDeg: [], p0Strength: [], p0Life: [], FPeak: [], bearingLoad: [], limitStrength: n, limitLife: n },
    resolution: res ?? { npf: DEFAULT_NPF, nth: DEFAULT_NTH },
    kc: kc ?? typedKc(undefined),
  };
}

function isPolymer(inp: GearboxInputs): boolean {
  return inp.discMaterial.kind === 'polymer' ||
    ringContactMaterial(inp.outerPin).kind === 'polymer' ||
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

/** The inputs with the load concentration factors in effect (typed, or the cached tolerance p95 values). */
function withKc(inputs: GearboxInputs, opts?: ResolutionOptions): { inp: GearboxInputs; kc: ResolvedKc } {
  let kc: ResolvedKc;
  try {
    kc = resolveKc(inputs, opts?.toleranceKc);
  } catch {
    kc = typedKc(inputs);
  }
  return { inp: kc.source === 'tolerance' ? { ...inputs, Kc: kc.Kc, KcLife: kc.KcLife } : inputs, kc };
}

function resolveRes(opts?: ResolutionOptions): { npf: number; nth: number } {
  const npf = opts?.npf != null && Number.isFinite(opts.npf) ? Math.max(200, Math.floor(opts.npf)) : DEFAULT_NPF;
  const nth = opts?.nth != null && Number.isFinite(opts.nth) ? Math.max(12, Math.floor(opts.nth)) : DEFAULT_NTH;
  return { npf, nth };
}

/** Run the full SPEC.md check. Never throws: bad input gives `valid: false` with `errors`. */
export function checkGearbox(inputsIn: GearboxInputs, opts?: ResolutionOptions): GearboxResult {
  const res = resolveRes(opts);
  try {
    const { inp: inputs, kc } = withKc(inputsIn, opts);
    const v = validateGearboxInputs(inputs);
    if (v.errors.length) {
      const g = safeDerived(inputs);
      return invalidResult(v.errors, v.warnings, g, res, kc);
    }
    return analyze(inputs, res, v.warnings, kc).result;
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

function analyze(inp: GearboxInputs, res: { npf: number; nth: number }, warnings: string[], kc: ResolvedKc): Analysis {
  const { npf, nth } = res;
  const integralRing = inp.outerPin.construction === 'integral';
  // integral ring: the disc's swept envelope (reference theta sweep) gives the exact reach and the fillet clearance
  const env = integralRing
    ? discEnvelope(inp.Zp, inp.D / 2, inp.e, inp.rr, nth, Math.max(32, Math.min(128, Math.round((128 * npf) / DEFAULT_NPF))))
    : null;
  const g = deriveGeometry(inp, env ? env.profileMaxR + inp.e : undefined);
  if (env && g.integral) {
    const fa = filletAnalysis(env, inp.Zp, g.Rp, inp.rr, g.integral.Rh, g.integral.toolRadius);
    g.integral.filletClearance = fa.clearance;
    g.integral.maxToolRadius = fa.maxToolRadius;
  }
  const prof = computeProfile(inp.Zp, g.Rp, inp.e, inp.rr, npf);
  const sw = ringSweep(inp.Zp, g.Rp, inp.e, inp.rr, prof.kappaA, npf, nth);
  const gt = innerForceTable(inp.Zw, inp.Zp, nth);
  const fbArr = new Float64Array(nth);
  const FbUnit = bearingUnitLoad(sw, gt, g.Rw, fbArr);
  const ring = standoffRingUnit(inp.Zw, inp.Zp, nth, inp.discs, inp.L, inp.gap, g.Rw);

  const FInnerUnit = 4000 / (inp.Zw * g.Rw);
  const invRin = 1 / inp.rw - 1 / (g.dh / 2);
  const p0InnerUnit = Math.sqrt((FInnerUnit * g.EstarInner * invRin) / (Math.PI * inp.L));
  const p0RingUnit = sw.P1 * Math.sqrt(g.EstarRing / inp.L);

  const u: UnitInputs = {
    p0RingUnit, FRingUnit: sw.F, p0InnerUnit, FInnerUnit, FbUnit,
    rhoMinConvex: prof.rhoMinConvex, cusp: prof.cusp, undercut: prof.undercut,
    MRingClamped: ring.clamped, MRingPinned: ring.pinned,
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
  if (!integralRing && g.pinClearance < 1) allWarn.push('Outer pins nearly touch: edge clearance below 1 mm.');
  if (integralRing && g.integral && g.integral.filletClearance < FILLET_CLEARANCE_MIN) {
    allWarn.push(g.integral.maxToolRadius > 0
      ? `The tool fillets reach into the disc path: use an end mill of radius at most ${g.integral.maxToolRadius.toFixed(2)} mm, or more root clearance.`
      : 'The tool fillets reach into the disc path even with a very small end mill: increase the root clearance.');
  }
  const polymer = isPolymer(inp);
  const mass = estimateMass(inp, g, prof.area);
  if (mass.netAreaMm2 < 0) allWarn.push('Disc net area is negative: holes and bore exceed the profile area.');

  const sStr = Math.sqrt(inp.Kc * inp.Tdes * g.share);
  const sLife = Math.sqrt(inp.KcLife * inp.Treq * g.share);
  const kE = Math.sqrt(g.EstarRing / inp.L);
  const ringLim = contactLimits(inp.discMaterial, ringContactMaterial(inp.outerPin));
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
    integralRing ? ['tooth root stress', loads.toothStress] : ['bolt bending', loads.boltBendingSimple],
    ['standoff bending', loads.standoffBending],
    ['ring pin force', loads.FRingPeak], ['inner pin force', loads.FInnerPeak],
    ['ring contact stress', loads.p0RingStrength], ['inner contact stress', loads.p0InnerStrength],
    ['bearing peak load', loads.bearingPeak], ['disc area', prof.area],
  ];
  for (const [name, val] of probe) if (!Number.isFinite(val)) errors.push(`${name} result is not finite: the values are too extreme to compute`);
  if (Number.isNaN(loads.L10h)) errors.push('bearing life result is not a number');
  if (errors.length) {
    return {
      result: invalidResult(errors, allWarn, g, res, kc),
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
      rhoMinConvex: prof.rhoMinConvex, MRingClamped: ring.clamped, MRingPinned: ring.pinned,
    } satisfies UnitResults,
    loads,
    checks,
    innerPinSupport: innerPinSupportOf(inp),
    verdict: w.verdict,
    governing: w.governing,
    maxUtilization: w.max,
    contactScore,
    cusp: prof.cusp,
    mass,
    sweep,
    resolution: res,
    kc,
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
export function createGearboxModel(inputsIn: GearboxInputs, opts?: ResolutionOptions): GearboxModel {
  const res = resolveRes(opts);
  let analysis: Analysis | null = null;
  let result: GearboxResult;
  // the per-pin forces use the factors in effect, like the checks
  const { inp: inputs, kc } = withKc(inputsIn, opts);
  try {
    const v = validateGearboxInputs(inputs);
    if (v.errors.length) {
      result = invalidResult(v.errors, v.warnings, safeDerived(inputs), res, kc);
    } else {
      analysis = analyze(inputs, res, v.warnings, kc);
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

  const ringCache = new Map<number, { x: number; y: number }[]>();
  function ringProfileOf(tol = 0.01): { x: number; y: number }[] | null {
    const ig = result.valid ? result.derived.integral : null;
    if (!ig) return null;
    const key = Math.max(1e-4, tol);
    let pts = ringCache.get(key);
    if (!pts) {
      pts = ringProfile(inputs.Zp, result.derived.Rp, inputs.rr, ig.Rh, ig.toolRadius, key);
      ringCache.set(key, pts);
    }
    return pts.length ? pts : null;
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
      ring: d.integral ? { profile: ringProfileOf() ?? [], Rh: d.integral.Rh } : null,
    };
  }

  return {
    inputs: inputsIn,
    result,
    pinsAt,
    drawingAt,
    profilePoints: (n = 720) => discFramePoints(Math.max(60, Math.floor(n))),
    ringProfile: ringProfileOf,
  };
}
