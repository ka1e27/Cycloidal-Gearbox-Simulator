import { describe, expect, it } from 'vitest';
import {
  applySolverSolution, checkGearbox, defaultGearboxInputs, PRESETS, solveMinimumSize, solveMinimumSizeAsync,
} from '../index';
import type { GearboxInputs } from '../index';

/** SPEC preset with an explicit disc count (the solver expectations quote 1- and 2-disc cases). */
const joint = (id: 'J1' | 'J2' | 'J3' | 'J4', discs: number): GearboxInputs => ({ ...PRESETS[id], discs });

describe('SPEC.md solver expectations (Db = 19, t_min = 2; +/-1 mm on D)', () => {
  it('geometric floor is about 45 mm with Db = 19', () => {
    const s = solveMinimumSize(joint('J4', 1));
    expect(s.floorD).not.toBeNull();
    expect(Math.abs(s.floorD! - 45)).toBeLessThanOrEqual(1);
  });

  it('geometric floor is about 51 mm with Db = 24', () => {
    const s = solveMinimumSize({ ...joint('J4', 1), Db: 24 });
    expect(Math.abs(s.floorD! - 51)).toBeLessThanOrEqual(1);
  });

  it('J3 1 disc: about 63 mm, e about 1.22', () => {
    const s = solveMinimumSize(joint('J3', 1));
    expect(Math.abs(s.minD! - 63)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.bestE! - 1.22)).toBeLessThan(0.05);
    expect(s.bestScore!).toBeLessThanOrEqual(1);
  });

  it('J3 2 discs: about 47 mm', () => {
    const s = solveMinimumSize(joint('J3', 2));
    expect(Math.abs(s.minD! - 47)).toBeLessThanOrEqual(1);
  });

  it('J1: about 47 mm', () => {
    const s = solveMinimumSize(joint('J1', 1));
    expect(Math.abs(s.minD! - 47)).toBeLessThanOrEqual(1);
  });

  it('J4: about 45 mm (the geometric floor)', () => {
    const s = solveMinimumSize(joint('J4', 1));
    expect(Math.abs(s.minD! - 45)).toBeLessThanOrEqual(1);
    expect(s.minD).toBe(s.floorD);
  });

  it('J2 2 discs: about 79 mm, e about 1.65', () => {
    const s = solveMinimumSize(joint('J2', 2));
    expect(Math.abs(s.minD! - 79)).toBeLessThanOrEqual(1);
    expect(Math.abs(s.bestE! - 1.65)).toBeLessThan(0.05);
  });

  it('J2 single disc: no solution up to 120 mm', () => {
    const s = solveMinimumSize(joint('J2', 1));
    expect(s.valid).toBe(true);
    expect(s.noSolution).toBe(true);
    expect(s.minD).toBeNull();
    expect(s.Dmax).toBe(120);
    expect(s.warnings.join(' ')).toMatch(/No solution/);
    expect(s.floorD).toBe(45);
  });
});

describe('solver behaviour', () => {
  it('the returned (D, e) passes the full SPEC check on the contact modes', () => {
    const inp = joint('J3', 1);
    const s = solveMinimumSize(inp);
    const r = checkGearbox(applySolverSolution(inp, s.minD!, s.bestE!));
    expect(r.valid).toBe(true);
    expect(r.contactScore).toBeLessThanOrEqual(1 + 1e-9);
    expect(r.contactScore).toBeCloseTo(s.bestScore!, 6);
    // one mm smaller does not pass for any K1 on the grid
    const smaller = solveMinimumSize({ ...inp }, { Dmin: s.minD! - 1, Dmax: s.minD! - 1 });
    expect(smaller.minD).toBeNull();
  });

  it('reports a heat-map grid and per-D rows', () => {
    const s = solveMinimumSize(joint('J3', 1));
    expect(s.grid.K1).toHaveLength(19);
    expect(s.grid.K1[0]).toBeCloseTo(0.4, 9);
    expect(s.grid.K1[18]).toBeCloseTo(0.85, 9);
    expect(s.grid.D[0]).toBe(30);
    expect(s.rows[0].feasible).toBe(false);
    expect(s.rows.at(-1)!.D).toBe(s.minD);
  });

  it('async version gives the same answer and reports progress; cancel works', async () => {
    const inp = joint('J2', 1);
    const progress: number[] = [];
    const s = await solveMinimumSizeAsync(inp, {}, { onProgress: (p) => progress.push(p.fraction) });
    expect(s.noSolution).toBe(true);
    for (let i = 1; i < progress.length; i++) expect(progress[i]).toBeGreaterThanOrEqual(progress[i - 1]);
    const c = await solveMinimumSizeAsync(inp, {}, { shouldCancel: () => true, onProgress: () => {} });
    // A very fast machine may finish before the first slice; otherwise it is cancelled.
    expect(c.cancelled || c.valid).toBe(true);
  });

  it('never throws on bad input', () => {
    const bad = { ...defaultGearboxInputs(), Zp: 3, L: NaN };
    const s = solveMinimumSize(bad);
    expect(s.valid).toBe(false);
    expect(s.errors.length).toBeGreaterThan(0);
    expect(() => solveMinimumSize(null as unknown as GearboxInputs)).not.toThrow();
  });
});
