// Pure edits of the joint list (add, remove, move, retype). The Arm & Loads screen applies these through updateArm,
// and the store then keeps the per-joint gearbox / advisor state in step with the result (reconcileSession).

import { MAX_JOINTS, MIN_JOINTS, MOTION_TYPES, makeJoint, type ArmInputs, type ArmJoint, type DriveType, type MotionType } from '../calc';

/** Append a joint at the tip. The previous last joint's tool link becomes the link to the new joint. No-op at 8 joints. */
export function addJoint(arm: ArmInputs, motion: MotionType, drive: DriveType = 'cycloidal'): ArmInputs {
  if (arm.joints.length >= MAX_JOINTS) return arm;
  return { ...arm, joints: [...arm.joints, makeJoint(arm.joints, motion, drive)] };
}

/** Remove a joint by id (its link goes with it). No-op for the last remaining joint. */
export function removeJoint(arm: ArmInputs, id: string): ArmInputs {
  if (arm.joints.length <= MIN_JOINTS || !arm.joints.some((j) => j.id === id)) return arm;
  return { ...arm, joints: arm.joints.filter((j) => j.id !== id) };
}

/** Move a joint one place toward the base (-1) or the tip (+1). */
export function moveJoint(arm: ArmInputs, id: string, delta: -1 | 1): ArmInputs {
  const i = arm.joints.findIndex((j) => j.id === id);
  const k = i + delta;
  if (i < 0 || k < 0 || k >= arm.joints.length) return arm;
  const joints = arm.joints.slice();
  [joints[i], joints[k]] = [joints[k], joints[i]];
  return { ...arm, joints };
}

/** Patch one joint by id. */
export function patchJoint(arm: ArmInputs, id: string, patch: Partial<ArmJoint>): ArmInputs {
  return { ...arm, joints: arm.joints.map((j) => (j.id === id ? { ...j, ...patch } : j)) };
}

/**
 * Change a joint's motion type. If its name is just the old type word (or empty) it follows the new type, so
 * an auto-named "J6 pitch" becomes "J6 roll"; a name the user typed is left alone.
 */
export function setMotion(arm: ArmInputs, id: string, motion: MotionType): ArmInputs {
  const j = arm.joints.find((x) => x.id === id);
  if (!j || j.motion === motion) return arm;
  const auto = j.name.trim() === '' || (MOTION_TYPES as readonly string[]).includes(j.name.trim());
  return patchJoint(arm, id, { motion, ...(auto ? { name: motion } : {}) });
}
