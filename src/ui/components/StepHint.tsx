import { STEP_HINTS } from '../help';

/** One plain sentence under each page title (replaces the old dismissable hint banners). */
export function stepSubtitle(step: 1 | 2 | 3 | 4): string {
  return STEP_HINTS[step];
}
