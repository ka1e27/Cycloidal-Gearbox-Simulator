import { MOTION_LABEL, type ArmJoint } from '../../calc';
import { MotionIcon } from '../viz/armSymbols';

/**
 * A joint as a small name block: motion symbol, "J3", and the user's name beneath. Used in tables.
 * `children` replaces the position text (e.g. with a button).
 */
export function JointTag({ joint, index, children, showDrive = true }: { joint: Pick<ArmJoint, 'name' | 'motion' | 'drive'>; index: number; children?: React.ReactNode; showDrive?: boolean }) {
  return (
    <>
      <span className="joint-name">
        <MotionIcon motion={joint.motion} size={18} title={`${MOTION_LABEL[joint.motion]} joint`} />
        {children ?? `J${index + 1}`}
      </span>
      <span className="joint-kind">
        {joint.name.trim() || MOTION_LABEL[joint.motion].toLowerCase()}
        {showDrive && joint.drive === 'servo' && <span className="tag">servo</span>}
      </span>
    </>
  );
}
