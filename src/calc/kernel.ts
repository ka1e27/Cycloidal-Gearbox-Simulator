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
    const thc = (t / nth) * TWO_PI / Zc; // theta / Zc
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
