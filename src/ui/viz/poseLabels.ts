// Joint labels of the pose explorer (pure, no React): greedy placement in screen space after projection.
// The most important label (the joint with the highest share of T_des) is placed first and always keeps its full text;
// the others try their full text first and fall back to the short form ("J7 22%") when the full one finds no free spot.
import { placeLabels, type Box, type LabelPlacement } from './armLayout';

export interface PoseLabelReq {
  key: number;
  /** anchor (the joint centre on screen) and the radius of its symbol, px */
  ax: number;
  ay: number;
  r: number;
  full: string;
  short: string;
  /** higher = placed earlier */
  importance: number;
  /** never shortened (the worst joint) */
  keepFull: boolean;
}
export interface PoseLabel extends LabelPlacement { text: string; short: boolean }

export const LABEL_CHAR_W = 6.6; // IBM Plex Mono at 11 px
export const LABEL_H = 14;

export function placePoseLabels(reqs: PoseLabelReq[], obstacles: Box[], bounds: { W: number; H: number }): PoseLabel[] {
  const order = [...reqs].sort((a, b) => (b.keepFull ? 1 : 0) - (a.keepFull ? 1 : 0) || b.importance - a.importance || a.key - b.key);
  const taken: Box[] = [...obstacles];
  const out: PoseLabel[] = [];
  const prefer = ['NE', 'E', 'SE', 'N', 'S', 'W', 'NW', 'SW'] as const;
  for (const r of order) {
    const one = (text: string) => placeLabels([{ key: r.key, ax: r.ax, ay: r.ay, r: r.r, w: text.length * LABEL_CHAR_W, h: LABEL_H, prefer: [...prefer] }], taken, bounds)[0];
    let text = r.full;
    let p = one(text);
    let short = false;
    if (!p.clear && !r.keepFull && r.short !== r.full) {
      const q = one(r.short);
      text = r.short;
      p = q;
      short = true;
    }
    taken.push({ ...p.box, text: true });
    out.push({ ...p, text, short });
  }
  return out.sort((a, b) => Number(a.key) - Number(b.key));
}
