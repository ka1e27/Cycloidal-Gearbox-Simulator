// Prints a readable table of solver and advisor results for the four SPEC presets (run with
// `npx vitest run src/calc/__tests__/explore.test.ts --reporter=verbose`). Also asserts basic sanity.
import { expect, it } from 'vitest';
import { PRESETS, adviseDesign, solveMinimumSize } from '../index';

it('prints solver and advisor results for the SPEC presets', () => {
  const lines: string[] = [];
  for (const id of ['J1', 'J2', 'J3', 'J4'] as const) {
    for (const discs of [1, 2]) {
      const t0 = performance.now();
      const s = solveMinimumSize({ ...PRESETS[id], discs });
      const ms = performance.now() - t0;
      lines.push(`solver ${id} ${discs} disc: minD ${s.minD ?? 'none'} e ${s.bestE?.toFixed(3) ?? '-'} floor ${s.floorD} (${ms.toFixed(0)} ms)`);
      expect(s.floorD).toBe(45);
    }
  }
  for (const id of ['J1', 'J2', 'J3', 'J4'] as const) {
    const t0 = performance.now();
    const a = adviseDesign(PRESETS[id]);
    const ms = performance.now() - t0;
    const b = a.best;
    lines.push(
      `advisor ${id}: ${b ? `OD ${b.housingOD} D ${b.D} discs ${b.discs} L ${b.L} util ${b.maxUtilization.toFixed(3)} mass ${b.massTotal_g.toFixed(1)} g` : 'none'} (${ms.toFixed(0)} ms)`,
    );
    expect(b).not.toBeNull();
  }
  console.log(lines.join('\n'));
});
