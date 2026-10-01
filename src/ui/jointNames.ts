// One place for joint labels so the Arm table, All Joints, the chips and the diagram agree.
// A joint is shown as "J<position> <name>"; the position follows the joint list, the name is the user's text.
import { DRIVE_LABEL, MOTION_LABEL, jointLabel, jointPos, type ArmJoint } from '../calc';

export { jointLabel, jointPos };

/** "base yaw", "pitch", "roll" in lower case, for running text. */
export const motionWord = (m: ArmJoint['motion']): string => (m === 'yaw' ? 'base yaw' : m);

/** "Pitch · Servo" style summary of how a joint moves and what drives it. */
export const jointKind = (j: Pick<ArmJoint, 'motion' | 'drive'>): string => `${MOTION_LABEL[j.motion]} · ${DRIVE_LABEL[j.drive]}`;
