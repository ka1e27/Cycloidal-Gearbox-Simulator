import type { GearboxInputs } from '../../calc';

/** Everything the minimum-size solver reads (it sweeps D and e itself, and ignores an Rw override and the wall). */
export function solverKey(i: GearboxInputs): string {
  const { D: _d, e: _e, RwOverride: _r, wall: _w, ...rest } = i;
  void _d; void _e; void _r; void _w;
  return JSON.stringify(rest);
}
