// Integral (pinless) ring, machined into the housing (CLAUDE.md Addition 12). Pure TypeScript, never throws on the UI path.
//
// The ring teeth are half-round bumps of radius rr centred on the pin circle (radius Rp), cut into the housing by an end
// mill of radius r_tool. In the ring frame (tooth 0 on +x, y up):
//   root circle (housing inner wall)  R_h = (max disc profile radius) + e + c_root = Rp + 2e - rr + c_root
//   tooth height                      h   = R_h - (Rp - rr)
//   base chord                        where the tooth circle (centre (Rp, 0), radius rr) meets the root circle:
//                                     cos(phi_b) = (Rp^2 + R_h^2 - rr^2) / (2 Rp R_h),  b = 2 R_h sin(phi_b)
//   tool fillet                       the end mill cannot reach the sharp corner where a tooth meets the root circle; it
//                                     leaves a fillet of radius r_tool: a circle centred at F with |F| = R_h - r_tool
//                                     (internally tangent to the root circle) and |F - C| = rr + r_tool (tangent to the
//                                     tooth). The fillet arc runs from its tangent point on the tooth to the one on the root.
// The tool-fillet clearance is the smallest signed distance from the disc (swept over the reference input angles,
// in the ring frame) to the fillet arcs: negative = the fillet material intrudes into the disc's path.

import { computeProfile } from './kernel';
import { materialProps, type MaterialProps, type OuterPinSpec } from './materials';

const TWO_PI = 2 * Math.PI;

/** Defaults of the integral ring fields (older sessions have none of them). */
export const DEFAULT_ROOT_CLEARANCE = 0.3;
export const DEFAULT_TOOL_RADIUS = 1.5;
export function defaultHousingMaterial(): MaterialProps { return materialProps('al-6061'); }
/** Smallest accepted gap between the disc and a tool fillet, mm (the check limit). */
export const FILLET_CLEARANCE_MIN = 0.05;
/** Standard end-mill radii, mm (diameters 1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10 mm), used by the fix search. */
export const END_MILL_RADII: readonly number[] = [0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4, 5];
/** Continuous tooth-radius set the Design Advisor searches for an integral ring, mm. */
export const INTEGRAL_RR_OPTIONS: readonly number[] = Array.from({ length: 19 }, (_, i) => 1.5 + 0.25 * i);

export interface IntegralSpec {
  housingMaterial: MaterialProps;
  rootClearance: number;
  toolRadius: number;
}

/** The integral-ring fields of an outer pin spec, with the defaults for any missing one. */
export function integralSpecOf(p: Partial<OuterPinSpec> | undefined): IntegralSpec {
  return {
    housingMaterial: p?.housingMaterial ?? defaultHousingMaterial(),
    rootClearance: p?.rootClearance ?? DEFAULT_ROOT_CLEARANCE,
    toolRadius: p?.toolRadius ?? DEFAULT_TOOL_RADIUS,
  };
}

export function isIntegral(p: Pick<OuterPinSpec, 'construction'> | undefined): boolean {
  return p?.construction === 'integral';
}

/** The ring-contact partner of the disc: the housing for an integral ring, else the bushing / pin material. */
export function ringContactMaterial(p: OuterPinSpec): MaterialProps {
  return p.construction === 'integral' ? integralSpecOf(p).housingMaterial : p.material;
}

/** Ring working length: the axial length of a tooth that the discs load, mm. */
export function toothLength(discs: number, L: number, gap: number): number {
  return discs * L + (discs - 1) * gap;
}

// ---------------------------------------------------------------------------
// Geometry
// ---------------------------------------------------------------------------

export interface FilletGeometry {
  /** A tool of this radius can touch both the tooth and the root circle */
  exists: boolean;
  /** Polar angle of the fillet centre / root tangent point (tooth 0, + side), rad */
  alpha: number;
  /** The fillet's root tangent point stays inside the half gap (alpha <= pi/Zp): the tool fits between two teeth */
  fits: boolean;
  F: { x: number; y: number };
  /** Tangent point on the root circle */
  Troot: { x: number; y: number };
  /** Tangent point on the tooth circle */
  Ttooth: { x: number; y: number };
}

/** Fillet of tooth 0 on its + side (positive polar angle). The - side is the mirror image (y -> -y). */
export function filletGeometry(Zp: number, Rp: number, rr: number, Rh: number, rt: number): FilletGeometry {
  const a = Rh - rt;
  const b = rr + rt;
  const none: FilletGeometry = {
    exists: false, alpha: NaN, fits: false, F: { x: NaN, y: NaN }, Troot: { x: NaN, y: NaN }, Ttooth: { x: NaN, y: NaN },
  };
  if (!(a > 0) || !(rt > 0)) return none;
  const c = (a * a + Rp * Rp - b * b) / (2 * a * Rp);
  if (!(c <= 1 && c >= -1)) return none;
  const alpha = Math.acos(c);
  const F = { x: a * Math.cos(alpha), y: a * Math.sin(alpha) };
  const Troot = { x: Rh * Math.cos(alpha), y: Rh * Math.sin(alpha) };
  const Ttooth = { x: Rp + (rr * (F.x - Rp)) / b, y: (rr * F.y) / b };
  return { exists: true, alpha, fits: alpha <= Math.PI / Zp + 1e-12, F, Troot, Ttooth };
}

export interface IntegralGeometry {
  /** Root circle (housing inner wall) radius, mm */
  Rh: number;
  /** Farthest reach of the disc in the ring frame (max profile radius + e), mm */
  reach: number;
  /** R_h - (Rp - rr), mm */
  toothHeight: number;
  /** Half angle of the tooth base at the root circle, rad */
  baseHalfAngle: number;
  /** Base chord width b, mm */
  baseChord: number;
  /** Tooth pitch at the root circle, 2 R_h sin(pi/Zp), mm */
  pitchChord: number;
  /** R_h < Rp + rr: the tooth circle reaches the housing wall */
  attached: boolean;
  /** R_h > Rp - rr: the teeth stand out of the wall */
  protrudes: boolean;
  /** The bases of neighbouring teeth do not overlap */
  separate: boolean;
  fillet: FilletGeometry;
}

/** Analytic farthest reach of the disc: tip radius Rp + e - rr of the actual profile, plus e. */
export function analyticReach(Rp: number, e: number, rr: number): number {
  return Rp + 2 * e - rr;
}

/**
 * Geometry of the machined ring. `reach` is the disc's farthest reach in the ring frame (pass the sampled actual-profile
 * maximum + e; it defaults to the exact analytic value Rp + 2e - rr).
 */
export function integralGeometry(
  Zp: number, Rp: number, e: number, rr: number, rootClearance: number, toolRadius: number, reach?: number,
): IntegralGeometry {
  const re = reach !== undefined && Number.isFinite(reach) ? Math.max(reach, analyticReach(Rp, e, rr)) : analyticReach(Rp, e, rr);
  const Rh = re + rootClearance;
  const attached = Rh < Rp + rr;
  const protrudes = Rh > Rp - rr;
  let baseHalfAngle = NaN, baseChord = NaN;
  if (attached && protrudes) {
    const c = (Rp * Rp + Rh * Rh - rr * rr) / (2 * Rp * Rh);
    baseHalfAngle = Math.acos(Math.min(1, Math.max(-1, c)));
    baseChord = 2 * Rh * Math.sin(baseHalfAngle);
  }
  const pitchChord = 2 * Rh * Math.sin(Math.PI / Zp);
  return {
    Rh, reach: re, toothHeight: Rh - (Rp - rr), baseHalfAngle, baseChord, pitchChord, attached, protrudes,
    separate: baseHalfAngle < Math.PI / Zp,
    fillet: filletGeometry(Zp, Rp, rr, Rh, toolRadius),
  };
}

/** Plain-text geometry errors of an integral ring (empty = machinable as specified). */
export function integralGeometryErrors(
  Zp: number, Rp: number, e: number, rr: number, rootClearance: number, toolRadius: number,
): string[] {
  const g = integralGeometry(Zp, Rp, e, rr, rootClearance, toolRadius);
  const out: string[] = [];
  const f = (x: number) => String(parseFloat(x.toFixed(3)));
  if (!g.protrudes) out.push('Ring teeth do not stand out of the housing wall: increase the root clearance or the eccentricity');
  else if (!g.attached) {
    out.push(`Tooth radius rr must be larger than e + root clearance / 2 (${f(e + rootClearance / 2)} mm), or the teeth would not reach the housing wall`);
  } else if (!g.separate) {
    out.push('Ring teeth merge at the root: neighbouring tooth bases overlap. Use a smaller tooth radius or a larger pin circle');
  } else if (!g.fillet.exists || !g.fillet.fits) {
    const max = maxFittingToolRadius(Zp, Rp, rr, g.Rh);
    out.push(`Tool radius ${f(toolRadius)} mm is too large to cut the root between two teeth (largest that fits the gap: ${f(Math.floor(max * 1000) / 1000)} mm)`);
  }
  return out;
}

/** Largest tool radius whose fillet still fits between two teeth (alpha = pi/Zp), mm. */
export function maxFittingToolRadius(Zp: number, Rp: number, rr: number, Rh: number): number {
  let lo = 0, hi = Rh;
  const ok = (rt: number) => { const f = filletGeometry(Zp, Rp, rr, Rh, rt); return f.exists && f.fits; };
  if (!ok(1e-6)) return 0;
  for (let i = 0; i < 50; i++) {
    const mid = 0.5 * (lo + hi);
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return lo;
}

// ---------------------------------------------------------------------------
// Tooth root stresses
// ---------------------------------------------------------------------------

export interface ToothRootStress {
  bending: number;
  shear: number;
  vonMises: number;
  limit: number;
}

/**
 * Tooth as a short cantilever of loaded axial length Lt (callers pass one disc thickness L: each disc loads its own
 * stretch of the tooth with the per-disc peak force): bending at the base sigma_b = 6 F h / (Lt b^2) with the tooth height h as
 * the (conservative) lever, shear tau = 1.5 F / (Lt b), combined sqrt(sigma_b^2 + 3 tau^2); limit min(0.4 Sy, sigma_f).
 */
export function toothRootStress(F: number, Lt: number, b: number, h: number, housing: MaterialProps): ToothRootStress {
  const bending = (6 * F * h) / (Lt * b * b);
  const shear = (1.5 * F) / (Lt * b);
  return {
    bending, shear, vonMises: Math.sqrt(bending * bending + 3 * shear * shear),
    limit: Math.min(0.4 * housing.Sy, housing.sigmaF),
  };
}

// ---------------------------------------------------------------------------
// Disc envelope in the ring frame and the fillet clearance
// ---------------------------------------------------------------------------

/**
 * The disc's swept envelope near the teeth, folded into the half sector of tooth 0 (polar angle 0..pi/Zp, the tooth on
 * +x): for each of `bins` angular bins, the farthest disc point reached over the sweep. Only ring-frame points at radius
 * >= Rp - rr - 1 are kept (a fillet arc never comes inside the tooth tip radius Rp - rr).
 */
export interface DiscEnvelope {
  x: Float64Array;
  y: Float64Array;
  count: number;
  /** Largest radius of the sampled actual profile in the disc frame, mm */
  profileMaxR: number;
}

export function discEnvelope(
  Zp: number, Rp: number, e: number, rr: number, nth: number, pointsPerLobe: number, bins = 2048,
): DiscEnvelope {
  // The reference sweep is theta_t = 2 pi t / nth. Two exact symmetries cut the work without changing the folded result:
  //  - the ring frame configuration at theta + 2 pi / Zp is the one at theta rotated by one tooth pitch (the disc turns by
  //    -2 pi / (Zp Zc), one lobe pitch minus a tooth pitch, and the sampled profile is lobe-periodic since n is a multiple
  //    of Zc), so only theta mod 2 pi / Zp matters: offsets m g with g = gcd(nth, Zp), theta' = 2 pi m / (nth Zp);
  //  - the configuration at -theta is the mirror image (y -> -y) of the one at theta, and the fold takes |y|, so offsets
  //    m and nth - m give the same envelope: only m <= nth / 2 is swept.
  const Zc = Zp - 1;
  const n = Math.max(60, Math.round(pointsPerLobe) * Zc);
  const prof = computeProfile(Zp, Rp, e, rr, n, true);
  const px = prof.px!, py = prof.py!;
  const ang = new Float64Array(n);
  let pm2 = 0;
  for (let k = 0; k < n; k++) {
    const q = px[k] * px[k] + py[k] * py[k];
    if (q > pm2) pm2 = q;
    ang[k] = Math.atan2(py[k], px[k]);
  }
  const sector = TWO_PI / Zp;
  const tanHalf = Math.tan(Math.PI / Zp);
  const tc = new Float64Array(Zp + 2), ts = new Float64Array(Zp + 2);
  for (let i = 0; i < Zp + 2; i++) { tc[i] = Math.cos(i * sector); ts[i] = Math.sin(i * sector); }
  const rMin = Math.max(0, Rp - rr - 1);
  const rMin2 = rMin * rMin;
  const bx = new Float64Array(bins), by = new Float64Array(bins), br = new Float64Array(bins).fill(-1);
  let g = nth, h = Zp;
  while (h) { const t = g % h; g = h; h = t; }
  for (let m = 0; 2 * m <= nth; m += g) {
    const th = (TWO_PI * m) / (nth * Zp);
    const cx = e * Math.cos(th), cy = e * Math.sin(th);
    const rot = -th / Zc;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let k = 0; k < n; k++) {
      const x = cr * px[k] - sr * py[k] + cx;
      const y = sr * px[k] + cr * py[k] + cy;
      const r2 = x * x + y * y;
      if (r2 < rMin2) continue;
      // nearest tooth from the disc-frame angle (the eccentric shift is far below half a pitch), then corrected
      let ti = Math.round((ang[k] + rot) / sector);
      ti -= Zp * Math.floor(ti / Zp);
      let xl = tc[ti] * x + ts[ti] * y, yl = -ts[ti] * x + tc[ti] * y;
      if (yl > xl * tanHalf) {
        ti = (ti + 1) % Zp;
        xl = tc[ti] * x + ts[ti] * y; yl = -ts[ti] * x + tc[ti] * y;
      } else if (-yl > xl * tanHalf) {
        ti = (ti + Zp - 1) % Zp;
        xl = tc[ti] * x + ts[ti] * y; yl = -ts[ti] * x + tc[ti] * y;
      }
      if (yl < 0) yl = -yl;
      let bi = Math.floor((yl / (xl * tanHalf)) * bins);
      if (bi >= bins) bi = bins - 1;
      if (bi < 0) bi = 0;
      if (r2 > br[bi]) { br[bi] = r2; bx[bi] = xl; by[bi] = yl; }
    }
  }
  let count = 0;
  for (let i = 0; i < bins; i++) if (br[i] >= 0) { bx[count] = bx[i]; by[count] = by[i]; count++; }
  return { x: bx, y: by, count, profileMaxR: Math.sqrt(pm2) };
}

/** Straightforward version of discEnvelope (every reference theta, atan2 folding, angle bins): for the tests. */
export function discEnvelopeReference(
  Zp: number, Rp: number, e: number, rr: number, nth: number, pointsPerLobe: number, bins = 2048,
): DiscEnvelope {
  const Zc = Zp - 1;
  const n = Math.max(60, Math.round(pointsPerLobe) * Zc);
  const prof = computeProfile(Zp, Rp, e, rr, n, true);
  const px = prof.px!, py = prof.py!;
  let pm2 = 0;
  for (let k = 0; k < n; k++) { const q = px[k] * px[k] + py[k] * py[k]; if (q > pm2) pm2 = q; }
  const half = Math.PI / Zp;
  const sector = TWO_PI / Zp;
  const rMin = Math.max(0, Rp - rr - 1);
  const rMin2 = rMin * rMin;
  const bx = new Float64Array(bins), by = new Float64Array(bins), br = new Float64Array(bins).fill(-1);
  for (let t = 0; t < nth; t++) {
    const th = (TWO_PI * t) / nth;
    const cx = e * Math.cos(th), cy = e * Math.sin(th);
    const rot = -th / Zc;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    for (let k = 0; k < n; k++) {
      const x = cr * px[k] - sr * py[k] + cx;
      const y = sr * px[k] + cr * py[k] + cy;
      const r2 = x * x + y * y;
      if (r2 < rMin2) continue;
      let phi = Math.atan2(y, x);
      phi -= sector * Math.round(phi / sector);
      if (phi < 0) phi = -phi;
      let bi = Math.floor((phi / half) * bins);
      if (bi >= bins) bi = bins - 1;
      if (r2 > br[bi]) {
        br[bi] = r2;
        const r = Math.sqrt(r2);
        bx[bi] = r * Math.cos(phi);
        by[bi] = r * Math.sin(phi);
      }
    }
  }
  let count = 0;
  for (let i = 0; i < bins; i++) if (br[i] >= 0) { bx[count] = bx[i]; by[count] = by[i]; count++; }
  return { x: bx, y: by, count, profileMaxR: Math.sqrt(pm2) };
}

/**
 * Smallest signed distance from the envelope points to the fillet arc of tooth 0 (+ side), mm. Positive = gap;
 * negative = the fillet material reaches into the disc's path. Infinity when there are no points; -Infinity when the
 * fillet does not exist or does not fit between the teeth.
 */
export function filletClearanceOf(env: DiscEnvelope, fil: FilletGeometry, rt: number): number {
  if (!fil.exists || !fil.fits) return -Infinity;
  const Fx = fil.F.x, Fy = fil.F.y;
  // arc from u_t (toward the tooth tangent point) to u_r (toward the root tangent point), the short way
  const utx = fil.Ttooth.x - Fx, uty = fil.Ttooth.y - Fy;
  const urx = fil.Troot.x - Fx, ury = fil.Troot.y - Fy;
  const s0 = utx * ury - uty * urx;
  let best = Infinity;
  for (let i = 0; i < env.count; i++) {
    const X = env.x[i], Y = env.y[i];
    const vx = X - Fx, vy = Y - Fy;
    const c1 = utx * vy - uty * vx;
    const c2 = vx * ury - vy * urx;
    let d: number;
    if ((s0 >= 0 && c1 >= 0 && c2 >= 0) || (s0 < 0 && c1 <= 0 && c2 <= 0)) {
      d = rt - Math.sqrt(vx * vx + vy * vy);
    } else {
      const d1 = Math.hypot(X - fil.Troot.x, Y - fil.Troot.y);
      const d2 = Math.hypot(X - fil.Ttooth.x, Y - fil.Ttooth.y);
      d = Math.min(d1, d2);
    }
    if (d < best) best = d;
  }
  return best;
}

/**
 * Largest tool radius whose fillet keeps at least `limit` mm from the disc (and still fits between two teeth), mm,
 * by bisection to 0.001 mm (rounded down). 0 when even a tiny tool intrudes.
 */
export function maxToolRadius(env: DiscEnvelope, Zp: number, Rp: number, rr: number, Rh: number, limit = FILLET_CLEARANCE_MIN): number {
  const ok = (rt: number) => filletClearanceOf(env, filletGeometry(Zp, Rp, rr, Rh, rt), rt) >= limit;
  const hiGeo = maxFittingToolRadius(Zp, Rp, rr, Rh);
  if (!(hiGeo > 1e-4) || !ok(1e-4)) return 0;
  if (ok(hiGeo)) return Math.floor(hiGeo * 1000) / 1000;
  let lo = 1e-4, hi = hiGeo;
  while (hi - lo > 2e-4) {
    const mid = 0.5 * (lo + hi);
    if (ok(mid)) lo = mid; else hi = mid;
  }
  return Math.floor(lo * 1000) / 1000;
}

export interface FilletResult {
  /** Clearance with the given tool radius, mm (min-type check against FILLET_CLEARANCE_MIN) */
  clearance: number;
  /** Largest tool radius that keeps the clearance limit, mm */
  maxToolRadius: number;
}

/** Full fillet analysis of one ring (sweep, clearance, largest tool). */
export function filletAnalysis(
  env: DiscEnvelope, Zp: number, Rp: number, rr: number, Rh: number, toolRadius: number,
): FilletResult {
  const fil = filletGeometry(Zp, Rp, rr, Rh, toolRadius);
  return { clearance: filletClearanceOf(env, fil, toolRadius), maxToolRadius: maxToolRadius(env, Zp, Rp, rr, Rh) };
}

const clearanceCache = new Map<string, number>();

/** Fillet clearance only (no bisection), cached per ring geometry: used by the advisor's coarse search. */
export function filletClearanceCached(
  Zp: number, Rp: number, e: number, rr: number, Rh: number, toolRadius: number, nth: number, pointsPerLobe: number,
): number {
  const key = `${Zp}|${Rp}|${e}|${rr}|${Rh}|${toolRadius}|${nth}|${pointsPerLobe}`;
  let v = clearanceCache.get(key);
  if (v === undefined) {
    const env = discEnvelope(Zp, Rp, e, rr, nth, pointsPerLobe, 1024);
    v = filletClearanceOf(env, filletGeometry(Zp, Rp, rr, Rh, toolRadius), toolRadius);
    if (clearanceCache.size > 20000) clearanceCache.clear();
    clearanceCache.set(key, v);
  }
  return v;
}

// ---------------------------------------------------------------------------
// The housing's internal profile (teeth + fillets + root arcs) as one closed polyline
// ---------------------------------------------------------------------------

/** Segments for an arc of radius r and sweep |ang| with chord error <= tol. */
function segs(r: number, ang: number, tol: number, min = 2): number {
  const step = r > tol ? 2 * Math.acos(1 - tol / r) : Math.PI / 2;
  return Math.max(min, Math.ceil(Math.abs(ang) / Math.max(step, 1e-4)));
}

/**
 * Closed polyline of the housing's internal tooth profile, counter-clockwise, not repeated at the end. Per tooth: the -
 * fillet (root to tooth), the tooth arc through its innermost point (Rp - rr, which is a vertex), the + fillet, then the
 * root arc to the next tooth. `tol` is the chord tolerance, mm. Empty when the geometry is not machinable.
 */
export function ringProfile(Zp: number, Rp: number, rr: number, Rh: number, toolRadius: number, tol = 0.005): { x: number; y: number }[] {
  const fil = filletGeometry(Zp, Rp, rr, Rh, toolRadius);
  if (!fil.exists || !fil.fits) return [];
  const rt = toolRadius;
  const t = Math.max(1e-4, tol);
  const sector = TWO_PI / Zp;
  // + fillet: from the tooth tangent point to the root tangent point, around F, the short way
  const aT = Math.atan2(fil.Ttooth.y - fil.F.y, fil.Ttooth.x - fil.F.x);
  const aR = Math.atan2(fil.Troot.y - fil.F.y, fil.Troot.x - fil.F.x);
  let dF = aR - aT;
  while (dF > Math.PI) dF -= TWO_PI;
  while (dF <= -Math.PI) dF += TWO_PI;
  const nF = segs(rt, dF, t);
  const filPlus: { x: number; y: number }[] = [];
  for (let i = 0; i <= nF; i++) {
    const a = aT + (dF * i) / nF;
    filPlus.push({ x: fil.F.x + rt * Math.cos(a), y: fil.F.y + rt * Math.sin(a) });
  }
  // tooth arc from the - tangent point to the + one, through angle pi about the tooth centre (interior points only)
  const gam = Math.atan2(fil.Ttooth.y, fil.Ttooth.x - Rp); // in (0, pi)
  const sweep = TWO_PI - 2 * gam;
  let nT = segs(rr, sweep, t, 4);
  if (nT % 2) nT++;
  const tooth: { x: number; y: number }[] = [];
  for (let i = 1; i < nT; i++) {
    const a = TWO_PI - gam - (sweep * i) / nT;
    tooth.push({ x: Rp + rr * Math.cos(a), y: rr * Math.sin(a) });
  }
  // root arc from alpha to sector - alpha (interior points only)
  const rootAng = sector - 2 * fil.alpha;
  const nR = segs(Rh, rootAng, t);
  const root: { x: number; y: number }[] = [];
  for (let i = 1; i < nR; i++) {
    const a = fil.alpha + (rootAng * i) / nR;
    root.push({ x: Rh * Math.cos(a), y: Rh * Math.sin(a) });
  }
  const filMinus = filPlus.map((p) => ({ x: p.x, y: -p.y })).reverse();
  const one = [...filMinus, ...tooth, ...filPlus, ...root];
  const out: { x: number; y: number }[] = [];
  for (let k = 0; k < Zp; k++) {
    const c = Math.cos(k * sector), s = Math.sin(k * sector);
    for (const p of one) out.push({ x: c * p.x - s * p.y, y: s * p.x + c * p.y });
  }
  return out;
}
