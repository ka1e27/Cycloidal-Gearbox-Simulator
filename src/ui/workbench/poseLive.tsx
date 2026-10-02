// Live pose state shared by the 3D stage, the "all angles" popover and the selected joint's "Pose angle" slider in the
// inspector (CLAUDE.md Additions 9 and 10). The angles, camera, zoom/pan and weight toggle live here while the user
// works and are saved to the session (debounced) as display-only state. The gearbox checks never read them.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { clampAngle, clampPose, hasLimits, lerpAngle, posePreset, randomPose, type ArmJoint, type PosePresetName } from '../../calc';
import { normalizePoseView, type PoseViewState } from '../session';
import { useStore } from '../store';
import { clampCamera, type Camera, type ZoomPan } from '../viz/view3d';

export const SEG_S = 2.6; // sweep: seconds per preset (2.0 s move + 0.6 s hold)
export const MOVE_S = 2.0;
export const SWEEP_KEYS: PosePresetName[] = ['ready', 'straight', 'folded', 'reachUp'];
export const PRESET_LABEL: Record<PosePresetName | 'random', string> = {
  ready: 'Ready', straight: 'Straight out (worst case)', folded: 'Folded', reachUp: 'Reach up', random: 'Random',
};
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const listJoints = (idx: number[]) => idx.map((i) => `J${i + 1}`).join(', ');

export function usePrefersReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const m = window.matchMedia('(prefers-reduced-motion: reduce)');
    const on = () => setR(!!m.matches);
    on();
    m.addEventListener?.('change', on);
    return () => m.removeEventListener?.('change', on);
  }, []);
  return r;
}

export interface PoseLive {
  joints: ArmJoint[];
  /** Angle of every joint in arm order, degrees, always inside the joint limits */
  angles: number[];
  setOne: (i: number, deg: number) => void;
  /** Set every angle (clamped); returns the indices that were clamped */
  setAll: (list: number[]) => number[];
  applyPreset: (key: PosePresetName | 'random') => void;
  cam: Camera;
  setCam: (c: Camera) => void;
  zp: ZoomPan;
  setZp: (z: ZoomPan | ((z: ZoomPan) => ZoomPan)) => void;
  weights: boolean;
  setWeights: (v: boolean) => void;
  playing: boolean;
  setPlaying: (v: boolean | ((p: boolean) => boolean)) => void;
  /** A joint dragged against one of its limits */
  stop: { i: number; side: 'min' | 'max' } | null;
  setStop: (s: { i: number; side: 'min' | 'max' } | null) => void;
  /** One-line note (a preset was clamped) */
  note: string | null;
  setNote: (n: string | null) => void;
  reduced: boolean;
  /** Pause saving while a joint drag is in progress */
  setHold: (v: boolean) => void;
}

const Ctx = createContext<PoseLive | null>(null);

export function usePoseLive(): PoseLive {
  const v = useContext(Ctx);
  if (!v) throw new Error('PoseLiveProvider missing');
  return v;
}

/** The live pose, or null outside the workbench (a panel rendered on its own). */
export function usePoseLiveOptional(): PoseLive | null {
  return useContext(Ctx);
}

export function PoseLiveProvider({ children }: { children: ReactNode }) {
  const { state, dispatch } = useStore();
  const joints = state.arm.joints;
  const stored = state.poseView;
  const reduced = usePrefersReducedMotion();

  const init = useMemo(() => normalizePoseView(stored), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [angleMap, setAngleMap] = useState<Record<string, number>>(init.angles);
  const [cam, setCamRaw] = useState<Camera>(clampCamera({ az: init.az, el: init.el }));
  const [zp, setZp] = useState<ZoomPan>({ zoom: init.zoom, px: init.px, py: init.py });
  const [weights, setWeights] = useState(init.weights);
  const [playing, setPlaying] = useState(false);
  const [stop, setStop] = useState<{ i: number; side: 'min' | 'max' } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [hold, setHold] = useState(false);
  const lastSaved = useRef<PoseViewState>(stored);
  const setCam = useCallback((c: Camera) => setCamRaw(clampCamera(c)), []);

  // the store changed under us (reset, import): take its state
  useEffect(() => {
    if (stored === lastSaved.current) return;
    lastSaved.current = stored;
    const v = normalizePoseView(stored);
    setAngleMap(v.angles);
    setCamRaw(clampCamera({ az: v.az, el: v.el }));
    setWeights(v.weights);
    setZp({ zoom: v.zoom, px: v.px, py: v.py });
  }, [stored]);
  useEffect(() => {
    if (playing || hold) return;
    const t = window.setTimeout(() => {
      const v: PoseViewState = { angles: angleMap, az: cam.az, el: cam.el, weights, zoom: zp.zoom, px: zp.px, py: zp.py };
      lastSaved.current = v;
      dispatch({ type: 'poseView', value: v });
    }, 400);
    return () => window.clearTimeout(t);
  }, [angleMap, cam, weights, zp, playing, hold, dispatch]);

  const ready = useMemo(() => posePreset(joints, 'ready'), [joints]);
  // what is shown is always inside the joint limits (a limit tightened after the angle was set clamps it)
  const angleKey = joints.map((j, i) => {
    const v = angleMap[j.id];
    return clampAngle(j, typeof v === 'number' && Number.isFinite(v) ? v : ready[i]);
  });
  const key = angleKey.join(',');
  const angles = useMemo(() => angleKey, [key]); // eslint-disable-line react-hooks/exhaustive-deps
  const anglesRef = useRef(angles);
  anglesRef.current = angles;

  const setAll = useCallback((list: number[]) => {
    const c = clampPose(joints, list);
    const m: Record<string, number> = {};
    joints.forEach((j, i) => { m[j.id] = c.angles[i]; });
    setAngleMap(m);
    return c.clamped;
  }, [joints]);
  const setOne = useCallback((i: number, deg: number) => {
    const j = joints[i];
    if (!j) return;
    setAngleMap((p) => ({ ...p, [j.id]: clampAngle(j, deg) }));
  }, [joints]);

  const applyPreset = useCallback((k: PosePresetName | 'random') => {
    setPlaying(false);
    if (k === 'random') { setAll(randomPose(joints)); setNote(null); return; }
    const clamped = setAll(posePreset(joints, k));
    setNote(clamped.length ? `${PRESET_LABEL[k]} was clamped to the joint limits at ${listJoints(clamped)}.` : null);
  }, [joints, setAll]);

  // ---- sweep ----
  const sweepRef = useRef({ joints, setAll });
  sweepRef.current = { joints, setAll };
  useEffect(() => {
    if (!playing) return;
    const { joints: js, setAll: set } = sweepRef.current;
    const keys = SWEEP_KEYS.map((k) => clampPose(js, posePreset(js, k)).angles);
    setNote(null);
    if (reduced) {
      // reduced motion: no tweening, step through the presets
      let s = 0;
      set(keys[0]);
      const h = window.setInterval(() => { s = (s + 1) % keys.length; set(keys[s]); }, SEG_S * 1000);
      return () => window.clearInterval(h);
    }
    const start = anglesRef.current.slice();
    const cycle = SEG_S * keys.length;
    let raf = 0;
    const t0 = performance.now();
    const tick = (now: number) => {
      const t = Math.max(0, (now - t0) / 1000); // a frame timestamp can precede t0
      const s = Math.floor(t / SEG_S) % keys.length;
      const f = smooth((t % SEG_S) / MOVE_S);
      const A = keys[s];
      const B = keys[(s + 1) % keys.length];
      const blend = smooth(t / 0.7);
      const out = js.map((j, i) => {
        let v = A[i] + (B[i] - A[i]) * f;
        if (j.motion === 'yaw') v += 55 * Math.sin((2 * Math.PI * t) / cycle);
        if (j.motion === 'roll') v += 90 * Math.sin((2 * Math.PI * t) / (cycle / 2));
        return blend < 1 ? (hasLimits(j) ? start[i] + (v - start[i]) * blend : lerpAngle(start[i], v, blend)) : v;
      });
      set(out); // clamped to the limits
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, reduced]);

  const value = useMemo<PoseLive>(() => ({
    joints, angles, setOne, setAll, applyPreset, cam, setCam, zp, setZp, weights, setWeights, playing, setPlaying,
    stop, setStop, note, setNote, reduced, setHold,
  }), [joints, angles, setOne, setAll, applyPreset, cam, setCam, zp, weights, playing, stop, note, reduced]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
