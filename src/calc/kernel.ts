// Numeric kernel: disc profile, curvature, ring-pin force sweep and eccentric bearing load.
// A faithful port of unit_case() in reference/cycloidal_disc_check.py.
// Pure functions, no allocation-heavy objects in the hot loops. Units: mm, N (unit case: 1 N*m on one disc, Kc = 1).

const TWO_PI = 2 * Math.PI;

// ---------------------------------------------------------------------------
// Trig table caches (keyed by sizes, reused by the advisor across thousands of candidates)
// ---------------------------------------------------------------------------

interface ProfileTrig { cp: Float64Array; sp: Float64Array; cz: Float64Array; sz: Float64Array }
interface SweepTrig { ct: Float64Array; st: Float64Array }
interface PinTrig { ca: Float64Array; sa: Float64Array; a: Float64Array }

const profileTrigCache = new Map<string, ProfileTrig>();
const sweepTrigCache = new Map<number, SweepTrig>();
const pinTrigCache = new Map<number, PinTrig>();
const gTableCache = new Map<string, Float64Array>();

function profileTrig(Zp: number, npf: number): ProfileTrig {
  const key = `${Zp}:${npf}`;
  let t = profileTrigCache.get(key);
  if (!t) {
    const cp = new Float64Array(npf), sp = new Float64Array(npf);
    const cz = new Float64Array(npf), sz = new Float64Array(npf);
    for (let k = 0; k < npf; k++) {
      const p = (TWO_PI * k) / npf;
      cp[k] = Math.cos(p); sp[k] = Math.sin(p);
      cz[k] = Math.cos(Zp * p); sz[k] = Math.sin(Zp * p);
    }
    t = { cp, sp, cz, sz };
    if (profileTrigCache.size > 64) profileTrigCache.clear();
    profileTrigCache.set(key, t);
  }
  return t;
}

function sweepTrig(nth: number): SweepTrig {
  let t = sweepTrigCache.get(nth);
  if (!t) {
    const ct = new Float64Array(nth), st = new Float64Array(nth);
    for (let k = 0; k < nth; k++) {
      const th = (TWO_PI * k) / nth;
      ct[k] = Math.cos(th); st[k] = Math.sin(th);
    }
    t = { ct, st };
    sweepTrigCache.set(nth, t);
  }
  return t;
}

function pinTrig(Zp: number): PinTrig {
  let t = pinTrigCache.get(Zp);
  if (!t) {
    const ca = new Float64Array(Zp), sa = new Float64Array(Zp), a = new Float64Array(Zp);
    for (let i = 0; i < Zp; i++) {
      a[i] = (TWO_PI * i) / Zp;
      ca[i] = Math.cos(a[i]); sa[i] = Math.sin(a[i]);
    }
    t = { ca, sa, a };
    pinTrigCache.set(Zp, t);
  }
  return t;
}

// ---------------------------------------------------------------------------
// Profile and curvature
// ---------------------------------------------------------------------------

/** rho_a below this (mm) and above 0 is flagged as a cusp (SPEC.md). */
export const CUSP_RHO = 0.3;

export interface ProfileData {
  npf: number;
  /** Actual-profile curvature kappa_a = 1/rho_a at each parameter sample (positive = convex) */
  kappaA: Float64Array;
  /** min over convex samples of rho_a, mm (Infinity if none) */
  rhoMinConvex: number;
  /** SPEC cusp flag: any 0 < rho_a < 0.3 mm. Also set for an undercut (path curvature above 1/rr). */
  cusp: boolean;
  /** True if the pin-centre path curvature exceeds 1/rr somewhere (rho_a <= 0: profile loops over itself) */
  undercut: boolean;
  /** Polygon area of the actual profile, mm^2 */
  area: number;
  /** Profile points (disc frame), only when requested */
  px?: Float64Array;
  py?: Float64Array;
}

/**
 * Pin-centre epitrochoid offset inward by rr. Parameter p in [0, 2pi) sampled at npf points,
 * endpoint excluded (as np.linspace(..., endpoint=False)).
 */
export function computeProfile(
  Zp: number, Rp: number, e: number, rr: number, npf: number, wantPoints = false,
): ProfileData {
  const { cp, sp, cz, sz } = profileTrig(Zp, npf);
  const kappaA = new Float64Array(npf);
  const px = wantPoints ? new Float64Array(npf) : undefined;
  const py = wantPoints ? new Float64Array(npf) : undefined;
  const eZ = e * Zp, eZ2 = e * Zp * Zp;
  let rhoMin = Infinity;
  let cusp = false, undercut = false;
  let area2 = 0;
  let firstX = 0, firstY = 0, prevX = 0, prevY = 0;
  for (let k = 0; k < npf; k++) {
    const c = cp[k], s = sp[k], czk = cz[k], szk = sz[k];
    const X = Rp * c - e * czk, Y = Rp * s - e * szk;
    const dX = -Rp * s + eZ * szk, dY = Rp * c - eZ * czk;
    const ddX = -Rp * c + eZ2 * czk, ddY = -Rp * s + eZ2 * szk;
    const sq = dX * dX + dY * dY;
    const len = Math.sqrt(sq);
    const kt = (dX * ddY - dY * ddX) / (sq * len);
    // rho_a = 1/kt - rr  ->  kappa_a = 1/rho_a = kt / (1 - rr*kt)
    const d = 1 - rr * kt;
    const rho = kt !== 0 ? d / kt : Infinity; // = 1/kt - rr
    kappaA[k] = d !== 0 ? kt / d : (kt > 0 ? 1e12 : -1e12);
    if (rho > 0) {
      if (rho < rhoMin) rhoMin = rho;
      if (rho < CUSP_RHO) cusp = true;
    } else if (kt > 0 && d <= 0) {
      undercut = true;
      cusp = true;
    }
    // area (shoelace) of the actual profile: (X - rr*nx, Y - rr*ny), n = (dY, -dX)/|d|
    const qx = X - (rr * dY) / len, qy = Y + (rr * dX) / len;
    if (px && py) { px[k] = qx; py[k] = qy; }
    if (k === 0) { firstX = qx; firstY = qy; } else { area2 += prevX * qy - qx * prevY; }
    prevX = qx; prevY = qy;
  }
  area2 += prevX * firstY - firstX * prevY;
  return {
    npf, kappaA, rhoMinConvex: rhoMin, cusp, undercut,
    area: Math.abs(area2) / 2, px, py,
  };
}

// ---------------------------------------------------------------------------
// Ring-pin sweep
// ---------------------------------------------------------------------------

export interface RingSweep {
  nth: number;
  /** Per theta: max over pins of sqrt(F*invR/pi), i.e. p0 at E* = 1 MPa and L = 1 mm, unit torque */
  maxP1: Float64Array;
  /** Per theta: max pin force, N per N*m */
  maxF: Float64Array;
  /** Per theta: vector sum of (F_i * n_i) over the ring pins, N per N*m */
  Rx: Float64Array;
  Ry: Float64Array;
  /** max over theta of maxP1 (p0 at E* = 1, L = 1, unit torque) */
  P1: number;
  /** max over theta of maxF, N per N*m */
  F: number;
}

/** Scratch buffers reused between calls (single-threaded). */
let scratchN = 0;
let nxA = new Float64Array(0), nyA = new Float64Array(0), armA = new Float64Array(0);
function ensureScratch(n: number) {
  if (n > scratchN) {
    scratchN = n;
    nxA = new Float64Array(n); nyA = new Float64Array(n); armA = new Float64Array(n);
  }
}

/**
 * Sweep the input angle over [0, 2pi) with nth steps (endpoint excluded) and compute the ring
 * pin force distribution and the Hertz pressure at each loaded pin, at unit torque.
 */
export function ringSweep(
  Zp: number, Rp: number, e: number, rr: number,
  kappaA: Float64Array, npf: number, nth: number,
): RingSweep {
  const Zc = Zp - 1;
  const { ct, st } = sweepTrig(nth);
  const { ca, sa, a } = pinTrig(Zp);
  ensureScratch(Zp);
  const maxP1 = new Float64Array(nth), maxF = new Float64Array(nth);
  const Rx = new Float64Array(nth), Ry = new Float64Array(nth);
  const invRr = 1 / rr;
  const eZ = e * Zp;
  const thStep = TWO_PI / nth;
  let P1 = 0, F = 0;
  for (let t = 0; t < nth; t++) {
    const ux = ct[t], uy = st[t];
    const Cx = e * ux, Cy = e * uy, Px = eZ * ux, Py = eZ * uy;
    let sumA2 = 0;
    for (let i = 0; i < Zp; i++) {
      const Qx = Rp * ca[i], Qy = Rp * sa[i];
      const dx = Px - Qx, dy = Py - Qy;
      const len = Math.sqrt(dx * dx + dy * dy);
      const nx = dx / len, ny = dy / len;
      const rx = Qx + rr * nx - Cx, ry = Qy + rr * ny - Cy;
      const arm = rx * ny - ry * nx;
      nxA[i] = nx; nyA[i] = ny; armA[i] = arm;
      if (arm > 0) sumA2 += arm * arm;
    }
    if (!(sumA2 > 0)) continue;
    const lam = 1000 / sumA2;
    // theta / Zc, evaluated exactly as the reference does it (np.linspace gives theta = t * (2pi/nth)).
    // The profile index below is a floor(), and for Zp - 1 dividing 25*t (Zp = 11, 16, 21, 26, ...) the
    // exact value lands on an integer: only the same rounding picks the same profile sample as the script.
    const thc = (t * thStep) / Zc;
    let mp = 0, mf = 0, rxs = 0, rys = 0;
    for (let i = 0; i < Zp; i++) {
      const arm = armA[i];
      if (!(arm > 0)) continue;
      const Fi = lam * arm;
      rxs += Fi * nxA[i]; rys += Fi * nyA[i];
      if (Fi > mf) mf = Fi;
      let ang = a[i] + thc;
      ang -= Math.floor(ang / TWO_PI) * TWO_PI;
      const j = Math.floor((ang / TWO_PI) * npf) % npf;
      const invR = invRr + kappaA[j];
      if (invR > 0) {
        const p1 = Math.sqrt((Fi * invR) / Math.PI);
        if (p1 > mp) mp = p1;
      }
    }
    maxP1[t] = mp; maxF[t] = mf; Rx[t] = rxs; Ry[t] = rys;
    if (mp > P1) P1 = mp;
    if (mf > F) F = mf;
  }
  return { nth, maxP1, maxF, Rx, Ry, P1, F };
}

// ---------------------------------------------------------------------------
// Inner pins and eccentric bearing load
// ---------------------------------------------------------------------------

/**
 * Sum of the inner-pin forces per unit of (1000/Rw), per theta:
 * sum_k F_k = (1000/Rw) * g(theta), g = sum|s|/sum s^2 over loaded pins (s < 0),
 * with s_k = sin(2 pi k/Zw - theta*Zp/Zc). (Closed form of the reference's tq/Fw loop.)
 */
export function innerForceTable(Zw: number, Zp: number, nth: number): Float64Array {
  const key = `${Zw}:${Zp}:${nth}`;
  let g = gTableCache.get(key);
  if (!g) {
    const Zc = Zp - 1;
    g = new Float64Array(nth);
    for (let t = 0; t < nth; t++) {
      const th = (TWO_PI * t) / nth;
      let sumAbs = 0, sumSq = 0;
      for (let k = 0; k < Zw; k++) {
        // chi_k = 2 pi k/Zw - th/Zc ; tq_k/Rw = cos(chi)*(-uy) - sin(chi)*(-ux)
        const chi = (TWO_PI * k) / Zw - th / Zc;
        const s = -Math.cos(chi) * Math.sin(th) + Math.sin(chi) * Math.cos(th);
        if (s < 0) { sumAbs += -s; sumSq += s * s; }
      }
      g[t] = sumSq > 0 ? sumAbs / sumSq : 0;
    }
    if (gTableCache.size > 256) gTableCache.clear();
    gTableCache.set(key, g);
  }
  return g;
}

/** Peak eccentric-bearing load over theta at unit torque, N per N*m, and optionally per theta. */
export function bearingUnitLoad(
  sweep: RingSweep, g: Float64Array, Rw: number, out?: Float64Array,
): number {
  const { nth, Rx, Ry } = sweep;
  const { ct, st } = sweepTrig(nth);
  const k = 1000 / Rw;
  let m = 0;
  for (let t = 0; t < nth; t++) {
    const fw = k * g[t];
    const bx = Rx[t] - fw * ct[t], by = Ry[t] - fw * st[t];
    const fb = Math.sqrt(bx * bx + by * by);
    if (out) out[t] = fb;
    if (fb > m) m = fb;
  }
  return m;
}

// ---------------------------------------------------------------------------
// Per-theta pin state (for the slider / bar chart / drawing)
// ---------------------------------------------------------------------------

export interface PinStateAtTheta {
  /** Ring pin forces, N per N*m (0 when unloaded) */
  F: Float64Array;
  loaded: Uint8Array;
  /** p0 at E* = 1, L = 1, unit torque (0 when unloaded or invR <= 0) */
  P1: Float64Array;
  Qx: Float64Array;
  Qy: Float64Array;
}

export function pinStateAtTheta(
  Zp: number, Rp: number, e: number, rr: number,
  kappaA: Float64Array, npf: number, theta: number,
): PinStateAtTheta {
  const Zc = Zp - 1;
  const F = new Float64Array(Zp), P1 = new Float64Array(Zp);
  const loaded = new Uint8Array(Zp);
  const Qxs = new Float64Array(Zp), Qys = new Float64Array(Zp);
  const ux = Math.cos(theta), uy = Math.sin(theta);
  const Cx = e * ux, Cy = e * uy, Px = e * Zp * ux, Py = e * Zp * uy;
  const arms = new Float64Array(Zp);
  let sumA2 = 0;
  for (let i = 0; i < Zp; i++) {
    const a = (TWO_PI * i) / Zp;
    const Qx = Rp * Math.cos(a), Qy = Rp * Math.sin(a);
    Qxs[i] = Qx; Qys[i] = Qy;
    const dx = Px - Qx, dy = Py - Qy;
    const len = Math.sqrt(dx * dx + dy * dy);
    const nx = dx / len, ny = dy / len;
    const rx = Qx + rr * nx - Cx, ry = Qy + rr * ny - Cy;
    arms[i] = rx * ny - ry * nx;
    if (arms[i] > 0) sumA2 += arms[i] * arms[i];
  }
  if (sumA2 > 0) {
    const lam = 1000 / sumA2;
    for (let i = 0; i < Zp; i++) {
      if (!(arms[i] > 0)) continue;
      loaded[i] = 1;
      F[i] = lam * arms[i];
      let ang = (TWO_PI * i) / Zp + theta / Zc;
      ang -= Math.floor(ang / TWO_PI) * TWO_PI;
      const j = Math.floor((ang / TWO_PI) * npf) % npf;
      const invR = 1 / rr + kappaA[j];
      if (invR > 0) P1[i] = Math.sqrt((F[i] * invR) / Math.PI);
    }
  }
  return { F, loaded, P1, Qx: Qxs, Qy: Qys };
}

// ---------------------------------------------------------------------------
// Convenience: profile + sweep in one call (used by the solver and the advisor)
// ---------------------------------------------------------------------------

export interface RingUnit {
  P1: number;
  F: number;
  rhoMinConvex: number;
  cusp: boolean;
  undercut: boolean;
  area: number;
  sweep: RingSweep;
}

/** Everything that depends only on (Zp, D, e, rr) at resolution (npf, nth), at unit torque. */
export function ringUnit(Zp: number, D: number, e: number, rr: number, npf: number, nth: number): RingUnit {
  const Rp = D / 2;
  const prof = computeProfile(Zp, Rp, e, rr, npf);
  const sweep = ringSweep(Zp, Rp, e, rr, prof.kappaA, npf, nth);
  return {
    P1: sweep.P1, F: sweep.F, rhoMinConvex: prof.rhoMinConvex, cusp: prof.cusp,
    undercut: prof.undercut, area: prof.area, sweep,
  };
}

// ---------------------------------------------------------------------------
// Inner standoffs tied by a floating ring (bending moment per unit torque)
// ---------------------------------------------------------------------------
//
// Each inner pin is an Euler-Bernoulli beam fixed (recessed and bolted) at the output face, x = 0. At x = H the tips of
// all pins are bolted to one free-floating rigid tie ring. Disc k loads every pin at a_k = gap + k(L + gap) + L/2 with
// the reference sine-law force P_j = F_j u (u = (cos th, sin th)); a second disc is 180 deg out of phase, so it loads
// the same pins with -P_j. The ring only moves as a rigid body in the plane (two translations, one rotation about the
// axis), so its tip forces carry no net force and no net moment about the axis:
//   Ft_j = -sum_k c(a_k) sign_k (P_j - Pbar - m z x r_j),  m = sum_j (r_j x P_j)_z / (Zw Rw^2)
//   clamped tip (bolted ring, tip slope 0):  c = a^2 (3H - 2a) / H^3,  C_j = -sum_k sign_k P_j a_k^2 / (2H) - Ft_j H / 2
//   pinned tip (tip slope free):             c = a^2 (3H - a) / (2 H^3), C_j = 0
//   M_j(x) = Ft_j (H - x) + C_j + sum_{a_k > x} sign_k P_j (a_k - x), piecewise linear, so max |M| is at x in {0, a_k, H}.
// Validated against an exact-constraint FEM in scripts/parity/standoff/ (see its README).

export type RingTip = 'clamped' | 'pinned';

/** One axial load station: position a (mm from the output face) and the force on every pin there (N). */
export interface RingLoad { a: number; Px: ArrayLike<number>; Py: ArrayLike<number> }

/**
 * Peak bending moment magnitude over all pins and all sections (N*mm) for pins at (rx, ry) (mm), fixed at x = 0 and
 * joined at x = H by a floating rigid ring, under the given loads. General form, used by the tests and as the
 * reference for the fast sweep below.
 */
export function ringStandoffMoment(
  rx: ArrayLike<number>, ry: ArrayLike<number>, loads: RingLoad[], H: number, tip: RingTip,
): number {
  const Zw = rx.length;
  let R2 = 0;
  for (let j = 0; j < Zw; j++) R2 += rx[j] * rx[j] + ry[j] * ry[j];
  R2 /= Zw;
  const Ftx = new Float64Array(Zw), Fty = new Float64Array(Zw);
  const Cx = new Float64Array(Zw), Cy = new Float64Array(Zw);
  for (const ld of loads) {
    const a = ld.a;
    const c = tip === 'clamped' ? (a * a * (3 * H - 2 * a)) / (H * H * H) : (a * a * (3 * H - a)) / (2 * H * H * H);
    let mx = 0, my = 0, mz = 0;
    for (let j = 0; j < Zw; j++) {
      mx += ld.Px[j]; my += ld.Py[j];
      mz += rx[j] * ld.Py[j] - ry[j] * ld.Px[j];
    }
    mx /= Zw; my /= Zw; mz /= Zw * R2;
    for (let j = 0; j < Zw; j++) {
      Ftx[j] -= c * (ld.Px[j] - mx + mz * ry[j]);
      Fty[j] -= c * (ld.Py[j] - my - mz * rx[j]);
      if (tip === 'clamped') {
        Cx[j] -= (ld.Px[j] * a * a) / (2 * H);
        Cy[j] -= (ld.Py[j] * a * a) / (2 * H);
      }
    }
  }
  if (tip === 'clamped') {
    for (let j = 0; j < Zw; j++) { Cx[j] -= (Ftx[j] * H) / 2; Cy[j] -= (Fty[j] * H) / 2; }
  }
  const xs = [0, H, ...loads.map((l) => l.a)];
  let best = 0;
  for (let j = 0; j < Zw; j++) {
    for (const x of xs) {
      let Mx = Ftx[j] * (H - x) + Cx[j], My = Fty[j] * (H - x) + Cy[j];
      for (const ld of loads) {
        if (ld.a > x) { Mx += ld.Px[j] * (ld.a - x); My += ld.Py[j] * (ld.a - x); }
      }
      const m = Math.hypot(Mx, My);
      if (m > best) best = m;
    }
  }
  return best;
}

export interface StandoffRingSweep {
  /** Peak |M| over theta, pins and sections, N*mm per N*m on one disc (Kc = 1): bolted ring (tip slope 0) */
  clamped: number;
  /** Same with the pin tips free to rotate in the ring */
  pinned: number;
  /** Per-theta peaks (only when requested) */
  clampedTheta?: Float64Array;
  pinnedTheta?: Float64Array;
}

/** Axial geometry: H (output face to ring) and the load stations a_k with their signs (+1 first disc, -1 second). */
export function standoffStations(discs: number, L: number, gap: number): { H: number; a: number[]; sign: number[] } {
  const n = discs === 2 ? 2 : 1;
  const a: number[] = [], sign: number[] = [];
  for (let k = 0; k < n; k++) { a.push(gap + k * (L + gap) + L / 2); sign.push(k === 0 ? 1 : -1); }
  return { H: n * L + (n + 1) * gap, a, sign };
}

/**
 * Sweep the reference input angles th_t = 2 pi t / nth and return the peak tied-standoff bending moment per N*m
 * (one disc share, Kc = 1) for both tip conditions. Pin forces are the reference sine law (the forces behind the
 * inner-pin / bearing sweep). At fixed (Zw, Zp, nth, discs, L, gap) the moment scales exactly as 1/Rw, which the
 * cached `standoffRingUnit` uses.
 */
export function standoffRingSweep(
  Zw: number, Zp: number, nth: number, discs: number, L: number, gap: number, Rw: number, perTheta = false,
): StandoffRingSweep {
  const Zc = Zp - 1;
  const { H, a, sign } = standoffStations(discs, L, gap);
  const nk = a.length;
  // At the sections x in {0, H, a_k}: M_j(x) = alpha(x) D_j + beta(x) P_j, with Ft_j = -S D_j and
  // D_j = P_j - Pbar - m z x r_j (the part of the load the rigid ring cannot take as a rigid-body motion).
  const xs = [0, H, ...a];
  const nx = xs.length;
  let Sc = 0, Sp = 0, A2 = 0;
  for (let k = 0; k < nk; k++) {
    const ak = a[k];
    Sc += (sign[k] * ak * ak * (3 * H - 2 * ak)) / (H * H * H);
    Sp += (sign[k] * ak * ak * (3 * H - ak)) / (2 * H * H * H);
    A2 += sign[k] * ak * ak;
  }
  const alphaC = new Float64Array(nx), alphaP = new Float64Array(nx);
  const betaC = new Float64Array(nx), betaP = new Float64Array(nx);
  for (let i = 0; i < nx; i++) {
    const x = xs[i];
    let tail = 0;
    for (let k = 0; k < nk; k++) if (a[k] > x) tail += sign[k] * (a[k] - x);
    // clamped: Ft (H - x) + C with C = -P A2 / (2H) - Ft H / 2  ->  Ft (H/2 - x) - P A2 / (2H)
    alphaC[i] = -Sc * (H / 2 - x);
    betaC[i] = tail - A2 / (2 * H);
    // pinned: Ft (H - x)
    alphaP[i] = -Sp * (H - x);
    betaP[i] = tail;
  }
  const cs = new Float64Array(Zw), sn = new Float64Array(Zw), F = new Float64Array(Zw);
  const ct = perTheta ? new Float64Array(nth) : undefined;
  const pt = perTheta ? new Float64Array(nth) : undefined;
  let bestC = 0, bestP = 0;
  for (let t = 0; t < nth; t++) {
    const th = (TWO_PI * t) / nth;
    const ux = Math.cos(th), uy = Math.sin(th);
    let sumSq = 0;
    for (let j = 0; j < Zw; j++) {
      const chi = (TWO_PI * j) / Zw - th / Zc;
      const c = Math.cos(chi), s = Math.sin(chi);
      cs[j] = c; sn[j] = s;
      const q = -c * uy + s * ux; // tq_j / Rw of the reference; loaded where q < 0
      if (q < 0) { F[j] = -q; sumSq += q * q; } else F[j] = 0;
    }
    let mC = 0, mP = 0;
    if (sumSq > 0) {
      const k = 1000 / (Rw * sumSq);
      let fs = 0, mz = 0;
      for (let j = 0; j < Zw; j++) {
        F[j] *= k;
        fs += F[j];
        mz += Rw * (cs[j] * uy - sn[j] * ux) * F[j]; // (r_j x P_j)_z
      }
      const pbx = (fs / Zw) * ux, pby = (fs / Zw) * uy;
      mz /= Zw * Rw * Rw;
      for (let j = 0; j < Zw; j++) {
        const Px = F[j] * ux, Py = F[j] * uy;
        const Dx = Px - pbx + mz * Rw * sn[j];
        const Dy = Py - pby - mz * Rw * cs[j];
        for (let i = 0; i < nx; i++) {
          const Mcx = alphaC[i] * Dx + betaC[i] * Px, Mcy = alphaC[i] * Dy + betaC[i] * Py;
          const Mpx = alphaP[i] * Dx + betaP[i] * Px, Mpy = alphaP[i] * Dy + betaP[i] * Py;
          const vc = Mcx * Mcx + Mcy * Mcy, vp = Mpx * Mpx + Mpy * Mpy;
          if (vc > mC) mC = vc;
          if (vp > mP) mP = vp;
        }
      }
      mC = Math.sqrt(mC); mP = Math.sqrt(mP);
    }
    if (ct && pt) { ct[t] = mC; pt[t] = mP; }
    if (mC > bestC) bestC = mC;
    if (mP > bestP) bestP = mP;
  }
  return { clamped: bestC, pinned: bestP, clampedTheta: ct, pinnedTheta: pt };
}

const standoffRingCache = new Map<string, { clamped: number; pinned: number }>();

/**
 * Cached peak tied-standoff moments, N*mm per N*m on one disc (Kc = 1), for both tip conditions. Swept once at
 * Rw = 1 per (Zw, Zp, nth, discs, L, gap) and scaled by 1/Rw (exact: the forces go as 1/Rw at fixed lever arms).
 */
export function standoffRingUnit(
  Zw: number, Zp: number, nth: number, discs: number, L: number, gap: number, Rw: number,
): { clamped: number; pinned: number } {
  const key = `${Zw}:${Zp}:${nth}:${discs === 2 ? 2 : 1}:${L}:${gap}`;
  let v = standoffRingCache.get(key);
  if (!v) {
    const s = standoffRingSweep(Zw, Zp, nth, discs, L, gap, 1);
    v = { clamped: s.clamped, pinned: s.pinned };
    if (standoffRingCache.size > 4096) standoffRingCache.clear();
    standoffRingCache.set(key, v);
  }
  return { clamped: v.clamped / Rw, pinned: v.pinned / Rw };
}
