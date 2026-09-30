import { HintBanner } from './primitives';
import { STEP_HINTS } from '../help';
import { useStore } from '../store';

/** One-line first-visit hint; once dismissed it stays away (persisted with the session). */
export function StepHint({ step }: { step: 1 | 2 | 3 | 4 }) {
  const { state, dispatch } = useStore();
  if (state.hintsSeen[`step${step}`]) return null;
  return <HintBanner text={STEP_HINTS[step]} onDismiss={() => dispatch({ type: 'hint', key: `step${step}` })} />;
}
