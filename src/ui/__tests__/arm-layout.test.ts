// Geometry of the arm drawing: the ready pose (shoulder on the base, elbow above it, later links out) and the
// worst-case pose (column up, then everything straight out), for chains of 1 to 8 joints.
import { describe, expect, it } from 'vitest';
import { defaultArmInputs, makeJoint, type ArmJoint, type MotionType } from '../../calc';
import { hit, layoutArm, linkDirections, placeLabels, type Box } from '../viz/armLayout';

const J = (motions: MotionType[], len = 100) => motions.map((motion) => ({ motion, length_mm: len }));
const pts = (g: ReturnType<typeof layoutArm>) => g.points.map((p) => [p.x, p.y]);

describe('arm drawing geometry', () => {
  const d = defaultArmInputs().joints;

  it('ready pose of the default arm: shoulder over the base, elbow above the shoulder, forearm and tool out', () => {
    const g = layoutArm(d, 'ready');
    // J1 yaw at the origin, the shoulder right on the turntable (0 mm column), upper arm 230 up to the elbow, then 200, 80, 110 out
    expect(pts(g)).toEqual([[0, 0], [0, 0], [0, 230], [200, 230], [280, 230], [390, 230]]);
    expect(g.vertical).toEqual([true, true, false, false, false]);
    // the elbow is directly above the shoulder
    expect(g.points[2].x).toBe(g.points[1].x);
    expect(g.points[2].y).toBeGreaterThan(g.points[1].y);
  });

  it('worst-case pose of the default arm: column up, every link from the shoulder on straight out', () => {
    const g = layoutArm(d, 'worst');
    expect(pts(g)).toEqual([[0, 0], [0, 0], [230, 0], [430, 0], [510, 0], [620, 0]]);
    expect(g.vertical).toEqual([true, false, false, false, false]);
    expect(g.bbox.maxX - g.bbox.minX).toBe(620); // the reach the torques use (J2 to the tip is 620 - 0)
  });

  it('a 3-DOF yaw, pitch, pitch arm in the ready pose', () => {
    const g = layoutArm(J(['yaw', 'pitch', 'pitch']), 'ready');
    expect(pts(g)).toEqual([[0, 0], [0, 100], [0, 200], [100, 200]]);
  });

  it('rolls and yaws continue along the current link direction', () => {
    const g = layoutArm(J(['yaw', 'pitch', 'roll', 'pitch', 'yaw', 'roll', 'pitch']), 'ready');
    // pitch count: 0,1,1,2,2,2,3 -> directions up, up, up, right, right, right, right
    expect(g.dirs.map((x) => (x.x === 1 ? 'R' : 'U'))).toEqual(['U', 'U', 'U', 'R', 'R', 'R', 'R']);
    expect(g.points[3]).toEqual({ x: 0, y: 300 });
    expect(g.points[7]).toEqual({ x: 400, y: 300 });
  });

  it('a pitch-first arm: the first link is already the upper arm and points up', () => {
    const g = layoutArm(J(['pitch', 'pitch']), 'ready');
    expect(pts(g)).toEqual([[0, 0], [0, 100], [100, 100]]);
    expect(pts(layoutArm(J(['pitch', 'pitch']), 'worst'))).toEqual([[0, 0], [100, 0], [200, 0]]);
  });

  it('chains with no pitch joint stay vertical in both poses; 1 joint works', () => {
    for (const mode of ['ready', 'worst'] as const) {
      expect(pts(layoutArm(J(['yaw', 'roll', 'yaw']), mode))).toEqual([[0, 0], [0, 100], [0, 200], [0, 300]]);
      expect(pts(layoutArm(J(['yaw']), mode))).toEqual([[0, 0], [0, 100]]);
    }
  });

  it('8 joints, and zero or garbage lengths, give finite points', () => {
    const joints = J(['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll', 'pitch', 'roll'], 50);
    for (const mode of ['ready', 'worst'] as const) {
      const g = layoutArm(joints, mode);
      expect(g.points).toHaveLength(9);
      for (const p of g.points) expect(Number.isFinite(p.x + p.y)).toBe(true);
    }
    const g = layoutArm([{ motion: 'pitch', length_mm: NaN }, { motion: 'pitch', length_mm: -4 }, { motion: 'roll', length_mm: 0 }], 'ready');
    for (const p of g.points) expect(p).toEqual({ x: 0, y: 0 });
  });

  it('linkDirections matches the engine rule: worst-case links before the first pitch are vertical, the rest horizontal', () => {
    const arm = defaultArmInputs();
    const made: ArmJoint[] = [...arm.joints, makeJoint(arm.joints, 'yaw')];
    const dirs = linkDirections(made, 'worst');
    expect(dirs.map((x) => (x.x === 1 ? 'R' : 'U'))).toEqual(['U', 'R', 'R', 'R', 'R', 'R']);
  });
});

describe('label placement', () => {
  const bounds = { W: 400, H: 300 };
  it('puts labels clear of obstacles and of each other, inside the canvas', () => {
    const obstacles: Box[] = [{ x1: 150, x2: 250, y1: 140, y2: 160 }];
    const reqs = [0, 1, 2, 3].map((k) => ({ key: k, ax: 160 + k * 25, ay: 150, r: 8, w: 70, h: 24 }));
    const out = placeLabels(reqs, obstacles, bounds);
    expect(out).toHaveLength(4);
    out.forEach((p, i) => {
      expect(p.clear).toBe(true);
      expect(p.box.x1).toBeGreaterThanOrEqual(2);
      expect(p.box.x2).toBeLessThanOrEqual(bounds.W - 2);
      expect(p.box.y1).toBeGreaterThanOrEqual(2);
      expect(p.box.y2).toBeLessThanOrEqual(bounds.H - 2);
      expect(hit(p.box, obstacles[0], 0)).toBe(false);
      out.slice(i + 1).forEach((q) => expect(hit(p.box, q.box, 0)).toBe(false));
    });
  });
  it('still returns a box (flagged not clear) when there is no room', () => {
    const wall: Box[] = [{ x1: 0, x2: 400, y1: 0, y2: 300 }];
    const out = placeLabels([{ key: 'a', ax: 200, ay: 150, r: 5, w: 80, h: 24 }], wall, bounds);
    expect(out[0].clear).toBe(false);
    expect(Number.isFinite(out[0].box.x1)).toBe(true);
  });
});
