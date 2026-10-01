// Geometry of the arm drawing (pure, no React): where every joint sits in the side view for the two poses, and a small
// label placer. Model coordinates are mm with x to the right and y UP; the SVG flips y.
//
//  ready pose : links point UP until the second pitch joint, then out horizontally to the right. So the shoulder
//               (first pitch) sits on the base column over the yaw turntable and the elbow (second pitch) is above it.
//  worst case : links before the first pitch joint are a vertical column; from the first pitch joint on every link is
//               horizontal (arm straight out). This is the pose all torques are computed for.
import type { MotionType } from '../../calc';

export type PoseMode = 'ready' | 'worst';
export interface Pt { x: number; y: number }
export const UP: Pt = { x: 0, y: 1 };
export const RIGHT: Pt = { x: 1, y: 0 };

export interface ArmGeometry {
  /** n + 1 points: joint 0 at the origin ... joint n-1, then the tool tip */
  points: Pt[];
  /** n unit vectors: direction of the link that leaves joint i */
  dirs: Pt[];
  /** true when link i is vertical */
  vertical: boolean[];
  /** bounding box of the points, mm */
  bbox: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Direction of every link for a pose. Rolls and yaws continue along the current link direction. */
export function linkDirections(joints: readonly { motion: MotionType }[], mode: PoseMode): Pt[] {
  const first = joints.findIndex((j) => j.motion === 'pitch');
  let pitches = 0;
  return joints.map((j, i) => {
    if (j.motion === 'pitch') pitches++;
    if (mode === 'worst') return first < 0 || i < first ? UP : RIGHT;
    return pitches < 2 ? UP : RIGHT;
  });
}

export function layoutArm(joints: readonly { motion: MotionType; length_mm: number }[], mode: PoseMode): ArmGeometry {
  const dirs = linkDirections(joints, mode);
  const points: Pt[] = [{ x: 0, y: 0 }];
  joints.forEach((j, i) => {
    const L = Number.isFinite(j.length_mm) && j.length_mm > 0 ? j.length_mm : 0;
    const p = points[i];
    points.push({ x: p.x + dirs[i].x * L, y: p.y + dirs[i].y * L });
  });
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  return {
    points, dirs, vertical: dirs.map((d) => d === UP),
    bbox: { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) },
  };
}

// ---------------------------------------------------------------------------
// Label placement
// ---------------------------------------------------------------------------

export interface Box { x1: number; x2: number; y1: number; y2: number; /** true for text, which a leader line should not cross */ text?: boolean }

/** True if the segment (x1, y1)-(x2, y2) passes through the box. */
export function segmentHits(l: [number, number, number, number], b: Box): boolean {
  for (let k = 1; k < 12; k++) {
    const t = k / 12;
    const x = l[0] + (l[2] - l[0]) * t;
    const y = l[1] + (l[3] - l[1]) * t;
    if (x > b.x1 && x < b.x2 && y > b.y1 && y < b.y2) return true;
  }
  return false;
}
export const hit = (a: Box, b: Box, pad = 3) => a.x1 < b.x2 + pad && a.x2 > b.x1 - pad && a.y1 < b.y2 + pad && a.y2 > b.y1 - pad;
const overlapArea = (a: Box, b: Box) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));

export interface LabelRequest {
  key: string | number;
  /** where the thing being labelled is */
  ax: number;
  ay: number;
  /** radius of the thing at the anchor: the label starts outside it */
  r: number;
  /** text block size */
  w: number;
  h: number;
  /** preferred directions, best first (default: E, W, S, N, SE, SW, NE, NW) */
  prefer?: Dir[];
}
export type Dir = 'E' | 'W' | 'S' | 'N' | 'SE' | 'SW' | 'NE' | 'NW';
export interface LabelPlacement {
  key: string | number;
  box: Box;
  /** leader line from the anchor edge to the box when the label is not touching its joint */
  lead: [number, number, number, number] | null;
  clear: boolean;
}

const DEFAULT_ORDER: Dir[] = ['E', 'W', 'S', 'N', 'SE', 'SW', 'NE', 'NW'];

function boxFor(req: LabelRequest, dir: Dir, d: number): Box {
  const { ax, ay, w, h } = req;
  const k = d * 0.72;
  switch (dir) {
    case 'E': return { x1: ax + d, x2: ax + d + w, y1: ay - h / 2, y2: ay + h / 2 };
    case 'W': return { x1: ax - d - w, x2: ax - d, y1: ay - h / 2, y2: ay + h / 2 };
    case 'S': return { x1: ax - w / 2, x2: ax + w / 2, y1: ay + d, y2: ay + d + h };
    case 'N': return { x1: ax - w / 2, x2: ax + w / 2, y1: ay - d - h, y2: ay - d };
    case 'SE': return { x1: ax + k, x2: ax + k + w, y1: ay + k, y2: ay + k + h };
    case 'SW': return { x1: ax - k - w, x2: ax - k, y1: ay + k, y2: ay + k + h };
    case 'NE': return { x1: ax + k, x2: ax + k + w, y1: ay - k - h, y2: ay - k };
    default: return { x1: ax - k - w, x2: ax - k, y1: ay - k - h, y2: ay - k };
  }
}

/**
 * Place label boxes one after another: for each request try rings of increasing distance around its anchor in the
 * preferred directions and take the cheapest box that stays inside `bounds` and clears every obstacle and every label
 * placed so far (and its leader line). If nothing is free, the box with the least overlap is used (clear = false).
 */
export function placeLabels(reqs: LabelRequest[], obstacles: Box[], bounds: { W: number; H: number }): LabelPlacement[] {
  const taken: Box[] = [...obstacles];
  const out: LabelPlacement[] = [];
  for (const req of reqs) {
    const order = [...(req.prefer ?? []), ...DEFAULT_ORDER.filter((d) => !(req.prefer ?? []).includes(d))];
    const rings = [req.r + 5, req.r + 20, req.r + 38, req.r + 58, req.r + 80];
    let best: { box: Box; lead: LabelPlacement['lead']; cost: number; clear: boolean } | null = null;
    rings.forEach((d, ri) => {
      order.forEach((dir, di) => {
        const box = boxFor(req, dir, d);
        const inside = box.x1 >= 2 && box.x2 <= bounds.W - 2 && box.y1 >= 2 && box.y2 <= bounds.H - 2;
        if (!inside) return;
        let lead: LabelPlacement['lead'] = null;
        if (ri > 0) {
          const cx = Math.min(Math.max(req.ax, box.x1), box.x2);
          const cy = Math.min(Math.max(req.ay, box.y1), box.y2);
          const dx = cx - req.ax;
          const dy = cy - req.ay;
          const len = Math.hypot(dx, dy) || 1;
          lead = [req.ax + (dx / len) * req.r, req.ay + (dy / len) * req.r, cx, cy];
        }
        const blocked = taken.some((t) => hit(box, t));
        const overlap = taken.reduce((s, t) => s + overlapArea(box, t), 0);
        // a leader line that runs through text is worse than a longer one
        const crossings = lead ? taken.filter((t) => t.text && segmentHits(lead!, t)).length : 0;
        const cost = ri * 14 + di * 2 + crossings * 40 + (blocked ? 1000 + overlap : 0);
        if (!best || cost < best.cost) best = { box, lead, cost, clear: !blocked };
      });
    });
    if (!best) {
      // nothing fits inside the canvas: put it just right of the anchor, clamped
      const b = boxFor(req, 'E', req.r + 5);
      const dx = Math.max(0, 2 - b.x1) + Math.min(0, bounds.W - 2 - b.x2);
      best = { box: { x1: b.x1 + dx, x2: b.x2 + dx, y1: b.y1, y2: b.y2 }, lead: null, cost: 9999, clear: false };
    }
    const chosen = best as { box: Box; lead: LabelPlacement['lead']; cost: number; clear: boolean };
    taken.push({ ...chosen.box, text: true });
    out.push({ key: req.key, box: chosen.box, lead: chosen.lead, clear: chosen.clear });
  }
  return out;
}
