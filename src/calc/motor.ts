// Motor torque and recommended gear ratio (CLAUDE.md Addition 8).
// Pure TypeScript. Torques in N*m, motor speed in rpm, joint speed in deg/s.
//
// Formulas (eta = gearbox efficiency, default 0.85; ratio = Zp - 1 for a cycloidal stage):
//   ratio_min = max( T_des / (eta * T_peak),  T_req / (eta * T_cont) when T_cont is given )
//   ratio_max = (max_speed_rpm * 6 deg/s per rpm) / required_speed_deg_s   when both are given
//   recommended Zp = smallest integer Zp with Zp - 1 >= ratio_min and Zp - 1 <= ratio_max, inside the allowed Zp range
//   output torque capacity = eta * T_peak * ratio (peak) and eta * T_cont * ratio (continuous)
//   output speed = max_speed_rpm * 6 / ratio  (deg/s, at full motor speed)
//   overload: eta * T_peak * ratio > T_des -> a stalled motor can exceed the gearbox design torque;
//             keep motor torque <= T_des / (eta * ratio) with the driver current limit (information, not a failed check)
// Nothing here throws; bad input comes back as status 'invalid' with messages.

import { ZP_OPTIONS } from './catalog';

/** One degree per second per rpm: 1 rpm = 360 deg / 60 s. */
export const RPM_TO_DEGPS = 6;
/** Gearbox efficiency used when none is given. */
export const DEFAULT_MOTOR_EFFICIENCY = 0.85;
/** Zp range a recommendation may use (a cycloidal stage needs at least 8 outer pins). */
export const RECOMMEND_ZP_RANGE: ZpRange = { min: 8, max: 60 };
/** Zp range the Design Advisor searches (from the catalog, 12 to 26). */
export const ADVISOR_ZP_RANGE: ZpRange = { min: Math.min(...ZP_OPTIONS), max: Math.max(...ZP_OPTIONS) };
/** Above this ratio a single cycloidal stage stops being sensible (efficiency, backlash, pin loads). */
export const SINGLE_STAGE_SENSIBLE_RATIO = 40;

/** Input ranges: [min exclusive, max inclusive]. Efficiency is a fraction. */
export const MOTOR_LIMITS = {
  torque_Nm: [0, 1e4],
  speed_rpm: [0, 1e5],
  speed_degps: [0, 1e6],
  efficiency: [0.1, 1],
} as const;

export interface ZpRange { min: number; max: number }

export interface MotorSpec {
  /** Free text ("NEMA 17 typical"), shown in read-outs */
  name?: string;
  /** Peak (max) torque at the motor shaft, N*m. null = not entered yet (no recommendation without it) */
  Tpeak_Nm: number | null;
  /** Continuous (rated) torque, N*m. null = not given */
  Tcont_Nm?: number | null;
  /** Max motor speed, rpm. null = not given */
  maxSpeed_rpm?: number | null;
  /** Speed the joint must reach, deg/s. null = not given */
  requiredSpeed_degps?: number | null;
  /** Gearbox efficiency, 0.1 to 1. Ignored for a direct-drive servo. Default 0.85 */
  efficiency: number;
}

export interface MotorLoad {
  /** Working torque the joint must carry, N*m */
  Treq: number;
  /** Design (peak) torque, N*m */
  Tdes: number;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const TOL = 1e-9;

// ---------------------------------------------------------------------------
// Text helpers (plain numbers; the UI converts "N·m" to the chosen torque unit with its text localizer)
// ---------------------------------------------------------------------------

/** About 3 significant figures, trailing zeros dropped: 0.45, 8.81, 23, 120. */
function sig(x: number): string {
  if (!Number.isFinite(x)) return '—';
  const a = Math.abs(x);
  if (a >= 1000) return String(Math.round(x));
  const s = x.toPrecision(3);
  return s.includes('e') ? String(x) : s.includes('.') ? s.replace(/0+$/, '').replace(/\.$/, '') : s;
}
/** Ratio with one decimal: 23.0 */
const r1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '—');
const pct = (x: number) => `${Math.round(x * 100)}%`;
const T = (x: number) => `${sig(x)} N·m`;

// ---------------------------------------------------------------------------
// Validation and normalization
// ---------------------------------------------------------------------------

/** A motor object with only usable fields, or undefined when raw is not a motor. Never throws. Missing fields become null. */
export function normalizeMotor(raw: unknown): MotorSpec | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const r = raw as Record<string, unknown>;
  const nul = (v: unknown): number | null => (fin(v) ? v : null);
  const out: MotorSpec = {
    Tpeak_Nm: nul(r.Tpeak_Nm),
    Tcont_Nm: nul(r.Tcont_Nm),
    maxSpeed_rpm: nul(r.maxSpeed_rpm),
    requiredSpeed_degps: nul(r.requiredSpeed_degps),
    efficiency: fin(r.efficiency) ? r.efficiency : DEFAULT_MOTOR_EFFICIENCY,
  };
  if (typeof r.name === 'string' && r.name.trim()) out.name = r.name.slice(0, 40);
  return out;
}

/** True when the motor has everything a recommendation needs: a positive, finite peak torque. */
export function hasMotorTorque(m: MotorSpec | null | undefined): m is MotorSpec & { Tpeak_Nm: number } {
  return !!m && fin(m.Tpeak_Nm) && m.Tpeak_Nm > 0;
}

/** Friendly range messages for the motor fields. Missing optional fields are fine. */
export function validateMotor(m: MotorSpec | null | undefined): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  if (!m || typeof m !== 'object') return { errors, warnings };
  const opt = (v: unknown, label: string, unit: string, [min, max]: readonly [number, number]) => {
    if (v == null) return;
    if (!fin(v)) errors.push(`${label} is not a number`);
    else if (v <= min) errors.push(`${label} must be > ${min} ${unit}`);
    else if (v > max) errors.push(`${label} must be at most ${max} ${unit}`);
  };
  opt(m.Tpeak_Nm, 'Motor peak torque', 'N·m', MOTOR_LIMITS.torque_Nm);
  opt(m.Tcont_Nm, 'Motor continuous torque', 'N·m', MOTOR_LIMITS.torque_Nm);
  opt(m.maxSpeed_rpm, 'Motor max speed', 'rpm', MOTOR_LIMITS.speed_rpm);
  opt(m.requiredSpeed_degps, 'Required joint speed', 'deg/s', MOTOR_LIMITS.speed_degps);
  const [eLo, eHi] = MOTOR_LIMITS.efficiency;
  if (!fin(m.efficiency)) errors.push('Gearbox efficiency is not a number');
  else if (m.efficiency < eLo || m.efficiency > eHi) errors.push(`Gearbox efficiency must be between ${eLo} and ${eHi} (0.85 is typical for a cycloidal stage)`);
  else if (m.efficiency < 0.6) warnings.push('An efficiency below 0.6 is unusually low for a cycloidal stage (typical 0.75 to 0.9).');
  if (fin(m.Tpeak_Nm) && fin(m.Tcont_Nm) && m.Tcont_Nm > m.Tpeak_Nm && !errors.length) {
    errors.push('Motor continuous torque cannot be above the peak torque');
  }
  return { errors, warnings };
}

// ---------------------------------------------------------------------------
// Recommendation
// ---------------------------------------------------------------------------

export type RecommendStatus =
  /** A ratio was found and nothing needs attention */
  | 'ok'
  /** A ratio was found, but it is outside the advisor range or beyond a sensible single stage */
  | 'warning'
  /** No whole-number ratio satisfies torque, speed and the allowed range */
  | 'infeasible'
  /** Motor peak torque missing: nothing to recommend yet */
  | 'incomplete'
  /** Bad numbers (a motor or load value out of range) */
  | 'invalid';

export interface MotorRecommendation {
  status: RecommendStatus;
  errors: string[];
  warnings: string[];
  /** The loads and efficiency used */
  Treq: number;
  Tdes: number;
  eta: number;
  /** T_des / (eta * T_peak) */
  ratioMinPeak: number | null;
  /** T_req / (eta * T_cont), null without a continuous rating */
  ratioMinCont: number | null;
  /** The larger of the two */
  ratioMin: number | null;
  /** Which rating sets ratio_min */
  minSetBy: 'peak' | 'continuous' | null;
  /** (max rpm * 6) / required deg/s, null unless both are given */
  ratioMax: number | null;
  /** Recommended number of outer pins (smallest valid), null when infeasible or incomplete */
  Zp: number | null;
  /** Zp - 1 */
  ratio: number | null;
  /** Why there is no Zp: the speed cap, or the Zp range */
  infeasibleBy: 'speed' | 'range' | null;
  /** Zp lies inside the advisor's range */
  inAdvisorRange: boolean;
  /** ratio <= 40: a single stage is sensible */
  singleStageSensible: boolean;
  /** eta * T_peak * ratio, N*m */
  outputPeak_Nm: number | null;
  /** eta * T_cont * ratio, N*m */
  outputCont_Nm: number | null;
  /** output peak / T_des (1.04 = 4% margin) */
  marginPeak: number | null;
  /** output continuous / T_req */
  marginCont: number | null;
  /** Joint speed at full motor speed, deg/s and rpm */
  outputSpeed_degps: number | null;
  outputSpeed_rpm: number | null;
  /** Motor speed needed to reach the required joint speed at this ratio, rpm (when a required speed is given) */
  motorSpeedNeeded_rpm: number | null;
  /** One line: "24:1 (Zp 25)" or the reason there is none */
  headline: string;
  /** Plain-language reasons, in reading order */
  reasons: string[];
}

export interface RecommendOptions {
  /** Zp range the recommendation may use. Default 8 to 60 */
  zpRange?: ZpRange;
  /** Range used only to flag "outside the advisor's search". Default 12 to 26 */
  advisorRange?: ZpRange;
}

function blankRecommendation(status: RecommendStatus, load: Partial<MotorLoad>, eta: number): MotorRecommendation {
  return {
    status, errors: [], warnings: [], Treq: load.Treq ?? NaN, Tdes: load.Tdes ?? NaN, eta,
    ratioMinPeak: null, ratioMinCont: null, ratioMin: null, minSetBy: null, ratioMax: null,
    Zp: null, ratio: null, infeasibleBy: null, inAdvisorRange: false, singleStageSensible: false,
    outputPeak_Nm: null, outputCont_Nm: null, marginPeak: null, marginCont: null,
    outputSpeed_degps: null, outputSpeed_rpm: null, motorSpeedNeeded_rpm: null, headline: '', reasons: [],
  };
}

/** "24:1 (Zp 25)" */
export const ratioLabel = (Zp: number): string => `${Zp - 1}:1 (Zp ${Zp})`;

function loadProblem(load: Partial<MotorLoad> | null | undefined): string | null {
  if (!load || !fin(load.Treq) || !fin(load.Tdes)) return 'The joint torques are not available yet (fix the arm inputs first).';
  if (load.Treq < 0 || load.Tdes < 0) return 'The joint torques must not be negative.';
  return null;
}

/**
 * Recommend the cycloidal ratio for a joint load and a motor. Never throws.
 * `load` is the torque the gearbox must carry (T_req for the continuous check, T_des for the peak check).
 */
export function recommendRatio(
  load: MotorLoad, motor: MotorSpec | null | undefined, opts: RecommendOptions = {},
): MotorRecommendation {
  const range = opts.zpRange ?? RECOMMEND_ZP_RANGE;
  const adv = opts.advisorRange ?? ADVISOR_ZP_RANGE;
  const eta = motor && fin(motor.efficiency) ? motor.efficiency : DEFAULT_MOTOR_EFFICIENCY;
  try {
    if (!motor) {
      const rec = blankRecommendation('incomplete', load, eta);
      rec.headline = 'No motor entered';
      rec.reasons.push('Enter the motor’s peak torque to get a recommended ratio.');
      return rec;
    }
    const v = validateMotor(motor);
    if (v.errors.length) {
      const rec = blankRecommendation('invalid', load, eta);
      rec.errors = v.errors;
      rec.headline = 'Motor values need fixing';
      rec.reasons.push(v.errors[0]);
      return rec;
    }
    const lp = loadProblem(load);
    if (lp) {
      const rec = blankRecommendation('invalid', load, eta);
      rec.errors = [lp];
      rec.headline = 'Joint torques unavailable';
      rec.reasons.push(lp);
      return rec;
    }
    if (!hasMotorTorque(motor)) {
      const rec = blankRecommendation('incomplete', load, eta);
      rec.warnings = v.warnings;
      rec.headline = 'Enter the motor’s peak torque';
      rec.reasons.push('A recommended ratio needs the motor’s max (peak) torque. Continuous torque and speeds are optional.');
      return rec;
    }

    const rec = blankRecommendation('ok', load, eta);
    rec.warnings = [...v.warnings];
    const { Treq, Tdes } = load;
    const Tpeak = motor.Tpeak_Nm;
    const Tcont = fin(motor.Tcont_Nm) && motor.Tcont_Nm > 0 ? motor.Tcont_Nm : null;
    const maxRpm = fin(motor.maxSpeed_rpm) && motor.maxSpeed_rpm > 0 ? motor.maxSpeed_rpm : null;
    const reqSpeed = fin(motor.requiredSpeed_degps) && motor.requiredSpeed_degps > 0 ? motor.requiredSpeed_degps : null;

    rec.ratioMinPeak = Tdes / (eta * Tpeak);
    rec.ratioMinCont = Tcont != null ? Treq / (eta * Tcont) : null;
    rec.minSetBy = rec.ratioMinCont != null && rec.ratioMinCont > rec.ratioMinPeak ? 'continuous' : 'peak';
    rec.ratioMin = rec.minSetBy === 'continuous' ? (rec.ratioMinCont as number) : rec.ratioMinPeak;
    rec.ratioMax = maxRpm != null && reqSpeed != null ? (maxRpm * RPM_TO_DEGPS) / reqSpeed : null;
    const ratioMin = rec.ratioMin;
    const ratioMax = rec.ratioMax;

    const why: string[] = [];
    why.push(`Needs ≥ ${r1(rec.ratioMinPeak)}:1 for ${T(Tdes)} (T_des) with a ${T(Tpeak)} motor at ${pct(eta)} efficiency.`);
    if (rec.ratioMinCont != null) {
      why.push(`Continuous: needs ≥ ${r1(rec.ratioMinCont)}:1 for ${T(Treq)} (T_req) with a ${T(Tcont as number)} continuous rating.`);
    }
    if (ratioMax != null) {
      why.push(`Speed: a ${sig(maxRpm as number)} rpm motor turns the joint at ${sig(reqSpeed as number)} deg/s up to ${r1(ratioMax)}:1.`);
    }

    // Smallest whole-number ratio at or above ratio_min, inside the allowed Zp range
    const rLo = range.min - 1;
    const rHi = range.max - 1;
    const rWanted = Math.max(rLo, Math.ceil(ratioMin - TOL));
    if (ratioMin < rLo - TOL && Tdes > 0) {
      why.push(`Torque alone would allow ${r1(ratioMin)}:1, but a cycloidal stage needs at least ${rLo}:1 (Zp ${range.min}).`);
    }

    if (ratioMax != null && rWanted > ratioMax + TOL) {
      // speed cap: the smallest allowed ratio is too high for the speed
      rec.status = 'infeasible';
      rec.infeasibleBy = 'speed';
      const rFloor = Math.floor(ratioMax + TOL);
      if (ratioMin > ratioMax + TOL) {
        why.push(`Not possible: torque needs ≥ ${r1(ratioMin)}:1 but the speed limit allows only ≤ ${r1(ratioMax)}:1.`);
      } else if (rFloor < rLo) {
        why.push(`Not possible: the speed limit allows only ≤ ${r1(ratioMax)}:1, below the ${rLo}:1 minimum of a cycloidal stage (Zp ${range.min}).`);
      } else {
        why.push(`Not possible: no whole-number ratio fits between ${r1(ratioMin)}:1 and ${r1(ratioMax)}:1.`);
      }
      const fixes: string[] = [];
      const useR = Math.max(rLo, rFloor);
      if (useR > 0 && Tdes > 0) {
        const needPeak = Tdes / (eta * useR);
        const needCont = Tcont != null ? Treq / (eta * useR) : null;
        fixes.push(`a motor with at least ${T(Math.max(needPeak, needCont ?? 0))} peak torque (at ${useR}:1)`);
      }
      const rNeed = Math.max(rLo, Math.ceil(ratioMin - TOL));
      fixes.push(`a motor that reaches ${sig((reqSpeed as number) * rNeed / RPM_TO_DEGPS)} rpm (at ${rNeed}:1)`);
      fixes.push(`a joint speed of at most ${sig((maxRpm as number) * RPM_TO_DEGPS / rNeed)} deg/s (at ${rNeed}:1)`);
      fixes.push('a lower service factor or torque');
      why.push(`Options: ${fixes.join('; ')}.`);
      rec.headline = 'No ratio fits torque and speed';
      rec.reasons = why;
      return rec;
    }
    if (rWanted > rHi) {
      rec.status = 'infeasible';
      rec.infeasibleBy = 'range';
      why.push(`Not possible in one stage: it needs ${r1(ratioMin)}:1, above the ${rHi}:1 (Zp ${range.max}) limit. Use a stronger motor or add a belt or gear reduction before the cycloidal stage.`);
      rec.headline = `Needs ${r1(ratioMin)}:1, too high for one stage`;
      rec.reasons = why;
      return rec;
    }

    const ratio = rWanted;
    const Zp = ratio + 1;
    rec.Zp = Zp;
    rec.ratio = ratio;
    rec.inAdvisorRange = Zp >= adv.min && Zp <= adv.max;
    rec.singleStageSensible = ratio <= SINGLE_STAGE_SENSIBLE_RATIO;
    rec.outputPeak_Nm = eta * Tpeak * ratio;
    rec.outputCont_Nm = Tcont != null ? eta * Tcont * ratio : null;
    rec.marginPeak = Tdes > 0 ? rec.outputPeak_Nm / Tdes : null;
    rec.marginCont = rec.outputCont_Nm != null && Treq > 0 ? rec.outputCont_Nm / Treq : null;
    if (maxRpm != null) {
      rec.outputSpeed_rpm = maxRpm / ratio;
      rec.outputSpeed_degps = (maxRpm * RPM_TO_DEGPS) / ratio;
    }
    if (reqSpeed != null) rec.motorSpeedNeeded_rpm = (reqSpeed * ratio) / RPM_TO_DEGPS;

    why.push(`Smallest whole-number cycloidal ratio: ${ratioLabel(Zp)}.`);
    const mp = rec.marginPeak != null ? ` (${pct(rec.marginPeak)} of T_des)` : '';
    why.push(`At ${ratio}:1 the gearbox can deliver ${T(rec.outputPeak_Nm)} peak${mp}${rec.outputCont_Nm != null ? ` and ${T(rec.outputCont_Nm)} continuous` : ''}.`);
    if (rec.outputSpeed_degps != null) {
      why.push(`Full motor speed gives ${sig(rec.outputSpeed_degps)} deg/s (${sig(rec.outputSpeed_rpm as number)} rpm) at the joint.`);
    }
    if (!rec.inAdvisorRange) {
      why.push(`Zp ${Zp} is outside the Design Advisor’s search range (Zp ${adv.min} to ${adv.max}). The Gearbox page can still check it.`);
    }
    if (!rec.singleStageSensible) {
      why.push(`${ratio}:1 is more than a single cycloidal stage sensibly gives (about ${SINGLE_STAGE_SENSIBLE_RATIO}:1): expect lower efficiency and heavy pin loads.`);
    }
    rec.status = rec.inAdvisorRange && rec.singleStageSensible ? 'ok' : 'warning';
    rec.headline = ratioLabel(Zp);
    rec.reasons = why;
    return rec;
  } catch (err) {
    const rec = blankRecommendation('invalid', load ?? {}, eta);
    rec.errors = [`The motor could not be evaluated: ${err instanceof Error ? err.message : String(err)}`];
    rec.headline = 'Motor could not be evaluated';
    return rec;
  }
}

/**
 * Zp values the Design Advisor may search when the ratio comes from the motor: every integer Zp in the advisor range
 * whose ratio (Zp - 1) is at least ratio_min and at most ratio_max. When none qualifies, `zps` holds the nearest
 * Zp of the advisor range instead and `feasible` is false.
 */
export function motorZpSet(rec: MotorRecommendation, advisorRange: ZpRange = ADVISOR_ZP_RANGE): {
  zps: number[]; feasible: boolean; nearest: number | null; note: string;
} {
  const none = { zps: [] as number[], feasible: false, nearest: null as number | null };
  if (rec.ratioMin == null || (rec.status !== 'ok' && rec.status !== 'warning' && rec.status !== 'infeasible')) {
    return { ...none, note: 'Enter the motor’s peak torque to restrict the ratio.' };
  }
  const zps: number[] = [];
  for (let z = advisorRange.min; z <= advisorRange.max; z++) {
    const r = z - 1;
    if (r >= rec.ratioMin - TOL && (rec.ratioMax == null || r <= rec.ratioMax + TOL)) zps.push(z);
  }
  if (zps.length) {
    const lo = zps[0];
    const hi = zps[zps.length - 1];
    return {
      zps, feasible: true, nearest: lo,
      note: `Motor-feasible ratios in the advisor range: ${lo - 1}:1 to ${hi - 1}:1 (Zp ${lo} to ${hi}).`,
    };
  }
  // nothing fits: the Zp of the advisor range closest to what the torque asks for
  const ideal = rec.Zp ?? Math.max(1, Math.ceil(rec.ratioMin - TOL)) + 1;
  const nearest = Math.min(advisorRange.max, Math.max(advisorRange.min, ideal));
  const note = rec.ratioMax != null && rec.ratioMax < advisorRange.min - 1 - TOL
    ? `No Zp in the advisor range (${advisorRange.min} to ${advisorRange.max}) is motor-feasible: the speed limit allows only ≤ ${r1(rec.ratioMax)}:1. Nearest is ${ratioLabel(nearest)}.`
    : rec.ratioMin > advisorRange.max - 1 + TOL
      ? `No Zp in the advisor range (${advisorRange.min} to ${advisorRange.max}) is motor-feasible: the motor needs ≥ ${r1(rec.ratioMin)}:1. Nearest is ${ratioLabel(nearest)}.`
      : `No Zp in the advisor range (${advisorRange.min} to ${advisorRange.max}) satisfies both torque and speed. Nearest is ${ratioLabel(nearest)}.`;
  return { zps: [nearest], feasible: false, nearest, note };
}

// ---------------------------------------------------------------------------
// Check of the actual drive
// ---------------------------------------------------------------------------

export interface MotorOverload {
  /** eta * T_peak * ratio exceeds T_des */
  exceeds: boolean;
  /** Torque a stalled motor puts on the gearbox output, N*m */
  stallOutput_Nm: number;
  designTorque_Nm: number;
  /** stall output / T_des */
  factor: number;
  /** Largest motor torque that keeps the output at or under T_des: T_des / (eta * ratio), N*m */
  motorLimit_Nm: number;
  /** That limit as a fraction of the motor's peak torque (torque follows current, so also the current limit) */
  limitFraction: number;
  message: string;
}

export type MotorCheckStatus =
  /** Motor delivers T_des (peak) and, if given, T_req (continuous) and the speed */
  | 'ok'
  /** Something falls short; see `problems` */
  | 'short'
  /** Peak torque missing */
  | 'incomplete'
  | 'invalid';

export interface MotorCheck {
  status: MotorCheckStatus;
  drive: 'cycloidal' | 'servo';
  errors: string[];
  warnings: string[];
  /** Zp - 1 for a cycloidal joint, 1 for a direct-drive servo */
  ratio: number | null;
  /** Efficiency applied (1 for a servo) */
  eta: number;
  outputPeak_Nm: number | null;
  outputCont_Nm: number | null;
  /** T_des / output peak (info; 1.0 = exactly enough) */
  peakUtil: number | null;
  /** T_req / output continuous */
  contUtil: number | null;
  peakOk: boolean | null;
  contOk: boolean | null;
  /** Joint speed at full motor speed, deg/s */
  outputSpeed_degps: number | null;
  /** Reaches the required joint speed (null unless both speeds are given) */
  speedOk: boolean | null;
  /** Cycloidal only; null for a servo or without a peak torque */
  overload: MotorOverload | null;
  /** What falls short, in plain words */
  problems: string[];
  /** Info lines (what the motor delivers) */
  info: string[];
}

function blankCheck(status: MotorCheckStatus, drive: 'cycloidal' | 'servo'): MotorCheck {
  return {
    status, drive, errors: [], warnings: [], ratio: null, eta: 1, outputPeak_Nm: null, outputCont_Nm: null,
    peakUtil: null, contUtil: null, peakOk: null, contOk: null, outputSpeed_degps: null, speedOk: null,
    overload: null, problems: [], info: [],
  };
}

/**
 * Does the motor deliver the joint's torque through the actual drive?
 * Cycloidal: through ratio Zp - 1 at efficiency eta. Servo: directly (ratio 1, no efficiency), servo peak vs T_des and
 * continuous vs T_req. The overload warning never changes `status`. Never throws.
 */
export function checkMotor(
  load: MotorLoad, motor: MotorSpec | null | undefined, drive: 'cycloidal' | 'servo', Zp?: number | null,
): MotorCheck {
  const c = blankCheck('incomplete', drive);
  try {
    if (!motor) { c.problems.push('No motor entered.'); return c; }
    const v = validateMotor(motor);
    if (v.errors.length) { c.status = 'invalid'; c.errors = v.errors; return c; }
    c.warnings = v.warnings;
    const lp = loadProblem(load);
    if (lp) { c.status = 'invalid'; c.errors = [lp]; return c; }
    if (!hasMotorTorque(motor)) { c.problems.push('Enter the motor’s peak torque.'); return c; }
    let ratio = 1;
    let eta = 1;
    if (drive === 'cycloidal') {
      if (!fin(Zp) || !Number.isInteger(Zp) || Zp < 2) { c.status = 'invalid'; c.errors = ['The gearbox needs a valid Zp to check the motor.']; return c; }
      ratio = Zp - 1;
      eta = motor.efficiency;
    }
    c.ratio = ratio;
    c.eta = eta;
    const { Treq, Tdes } = load;
    const Tpeak = motor.Tpeak_Nm;
    const Tcont = fin(motor.Tcont_Nm) && motor.Tcont_Nm > 0 ? motor.Tcont_Nm : null;
    const maxRpm = fin(motor.maxSpeed_rpm) && motor.maxSpeed_rpm > 0 ? motor.maxSpeed_rpm : null;
    const reqSpeed = fin(motor.requiredSpeed_degps) && motor.requiredSpeed_degps > 0 ? motor.requiredSpeed_degps : null;
    const unit = drive === 'servo' ? 'servo' : 'motor';

    c.outputPeak_Nm = eta * Tpeak * ratio;
    c.peakUtil = c.outputPeak_Nm > 0 ? Tdes / c.outputPeak_Nm : null;
    c.peakOk = c.outputPeak_Nm >= Tdes - TOL;
    const via = drive === 'cycloidal' ? ` through ${ratio}:1 at ${pct(eta)}` : '';
    c.info.push(`Peak: the ${unit} delivers ${T(c.outputPeak_Nm)}${via}; T_des is ${T(Tdes)}${c.peakUtil != null ? ` (${pct(c.peakUtil)} used)` : ''}.`);
    if (!c.peakOk) c.problems.push(`Peak torque falls short: ${T(c.outputPeak_Nm)} available, ${T(Tdes)} needed.`);
    if (Tcont != null) {
      c.outputCont_Nm = eta * Tcont * ratio;
      c.contUtil = c.outputCont_Nm > 0 ? Treq / c.outputCont_Nm : null;
      c.contOk = c.outputCont_Nm >= Treq - TOL;
      c.info.push(`Continuous: ${T(c.outputCont_Nm)} available; T_req is ${T(Treq)}${c.contUtil != null ? ` (${pct(c.contUtil)} used)` : ''}.`);
      if (!c.contOk) c.problems.push(`Continuous torque falls short: ${T(c.outputCont_Nm)} available, ${T(Treq)} needed.`);
    }
    if (maxRpm != null) {
      c.outputSpeed_degps = (maxRpm * RPM_TO_DEGPS) / ratio;
      if (reqSpeed != null) {
        c.speedOk = c.outputSpeed_degps >= reqSpeed - TOL;
        c.info.push(`Speed: ${sig(c.outputSpeed_degps)} deg/s at full motor speed; ${sig(reqSpeed)} deg/s required.`);
        if (!c.speedOk) c.problems.push(`Too slow: ${sig(c.outputSpeed_degps)} deg/s available, ${sig(reqSpeed)} deg/s required.`);
      } else {
        c.info.push(`Speed: ${sig(c.outputSpeed_degps)} deg/s at full motor speed.`);
      }
    }

    if (drive === 'cycloidal' && Tdes > 0 && c.outputPeak_Nm > Tdes + TOL) {
      const limit = Tdes / (eta * ratio);
      const factor = c.outputPeak_Nm / Tdes;
      c.overload = {
        exceeds: true, stallOutput_Nm: c.outputPeak_Nm, designTorque_Nm: Tdes, factor,
        motorLimit_Nm: limit, limitFraction: limit / Tpeak,
        message:
          `Motor stall can exceed the gearbox design torque: ${T(Tpeak)} × ${pct(eta)} × ${ratio} = ${T(c.outputPeak_Nm)} against T_des ${T(Tdes)} (${pct(factor)}). ` +
          `Set a driver current limit so the motor torque stays ≤ ${T(limit)} (about ${pct(limit / Tpeak)} of its peak current).`,
      };
    } else if (drive === 'cycloidal') {
      c.overload = {
        exceeds: false, stallOutput_Nm: c.outputPeak_Nm, designTorque_Nm: Tdes, factor: Tdes > 0 ? c.outputPeak_Nm / Tdes : 0,
        motorLimit_Nm: Tdes > 0 ? Tdes / (eta * ratio) : 0, limitFraction: Tdes > 0 ? Tdes / (eta * ratio) / Tpeak : 0,
        message: 'A stalled motor cannot exceed the gearbox design torque.',
      };
    }
    c.status = c.problems.length ? 'short' : 'ok';
    return c;
  } catch (err) {
    c.status = 'invalid';
    c.errors = [`The motor could not be checked: ${err instanceof Error ? err.message : String(err)}`];
    return c;
  }
}

// ---------------------------------------------------------------------------
// One joint
// ---------------------------------------------------------------------------

/** Everything the screens show about one joint's motor. */
export interface JointMotorInfo {
  spec: MotorSpec;
  /** Cycloidal joints only: the recommended ratio (null for a servo) */
  recommendation: MotorRecommendation | null;
  /** The motor against the actual drive (for a cycloidal joint: its current Zp) */
  check: MotorCheck;
}

/**
 * Recommendation and check for one joint. Returns null when the joint has no motor data.
 * `Zp` is the joint's current gearbox Zp (cycloidal joints; ignored for a servo).
 */
export function analyzeJointMotor(
  joint: { drive: 'cycloidal' | 'servo'; motor?: MotorSpec },
  load: MotorLoad, Zp: number | null | undefined,
): JointMotorInfo | null {
  const spec = joint.motor;
  if (!spec) return null;
  return {
    spec,
    recommendation: joint.drive === 'cycloidal' ? recommendRatio(load, spec) : null,
    check: checkMotor(load, spec, joint.drive, Zp ?? null),
  };
}
