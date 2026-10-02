import { useDeferredValue, useMemo } from 'react';
import { computeArmResult } from '../session';
import { useStore } from '../store';
import { jointStatus, type JointStatus } from './status';

/** Status of every joint in arm order (deferred, so typing never waits for the four gearbox checks). */
export function useJointStatuses(): JointStatus[] {
  const { state } = useStore();
  const d = useDeferredValue(state);
  const { arm: armIn, gearboxes, useArmLoads, presetBase } = d;
  return useMemo(() => {
    const arm = computeArmResult(armIn);
    return armIn.joints.map((j, i) => jointStatus(d, arm, j, i));
  }, [armIn, gearboxes, useArmLoads, presetBase]); // eslint-disable-line react-hooks/exhaustive-deps
}
