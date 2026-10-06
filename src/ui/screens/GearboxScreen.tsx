// Gearbox of one slot for the workbench (CLAUDE.md Addition 10): the live model of the selected joint (or Custom) that
// the inspector's Gearbox design, Checks, Disc, Solver and DXF sections and the Disc stage all read. This used to be the
// 02 Gearbox page; its inputs and results now live in inspector sections.
import { useDeferredValue, useMemo } from 'react';
import type { GearboxInputs, GearboxModel } from '../../calc';
import { useEffectiveInputs } from '../store';
import { useToleranceVersion } from '../tolerance';
import type { Slot } from '../session';
import { modelFor } from '../workbench/status';

export interface SlotModel {
  /** Inputs actually checked (arm torques applied when the toggle is on), current */
  eff: GearboxInputs;
  /** The same, deferred while typing so the heavy results lag a frame instead of blocking input */
  deferred: GearboxInputs;
  model: GearboxModel;
  /** The results are a frame behind the inputs */
  pending: boolean;
}

/** The live gearbox model of a slot (cached by inputs, so every section shares one computation). */
export function useSlotModel(slot: Slot): SlotModel {
  const eff = useEffectiveInputs(slot);
  const deferred = useDeferredValue(eff);
  const tv = useToleranceVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const model = useMemo(() => modelFor(deferred), [deferred, deferred.useToleranceKc ? tv : 0]);
  return { eff, deferred, model, pending: deferred !== eff };
}
