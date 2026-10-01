// One place for the joint names so the Arm table, All Joints, the chips and the diagram agree.
// J1..J4 are the gearbox joints, J5 is the direct-drive wrist servo.

/** What each joint does, in the order J1..J5. */
export const JOINT_KIND = ['base yaw', 'shoulder pitch', 'elbow pitch', 'forearm roll', 'wrist pitch (servo)'] as const;

/** "J2 shoulder pitch" for a joint index 0..4. */
export const jointFullName = (i: number) => `J${i + 1} ${JOINT_KIND[i]}`;
