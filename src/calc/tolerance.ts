// Machining tolerances, backlash, load sharing and stiffness (CLAUDE.md Addition 13). Pure TypeScript, never throws on
// the UI path. The Monte Carlo runs in the calc worker (workerClient.tolerance); everything here is also usable on the
// main thread and in tests. Units: mm, N, N*m, rad (arcmin in the *_arcmin fields).
//
// ------------------------------------------------------------------------------------------------------------------
// Model (as implemented)
// ------------------------------------------------------------------------------------------------------------------
// Reference geometry at input angle theta (the kernel's construction, kernel.ts ringSweep):
//   u = (cos th, sin th), C = e u (disc centre), P = e Zp u (pitch point), Q_i = Rp (cos 2 pi i/Zp, sin 2 pi i/Zp),
//   n_i = (P - Q_i)/|P - Q_i| (contact normal, from the pin centre toward the disc), r_i = Q_i + rr n_i - C,
//   arm_i = r_i x n_i (> 0: the pins that carry the torque in the kernel's sense). An integral ring uses the same
//   construction (its teeth are circles of radius rr at Q_i).
//   Inner pins: chi_k = 2 pi k/Zw - th/Zc, tangent t_k = (-sin chi_k, cos chi_k); the inner contact normal is +-u.
//
// Gap at outer pin i (mm, > 0 = room):
//   g_i = drp + bushingPlay* + eps_p - d_i . n_i - eps_r - de (n_i . u)
//   drp = profile clearance; the bushing play (*) is one-sided (the load seats the bushing on its bolt): uniform[0, play]
//   per pin in the Monte Carlo, play/2 in the design case, the full play in the worst case; eps_p ~ U(+-profileError);
//   d_i = pin position error = (true-position vector, uniform over the disc of radius pinPosition) + (bolt seat in its
//   clearance hole, uniform over the disc of radius holePlay): a clamped bolt sits anywhere in its hole, so the hole
//   play is a two-sided position error, not a gap; eps_r ~ U(+-pinDiaTol/2);
//   de ~ U(+-eccError), one draw per trial for every pin (and the inner holes).
//   Integral ring: g_i = drp + U(+-profileError) (disc) + U(+-profileError) (tooth) - de (n_i . u); no plays, position or
//   diameter terms. All per-pin draws are fixed for a trial (the same part at every theta).
//
// Free rotation of the disc (ring backlash) at theta for a gap vector g: the disc turns by psi about C and moves by t in
// the eccentric bearing clearance, |t| <= c_b; gaps become g_i + n_i . t + arm_i psi and must all stay >= 0.
//   psi+ = max psi >= 0 such that some t exists (psi- the same with -arm). For a fixed psi the set of t is a 2D convex set
//   (half-planes n_i . t >= -g_i - arm_i psi intersected with the disc |t| <= c_b); it is decided exactly by testing
//   t = 0, the points c_b n_i, the line-circle intersections and the pairwise line intersections (if the set is not
//   empty, one of these lies in it). psi is bisected to 1e-8 rad between the t = 0 answer and min (g_i + c_b)/(-arm_i).
//   Empty at psi = 0 = interference (the disc binds). Ring backlash = psi+ + psi-.
// Inner holes (output relative to the disc): with the hole centre at the pin centre + e u, an output rotation phi moves
//   pin k by Rw phi t_k and to first order closes the gap along u: gin_k + Rw phi (t_k . u) >= 0 for one direction.
//   gin_k = dh/2 + de + p_k . u - eps_d (dh = inner hole clearance, diametral; p_k = hole position error, a vector of
//   length <= innerHolePosition; eps_d ~ U(+-innerPinDiaTol/2); a larger real eccentricity, de < 0 here, presses every
//   pin further into its hole). phi+ = min over t_k . u < 0 of gin_k / (Rw |t_k . u|), phi- over t_k . u > 0.
//   With equal gaps this is 2 (dh/2) / (Rw max_k |t_k . u|) for a symmetric pattern (the brief's formula).
// Output backlash = ring + inner, per theta; the statistics take the max over 24 samples of one outer pin pitch
//   (theta in [0, 2 pi/Zp)).
//   design: no random errors, the bushing play at its mean (play/2), the hole play 0 (a position error with mean 0).
//   worst: the full bushing play and every random term at its gap-widening limit for every pin separately
//   (eps_p = +dp, d_i . n_i = -(dQ + holePlay), eps_r = -tol/2, -de (n_i . u) = +eccError |n_i . u|, p_k . u = +dh_pos,
//   eps_d = -tol/2, inner de = +eccError). Every Monte Carlo gap is <= this one, pin by pin, and the free rotation only
//   grows with the gaps, so p50 <= p95 <= worst always holds. design <= p50 does not have to hold: the tightest of the
//   randomly scattered pins limits the rotation, so random errors usually take some backlash away.
//   Monte Carlo: p50 / p95 over the free builds (no interference anywhere) of the per-trial max over theta; shown only
//   when at least min(50, trials) builds are free (else NaN).
//   Binding: worst-case minimum gap at t = 0 = drp - (dp + dQ + holePlay + pinDiaTol/2 + de max_i |n_i . u|) (the
//   bushing play counts 0; integral: drp - (2 dp + de max |n . u|)); required profile clearance = that stack. Inner holes
//   the same: dh/2 - (innerHolePosition + innerPinDiaTol/2 + eccError). max |n . u| = 1 for every design (the pin in
//   line with u at theta = 0), so the stacks depend on the construction only.
//   Presets carry fitted clearances: the stacks rounded up to 0.005 mm (fittedClearances).
//
// Load sharing (Monte Carlo): every loaded pin (arm_i > 0) is a spring k:
//   F_i = k max(0, arm_i psi - g_i), solve sum F_i arm_i = 1000 T share (N*mm) for psi (exactly: the moment is piecewise
//   linear in psi, the breakpoints g_i/arm_i are walked in order; with a negative gap, a press fit, psi may be < 0).
//   Kc = max F_i / max F_i,rigid with F_i,rigid = 1000 arm_i / sum arm_j^2 x T share (the engine's rigid distribution).
//   Strength: T = T_des; life: T = T_req. 8 theta samples over one pitch, max over theta per trial, p50 / p95 over trials.
//   k = 1 / (1/k_c + 1/k_b):
//     contact (Hertz line contact, approach of the cylinder centres), secant k_c = F/delta_c at the rigid peak pin force
//       F = F_unit T share (T_des for strength, T_req for life and stiffness):
//       delta_c = (2F/(pi L)) [ (1-nu1^2)/E1 (ln(4 R1/a) - 0.5) + (1-nu2^2)/E2 (ln(4 R2/a) - 0.5) ],
//       a = sqrt(4 F R*/(pi L E*)), 1/R* = 1/rr + kappa_a, R1 = rr (pin / tooth), R2 = |rho_a| at the contact of the
//       rigid peak force (disc), E1 = bushing / pin / housing, E2 = disc.
//     pin bending, simply supported over the span with a central load: k_b = 48 E I / span^3, I = pi d^4/64,
//       d = bolt shank (bolt + bushing, steel bolt E 200 GPa) or 2 rr (solid pin, its material); integral ring: rigid.
// Torsional stiffness: psi(T) = 1000 T share / (k sum_{arm>0} arm^2) with zero gaps (rigid sharing); K_t = T/psi at T_req,
//   at the theta (24 per pitch) with the smallest sum arm^2. Inner pins, standoffs and the housing are not included.
// Sensitivity: backlash share = worst-loose backlash with only that term at its value (all others 0, plays included);
//   Kc share = variance of the strength Kc from a small Monte Carlo with only that random term (the profile clearance
//   kept, since it is a deliberate value, not a random one).

import { computeProfile } from './kernel';
import { deriveGeometry, discShareOf, validateGearboxInputs } from './gearbox';
import { effectiveModulus, SPEC_STEEL } from './materials';
import { ringContactMaterial } from './integral';
import { nextNonRoll, firstPitchIndex, type ArmInputs } from './arm';
import { now, runAsync, runSync, SLICE_MS, type RunHooks } from './runner';
import type { GearboxInputs, ToleranceSpec } from './types';

const TWO_PI = 2 * Math.PI;
/** rad -> arcmin */
export const ARCMIN_PER_RAD = (180 * 60) / Math.PI;
const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

// ---------------------------------------------------------------------------
// Process presets and the spec
// ---------------------------------------------------------------------------

export type ProcessId = 'waterjet' | 'laser' | 'router' | 'mill' | 'edm' | 'fdm' | 'sls';

export interface ProcessPreset {
  id: ProcessId;
  label: string;
  note: string;
  profileError: number;
  pinPosition: number;
  eccError: number;
  innerHolePosition: number;
}

/** Typical values (mm) per process. Editable after picking. */
export const PROCESS_PRESETS: readonly ProcessPreset[] = [
  { id: 'waterjet', label: 'Waterjet (abrasive)', note: 'Taper and stream lag make the profile the weak point.', profileError: 0.10, pinPosition: 0.10, eccError: 0.03, innerHolePosition: 0.10 },
  { id: 'laser', label: 'Laser (metal)', note: 'Thin plate, small kerf; heat can warp large discs.', profileError: 0.05, pinPosition: 0.05, eccError: 0.02, innerHolePosition: 0.05 },
  { id: 'router', label: 'CNC router', note: 'Hobby-to-pro gantry routers in aluminum or plastics.', profileError: 0.05, pinPosition: 0.05, eccError: 0.02, innerHolePosition: 0.05 },
  { id: 'mill', label: 'CNC mill', note: 'A rigid mill with a sharp end mill and a finishing pass.', profileError: 0.02, pinPosition: 0.02, eccError: 0.01, innerHolePosition: 0.02 },
  { id: 'edm', label: 'Wire EDM', note: 'The precision reference: microns, but slow and costly.', profileError: 0.005, pinPosition: 0.005, eccError: 0.005, innerHolePosition: 0.005 },
  { id: 'fdm', label: 'FDM print', note: 'Layer lines, shrink and elephant foot; ream or drill the holes after printing.', profileError: 0.15, pinPosition: 0.20, eccError: 0.05, innerHolePosition: 0.20 },
  { id: 'sls', label: 'SLS/MJF print', note: 'Powder-bed nylon: even, but it shrinks a little.', profileError: 0.10, pinPosition: 0.10, eccError: 0.05, innerHolePosition: 0.10 },
];

/** Values every preset shares (bought bushings, standoffs and bearings), mm. */
export const PRESET_COMMON = {
  pinDiaTol: 0.01,
  innerPinDiaTol: 0.01,
  bushingPlay: 0.025,
  holePlay: 0.1,
  bearingClearance: 0.010,
  innerHoleClearance: 0.05,
} as const;

export const DEFAULT_PROCESS: ProcessId = 'mill';
export const DEFAULT_MC_TRIALS = 1000;
/** The default before 2026-10: specs that still carry it move to DEFAULT_MC_TRIALS (any other typed value is kept). */
export const OLD_DEFAULT_MC_TRIALS = 400;
export const DEFAULT_SEED = 1;
/** Accepted binding probability of the statistical clearance fit, and its range */
export const DEFAULT_BIND_TARGET = 0.01;
export const BIND_TARGET_RANGE = [0.001, 0.2] as const;
/** "Reamed / dowel-fit holes": radial hole play, mm (DXF pin hole clearance 0.01 mm) */
export const REAMED_HOLE_PLAY = 0.005;
/** Plain drilled / cut clearance holes (the presets' hole play), mm */
export const DRILLED_HOLE_PLAY = PRESET_COMMON.holePlay;
/** Largest accepted tolerance or clearance, mm, and the Monte Carlo trial range. */
export const TOLERANCE_LIMITS = { maxMm: 5, minTrials: 20, maxTrials: 5000 } as const;

/** Every length field of the spec, in display order. */
export const TOLERANCE_MM_FIELDS = [
  'profileClearance', 'innerHoleClearance', 'bushingPlay', 'holePlay', 'bearingClearance',
  'profileError', 'pinPosition', 'pinDiaTol', 'eccError', 'innerHolePosition', 'innerPinDiaTol',
] as const satisfies readonly (keyof ToleranceSpec)[];
export type ToleranceTerm = (typeof TOLERANCE_MM_FIELDS)[number];

/** Short names of the terms (sensitivity bars, messages). */
export const TOLERANCE_TERM_LABEL: Record<ToleranceTerm, string> = {
  profileClearance: 'Profile clearance',
  innerHoleClearance: 'Inner hole clearance',
  bushingPlay: 'Bushing play',
  holePlay: 'Bolt hole play',
  bearingClearance: 'Bearing clearance',
  profileError: 'Profile error',
  pinPosition: 'Pin position',
  pinDiaTol: 'Pin diameter',
  eccError: 'Eccentricity error',
  innerHolePosition: 'Inner hole position',
  innerPinDiaTol: 'Inner pin diameter',
};

/** Terms that do not exist for an integral (machined) ring. */
export const INTEGRAL_UNUSED_TERMS: readonly ToleranceTerm[] = ['bushingPlay', 'holePlay', 'pinPosition', 'pinDiaTol'];

export function processPreset(id: ProcessId): ProcessPreset {
  return PROCESS_PRESETS.find((p) => p.id === id) ?? PROCESS_PRESETS.find((p) => p.id === DEFAULT_PROCESS)!;
}

/** Worst-case stacks (mm): what the profile clearance (radial) and half the inner hole clearance must cover. */
export function toleranceStacks(t: ToleranceSpec, integral: boolean, maxNU = 1): { profile: number; inner: number } {
  return {
    profile: integral
      ? 2 * t.profileError + t.eccError * maxNU
      : t.profileError + t.pinPosition + t.holePlay + t.pinDiaTol / 2 + t.eccError * maxNU,
    inner: t.innerHolePosition + t.innerPinDiaTol / 2 + t.eccError,
  };
}

/** Round up to 0.005 mm (and clean the float). */
export const ceilStep = (x: number, step = 0.005): number => Math.max(0, Math.round(Math.ceil(x / step - 1e-9) * step * 1e9) / 1e9);

/** The smallest clearances (0.005 mm steps) that keep the worst-case stacks from binding. */
export function fittedClearances(t: ToleranceSpec, integral: boolean): { profileClearance: number; innerHoleClearance: number } {
  const st = toleranceStacks(t, integral);
  return { profileClearance: ceilStep(st.profile), innerHoleClearance: ceilStep(2 * st.inner) };
}

export interface ProcessSpecOptions {
  /** Integral (machined) ring: no hole play or pin terms in the profile stack */
  integral?: boolean;
  /** Hole play to keep (reamed holes); default the preset's 0.1 mm */
  holePlay?: number;
  /** Monte Carlo settings to keep */
  keep?: Partial<Pick<ToleranceSpec, 'mcTrials' | 'seed' | 'fitMode' | 'bindTarget'>>;
}

/** The full spec of a process preset, with clearances fitted to its worst-case stack. */
export function processSpec(id: ProcessId, opts: ProcessSpecOptions = {}): ToleranceSpec {
  const p = processPreset(id);
  const keep = opts.keep;
  const t: ToleranceSpec = {
    profileClearance: 0,
    innerHoleClearance: 0,
    bushingPlay: PRESET_COMMON.bushingPlay,
    holePlay: fin(opts.holePlay) && opts.holePlay >= 0 ? opts.holePlay : PRESET_COMMON.holePlay,
    bearingClearance: PRESET_COMMON.bearingClearance,
    profileError: p.profileError,
    pinPosition: p.pinPosition,
    pinDiaTol: PRESET_COMMON.pinDiaTol,
    eccError: p.eccError,
    innerHolePosition: p.innerHolePosition,
    innerPinDiaTol: PRESET_COMMON.innerPinDiaTol,
    mcTrials: keep?.mcTrials ?? DEFAULT_MC_TRIALS,
    seed: keep?.seed ?? DEFAULT_SEED,
    fitMode: keep?.fitMode === 'statistical' ? 'statistical' : 'worst',
    bindTarget: fin(keep?.bindTarget) ? keep.bindTarget : DEFAULT_BIND_TARGET,
  };
  // the worst-case fit; fitClearances(inputs, spec) gives the statistical one (it needs the geometry and a Monte Carlo)
  return { ...t, ...fittedClearances(t, opts.integral === true) };
}

/** A missing spec: the CNC mill preset with fitted clearances. */
export function defaultToleranceSpec(integral = false): ToleranceSpec {
  return processSpec(DEFAULT_PROCESS, { integral });
}

/** Fields a preset fills that describe the process (the hole play is a design choice: reamed or not). */
const PROCESS_FIELDS = ['profileError', 'pinPosition', 'eccError', 'innerHolePosition', 'pinDiaTol', 'innerPinDiaTol', 'bushingPlay', 'bearingClearance'] as const;

/**
 * The preset whose process values match the spec and whose fitted clearances (for the spec's hole play and fit mode) are
 * the spec's clearances (to 1e-9 mm), or null: custom (a clearance or a process value was edited). In statistical mode the
 * fitted values depend on the geometry and a Monte Carlo: pass them as `statFit` (from fitClearances / the analysis);
 * without them only the process values are compared.
 */
export function matchProcess(
  t: ToleranceSpec, integral = false, statFit?: { profileClearance: number; innerHoleClearance: number } | null,
): ProcessId | null {
  for (const p of PROCESS_PRESETS) {
    const s = processSpec(p.id, { integral, holePlay: t.holePlay });
    const same = (k: (typeof PROCESS_FIELDS)[number]) => Math.abs(s[k] - t[k]) < 1e-9;
    if (!PROCESS_FIELDS.every(same)) continue;
    const want = t.fitMode === 'statistical' ? statFit : s;
    if (!want) return p.id;
    if (Math.abs(want.profileClearance - t.profileClearance) < 1e-9 && Math.abs(want.innerHoleClearance - t.innerHoleClearance) < 1e-9) return p.id;
  }
  return null;
}

/** How loose a set of process tolerances is (sum of the four process-dependent errors), for ordering presets. */
export function processLooseness(t: Pick<ToleranceSpec, 'profileError' | 'pinPosition' | 'eccError' | 'innerHolePosition'>): number {
  return t.profileError + t.pinPosition + t.eccError + t.innerHolePosition;
}

/** Presets tighter than the spec, the nearest (least tight) first. */
export function tighterProcesses(t: ToleranceSpec): ProcessPreset[] {
  const cur = processLooseness(t);
  return PROCESS_PRESETS.filter((p) => processLooseness(p) < cur - 1e-9)
    .slice().sort((a, b) => processLooseness(b) - processLooseness(a));
}

/** A complete, finite spec from anything (missing or garbled fields from the default spec). */
export function normalizeToleranceSpec(raw: unknown): ToleranceSpec {
  const d = defaultToleranceSpec();
  if (!raw || typeof raw !== 'object') return d;
  const r = raw as Record<string, unknown>;
  const out = { ...d };
  for (const k of TOLERANCE_MM_FIELDS) if (fin(r[k])) out[k] = r[k] as number;
  if (fin(r.mcTrials)) out.mcTrials = r.mcTrials === OLD_DEFAULT_MC_TRIALS ? DEFAULT_MC_TRIALS : r.mcTrials as number;
  if (fin(r.seed)) out.seed = r.seed as number;
  out.fitMode = r.fitMode === 'statistical' ? 'statistical' : 'worst';
  if (fin(r.bindTarget)) out.bindTarget = r.bindTarget as number;
  return out;
}

type ToleranceHolder = Pick<GearboxInputs, 'tolerance'> & { outerPin?: { construction?: string } };

/** The spec in effect for a gearbox (normalized; a missing one is the default for its construction). */
export function toleranceOf(inputs: ToleranceHolder): ToleranceSpec {
  return inputs.tolerance === undefined || inputs.tolerance === null
    ? defaultToleranceSpec(inputs.outerPin?.construction === 'integral')
    : normalizeToleranceSpec(inputs.tolerance);
}

/** One message per bad field (empty = usable). */
export function validateToleranceSpec(t: ToleranceSpec): Partial<Record<keyof ToleranceSpec, string>> {
  const e: Partial<Record<keyof ToleranceSpec, string>> = {};
  const M = TOLERANCE_LIMITS.maxMm;
  for (const k of TOLERANCE_MM_FIELDS) {
    const v = t[k];
    if (!fin(v)) e[k] = `${TOLERANCE_TERM_LABEL[k]} is not a number`;
    else if (v < 0) e[k] = `${TOLERANCE_TERM_LABEL[k]} must be >= 0 mm`;
    else if (v > M) e[k] = `${TOLERANCE_TERM_LABEL[k]} must be at most ${M} mm`;
  }
  if (!fin(t.mcTrials) || !Number.isInteger(t.mcTrials) || t.mcTrials < TOLERANCE_LIMITS.minTrials || t.mcTrials > TOLERANCE_LIMITS.maxTrials) {
    e.mcTrials = `Monte Carlo trials must be a whole number from ${TOLERANCE_LIMITS.minTrials} to ${TOLERANCE_LIMITS.maxTrials}`;
  }
  if (!fin(t.seed) || !Number.isInteger(t.seed) || t.seed < 0 || t.seed > 2 ** 32 - 1) e.seed = 'Seed must be a whole number from 0 to 4294967295';
  if (t.fitMode !== 'worst' && t.fitMode !== 'statistical') e.fitMode = 'Fit mode must be worst or statistical';
  if (!fin(t.bindTarget) || t.bindTarget < BIND_TARGET_RANGE[0] - 1e-12 || t.bindTarget > BIND_TARGET_RANGE[1] + 1e-12) {
    e.bindTarget = `Binding target must be from ${BIND_TARGET_RANGE[0] * 100}% to ${BIND_TARGET_RANGE[1] * 100}%`;
  }
  return e;
}

/** The DXF allowances that come from the tolerance spec (one source of truth). */
export function dxfClearancesOf(inputs: ToleranceHolder): { profileClearance: number; pinHoleClearance: number; innerHoleClearance: number } {
  const t = toleranceOf(inputs);
  return { profileClearance: t.profileClearance, pinHoleClearance: 2 * t.holePlay, innerHoleClearance: t.innerHoleClearance };
}

// ---------------------------------------------------------------------------
// Geometry per theta
// ---------------------------------------------------------------------------

export interface ToleranceGeometry {
  theta: number;
  ux: number;
  uy: number;
  /** Contact normals (pin centre toward the disc), lever arms (mm) and n . u, per outer pin */
  nx: Float64Array;
  ny: Float64Array;
  arm: Float64Array;
  nu: Float64Array;
  /** Inner pin tangent . u, per inner pin */
  tu: Float64Array;
}

/** The kernel's reference geometry at input angle theta (rad). */
export function toleranceGeometryAt(Zp: number, Rp: number, e: number, rr: number, Zw: number, theta: number): ToleranceGeometry {
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const Cx = e * ux, Cy = e * uy, Px = e * Zp * ux, Py = e * Zp * uy;
  const nx = new Float64Array(Zp), ny = new Float64Array(Zp), arm = new Float64Array(Zp), nu = new Float64Array(Zp);
  for (let i = 0; i < Zp; i++) {
    const a = (TWO_PI * i) / Zp;
    const Qx = Rp * Math.cos(a), Qy = Rp * Math.sin(a);
    const dx = Px - Qx, dy = Py - Qy;
    const len = Math.sqrt(dx * dx + dy * dy);
    const mx = dx / len, my = dy / len;
    const rx = Qx + rr * mx - Cx, ry = Qy + rr * my - Cy;
    nx[i] = mx; ny[i] = my; arm[i] = rx * my - ry * mx; nu[i] = mx * ux + my * uy;
  }
  const Zc = Zp - 1;
  const tu = new Float64Array(Zw);
  for (let k = 0; k < Zw; k++) {
    const chi = (TWO_PI * k) / Zw - theta / Zc;
    tu[k] = -Math.sin(chi) * ux + Math.cos(chi) * uy;
  }
  return { theta, ux, uy, nx, ny, arm, nu, tu };
}

// ---------------------------------------------------------------------------
// Free rotation (backlash)
// ---------------------------------------------------------------------------

const ARM_EPS = 1e-12;
/** Bisection tolerance on psi, rad (3e-5 arcmin; the read-outs show 0.1 arcmin) */
export const PSI_TOL = 1e-8;

/**
 * Is there a t with |t| <= c and n_i . t >= b_i for every i? Exact for the 2D convex set (half-planes and a disc):
 * t = 0, the points c n_i, the line-circle intersections and the pairwise line intersections are the candidates.
 */
export function feasibleTranslation(nx: ArrayLike<number>, ny: ArrayLike<number>, b: ArrayLike<number>, c: number): boolean {
  const n = b.length;
  const eps = 1e-12 + 1e-9 * Math.abs(c);
  let anyPos = false;
  const act: number[] = [];
  for (let i = 0; i < n; i++) {
    if (b[i] > c + eps) return false; // n . t <= c on the disc
    if (b[i] > eps) anyPos = true;
    if (b[i] > -c - eps) act.push(i); // b_i <= -c is satisfied everywhere on the disc
  }
  if (!anyPos) return true; // t = 0
  if (!(c > 0)) return false;
  const c2 = c * c * (1 + 1e-9) + 1e-24;
  const ok = (tx: number, ty: number) => {
    if (tx * tx + ty * ty > c2) return false;
    for (const i of act) if (nx[i] * tx + ny[i] * ty < b[i] - eps) return false;
    return true;
  };
  for (const i of act) if (ok(c * nx[i], c * ny[i])) return true;
  for (const i of act) {
    const d = b[i];
    if (Math.abs(d) > c) continue;
    const h = Math.sqrt(Math.max(0, c * c - d * d));
    const bx = d * nx[i], by = d * ny[i], px = -ny[i], py = nx[i];
    if (ok(bx + h * px, by + h * py) || ok(bx - h * px, by - h * py)) return true;
  }
  for (let ii = 0; ii < act.length; ii++) {
    const i = act[ii];
    for (let jj = ii + 1; jj < act.length; jj++) {
      const j = act[jj];
      const det = nx[i] * ny[j] - ny[i] * nx[j];
      if (Math.abs(det) < 1e-12) continue;
      const tx = (b[i] * ny[j] - b[j] * ny[i]) / det;
      const ty = (nx[i] * b[j] - nx[j] * b[i]) / det;
      if (ok(tx, ty)) return true;
    }
  }
  return false;
}

export interface FreeRotation {
  /** Largest disc rotation each way with every gap >= 0, rad (0 when binding) */
  plus: number;
  minus: number;
  /** No translation within the bearing clearance makes every gap >= 0 at psi = 0 */
  interference: boolean;
}

function maxRotation(arm: ArrayLike<number>, nx: ArrayLike<number>, ny: ArrayLike<number>, g: ArrayLike<number>, c: number, sign: 1 | -1, b: Float64Array): number {
  const n = g.length;
  let minG = Infinity;
  for (let i = 0; i < n; i++) if (g[i] < minG) minG = g[i];
  let lo = 0, hi = Infinity, lo0 = Infinity;
  for (let i = 0; i < n; i++) {
    const a = sign * arm[i];
    if (a < -ARM_EPS) {
      hi = Math.min(hi, (g[i] + Math.max(0, c)) / -a);
      lo0 = Math.min(lo0, g[i] / -a);
    }
  }
  if (!Number.isFinite(hi)) return 0; // no pin limits this direction (cannot happen for a real ring)
  if (minG >= 0 && Number.isFinite(lo0)) lo = Math.max(0, lo0); // t = 0 is feasible up to here
  if (!(c > 0)) return lo;
  if (hi <= lo) return lo;
  const at = (psi: number) => {
    for (let i = 0; i < n; i++) b[i] = -g[i] - sign * arm[i] * psi;
    return feasibleTranslation(nx, ny, b, c);
  };
  let iter = 0;
  while (hi - lo > PSI_TOL && iter++ < 200) {
    const mid = 0.5 * (lo + hi);
    if (at(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

/** Free rotation of the disc each way for gaps g (mm) with the bearing clearance c (mm) (see the header). */
export function freeRotation(arm: ArrayLike<number>, nx: ArrayLike<number>, ny: ArrayLike<number>, g: ArrayLike<number>, c: number): FreeRotation {
  const n = g.length;
  const b = new Float64Array(n);
  for (let i = 0; i < n; i++) b[i] = -g[i];
  if (!feasibleTranslation(nx, ny, b, Math.max(0, c))) return { plus: 0, minus: 0, interference: true };
  return { plus: maxRotation(arm, nx, ny, g, c, 1, b), minus: maxRotation(arm, nx, ny, g, c, -1, b), interference: false };
}

/** Free rotation of the output relative to the disc in the inner holes (rad each way) for hole gaps gin (mm). */
export function innerFreeRotation(tu: ArrayLike<number>, gin: ArrayLike<number>, Rw: number): FreeRotation {
  let plus = Infinity, minus = Infinity, interference = false;
  for (let k = 0; k < gin.length; k++) {
    if (gin[k] < 0) interference = true;
    const t = tu[k];
    if (t < -1e-9) plus = Math.min(plus, gin[k] / (Rw * -t));
    else if (t > 1e-9) minus = Math.min(minus, gin[k] / (Rw * t));
  }
  return {
    plus: Number.isFinite(plus) ? Math.max(0, plus) : 0,
    minus: Number.isFinite(minus) ? Math.max(0, minus) : 0,
    interference,
  };
}

// ---------------------------------------------------------------------------
// Load sharing
// ---------------------------------------------------------------------------

export interface LoadShare {
  /** Load concentration max F / max F_rigid (1 at zero torque) */
  Kc: number;
  /** Disc rotation that balances the torque, rad (in the loading sense) */
  psi: number;
  /** Largest pin force, N */
  Fmax: number;
  /** Largest pin force of the rigid (equal-gap, zero-gap) distribution, N */
  FmaxRigid: number;
}

/**
 * Pins with arm > 0 are springs k (N/mm) with gaps g (mm): F_i = k max(0, arm_i psi - g_i). Solves sum F_i arm_i = T
 * (N*mm) exactly (piecewise linear in psi) and returns Kc against the rigid distribution 1000-style F_i = T arm_i / sum arm^2.
 */
export function loadShare(arm: ArrayLike<number>, g: ArrayLike<number>, k: number, T: number): LoadShare {
  const idx: number[] = [];
  let sumA2 = 0, aMax = 0;
  for (let i = 0; i < arm.length; i++) {
    const a = arm[i];
    if (a > 0) { idx.push(i); sumA2 += a * a; if (a > aMax) aMax = a; }
  }
  if (!(sumA2 > 0) || !(T > 0) || !(k > 0)) return { Kc: 1, psi: 0, Fmax: 0, FmaxRigid: 0 };
  const FmaxRigid = (T * aMax) / sumA2;
  // breakpoints psi_i = g_i / a_i, ascending
  idx.sort((p, q) => g[p] / arm[p] - g[q] / arm[q]);
  // M(psi) = k (S2 psi - S1) over the engaged pins, S2 = sum a^2, S1 = sum g a
  let S2 = 0, S1 = 0, psi = 0;
  const target = T / k;
  let found = false;
  for (let m = 0; m < idx.length; m++) {
    const i = idx[m];
    S2 += arm[i] * arm[i];
    S1 += g[i] * arm[i];
    psi = (target + S1) / S2;
    const next = m + 1 < idx.length ? g[idx[m + 1]] / arm[idx[m + 1]] : Infinity;
    if (psi <= next) { found = true; break; }
  }
  if (!found) psi = (target + S1) / S2;
  let Fmax = 0;
  for (const i of idx) {
    const F = k * Math.max(0, arm[i] * psi - g[i]);
    if (F > Fmax) Fmax = F;
  }
  return { Kc: Fmax / FmaxRigid, psi, Fmax, FmaxRigid };
}

// ---------------------------------------------------------------------------
// Pin stiffness
// ---------------------------------------------------------------------------

export interface HertzLine {
  /** Approach of the two cylinder centres, mm */
  delta: number;
  /** Contact half-width, mm */
  a: number;
}

/**
 * Hertz line contact of two cylinders (radii R1, R2 mm; E MPa) under F (N) over length L (mm): approach of the centres.
 * `invR` = 1/R* (curvature sum, 1/mm); the half-width uses it, the log terms use each body's own radius.
 */
export function hertzLineApproach(
  F: number, L: number, R1: number, E1: number, nu1: number, R2: number, E2: number, nu2: number, invR: number,
): HertzLine {
  const Es = effectiveModulus({ E: E1, nu: nu1 }, { E: E2, nu: nu2 });
  const Rs = 1 / Math.max(invR, 1e-6);
  const a = Math.sqrt((4 * F * Rs) / (Math.PI * L * Es));
  const term = (R: number, E: number, nu: number) => ((1 - nu * nu) / E) * Math.max(0, Math.log((4 * R) / a) - 0.5);
  const delta = ((2 * F) / (Math.PI * L)) * (term(R1, E1, nu1) + term(R2, E2, nu2));
  return { delta, a };
}

/** Largest disc radius of curvature used in the contact term (a nearly flat profile point), mm. */
export const MAX_DISC_RADIUS = 1e4;
/** Smallest force the secant stiffness is taken at, N (the log contact law has no stiffness at zero load). */
export const MIN_STIFFNESS_FORCE = 1;

export interface PinStiffness {
  /** Force the secant stiffness is taken at, N */
  F: number;
  /** Contact (Hertz secant), bending and series stiffness, N/mm (kb Infinity for an integral ring) */
  kc: number;
  kb: number;
  k: number;
  deltaC: number;
  deltaB: number;
  /** Contact half-width, mm, and the disc radius used (|rho_a|), mm */
  a: number;
  R2: number;
}

/** The pin spring of the load-sharing model at force F (N), with the disc curvature kappa_a (1/mm) at the contact. */
export function pinStiffness(inputs: GearboxInputs, F: number, kappaA: number, span: number): PinStiffness {
  const Fs = Math.max(MIN_STIFFNESS_FORCE, fin(F) ? F : 0);
  const pin = ringContactMaterial(inputs.outerPin);
  const disc = inputs.discMaterial;
  const R2 = kappaA !== 0 ? Math.min(MAX_DISC_RADIUS, Math.abs(1 / kappaA)) : MAX_DISC_RADIUS;
  const h = hertzLineApproach(Fs, inputs.L, inputs.rr, pin.E, pin.nu, R2, disc.E, disc.nu, 1 / inputs.rr + kappaA);
  const kc = Fs / h.delta;
  let kb = Infinity, deltaB = 0;
  if (inputs.outerPin.construction !== 'integral') {
    const bolt = inputs.outerPin.construction === 'boltBushing';
    const d = bolt ? inputs.outerPin.shankDia : 2 * inputs.rr;
    const E = bolt ? SPEC_STEEL.E : inputs.outerPin.material.E;
    const I = (Math.PI * d ** 4) / 64;
    kb = (48 * E * I) / span ** 3;
    deltaB = Fs / kb;
  }
  const k = Number.isFinite(kb) ? 1 / (1 / kc + 1 / kb) : kc;
  return { F: Fs, kc, kb, k, deltaC: h.delta, deltaB, a: h.a, R2 };
}

/**
 * Rigid peak pin force per N*m on one disc (the kernel's F_unit at its reference sweep, nth samples of a full turn) and
 * the disc curvature kappa_a at that contact.
 */
export function governingContact(Zp: number, Rp: number, e: number, rr: number, nth = 240, npf = 6000): { Funit: number; kappaA: number } {
  const prof = computeProfile(Zp, Rp, e, rr, npf);
  const Zc = Zp - 1;
  let best = 0, kap = 0;
  for (let t = 0; t < nth; t++) {
    const th = (TWO_PI * t) / nth;
    const gm = toleranceGeometryAt(Zp, Rp, e, rr, 0, th);
    let s2 = 0, am = 0, im = -1;
    for (let i = 0; i < Zp; i++) {
      const a = gm.arm[i];
      if (a > 0) { s2 += a * a; if (a > am) { am = a; im = i; } }
    }
    if (!(s2 > 0) || im < 0) continue;
    const F = (1000 * am) / s2;
    if (F > best) {
      best = F;
      let ang = (TWO_PI * im) / Zp + th / Zc;
      ang -= Math.floor(ang / TWO_PI) * TWO_PI;
      const j = Math.floor((ang / TWO_PI) * npf) % npf;
      kap = prof.kappaA[j];
    }
  }
  return { Funit: best, kappaA: kap };
}

// ---------------------------------------------------------------------------
// Random numbers
// ---------------------------------------------------------------------------

/** mulberry32: small, fast, deterministic for a seed. Returns uniform [0, 1). */
export function makeRng(seed: number): () => number {
  let s = (Math.floor(seed) >>> 0) || 0x9e3779b9;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Linear-interpolated quantile of a sorted copy. */
export function quantile(values: ArrayLike<number>, q: number): number {
  const a = Array.from(values).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const p = Math.min(1, Math.max(0, q)) * (a.length - 1);
  const i = Math.floor(p), f = p - i;
  return i + 1 < a.length ? a[i] * (1 - f) + a[i + 1] * f : a[i];
}

// ---------------------------------------------------------------------------
// The analysis
// ---------------------------------------------------------------------------

export interface ToleranceOptions {
  /** Monte Carlo trials (default: the spec's mcTrials) and seed (default: the spec's seed) */
  trials?: number;
  seed?: number;
  /** Theta samples over one outer pin pitch for the backlash (24) and for Kc (8; must divide the backlash count to reuse its geometry) */
  nBacklash?: number;
  nKc?: number;
  /** Compute the sensitivity shares (default true) and with how many trials per Kc term (default 100) */
  sensitivity?: boolean;
  sensitivityTrials?: number;
}

export interface BacklashValue {
  /** Output backlash (ring + inner), rad, and the two parts at the theta of the maximum */
  total: number;
  ring: number;
  inner: number;
  arcmin: number;
}

export interface ToleranceStat { p50: number; p95: number; mean: number }

export interface SensitivityItem { term: ToleranceTerm; label: string; value: number; share: number }

export interface ToleranceResult {
  valid: boolean;
  /** The job was cancelled (worker client) */
  cancelled: boolean;
  errors: string[];
  warnings: string[];
  /** The spec used (normalized) and whether the ring is integral */
  spec: ToleranceSpec;
  integral: boolean;
  trials: number;
  seed: number;
  /** Monte Carlo builds that fit and turn at every theta (no ring or inner-hole interference); the statistics use only these */
  freeBuilds: number;
  /** Fraction of the builds that bind somewhere (ring or inner holes) */
  bindProb: number;
  /** The statistics are shown: at least min(50, trials) free builds (else they are NaN) */
  statsShown: boolean;
  backlash: {
    /** No random errors, bushing play at its mean (play/2), hole play 0 */
    design: BacklashValue;
    /** Full bushing play and every random term at its gap-widening limit (an upper bound of every build) */
    worst: BacklashValue;
    /** Monte Carlo over the free builds of the per-trial max over theta, rad (and arcmin); NaN when too few builds are free */
    mc: ToleranceStat;
    mcArcmin: ToleranceStat;
  };
  binding: {
    /** Worst-case minimum ring gap at t = 0, mm (< 0 = the worst stack binds) */
    minGapWorst: number;
    /** The random stack the profile clearance must cover, mm, and a rounded-up value to use (0.005 mm steps) */
    requiredProfileClearance: number;
    suggestedProfileClearance: number;
    binds: boolean;
    /** Fraction of Monte Carlo builds whose disc cannot fit at some theta (even moving within the bearing clearance) */
    interferenceProb: number;
    /** Inner holes: worst-case minimum radial gap, required diametral clearance (rounded up 0.005 mm), MC fraction */
    innerMinGapWorst: number;
    requiredInnerHoleClearance: number;
    suggestedInnerHoleClearance: number;
    innerBinds: boolean;
    innerInterferenceProb: number;
  };
  kc: {
    /** The design gaps (no random errors, bushing play/2) */
    designStrength: number;
    designLife: number;
    strength: ToleranceStat;
    life: ToleranceStat;
    typedKc: number;
    typedKcLife: number;
  };
  stiffness: {
    /** Pin springs at the strength force (T_des) and at the working force (T_req) */
    strength: PinStiffness;
    life: PinStiffness;
    /** Rigid peak pin force per N*m on one disc, N, and the disc curvature at that contact, 1/mm */
    Funit: number;
    kappaA: number;
    /** min over theta of sum_{arm>0} arm^2, mm^2 */
    sumArm2: number;
    share: number;
    /** Joint torsional stiffness at T_req, N*m/rad and N*m/arcmin; twist at T_req, rad and arcmin */
    Kt_Nm_per_rad: number;
    Kt_Nm_per_arcmin: number;
    twistReq: number;
    twistReq_arcmin: number;
  };
  sensitivity: { backlash: SensitivityItem[]; kc: SensitivityItem[] } | null;
  /** Fitted clearances for these process values: worst case and statistical (the spec's bindTarget) */
  fit: { worst: FittedValues; statistical: StatisticalFit };
  elapsedMs: number;
}

export interface FittedValues { profileClearance: number; innerHoleClearance: number }

export interface StatisticalFit extends FittedValues {
  /** Monte Carlo binding probability at the fitted values (ring / inner holes) and the target */
  ringProb: number;
  /** Probabilities one grid step (0.005 mm) below the fitted values (> target unless the fit is 0) */
  ringProbBelow: number;
  innerProbBelow: number;
  innerProb: number;
  target: number;
  trials: number;
  elapsedMs: number;
}

export interface ToleranceProgress { fraction: number; phase: 'trials' | 'sensitivity' }

interface Prepared {
  inputs: GearboxInputs;
  spec: ToleranceSpec;
  integral: boolean;
  Zp: number;
  Zw: number;
  Rw: number;
  share: number;
  geo: ToleranceGeometry[];
  /** indices into geo used for Kc */
  kcIdx: number[];
  maxNU: number;
  kStr: number;
  kLife: number;
  Tstr: number;
  Tlife: number;
}

/** One build: per-pin random terms (fixed over theta) and the eccentricity error. */
interface Draw {
  /** signed eccentricity error in the ring gaps (-de n.u), its per-pin gap-widening bound (+deAbs |n.u|), inner term */
  de: number;
  deAbs: number;
  ide: number;
  /** theta-independent part of each outer gap */
  base: Float64Array;
  dx: Float64Array;
  dy: Float64Array;
  /** theta-independent part of each inner gap and the hole position vectors */
  ibase: Float64Array;
  px: Float64Array;
  py: Float64Array;
}

function drawBuild(p: Prepared, t: ToleranceSpec, rnd: () => number): Draw {
  const { Zp, Zw } = p;
  const U = (h: number) => (2 * rnd() - 1) * h;
  const de = U(t.eccError);
  const base = new Float64Array(Zp), dx = new Float64Array(Zp), dy = new Float64Array(Zp);
  for (let i = 0; i < Zp; i++) {
    if (p.integral) {
      base[i] = t.profileClearance + U(t.profileError) + U(t.profileError);
    } else {
      // true-position error plus where the clamped bolt sits in its clearance hole (both uniform over their zones)
      const r = t.pinPosition * Math.sqrt(rnd()), ph = TWO_PI * rnd();
      const rh = t.holePlay * Math.sqrt(rnd()), phh = TWO_PI * rnd();
      dx[i] = r * Math.cos(ph) + rh * Math.cos(phh); dy[i] = r * Math.sin(ph) + rh * Math.sin(phh);
      base[i] = t.profileClearance + rnd() * t.bushingPlay + U(t.profileError) - U(t.pinDiaTol / 2);
    }
  }
  const ibase = new Float64Array(Zw), px = new Float64Array(Zw), py = new Float64Array(Zw);
  for (let k = 0; k < Zw; k++) {
    const r = t.innerHolePosition * Math.sqrt(rnd()), ph = TWO_PI * rnd();
    px[k] = r * Math.cos(ph); py[k] = r * Math.sin(ph);
    ibase[k] = t.innerHoleClearance / 2 - U(t.innerPinDiaTol / 2);
  }
  return { de, deAbs: 0, ide: de, base, dx, dy, ibase, px, py };
}

/**
 * Deterministic builds. 'design': no random errors, bushing play/2, hole play 0. 'worst': full bushing play and every
 * random term at its gap-widening limit for each pin separately (an upper bound of every Monte Carlo gap).
 */
function fixedBuild(p: Prepared, t: ToleranceSpec, mode: 'design' | 'worst'): Draw {
  const { Zp, Zw } = p;
  const worst = mode === 'worst';
  const base = new Float64Array(Zp);
  for (let i = 0; i < Zp; i++) {
    base[i] = p.integral
      ? t.profileClearance + (worst ? 2 * t.profileError : 0)
      : t.profileClearance + (worst
        ? t.bushingPlay + t.profileError + t.pinDiaTol / 2 + t.pinPosition + t.holePlay
        : t.bushingPlay / 2);
  }
  const ibase = new Float64Array(Zw);
  for (let k = 0; k < Zw; k++) ibase[k] = t.innerHoleClearance / 2 + (worst ? t.innerHolePosition + t.innerPinDiaTol / 2 : 0);
  return {
    de: 0, deAbs: worst ? t.eccError : 0, ide: worst ? t.eccError : 0,
    base, dx: new Float64Array(Zp), dy: new Float64Array(Zp), ibase, px: new Float64Array(Zw), py: new Float64Array(Zw),
  };
}

function ringGaps(d: Draw, g: ToleranceGeometry, out: Float64Array): Float64Array {
  for (let i = 0; i < out.length; i++) {
    out[i] = d.base[i] - (d.dx[i] * g.nx[i] + d.dy[i] * g.ny[i]) - d.de * g.nu[i] + d.deAbs * Math.abs(g.nu[i]);
  }
  return out;
}

function innerGaps(d: Draw, g: ToleranceGeometry, out: Float64Array): Float64Array {
  for (let k = 0; k < out.length; k++) out[k] = d.ibase[k] + d.ide + (d.px[k] * g.ux + d.py[k] * g.uy);
  return out;
}

interface BuildEval { total: number; ring: number; inner: number; ringInterf: boolean; innerInterf: boolean }

/** Backlash of one build: max over the theta samples, and whether the ring or the inner holes bind at any of them. */
function backlashOf(p: Prepared, d: Draw): BuildEval {
  const g = new Float64Array(p.Zp), gi = new Float64Array(p.Zw);
  const c = p.spec.bearingClearance;
  let best: BuildEval = { total: 0, ring: 0, inner: 0, ringInterf: false, innerInterf: false };
  let ringInterf = false, innerInterf = false;
  for (const gm of p.geo) {
    ringGaps(d, gm, g);
    const fr = freeRotation(gm.arm, gm.nx, gm.ny, g, c);
    innerGaps(d, gm, gi);
    const ir = innerFreeRotation(gm.tu, gi, p.Rw);
    if (fr.interference) ringInterf = true;
    if (ir.interference) innerInterf = true;
    const ring = fr.plus + fr.minus, inner = ir.plus + ir.minus;
    if (ring + inner > best.total) best = { total: ring + inner, ring, inner, ringInterf: false, innerInterf: false };
  }
  best.ringInterf = ringInterf;
  best.innerInterf = innerInterf;
  return best;
}

/** Max Kc over the Kc theta samples for one build, strength and life. */
function kcOf(p: Prepared, d: Draw): { str: number; life: number } {
  const g = new Float64Array(p.Zp);
  let str = 0, life = 0;
  for (const j of p.kcIdx) {
    const gm = p.geo[j];
    ringGaps(d, gm, g);
    const a = loadShare(gm.arm, g, p.kStr, p.Tstr).Kc;
    const b = loadShare(gm.arm, g, p.kLife, p.Tlife).Kc;
    if (a > str) str = a;
    if (b > life) life = b;
  }
  return { str, life };
}

const val = (rad: number, ring: number, inner: number): BacklashValue => ({ total: rad, ring, inner, arcmin: rad * ARCMIN_PER_RAD });

function stat(arr: ArrayLike<number>): ToleranceStat {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i];
  return { p50: quantile(arr, 0.5), p95: quantile(arr, 0.95), mean: arr.length ? s / arr.length : NaN };
}

function worstOf(p: Prepared, t: ToleranceSpec): BuildEval {
  const q: Prepared = { ...p, spec: t };
  return backlashOf(q, fixedBuild(q, t, 'worst'));
}

/** Free builds needed before the Monte Carlo statistics are shown. */
export const MIN_FREE_BUILDS = 50;

function invalidTolerance(errors: string[], spec: ToleranceSpec, integral: boolean): ToleranceResult {
  const n = NaN;
  const bv = val(n, n, n);
  const st: ToleranceStat = { p50: n, p95: n, mean: n };
  const ps: PinStiffness = { F: n, kc: n, kb: n, k: n, deltaC: n, deltaB: n, a: n, R2: n };
  return {
    valid: false, cancelled: false, errors, warnings: [], spec, integral, trials: 0, seed: spec.seed, freeBuilds: 0,
    bindProb: n, statsShown: false,
    backlash: { design: bv, worst: bv, mc: st, mcArcmin: st },
    binding: {
      minGapWorst: n, requiredProfileClearance: n, suggestedProfileClearance: n, binds: false, interferenceProb: n,
      innerMinGapWorst: n, requiredInnerHoleClearance: n, suggestedInnerHoleClearance: n, innerBinds: false, innerInterferenceProb: n,
    },
    kc: { designStrength: n, designLife: n, strength: st, life: st, typedKc: n, typedKcLife: n },
    stiffness: {
      strength: ps, life: ps, Funit: n, kappaA: n, sumArm2: n, share: n,
      Kt_Nm_per_rad: n, Kt_Nm_per_arcmin: n, twistReq: n, twistReq_arcmin: n,
    },
    sensitivity: null,
    fit: {
      worst: { profileClearance: n, innerHoleClearance: n },
      statistical: { profileClearance: n, innerHoleClearance: n, ringProb: n, innerProb: n, ringProbBelow: n, innerProbBelow: n, target: n, trials: 0, elapsedMs: 0 },
    },
    elapsedMs: 0,
  };
}

// ---------------------------------------------------------------------------
// Statistical clearance fit
// ---------------------------------------------------------------------------

/**
 * The smallest clearances on the 0.005 mm grid whose Monte Carlo binding probability is <= target (ring and inner holes
 * separately). Common random numbers: the builds are drawn exactly as the analysis draws them (same seed, same order of
 * draws; a clearance only adds to every gap), so the probability is monotone in the clearance, the fit is deterministic,
 * and the analysis at the fitted value reports a probability <= target. Per build the smallest clearance that fits at
 * every theta sample is found (inner holes: exact; ring: bisection with the exact translation test), then the fitted
 * value is the smallest grid point that at most target x trials builds exceed. Never above the worst-case fit.
 */
export function statisticalFitFor(inputs: GearboxInputs, spec: ToleranceSpec, opts: { trials?: number; seed?: number; nBacklash?: number } = {}): StatisticalFit {
  const target = fin(spec.bindTarget) ? spec.bindTarget : DEFAULT_BIND_TARGET;
  const trials = fin(opts.trials) ? Math.max(1, Math.floor(opts.trials)) : fitTrialsFor(target);
  const seed = fin(opts.seed) ? Math.floor(opts.seed) : spec.seed;
  const nB = fin(opts.nBacklash) ? Math.max(1, Math.floor(opts.nBacklash)) : 24;
  const key = statFitKey(inputs, spec, trials, seed, nB);
  const hit = fitCache.get(key);
  if (hit) return hit;
  const r = statisticalFitRaw(inputs, spec, trials, seed, nB, target);
  fitCache.set(key, r);
  if (fitCache.size > 64) fitCache.delete(fitCache.keys().next().value as string);
  return r;
}

function notFitted(spec: ToleranceSpec): StatisticalFit {
  const n = NaN;
  return { profileClearance: n, innerHoleClearance: n, ringProb: n, innerProb: n, ringProbBelow: n, innerProbBelow: n, target: spec.bindTarget, trials: 0, elapsedMs: 0 };
}

/** Sample size of the statistical fit: 50 builds expected in the tail, 2000..25000 (5000 for 1%). */
export function fitTrialsFor(target: number): number {
  return Math.min(25000, Math.max(2000, Math.ceil(50 / (fin(target) && target > 0 ? target : DEFAULT_BIND_TARGET) - 1e-9)));
}

/** Everything the statistical fit depends on (not the clearances, the torques or the materials). */
export function statFitKey(inputs: GearboxInputs, spec: ToleranceSpec, trials = fitTrialsFor(spec.bindTarget), seed = spec.seed, nB = 24): string {
  const t = spec;
  return JSON.stringify([inputs.Zp, inputs.D, inputs.e, inputs.rr, inputs.rw, inputs.Zw, inputs.Db, inputs.tMin, inputs.RwOverride,
    inputs.outerPin?.construction === 'integral', t.profileError, t.pinPosition, t.pinDiaTol, t.eccError, t.innerHolePosition,
    t.innerPinDiaTol, t.bushingPlay, t.holePlay, t.bearingClearance, t.bindTarget, trials, seed, nB]);
}

const fitCache = new Map<string, StatisticalFit>();

function statisticalFitRaw(inputs: GearboxInputs, spec: ToleranceSpec, trials: number, seed: number, nB: number, target: number): StatisticalFit {
  const t0 = now();
  const integral = inputs.outerPin?.construction === 'integral';
  const worst = fittedClearances(spec, integral);
  const gd = deriveGeometry(inputs);
  const Zp = inputs.Zp, Zw = inputs.Zw;
  const geo: ToleranceGeometry[] = [];
  for (let j = 0; j < nB; j++) geo.push(toleranceGeometryAt(Zp, gd.Rp, inputs.e, inputs.rr, Zw, ((2 * Math.PI) / Zp) * (j / nB)));
  const p = { Zp, Zw, integral } as Prepared;
  const zeroC: ToleranceSpec = { ...spec, profileClearance: 0, innerHoleClearance: 0 };
  const rnd = makeRng(seed);
  const c = Math.max(0, spec.bearingClearance);
  const needRing = new Float64Array(trials), needInner = new Float64Array(trials);
  const g = new Float64Array(Zp), gi = new Float64Array(Zw), b = new Float64Array(Zp);
  for (let n = 0; n < trials; n++) {
    const d = drawBuild(p, zeroC, rnd);
    // inner holes: every gap >= 0  ->  clearance (diametral) >= 2 max(-gap0)
    let ni = 0;
    for (const gm of geo) { innerGaps(d, gm, gi); for (let k = 0; k < Zw; k++) ni = Math.max(ni, -gi[k]); }
    needInner[n] = 2 * ni;
    // ring: smallest added gap with a translation within c_b, max over theta. Per theta the need lies in
    // [max(0, m - c_b), m] with m = -min gap (t = 0 fits at m), so a theta whose m is below the running max is skipped.
    const order: { j: number; m: number }[] = [];
    for (let j = 0; j < geo.length; j++) {
      ringGaps(d, geo[j], g);
      let m = 0;
      for (let i = 0; i < Zp; i++) m = Math.max(m, -g[i]);
      order.push({ j, m });
    }
    order.sort((x, y) => y.m - x.m);
    let need = 0;
    for (const { j, m } of order) {
      if (m <= need) break;
      const gm = geo[j];
      ringGaps(d, gm, g);
      const fitsAt = (cl: number) => {
        for (let i = 0; i < Zp; i++) b[i] = -(g[i] + cl);
        return feasibleTranslation(gm.nx, gm.ny, b, c);
      };
      let lo = Math.max(need, m - c), hi = m;
      if (fitsAt(lo)) { need = lo; continue; }
      while (hi - lo > 1e-5) { const mid = 0.5 * (lo + hi); if (fitsAt(mid)) hi = mid; else lo = mid; }
      need = hi;
    }
    needRing[n] = need;
  }
  const allowed = Math.floor(target * trials + 1e-9);
  /** smallest grid value v with #(need > v) <= allowed */
  const gridFit = (need: Float64Array, cap: number) => {
    const sorted = Array.from(need).sort((x, y) => y - x); // descending
    const v = allowed < sorted.length ? sorted[allowed] : 0; // need > grid must hold for at most `allowed` builds
    return Math.min(cap, ceilStep(v));
  };
  const profileClearance = gridFit(needRing, worst.profileClearance);
  const innerHoleClearance = gridFit(needInner, worst.innerHoleClearance);
  let rb = 0, ib = 0;
  for (let n = 0; n < trials; n++) { if (needRing[n] > profileClearance + 1e-9) rb++; if (needInner[n] > innerHoleClearance + 1e-9) ib++; }
  let rb1 = 0, ib1 = 0;
  for (let n = 0; n < trials; n++) {
    if (needRing[n] > profileClearance - 0.005 + 1e-9) rb1++;
    if (needInner[n] > innerHoleClearance - 0.005 + 1e-9) ib1++;
  }
  return {
    profileClearance, innerHoleClearance, ringProb: rb / trials, innerProb: ib / trials,
    ringProbBelow: profileClearance >= 0.005 - 1e-12 ? rb1 / trials : NaN, innerProbBelow: innerHoleClearance >= 0.005 - 1e-12 ? ib1 / trials : NaN,
    target, trials, elapsedMs: now() - t0,
  };
}

/** The spec with its clearances fitted for its fit mode (worst case, or the statistical Monte Carlo fit). Pure. */
export function fitClearances(inputs: GearboxInputs, spec: ToleranceSpec): ToleranceSpec {
  const integral = inputs.outerPin?.construction === 'integral';
  if (spec.fitMode !== 'statistical') return { ...spec, ...fittedClearances(spec, integral) };
  try {
    const f = statisticalFitFor(inputs, spec);
    return { ...spec, profileClearance: f.profileClearance, innerHoleClearance: f.innerHoleClearance };
  } catch {
    return { ...spec, ...fittedClearances(spec, integral) };
  }
}

/** A cancelled run (the worker client resolves a cancelled job with this). */
export function cancelledToleranceResult(inputs?: GearboxInputs): ToleranceResult {
  const spec = inputs ? toleranceOf(inputs) : defaultToleranceSpec();
  return { ...invalidTolerance([], spec, inputs?.outerPin?.construction === 'integral'), cancelled: true };
}

function* toleranceGen(inputs: GearboxInputs, opts: ToleranceOptions = {}): Generator<ToleranceProgress, ToleranceResult, void> {
  const t0 = now();
  const integral = inputs?.outerPin?.construction === 'integral';
  const spec = toleranceOf(inputs);
  const v = validateGearboxInputs(inputs);
  if (v.errors.length) return invalidTolerance(v.errors, spec, integral);
  const se = Object.values(validateToleranceSpec(spec)) as string[];
  if (se.length) return invalidTolerance(se, spec, integral);
  const trials = fin(opts.trials) ? Math.max(1, Math.floor(opts.trials)) : spec.mcTrials;
  const seed = fin(opts.seed) ? Math.floor(opts.seed) : spec.seed;
  const nB = fin(opts.nBacklash) ? Math.max(1, Math.floor(opts.nBacklash)) : 24;
  const nK = fin(opts.nKc) ? Math.max(1, Math.floor(opts.nKc)) : 8;

  const gd = deriveGeometry(inputs);
  const Rp = gd.Rp, Zp = inputs.Zp, Zw = inputs.Zw;
  const share = discShareOf(inputs.discs, inputs.discShare);
  const pitch = TWO_PI / Zp;
  const geo: ToleranceGeometry[] = [];
  for (let j = 0; j < nB; j++) geo.push(toleranceGeometryAt(Zp, Rp, inputs.e, inputs.rr, Zw, (pitch * j) / nB));
  const kcIdx: number[] = [];
  for (let j = 0; j < nK; j++) kcIdx.push(Math.min(nB - 1, Math.round((j * nB) / nK)));
  if (nB % nK !== 0) {
    // Kc samples that are not on the backlash grid get their own geometry
    kcIdx.length = 0;
    for (let j = 0; j < nK; j++) { kcIdx.push(geo.length); geo.push(toleranceGeometryAt(Zp, Rp, inputs.e, inputs.rr, Zw, (pitch * j) / nK)); }
  }
  const backlashGeo = geo.slice(0, nB);
  let maxNU = 0, sumArm2 = Infinity;
  for (const gm of backlashGeo) {
    let s2 = 0;
    for (let i = 0; i < Zp; i++) {
      maxNU = Math.max(maxNU, Math.abs(gm.nu[i]));
      if (gm.arm[i] > 0) s2 += gm.arm[i] * gm.arm[i];
    }
    sumArm2 = Math.min(sumArm2, s2);
  }

  // pin springs at the rigid peak force of each load case
  const gc = governingContact(Zp, Rp, inputs.e, inputs.rr);
  const kStrength = pinStiffness(inputs, gc.Funit * inputs.Tdes * share, gc.kappaA, gd.span);
  const kLife = pinStiffness(inputs, gc.Funit * inputs.Treq * share, gc.kappaA, gd.span);

  const p: Prepared = {
    inputs, spec, integral, Zp, Zw, Rw: gd.Rw, share, geo: backlashGeo, kcIdx: [], maxNU,
    kStr: kStrength.k, kLife: kLife.k, Tstr: 1000 * inputs.Tdes * share, Tlife: 1000 * inputs.Treq * share,
  };
  // Kc uses the full geo list (it may hold extra samples)
  const pk: Prepared = { ...p, geo, kcIdx };

  // design and worst case
  const desBuild = fixedBuild(p, spec, 'design');
  const des = backlashOf(p, desBuild);
  const desKc = kcOf(pk, desBuild);
  const worst = worstOf(p, spec);

  // Monte Carlo
  const rnd = makeRng(seed);
  const bl = new Float64Array(trials), ks = new Float64Array(trials), kl = new Float64Array(trials);
  let ringBind = 0, innerBind = 0, free = 0;
  const sens = opts.sensitivity !== false;
  const sTrials = fin(opts.sensitivityTrials) ? Math.max(2, Math.floor(opts.sensitivityTrials)) : Math.min(100, trials);
  const kcTerms: ToleranceTerm[] = (['bushingPlay', 'holePlay', 'profileError', 'pinPosition', 'pinDiaTol', 'eccError'] as ToleranceTerm[])
    .filter((x) => !(integral && INTEGRAL_UNUSED_TERMS.includes(x)));
  const totalWork = trials + (sens ? kcTerms.length * sTrials : 0);
  let done = 0;
  let slice = now();
  for (let n = 0; n < trials; n++) {
    const d = drawBuild(p, spec, rnd);
    const b = backlashOf(p, d);
    if (b.ringInterf) ringBind++;
    if (b.innerInterf) innerBind++;
    // a build that binds anywhere does not turn (or only with preload): it is counted, but its backlash and Kc are not
    if (!b.ringInterf && !b.innerInterf) {
      const k = kcOf(pk, d);
      bl[free] = b.total; ks[free] = k.str; kl[free] = k.life;
      free++;
    }
    done++;
    if (now() - slice > SLICE_MS) { slice = now(); yield { fraction: done / totalWork, phase: 'trials' }; }
  }

  // binding (worst-case stack at t = 0)
  const stacks = toleranceStacks(spec, integral, maxNU);
  const stack = stacks.profile;
  const innerStack = stacks.inner;
  const minGapWorst = spec.profileClearance - stack;
  const innerMinGapWorst = spec.innerHoleClearance / 2 - innerStack;

  // stiffness and twist at T_req (zero gaps, rigid sharing)
  const KtRad = (kLife.k * sumArm2) / (1000 * share);
  const twist = KtRad > 0 ? inputs.Treq / KtRad : 0;

  // sensitivity
  let sensitivity: ToleranceResult['sensitivity'] = null;
  if (sens) {
    const zero: ToleranceSpec = { ...spec };
    for (const k of TOLERANCE_MM_FIELDS) zero[k] = 0;
    const blTerms = TOLERANCE_MM_FIELDS.filter((x) => !(integral && INTEGRAL_UNUSED_TERMS.includes(x)));
    const bItems: SensitivityItem[] = blTerms.map((term) => {
      const s1 = { ...zero, [term]: spec[term] };
      const value = spec[term] > 0 ? worstOf(p, s1).total : 0;
      return { term, label: TOLERANCE_TERM_LABEL[term], value, share: 0 };
    });
    const bSum = bItems.reduce((s, x) => s + x.value, 0);
    for (const x of bItems) x.share = bSum > 0 ? x.value / bSum : 0;
    const kItems: SensitivityItem[] = [];
    let ti = 0;
    for (const term of kcTerms) {
      const s1: ToleranceSpec = { ...spec };
      for (const x of kcTerms) s1[x] = 0;
      s1[term] = spec[term];
      let variance = 0;
      if (spec[term] > 0) {
        const r2 = makeRng(seed + 7919 * (++ti));
        const q: Prepared = { ...pk, spec: s1 };
        const arr = new Float64Array(sTrials);
        for (let n = 0; n < sTrials; n++) {
          arr[n] = kcOf(q, drawBuild(q, s1, r2)).str;
          done++;
          if (now() - slice > SLICE_MS) { slice = now(); yield { fraction: Math.min(1, done / totalWork), phase: 'sensitivity' }; }
        }
        let m = 0;
        for (const x of arr) m += x;
        m /= sTrials;
        for (const x of arr) variance += (x - m) * (x - m);
        variance /= Math.max(1, sTrials - 1);
      } else done += sTrials;
      kItems.push({ term, label: TOLERANCE_TERM_LABEL[term], value: variance, share: 0 });
    }
    const kSum = kItems.reduce((s, x) => s + x.value, 0);
    for (const x of kItems) x.share = kSum > 0 ? x.value / kSum : 0;
    sensitivity = { backlash: bItems, kc: kItems };
  }

  const statsShown = free >= Math.min(MIN_FREE_BUILDS, trials) && free > 0;
  const none = new Float64Array(0);
  const mc = stat(statsShown ? bl.subarray(0, free) : none);
  const warnings: string[] = [];
  if (!statsShown) warnings.push('Most Monte Carlo builds bind: raise the clearance before reading the backlash and Kc statistics.');
  if (minGapWorst < 0) warnings.push(`The worst-case tolerance stack (${stack.toFixed(3)} mm) is larger than the profile clearance: the disc can bind. Use a profile clearance of at least ${ceilStep(stack).toFixed(3)} mm.`);
  if (innerMinGapWorst < 0) warnings.push(`The inner holes can bind: their worst-case stack (${innerStack.toFixed(3)} mm radial) is larger than half the inner hole clearance. Use at least ${ceilStep(2 * innerStack).toFixed(3)} mm.`);
  return {
    valid: true, cancelled: false, errors: [], warnings, spec, integral, trials, seed, freeBuilds: free,
    bindProb: trials ? 1 - free / trials : 0, statsShown,
    backlash: {
      design: val(des.total, des.ring, des.inner),
      worst: val(worst.total, worst.ring, worst.inner),
      mc,
      mcArcmin: { p50: mc.p50 * ARCMIN_PER_RAD, p95: mc.p95 * ARCMIN_PER_RAD, mean: mc.mean * ARCMIN_PER_RAD },
    },
    binding: {
      minGapWorst, requiredProfileClearance: stack, suggestedProfileClearance: ceilStep(stack), binds: minGapWorst < -1e-12,
      interferenceProb: trials ? ringBind / trials : 0,
      innerMinGapWorst, requiredInnerHoleClearance: 2 * innerStack, suggestedInnerHoleClearance: ceilStep(2 * innerStack),
      innerBinds: innerMinGapWorst < -1e-12, innerInterferenceProb: trials ? innerBind / trials : 0,
    },
    kc: {
      designStrength: desKc.str, designLife: desKc.life,
      strength: stat(statsShown ? ks.subarray(0, free) : none), life: stat(statsShown ? kl.subarray(0, free) : none),
      typedKc: inputs.Kc, typedKcLife: inputs.KcLife,
    },
    stiffness: {
      strength: kStrength, life: kLife, Funit: gc.Funit, kappaA: gc.kappaA, sumArm2, share,
      Kt_Nm_per_rad: KtRad, Kt_Nm_per_arcmin: KtRad / ARCMIN_PER_RAD, twistReq: twist, twistReq_arcmin: twist * ARCMIN_PER_RAD,
    },
    sensitivity,
    fit: { worst: fittedClearances(spec, integral), statistical: spec.fitMode === 'statistical' ? statisticalFitFor(inputs, spec, { nBacklash: nB }) : notFitted(spec) },
    elapsedMs: now() - t0,
  };
}

/** The tolerance analysis (backlash, binding, Monte Carlo Kc, stiffness, sensitivity). Never throws. */
export function analyzeTolerance(inputs: GearboxInputs, opts?: ToleranceOptions, hooks?: RunHooks<ToleranceProgress>): ToleranceResult {
  try {
    return runSync(toleranceGen(inputs, opts), hooks) ?? cancelledToleranceResult(inputs);
  } catch (err) {
    return invalidTolerance([`Tolerance analysis failed: ${err instanceof Error ? err.message : String(err)}`], defaultToleranceSpec(), false);
  }
}

/** Same, yielding to the event loop between slices (cancellable from the worker). */
export async function analyzeToleranceAsync(inputs: GearboxInputs, opts?: ToleranceOptions, hooks?: RunHooks<ToleranceProgress>): Promise<ToleranceResult> {
  try {
    return (await runAsync(toleranceGen(inputs, opts), hooks)) ?? cancelledToleranceResult(inputs);
  } catch (err) {
    return invalidTolerance([`Tolerance analysis failed: ${err instanceof Error ? err.message : String(err)}`], defaultToleranceSpec(), false);
  }
}

/** The patch that applies a profile clearance (keeps the rest of the spec). */
export function withTolerance(inputs: GearboxInputs, patch: Partial<ToleranceSpec>): GearboxInputs {
  return { ...inputs, tolerance: { ...toleranceOf(inputs), ...patch } };
}

// ---------------------------------------------------------------------------
// Arm tip effect
// ---------------------------------------------------------------------------

/**
 * Lever from each joint's axis to the tool tip in the worst-case pose (mm), the arm model's rules: pitch and yaw use the
 * horizontal reach from the joint (links before the first pitch joint are a vertical column on the base axis); a roll
 * uses the distance along the chain from the next non-roll joint to the tip (0 when there is none).
 */
export function armTipLevers(arm: ArmInputs): number[] {
  const js = arm?.joints ?? [];
  const n = js.length;
  const p = firstPitchIndex(js);
  const L = js.map((j) => (fin(j.length_mm) && j.length_mm > 0 ? j.length_mm : 0));
  const x: number[] = [], s: number[] = [];
  for (let i = 0; i <= n; i++) {
    x.push(p < 0 || i <= p ? 0 : x[i - 1] + L[i - 1]);
    s.push(i === 0 ? 0 : s[i - 1] + L[i - 1]);
  }
  return js.map((j, i) => {
    if (j.motion === 'roll') {
      const k = nextNonRoll(js, i);
      return k < 0 ? 0 : s[n] - s[k];
    }
    return x[n] - x[i];
  });
}

export interface JointSlop {
  index: number;
  /** Lever to the tip, mm */
  lever: number;
  /** Output backlash (p95) and twist at T_req, rad; null when this joint has no gearbox analysis */
  backlash: number | null;
  twist: number | null;
  /** (backlash + twist) x lever, mm */
  tip: number | null;
}

export interface ArmSlop {
  joints: JointSlop[];
  /** Worst-case sum and root-sum-square over the joints with an analysis, mm */
  sum: number;
  rss: number;
  /** Joints counted */
  counted: number;
}

/** Tip error per joint and for the arm: (backlash p95 + twist at T_req) x lever. */
export function armTipSlop(levers: readonly number[], perJoint: readonly ({ backlash: number; twist: number } | null)[]): ArmSlop {
  let sum = 0, sq = 0, counted = 0;
  const joints: JointSlop[] = levers.map((lever, index) => {
    const pj = perJoint[index];
    if (!pj || !fin(pj.backlash) || !fin(pj.twist)) return { index, lever, backlash: null, twist: null, tip: null };
    const tip = (pj.backlash + pj.twist) * lever;
    sum += tip; sq += tip * tip; counted++;
    return { index, lever, backlash: pj.backlash, twist: pj.twist, tip };
  });
  return { joints, sum, rss: Math.sqrt(sq), counted };
}
