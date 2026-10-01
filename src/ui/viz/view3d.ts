// Small orthographic 3D helper for the pose explorer (pure, no React). World: mm, z up.
// Camera: azimuth az and elevation el in degrees. az = 0, el = 0 is the side view: the viewer stands at -y looking
// toward +y, so +x is screen right and +z is screen up (the same picture as the 2D arm drawing). az = 90 looks from +x
// (front), el = 90 looks straight down (top).

export type V3 = [number, number, number];
export interface Camera { az: number; el: number }
export interface Basis { right: V3; up: V3; toward: V3 }
export interface Frame { b: Basis; scale: number; ox: number; oy: number }
export interface P2 { x: number; y: number; depth: number }

export const VIEW_PRESETS = {
  side: { az: 0, el: 0 },
  front: { az: 90, el: 0 },
  top: { az: 0, el: 90 },
  iso: { az: -38, el: 26 },
} as const satisfies Record<string, Camera>;
export type ViewName = keyof typeof VIEW_PRESETS;

const RAD = Math.PI / 180;
export const dot = (a: V3, b: V3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
export const add = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const scl = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const len = (a: V3) => Math.hypot(a[0], a[1], a[2]);
export const unit = (a: V3): V3 => {
  const l = len(a);
  return l > 1e-12 ? scl(a, 1 / l) : [1, 0, 0];
};

/** Clamp a camera: elevation 0..90 (never from below the ground), azimuth wrapped to (-180, 180]. */
export function clampCamera(c: Camera): Camera {
  const el = Number.isFinite(c.el) ? Math.max(0, Math.min(90, c.el)) : 0;
  let az = Number.isFinite(c.az) ? ((c.az + 180) % 360 + 360) % 360 - 180 : 0;
  if (az === -180) az = 180;
  return { az, el };
}

export function basis(c: Camera): Basis {
  const az = c.az * RAD;
  const el = c.el * RAD;
  const toward: V3 = [Math.cos(el) * Math.sin(az), -Math.cos(el) * Math.cos(az), Math.sin(el)];
  const right: V3 = [Math.cos(az), Math.sin(az), 0];
  const up = cross(toward, right);
  return { right, up, toward };
}

export function viewNameOf(c: Camera): ViewName | null {
  const dAz = (x: number, y: number) => Math.abs((((x - y) % 360) + 540) % 360 - 180);
  for (const [k, v] of Object.entries(VIEW_PRESETS)) if (Math.abs(v.el - c.el) < 0.5 && dAz(v.az, c.az) < 0.5) return k as ViewName;
  return null;
}

export function project(f: Frame, p: V3): P2 {
  return { x: f.ox + f.scale * dot(p, f.b.right), y: f.oy - f.scale * dot(p, f.b.up), depth: dot(p, f.b.toward) };
}
/** Screen direction (px per mm, y down) of a world vector. */
export function projectDir(f: Frame, v: V3): { x: number; y: number } {
  return { x: f.scale * dot(v, f.b.right), y: -f.scale * dot(v, f.b.up) };
}
/** World point on the view plane (depth 0) under a screen point. */
export function unproject(f: Frame, x: number, y: number): V3 {
  const X = (x - f.ox) / f.scale;
  const Y = (f.oy - y) / f.scale;
  return add(scl(f.b.right, X), scl(f.b.up, Y));
}

export interface Box2 { x1: number; x2: number; y1: number; y2: number }
/** Bounding box of points in camera coordinates (mm along right / up). */
export function boxOf(b: Basis, pts: V3[]): Box2 {
  let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
  for (const p of pts) {
    const X = dot(p, b.right);
    const Y = dot(p, b.up);
    if (!Number.isFinite(X) || !Number.isFinite(Y)) continue;
    x1 = Math.min(x1, X); x2 = Math.max(x2, X); y1 = Math.min(y1, Y); y2 = Math.max(y2, Y);
  }
  if (!Number.isFinite(x1)) return { x1: -1, x2: 1, y1: -1, y2: 1 };
  return { x1, x2, y1, y2 };
}
export const unionBox = (a: Box2, c: Box2): Box2 => ({ x1: Math.min(a.x1, c.x1), x2: Math.max(a.x2, c.x2), y1: Math.min(a.y1, c.y1), y2: Math.max(a.y2, c.y2) });

/** Frame that fits a camera-space box into a W x H canvas with padding. */
export function frameFromBox(b: Basis, bx: Box2, W: number, H: number, pad: number): Frame {
  const w = Math.max(bx.x2 - bx.x1, 1e-6);
  const h = Math.max(bx.y2 - bx.y1, 1e-6);
  const scale = Math.max(1e-9, Math.min((W - 2 * pad) / w, (H - 2 * pad) / h));
  const cx = (bx.x1 + bx.x2) / 2;
  const cy = (bx.y1 + bx.y2) / 2;
  return { b, scale, ox: W / 2 - cx * scale, oy: H / 2 + cy * scale };
}
/** Fit points into a W x H box with padding. */
export function fitFrame(b: Basis, pts: V3[], W: number, H: number, pad: number): Frame {
  return frameFromBox(b, boxOf(b, pts), W, H, pad);
}

/** A stable unit vector perpendicular to a unit axis. */
export function perpRef(a: V3): V3 {
  const t: V3 = Math.abs(a[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  return unit(cross(cross(a, t), a));
}

/** Points of a circle (or an arc from a0 to a1, radians) of radius r about axis a through c, starting from e1. */
export function ringPoints(c: V3, a: V3, r: number, e1: V3, a0 = 0, a1 = 2 * Math.PI, n = 32): V3[] {
  const e2 = cross(a, e1);
  const out: V3[] = [];
  for (let k = 0; k <= n; k++) {
    const t = a0 + ((a1 - a0) * k) / n;
    out.push(add(c, add(scl(e1, r * Math.cos(t)), scl(e2, r * Math.sin(t)))));
  }
  return out;
}

export interface Ellipse { cx: number; cy: number; rx: number; ry: number; rot: number }
/** Projection of a disc of radius r (px) centred at c, perpendicular to the unit axis a. */
export function discEllipse(f: Frame, c: V3, a: V3, rPx: number): Ellipse {
  const p = project(f, c);
  const ad = projectDir(f, a); // in px per mm; its length / scale = how much the axis lies in the screen plane
  const inPlane = Math.hypot(ad.x, ad.y) / f.scale;
  const minor = rPx * Math.min(1, Math.abs(dot(a, f.b.toward)));
  // major axis is perpendicular to the projected axis
  const rot = inPlane > 1e-6 ? (Math.atan2(ad.y, ad.x) * 180) / Math.PI + 90 : 0;
  return { cx: p.x, cy: p.y, rx: rPx, ry: Math.max(minor, 0.0001), rot };
}

export interface Cyl { back: Ellipse; front: Ellipse; side: [number, number][]; frontSign: number }
/** A cylinder (radius rPx, half length hPx along a), projected: back cap, side silhouette, front cap. */
export function cylinder(f: Frame, c: V3, a: V3, rPx: number, hPx: number): Cyl {
  const s = dot(a, f.b.toward) >= 0 ? 1 : -1;
  const h = hPx / f.scale;
  const front = discEllipse(f, add(c, scl(a, s * h)), a, rPx);
  const back = discEllipse(f, add(c, scl(a, -s * h)), a, rPx);
  const rr = (front.rot * Math.PI) / 180;
  const nx = Math.cos(rr) * rPx;
  const ny = Math.sin(rr) * rPx;
  return {
    front, back, frontSign: s,
    side: [[front.cx + nx, front.cy + ny], [back.cx + nx, back.cy + ny], [back.cx - nx, back.cy - ny], [front.cx - nx, front.cy - ny]],
  };
}

/** Change of the rotation angle (rad) about axis a through c when the pointer moves, plane method. Null if degenerate. */
export function planeAngle(f: Frame, c: V3, a: V3, x: number, y: number): { phi: number; radiusPx: number } | null {
  const ta = dot(f.b.toward, a);
  if (Math.abs(ta) < 1e-6) return null;
  const P0 = unproject(f, x, y);
  const t = dot(sub(c, P0), a) / ta;
  const X = add(P0, scl(f.b.toward, t));
  const w = sub(X, c);
  const e1 = perpRef(a);
  const e2 = cross(a, e1);
  return { phi: Math.atan2(dot(w, e2), dot(w, e1)), radiusPx: len(w) * f.scale };
}

/** Screen direction in which "grabbing the front" of a rotation about a moves for +q (knob method), unit px vector. */
export function knobDir(f: Frame, a: V3): { x: number; y: number } {
  const v = f.b.toward;
  const vp = sub(v, scl(a, dot(v, a)));
  const d = projectDir(f, cross(a, unit(vp)));
  const l = Math.hypot(d.x, d.y) || 1;
  return { x: d.x / l, y: d.y / l };
}

// ---------------------------------------------------------------------------
// Zoom and pan (screen space, on top of the fitted frame)
// ---------------------------------------------------------------------------

export const ZOOM_MIN = 0.25;
export const ZOOM_MAX = 8;
export interface ZoomPan { zoom: number; px: number; py: number }
export const NO_ZOOM: ZoomPan = { zoom: 1, px: 0, py: 0 };

/** Apply zoom and pan to a fitted frame: screen' = C + zoom (screen - C) + pan, C = the canvas centre. */
export function applyZoomPan(f: Frame, z: ZoomPan, W: number, H: number): Frame {
  const cx = W / 2;
  const cy = H / 2;
  return { b: f.b, scale: f.scale * z.zoom, ox: cx + z.zoom * (f.ox - cx) + z.px, oy: cy + z.zoom * (f.oy - cy) + z.py };
}

/** Zoom by factor k about the screen point (x, y), keeping that point fixed. The zoom is clamped to ZOOM_MIN..ZOOM_MAX. */
export function zoomAbout(z: ZoomPan, k: number, x: number, y: number, W: number, H: number): ZoomPan {
  const zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, z.zoom * (Number.isFinite(k) && k > 0 ? k : 1)));
  const kk = zoom / z.zoom;
  const cx = W / 2;
  const cy = H / 2;
  // a screen point s maps to x + kk (s - x): pan' = (1 - kk)(P - C) + kk pan
  return { zoom, px: (1 - kk) * (x - cx) + kk * z.px, py: (1 - kk) * (y - cy) + kk * z.py };
}
