// Pose explorer (CLAUDE.md Addition 9): a movable 3D arm in an orthographic SVG with the static gravity load at the
// chosen pose. Display only: every gearbox check keeps using the worst case (arm straight out).
import { useCallback, useEffect, useId, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  MOTION_LABEL, clampAngle, clampPose, computePose, hasLimits, jointLabel, jointLimits, lerpAngle, posePreset, randomPose,
  validateJointLimits,
  type ArmInputs, type ArmJoint, type ArmResult, type PosePresetName, type PoseResult, type PoseStatus,
} from '../../calc';
import { Button, Card, Cu, Notice, ResponsiveTable, Segmented, Switch } from '../components/primitives';
import { JointTag } from '../components/JointTag';
import { DASH } from '../format';
import { useStore } from '../store';
import { normalizePoseView, type PoseViewState } from '../session';
import { patchJoint } from '../armEdit';
import { forceColor, forceStops } from './colors';
import { type Box } from './armLayout';
import { LABEL_CHAR_W, LABEL_H, placePoseLabels, type PoseLabelReq } from './poseLabels';
import { useWidth } from './useWidth';
import {
  NO_ZOOM, VIEW_PRESETS, ZOOM_MAX, ZOOM_MIN, add, applyZoomPan, basis, boxOf, clampCamera, cylinder, dot, frameFromBox, knobDir, len,
  perpRef, planeAngle, project, projectDir, ringPoints, scl, sub, unionBox, unit, viewNameOf, zoomAbout,
  type Box2, type Camera, type Cyl, type Ellipse, type Frame, type V3, type ViewName, type ZoomPan,
} from './view3d';

const RAD = Math.PI / 180;
const LINK_W = 9;
const SEG_PX = 16; // links are cut into pieces about this long on screen, each depth-sorted on its own
const SEG_S = 2.6; // sweep: seconds per preset (2.0 s move + 0.6 s hold)
const MOVE_S = 2.0;
const SWEEP_KEYS: PosePresetName[] = ['ready', 'straight', 'folded', 'reachUp'];
const PRESET_LABEL: Record<PosePresetName | 'random', string> = {
  ready: 'Ready', straight: 'Straight out (worst case)', folded: 'Folded', reachUp: 'Reach up', random: 'Random',
};
const PRESET_BUTTONS: { key: PosePresetName | 'random'; title: string }[] = [
  { key: 'ready', title: 'Upper arm up, forearm out (the drawing’s ready pose)' },
  { key: 'straight', title: 'Every angle 0: the pose all torques are computed for' },
  { key: 'folded', title: 'Tucked in' },
  { key: 'reachUp', title: 'Everything from the first pitch joint points up' },
  { key: 'random', title: 'A random pose inside the joint limits' },
];
const VIEW_OPTIONS: { value: ViewName | 'custom'; label: string; title: string }[] = [
  { value: 'side', label: 'Side', title: 'Looking along the pitch axes (like the drawing above)' },
  { value: 'front', label: 'Front', title: 'Looking back along the arm' },
  { value: 'top', label: 'Top', title: 'Looking down' },
  { value: 'iso', label: 'Iso', title: 'Three-quarter view' },
];
const smooth = (t: number) => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));
const pct = (u: number | null) => (u == null ? DASH : `${Math.round(u * 100)}%`);
const STATUS_TEXT: Record<PoseStatus, string> = { ok: 'OK', marginal: 'MARGINAL', fail: 'OVER', none: 'N/A' };
const STATUS_CLASS: Record<PoseStatus, string> = { ok: 'ok', marginal: 'marginal', fail: 'fail', none: 'neutral' };
const fmtDeg = (x: number) => `${Math.round(x * 10) / 10}°`;
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

type DragKind = 'orbit' | 'joint' | 'pan' | 'pinch';
type Drag =
  | { kind: 'orbit'; x: number; y: number; cam: Camera; id: number }
  | { kind: 'pan'; x: number; y: number; zp: ZoomPan; id: number }
  | { kind: 'pinch'; d0: number; mx: number; my: number; zp: ZoomPan }
  | { kind: 'joint'; i: number; jid: string; method: 'plane' | 'knob'; prevPhi: number | null; x: number; y: number; acc: number; id: number };

/** The Pose Explorer card. */
export function PoseExplorer() {
  const { state, arm: armRes, dispatch } = useStore();
  const a = state.arm;
  return (
    <Card title="Pose explorer" className="pose-card"
      subtitle="Move the arm and see the static gravity load at that pose. Drag a joint (or the link after it) to turn it, drag the background to orbit, or use the sliders.">
      {armRes.valid && a.joints.length > 0
        ? <PoseExplorerBody arm={a} res={armRes} stored={state.poseView} onSave={(v) => dispatch({ type: 'poseView', value: v })} />
        : <Notice kind="info" title="Waiting for valid arm inputs">Fix the arm inputs above to move the arm and see the load at each pose.</Notice>}
    </Card>
  );
}

function PoseExplorerBody({ arm, res, stored, onSave }: { arm: ArmInputs; res: ArmResult; stored: PoseViewState; onSave: (v: PoseViewState) => void }) {
  const { resolvedTheme, updateArm } = useStore();
  const joints = arm.joints;
  const uid = useId().replace(/:/g, '');
  const reduced = usePrefersReducedMotion();

  // ---- local display state (persisted to the session, debounced) ----
  const init = useMemo(() => normalizePoseView(stored), []); // eslint-disable-line react-hooks/exhaustive-deps
  const [angleMap, setAngleMap] = useState<Record<string, number>>(init.angles);
  const [cam, setCam] = useState<Camera>(clampCamera({ az: init.az, el: init.el }));
  const [zp, setZp] = useState<ZoomPan>(NO_ZOOM);
  const [weights, setWeights] = useState(init.weights);
  const [playing, setPlaying] = useState(false);
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const [stop, setStop] = useState<{ i: number; side: 'min' | 'max' } | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const lastSaved = useRef<PoseViewState>(stored);

  // the store changed under us (reset, import): take its state
  useEffect(() => {
    if (stored === lastSaved.current) return;
    lastSaved.current = stored;
    const v = normalizePoseView(stored);
    setAngleMap(v.angles);
    setCam(clampCamera({ az: v.az, el: v.el }));
    setWeights(v.weights);
  }, [stored]);
  useEffect(() => {
    if (playing) return;
    const t = window.setTimeout(() => {
      const v: PoseViewState = { angles: angleMap, az: cam.az, el: cam.el, weights };
      lastSaved.current = v;
      onSave(v);
    }, 400);
    return () => window.clearTimeout(t);
  }, [angleMap, cam, weights, playing]); // eslint-disable-line react-hooks/exhaustive-deps

  const ready = useMemo(() => posePreset(joints, 'ready'), [joints]);
  // what is shown is always inside the joint limits (a limit tightened after the angle was set clamps it)
  const angles = joints.map((j, i) => {
    const v = angleMap[j.id];
    return clampAngle(j, typeof v === 'number' && Number.isFinite(v) ? v : ready[i]);
  });
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

  const applyPreset = (key: PosePresetName | 'random') => {
    setPlaying(false);
    if (key === 'random') { setAll(randomPose(joints)); setNote(null); return; }
    const clamped = setAll(posePreset(joints, key));
    setNote(clamped.length ? `${PRESET_LABEL[key]} was clamped to the joint limits at ${listJoints(clamped)}.` : null);
  };

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

  const pose = useMemo(() => computePose(arm, angles, res), [arm, res, angles.join(',')]); // eslint-disable-line react-hooks/exhaustive-deps
  const [figRef, W] = useWidth<HTMLDivElement>(640);
  const H = Math.round(Math.max(280, Math.min(560, W < 520 ? W * 0.95 : W * 0.72)));
  const zoomBy = (k: number) => setZp((z) => zoomAbout(z, k, W / 2, H / 2, W, H));

  return (
    <div className="pz">
      <div className="pz-main">
        <div className="pz-figwrap" ref={figRef}>
          <div className="pz-tools">
            <Segmented<ViewName | 'custom'> value={viewNameOf(cam) ?? 'custom'} onChange={(v) => { if (v !== 'custom') setCam({ ...VIEW_PRESETS[v] }); }}
              label="Camera view" size="sm" options={VIEW_OPTIONS} />
            <div className="pz-zoom" role="group" aria-label="Zoom">
              <button type="button" className="icon-btn pz-zbtn" onClick={() => zoomBy(1 / 1.25)} disabled={zp.zoom <= ZOOM_MIN + 1e-9} aria-label="Zoom out" title="Zoom out">−</button>
              <span className="pz-zval mono" aria-live="off">{Math.round(zp.zoom * 100)}%</span>
              <button type="button" className="icon-btn pz-zbtn" onClick={() => zoomBy(1.25)} disabled={zp.zoom >= ZOOM_MAX - 1e-9} aria-label="Zoom in" title="Zoom in">+</button>
              <Button size="sm" variant="ghost" onClick={() => setZp(NO_ZOOM)} title="Fit the arm in the view (zoom 100%, no pan)">Fit</Button>
              <Button size="sm" variant="ghost" icon="reset" onClick={() => { setCam({ ...VIEW_PRESETS.side }); setZp(NO_ZOOM); }} title="Side view, zoom and pan reset">Reset view</Button>
            </div>
          </div>
          <PoseSvg
            arm={arm} pose={pose} cam={cam} zp={zp} W={W} H={H} uid={uid} theme={resolvedTheme} weights={weights} dragging={dragging}
            hold={playing || dragging === 'joint'} stop={stop}
            onOrbit={(c) => setCam(clampCamera(c))}
            onZoomPan={setZp}
            onJoint={(i, deg) => {
              const L = jointLimits(joints[i]);
              const lim = hasLimits(joints[i]);
              setOne(i, deg);
              setStop(lim && deg < L.min - 1e-9 ? { i, side: 'min' } : lim && deg > L.max + 1e-9 ? { i, side: 'max' } : null);
            }}
            onDragState={(d) => { setDragging(d); if (d) setPlaying(false); if (!d) setStop(null); if (d === 'joint') setNote(null); }}
          />
          <p className="pz-hint muted small">
            Drag a joint to turn it · drag the background to orbit · Shift-drag or middle-drag to pan · Ctrl (⌘) + scroll, or pinch, to zoom; plain scrolling scrolls the page.
          </p>
          <FigLegend pose={pose} theme={resolvedTheme} />
        </div>

        <div className="pz-controls">
          <div className="pz-presets" role="group" aria-label="Pose presets">
            {PRESET_BUTTONS.map((p) => (
              <Button key={p.key} size="sm" variant="secondary" title={p.title} onClick={() => applyPreset(p.key)}>{PRESET_LABEL[p.key]}</Button>
            ))}
            <Button size="sm" variant="primary" icon={playing ? 'pause' : 'play'} aria-pressed={playing}
              title={reduced ? 'Steps through the presets (reduced motion is on)' : 'Animate a smooth path through the presets'}
              onClick={() => setPlaying((x) => !x)}>
              {playing ? 'Pause sweep' : 'Sweep'}
            </Button>
          </div>
          {reduced && <p className="muted small pz-rm">Reduced motion is on: Sweep steps through the presets without animating.</p>}
          {note && <p className="pz-note small" role="status">{note}</p>}
          <div className="pz-sliders">
            {joints.map((j, i) => (
              <JointSlider key={j.id} joint={j} index={i} uid={uid} angle={angles[i]} atStop={stop?.i === i ? stop.side : null}
                onAngle={(d) => { setPlaying(false); setOne(i, d); }}
                onLimits={(lim) => updateArm((x) => patchJoint(x, j.id, { limits: lim }))} />
            ))}
          </div>
          <Switch checked={weights} onChange={setWeights} label="Weight arrows" description="An arrow at every mass, length in proportion to the mass." />
        </div>
      </div>

      <PoseTable arm={arm} res={res} pose={pose} angles={angles} />
      <p className="card-foot muted small">
        The gearbox checks always use the worst case (arm straight out, the T_static column), whatever the joint limits. This view shows the static
        gravity load at the chosen pose only: no dynamics (α·I), so a joint can need more while it accelerates.
        Positive torque means the joint pushes in its + angle direction; + pitch lifts the link.
      </p>
    </div>
  );
}

/** One joint: angle slider plus a compact "Limits" disclosure (min / max angle, degrees). */
function JointSlider({ joint: j, index: i, uid, angle, atStop, onAngle, onLimits }: {
  joint: ArmJoint; index: number; uid: string; angle: number; atStop: 'min' | 'max' | null;
  onAngle: (deg: number) => void; onLimits: (l: { min: number; max: number } | undefined) => void;
}) {
  const id = `${uid}-q-${j.id}`;
  const L = jointLimits(j);
  const limited = hasLimits(j);
  const deg = Math.round(angle);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ min: String(L.min), max: String(L.max) });
  useEffect(() => { setDraft({ min: String(L.min), max: String(L.max) }); }, [L.min, L.max]);
  const nmin = draft.min.trim() === '' ? NaN : Number(draft.min);
  const nmax = draft.max.trim() === '' ? NaN : Number(draft.max);
  const err = validateJointLimits(nmin, nmax);
  const commit = (mn: string, mx: string) => {
    setDraft({ min: mn, max: mx });
    const a = mn.trim() === '' ? NaN : Number(mn);
    const b = mx.trim() === '' ? NaN : Number(mx);
    if (validateJointLimits(a, b) === null) onLimits(a === -180 && b === 180 ? undefined : { min: a, max: b });
  };
  const pid = `${id}-lim`;
  return (
    <div className={`pz-slider${atStop ? ' is-stop' : ''}`}>
      <label htmlFor={id} className="pz-slider-label">
        <span className="mono strong">J{i + 1}</span>{' '}
        <span className="pz-slider-name">{j.name.trim() || MOTION_LABEL[j.motion].toLowerCase()}</span>
        <small className="muted"> · {MOTION_LABEL[j.motion]}{j.drive === 'servo' ? ' · servo' : ''}</small>
      </label>
      <output htmlFor={id} className="pz-slider-val mono">{deg}°{atStop && <span className="pz-stoptag"> limit</span>}</output>
      <input id={id} type="range" min={Math.ceil(L.min)} max={Math.floor(L.max)} step={1} value={Math.min(Math.floor(L.max), Math.max(Math.ceil(L.min), deg))}
        aria-valuetext={`${deg} degrees${limited ? `, limits ${L.min} to ${L.max}` : ''}`}
        onChange={(e) => onAngle(Number(e.target.value))} />
      <button type="button" className="pz-limbtn" aria-expanded={open} aria-controls={pid} onClick={() => setOpen((o) => !o)}>
        Limits <span className="mono">{limited ? `${fmtDeg(L.min)} … ${fmtDeg(L.max)}` : '±180°'}</span>
      </button>
      {open && (
        <div className="pz-limits" id={pid}>
          <label className="pz-limfield">
            <span>Min</span>
            <input className="nf-input" type="number" inputMode="decimal" step={1} min={-180} max={180} value={draft.min}
              aria-invalid={!!err} aria-label={`Minimum angle of J${i + 1}, degrees`} onChange={(e) => commit(e.target.value, draft.max)} />
            <span className="nf-unit">°</span>
          </label>
          <label className="pz-limfield">
            <span>Max</span>
            <input className="nf-input" type="number" inputMode="decimal" step={1} min={-180} max={180} value={draft.max}
              aria-invalid={!!err} aria-label={`Maximum angle of J${i + 1}, degrees`} onChange={(e) => commit(draft.min, e.target.value)} />
            <span className="nf-unit">°</span>
          </label>
          <Button size="sm" variant="ghost" disabled={!limited && !err} onClick={() => commit('-180', '180')}>Clear</Button>
          {err && <p className="pz-limerr small" role="alert">{err}</p>}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// The 3D drawing
// ---------------------------------------------------------------------------

interface SvgProps {
  arm: ArmInputs; pose: PoseResult; cam: Camera; zp: ZoomPan; W: number; H: number; uid: string; theme: 'light' | 'dark'; weights: boolean;
  dragging: DragKind | null;
  /** Freeze the framing (grow only): a joint drag or the sweep is running */
  hold: boolean;
  /** A joint being dragged against one of its limits */
  stop: { i: number; side: 'min' | 'max' } | null;
  onOrbit: (c: Camera) => void;
  onZoomPan: (z: ZoomPan) => void;
  onJoint: (i: number, deg: number) => void;
  onDragState: (d: DragKind | null) => void;
}

const clean = (x: number) => (Number.isFinite(x) && x > 0 ? Math.min(x, 1e7) : 0);

function PoseSvg({ arm, pose, cam, zp, W, H, uid, theme, weights, dragging, hold, stop, onOrbit, onZoomPan, onJoint, onDragState }: SvgProps) {
  const { u } = useStore();
  const svgRef = useRef<SVGSVGElement>(null);
  const joints = arm.joints;
  const b = useMemo(() => basis(cam), [cam]);
  void uid;

  // ---- sizes (world mm) ----
  const L = joints.map((j) => clean(j.length_mm));
  const total = L.reduce((s, x) => s + x, 0);
  const S = Math.max(total, 100);
  const p = joints.findIndex((j) => j.motion === 'pitch');
  const colH = p < 0 ? total : L.slice(0, p).reduce((s, x) => s + x, 0);
  const R = p < 0 ? 0 : total - colH;
  const yawBase = joints[0].motion === 'yaw';
  const baseR = 0.07 * S;
  const turnH = yawBase ? 0.035 * S : 0;
  const plateH = 0.02 * S;
  const pedestal = yawBase ? 0 : 0.06 * S;
  const zG = -(turnH + plateH + pedestal);
  const plateR = baseR * 1.35;
  const G = Math.max(R, 0.35 * S, plateR * 1.6) * 1.25;
  // grid step: a nice number in the display unit, about 8 cells across
  const gridStep = useMemo(() => {
    const raw = u.toDisplay('length', (2 * G) / 8);
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const m = raw / mag;
    const nice = (m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10) * mag;
    return u.fromDisplay('length', nice);
  }, [G, u]);
  const Gr = Math.ceil(G / gridStep) * gridStep;

  // Framing: the preset poses, the base and the current pose. While a joint is dragged or the sweep runs the frame only
  // grows, so the picture does not zoom under the pointer. Zoom and pan sit on top of it.
  const presetPts = useMemo(() => {
    const pts: V3[] = [[0, 0, zG], [plateR, 0, zG], [-plateR, 0, zG], [0, plateR, zG], [0, -plateR, zG], [0, 0, colH]];
    for (const k of ['ready', 'straight', 'folded', 'reachUp'] as const) {
      const pr = computePose(arm, clampPose(joints, posePreset(joints, k)).angles);
      for (const pj of pr.joints) pts.push(pj.pos_mm as V3);
      pts.push(pr.tip_mm as V3);
    }
    return pts;
  }, [arm, joints, zG, plateR, colH]);
  const posePts: V3[] = [...pose.joints.map((j) => j.pos_mm as V3), pose.tip_mm as V3];
  let box = boxOf(b, [...presetPts, ...posePts]);
  const held = useRef<{ key: string; box: Box2 } | null>(null);
  const camKey = `${cam.az},${cam.el},${W},${H}`;
  if (hold && held.current && held.current.key === camKey) box = unionBox(box, held.current.box);
  held.current = { key: camKey, box };
  const f: Frame = applyZoomPan(frameFromBox(b, box, W, H, 34), zp, W, H);
  const frameRef = useRef(f);
  frameRef.current = f;
  const poseRef = useRef(pose);
  poseRef.current = pose;
  const zpRef = useRef(zp);
  zpRef.current = zp;

  // joint symbol radius (px): grows a little with mass
  const jm = joints.map((j) => clean(j.mass_g));
  const maxM = Math.max(1, ...jm);
  const rJ = jm.map((m) => 9 + 6 * Math.sqrt(m / maxM));

  // ---- pointer handling: orbit, pan, joint drag, two-finger pinch ----
  const drag = useRef<Drag | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const toSvg = (e: { clientX: number; clientY: number }) => {
    const r = svgRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: ((e.clientX - r.left) * W) / r.width, y: ((e.clientY - r.top) * H) / r.height };
  };
  const capture = (e: RPointerEvent) => {
    try { svgRef.current?.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
  };
  const pinchState = () => {
    const pts = [...pointers.current.values()];
    const [a, c] = pts;
    return { d: Math.max(1, Math.hypot(c.x - a.x, c.y - a.y)), mx: (a.x + c.x) / 2, my: (a.y + c.y) / 2 };
  };
  /** Register a pointer; a second one turns any gesture into a pinch. Returns true when a pinch started. */
  const addPointer = (e: RPointerEvent) => {
    pointers.current.set(e.pointerId, toSvg(e));
    capture(e);
    if (pointers.current.size === 2) {
      const ps = pinchState();
      drag.current = { kind: 'pinch', d0: ps.d, mx: ps.mx, my: ps.my, zp: zpRef.current };
      onDragState('pinch');
      return true;
    }
    return false;
  };
  const startPan = (e: RPointerEvent) => {
    const { x, y } = toSvg(e);
    drag.current = { kind: 'pan', x, y, zp: zpRef.current, id: e.pointerId };
    onDragState('pan');
  };
  const startBackground = (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.preventDefault();
    if (addPointer(e)) return;
    if (e.button === 1 || e.shiftKey) { startPan(e); return; }
    const { x, y } = toSvg(e);
    drag.current = { kind: 'orbit', x, y, cam, id: e.pointerId };
    onDragState('orbit');
  };
  const startJoint = (i: number) => (e: RPointerEvent) => {
    if (e.pointerType === 'mouse' && e.button !== 0 && e.button !== 1) return;
    e.stopPropagation();
    e.preventDefault();
    if (addPointer(e)) return;
    if (e.button === 1) { startPan(e); return; }
    const pj = poseRef.current.joints[i];
    if (!pj) return;
    const fr = frameRef.current;
    const { x, y } = toSvg(e);
    const method = Math.abs(dot(pj.axis as V3, fr.b.toward)) >= 0.3 ? 'plane' : 'knob';
    let prevPhi: number | null = null;
    if (method === 'plane') {
      const pa = planeAngle(fr, pj.pos_mm as V3, pj.axis as V3, x, y);
      prevPhi = pa && pa.radiusPx >= 12 ? pa.phi : null;
    }
    drag.current = { kind: 'joint', i, jid: joints[i].id, method, prevPhi, x, y, acc: pj.angleDeg, id: e.pointerId };
    onDragState('joint');
  };
  const onMove = (e: RPointerEvent) => {
    if (pointers.current.has(e.pointerId)) pointers.current.set(e.pointerId, toSvg(e));
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (pointers.current.size < 2) return;
      const ps = pinchState();
      const z1 = zoomAbout(d.zp, ps.d / d.d0, d.mx, d.my, W, H);
      onZoomPan({ ...z1, px: z1.px + (ps.mx - d.mx), py: z1.py + (ps.my - d.my) });
      return;
    }
    if (d.id !== e.pointerId) return;
    const { x, y } = toSvg(e);
    if (d.kind === 'orbit') { onOrbit({ az: d.cam.az - (x - d.x) * 0.5, el: d.cam.el + (y - d.y) * 0.5 }); return; }
    if (d.kind === 'pan') { onZoomPan({ ...d.zp, px: d.zp.px + (x - d.x), py: d.zp.py + (y - d.y) }); return; }
    const pj = poseRef.current.joints[d.i];
    if (!pj) return;
    const fr = frameRef.current;
    let dq = 0;
    if (d.method === 'plane') {
      const pa = planeAngle(fr, pj.pos_mm as V3, pj.axis as V3, x, y);
      if (!pa || pa.radiusPx < 12) { d.prevPhi = null; return; }
      if (d.prevPhi != null) {
        let dp = pa.phi - d.prevPhi;
        if (dp > Math.PI) dp -= 2 * Math.PI;
        if (dp < -Math.PI) dp += 2 * Math.PI;
        dq = dp / RAD;
      }
      d.prevPhi = pa.phi;
    } else {
      const k = knobDir(fr, pj.axis as V3);
      dq = (((x - d.x) * k.x + (y - d.y) * k.y) / 60) / RAD;
      d.x = x; d.y = y;
    }
    if (dq === 0) return;
    const want = d.acc + dq;
    const j = joints[d.i];
    if (hasLimits(j)) {
      // the drag stops at a limit, and turning back moves at once (the accumulator does not run past the stop)
      const Lm = jointLimits(j);
      d.acc = Math.min(Lm.max, Math.max(Lm.min, want));
      onJoint(d.i, e.shiftKey ? Math.round(want / 15) * 15 : want);
    } else {
      d.acc = want;
      onJoint(d.i, e.shiftKey ? Math.round(d.acc / 15) * 15 : d.acc);
    }
  };
  const onUp = (e: RPointerEvent) => {
    pointers.current.delete(e.pointerId);
    const d = drag.current;
    if (!d) return;
    if (d.kind === 'pinch') {
      if (pointers.current.size < 2) { drag.current = null; onDragState(null); }
      return;
    }
    if (d.id === e.pointerId) { drag.current = null; onDragState(null); }
  };

  // ctrl / cmd + wheel (and trackpad pinch, which arrives as ctrl + wheel) zooms about the pointer; a plain wheel scrolls the page
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  onWheelRef.current = (e: WheelEvent) => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const { x, y } = toSvg(e);
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    const z = zoomAbout(zpRef.current, Math.exp(-dy * 0.0022), x, y, W, H);
    zpRef.current = z; // several wheel events can arrive before the next render
    onZoomPan(z);
  };
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const h = (e: WheelEvent) => onWheelRef.current(e);
    el.addEventListener('wheel', h, { passive: false });
    return () => el.removeEventListener('wheel', h);
  }, []);

  // ---- drawing: every primitive is depth-sorted on its own (link pieces, joints, payload, weight arrows) ----
  const items: { depth: number; key: string; node: ReactNode }[] = [];
  const P = (v: V3) => project(f, v);
  const tor = b.toward;
  const ell = (e: Ellipse, cls: string, key?: string) => (
    <ellipse key={key} className={cls} cx={e.cx} cy={e.cy} rx={e.rx} ry={e.ry} transform={`rotate(${e.rot} ${e.cx} ${e.cy})`} />
  );
  const cyl = (c: Cyl, cls: string, extra?: ReactNode) => (
    <g className={cls}>
      {ell(c.back, 'pz-cap pz-back')}
      <polygon className="pz-side" points={c.side.map((q) => q.join(',')).join(' ')} />
      {ell(c.front, 'pz-cap')}
      {extra}
    </g>
  );
  const poly = (pts: V3[]) => pts.map((q) => { const s = P(q); return `${s.x.toFixed(2)},${s.y.toFixed(2)}`; }).join(' ');

  // ground plane and grid (always behind: the camera never looks from below)
  const gridLines: ReactNode[] = [];
  const nCells = Math.round((2 * Gr) / gridStep);
  for (let k = 0; k <= nCells && nCells <= 60; k++) {
    const c = -Gr + k * gridStep;
    const a1 = P([c, -Gr, zG]); const a2 = P([c, Gr, zG]);
    const b1 = P([-Gr, c, zG]); const b2 = P([Gr, c, zG]);
    gridLines.push(<line key={`gx${k}`} x1={a1.x} y1={a1.y} x2={a2.x} y2={a2.y} />, <line key={`gy${k}`} x1={b1.x} y1={b1.y} x2={b2.x} y2={b2.y} />);
  }
  const groundPoly = poly([[-Gr, -Gr, zG], [Gr, -Gr, zG], [Gr, Gr, zG], [-Gr, Gr, zG]]);
  const ax0 = P([0, 0, zG]);
  const ax1 = P([Gr, 0, zG]);

  // base plate (on the ground) and the pedestal of a non-yaw first joint
  const Z: V3 = [0, 0, 1];
  const toPx = (mm: number) => mm * f.scale;
  const plate = cylinder(f, [0, 0, zG + plateH / 2], Z, Math.max(3, toPx(plateR)), Math.max(1, toPx(plateH / 2)));
  items.push({ depth: -1e12, key: 'plate', node: cyl(plate, 'pz-base') });
  if (!yawBase) {
    const ped = cylinder(f, [0, 0, -pedestal / 2], Z, Math.max(3, toPx(baseR * 0.45)), Math.max(1, toPx(pedestal / 2)));
    items.push({ depth: P([0, 0, -pedestal / 2]).depth, key: 'ped', node: cyl(ped, 'pz-base') });
  }

  // joint centres, depths and symbol radii (px) first: link pieces inside a joint's housing go behind that joint
  const jointCenter: V3[] = pose.joints.map((pj, i) => (i === 0 && joints[0].motion === 'yaw' ? [0, 0, -turnH / 2] : pj.pos_mm) as V3);
  const jointR: number[] = joints.map((j, i) => (i === 0 && j.motion === 'yaw' ? Math.max(6, toPx(baseR)) : j.motion === 'roll' ? Math.max(7.5, rJ[i] * 0.8) : rJ[i]));
  const jointDepth = jointCenter.map((c) => P(c).depth);

  // links: cut into short pieces, each with its own depth and its own bending colour
  const Mref = pose.Mref_Nm > 0 ? pose.Mref_Nm : 1;
  const linkObstacles: Box[] = [];
  pose.links.forEach((lk, i) => {
    if (lk.length_mm <= 0) return;
    const A3 = lk.from_mm as V3;
    const B3 = lk.to_mm as V3;
    const A = P(A3);
    const B = P(B3);
    const lenPx = Math.hypot(B.x - A.x, B.y - A.y);
    const n = Math.max(1, Math.min(40, Math.ceil(lenPx / SEG_PX)));
    const Mat = (t: number) => (t <= 0.5 ? lk.Mroot_Nm + (lk.Mmid_Nm - lk.Mroot_Nm) * (t / 0.5) : lk.Mmid_Nm + (lk.Mend_Nm - lk.Mmid_Nm) * ((t - 0.5) / 0.5));
    const at = (t: number): V3 => add(A3, scl(sub(B3, A3), t));
    for (let k = 0; k < n; k++) {
      const t0 = k / n;
      const t1 = (k + 1) / n;
      const s0 = P(at(t0));
      const s1 = P(at(t1));
      const mid = at((t0 + t1) / 2);
      let depth = P(mid).depth;
      // inside the housing of the joint at either end: draw it behind that joint
      for (const jj of [i, i + 1]) {
        if (jj >= jointCenter.length) continue;
        if (len(sub(mid, pose.joints[jj].pos_mm as V3)) * f.scale < jointR[jj] + 1) depth = Math.min(depth, jointDepth[jj] - 1e-6);
      }
      const color = forceColor(Mat((t0 + t1) / 2) / Mref, theme);
      const capA = k === 0;
      const capB = k === n - 1;
      const EW = LINK_W + 2.5;
      items.push({
        depth, key: `l${i}-${k}`,
        node: (
          <g className="pz-link" onPointerDown={startJoint(i)} data-joint={i}>
            <line className="pz-link-hit" x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} />
            <line className="pz-link-edge" x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} strokeWidth={EW} />
            {capA && <circle className="pz-link-cap" cx={s0.x} cy={s0.y} r={EW / 2} />}
            {capB && <circle className="pz-link-cap" cx={s1.x} cy={s1.y} r={EW / 2} />}
            <line x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} stroke={color} strokeWidth={LINK_W} />
            {capA && <circle cx={s0.x} cy={s0.y} r={LINK_W / 2} fill={color} />}
            {capB && <circle cx={s1.x} cy={s1.y} r={LINK_W / 2} fill={color} />}
          </g>
        ),
      });
      const m2 = P(mid);
      const hw = Math.abs(s1.x - s0.x) / 2 + LINK_W / 2;
      const hh = Math.abs(s1.y - s0.y) / 2 + LINK_W / 2;
      linkObstacles.push({ x1: m2.x - hw, x2: m2.x + hw, y1: m2.y - hh, y2: m2.y + hh });
    }
  });

  // joints
  const labelReqs: PoseLabelReq[] = [];
  const obstacles: Box[] = [];
  pose.joints.forEach((pj, i) => {
    const j = joints[i];
    const c = pj.pos_mm as V3;
    const a = pj.axis as V3;
    const r = rJ[i];
    const st = `pz-joint pz-st-${STATUS_CLASS[pj.status]}`;
    const center = jointCenter[i];
    const rr = jointR[i];
    let body: ReactNode;
    const axisLine = (ext: number, through: V3 = c) => {
      const e = ext / f.scale;
      const q1 = P(add(through, scl(a, -e)));
      const q2 = P(add(through, scl(a, e)));
      return <line className="dr-axis" x1={q1.x} y1={q1.y} x2={q2.x} y2={q2.y} />;
    };
    if (i === 0 && j.motion === 'yaw') {
      const t = cylinder(f, center, Z, rr, Math.max(1.5, toPx(turnH / 2)));
      body = <>{axisLine(rr + 14, [0, 0, zG / 2 + colH / 2] as V3)}{cyl(t, st)}</>;
    } else if (j.motion === 'pitch') {
      const cy = cylinder(f, c, a, r, r * 0.55);
      const facing = Math.abs(dot(a, tor));
      const cr = Math.min(3.5, r * 0.4);
      const fc = cy.front;
      body = cyl(cy, st, facing > 0.5 ? <path className="dr-cross" d={`M${fc.cx - cr} ${fc.cy - cr} l${2 * cr} ${2 * cr} m0 ${-2 * cr} l${-2 * cr} ${2 * cr}`} /> : null);
    } else if (j.motion === 'yaw') {
      body = <>{axisLine(r + 12)}{cyl(cylinder(f, c, a, r, r * 0.4), st)}</>;
    } else {
      body = <>{axisLine(rr + 14)}{cyl(cylinder(f, c, a, rr, 4), st)}</>;
    }

    // torque direction arc: around the axis, centred on the screen-up side, arrowhead in the + or - direction
    let arc: ReactNode = null;
    const share = pj.Tstatic_Nm > 1e-12 ? Math.min(1, pj.absTau_Nm / pj.Tstatic_Nm) : 0;
    if (pj.absTau_Nm > 1e-9 && share > 0.005) {
      let e1 = sub(b.up, scl(a, dot(b.up, a)));
      e1 = len(e1) > 0.2 ? unit(e1) : perpRef(a);
      const span = (50 + 230 * share) * RAD;
      const rad = (rr + 6) / f.scale;
      const off = dot(a, tor) >= 0 ? 1 : -1;
      const ac = add(center, scl(a, off * (j.motion === 'pitch' ? r * 0.55 : 0) / f.scale));
      const pts = ringPoints(ac, a, rad, e1, -span / 2, span / 2, 28);
      if (pj.tau_Nm < 0) pts.reverse();
      const s2 = pts.map((q) => P(q));
      const end = s2[s2.length - 1];
      const prev = s2[s2.length - 3];
      const dx = end.x - prev.x;
      const dy = end.y - prev.y;
      const head = Math.hypot(dx, dy) > 0.6
        ? <path className="dr-motion-head" d="M0 0 L-7 -3.2 L-7 3.2 Z" transform={`translate(${end.x} ${end.y}) rotate(${Math.atan2(dy, dx) / RAD})`} />
        : null;
      arc = (
        <g className="pz-arc" aria-hidden="true">
          <polyline className="dr-motion" points={s2.map((q) => `${q.x.toFixed(2)},${q.y.toFixed(2)}`).join(' ')} />
          {head}
        </g>
      );
    }
    const cs = P(center);
    const atStop = stop?.i === i;
    items.push({
      depth: jointDepth[i], key: `j${i}`,
      node: (
        <g className={`pz-jgrp${atStop ? ' is-stop' : ''}`} onPointerDown={startJoint(i)} data-joint={i}>
          {body}
          {arc}
          {atStop && <circle className="pz-stop" cx={cs.x} cy={cs.y} r={rr + 4} />}
        </g>
      ),
    });
    obstacles.push({ x1: cs.x - rr - 3, x2: cs.x + rr + 3, y1: cs.y - rr - 3, y2: cs.y + rr + 3 });
    const top = i === pose.worstJoint ? ' ▲' : '';
    const torque = `${u.f('torque', pj.absTau_Nm, { fixed: true })} ${u.sym('torque')}`;
    // a joint zoomed or panned out of the view gets no label
    if (cs.x >= 0 && cs.x <= W && cs.y >= 0 && cs.y <= H) labelReqs.push({
      key: i, ax: cs.x, ay: cs.y, r: rr + 4,
      full: `J${i + 1} ${torque} · ${pct(pj.util)}${top}`, short: `J${i + 1} ${pct(pj.util)}${top}`,
      importance: pj.util ?? -1, keepFull: i === pose.worstJoint,
    });
  });

  // payload cube at the tip
  const tip = pose.tip_mm as V3;
  const hs = 8 / f.scale;
  {
    const faces: { n: V3; c: V3[] }[] = [];
    const ax: V3[] = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
    for (let k = 0; k < 3; k++) {
      for (const s of [-1, 1]) {
        const nrm = scl(ax[k], s);
        const u1 = ax[(k + 1) % 3];
        const u2 = ax[(k + 2) % 3];
        const cc = add(tip, scl(nrm, hs));
        faces.push({ n: nrm, c: [[1, 1], [1, -1], [-1, -1], [-1, 1]].map(([p1, p2]) => add(cc, add(scl(u1, p1 * hs), scl(u2, p2 * hs)))) });
      }
    }
    const vis = faces.filter((fc) => dot(fc.n, tor) > 1e-6);
    const ps = P(tip);
    items.push({
      depth: ps.depth + 1e-6, key: 'payload',
      node: <g className="pz-payload">{vis.map((fc, k) => <polygon key={k} className={`pz-face pz-face-${Math.abs(fc.n[2]) > 0.5 ? 'top' : 'side'}`} points={poly(fc.c)} />)}</g>,
    });
    obstacles.push({ x1: ps.x - 14, x2: ps.x + 14, y1: ps.y - 14, y2: ps.y + 14 });
  }

  // weight arrows: depth-sorted with everything else, just in front of their mass
  if (weights) {
    const mmax = Math.max(1e-9, ...pose.masses.map((m) => m.mass_g));
    const down = projectDir(f, [0, 0, -1]);
    const dl = Math.hypot(down.x, down.y) / f.scale; // 1 = the down direction lies in the screen
    pose.masses.forEach((m, k) => {
      if (!(m.mass_g > 0)) return;
      const s0 = P(m.pos_mm as V3);
      const Lpx = 10 + 34 * (m.mass_g / mmax);
      let node: ReactNode;
      if (dl < 0.15) {
        node = <g className="pz-weight" pointerEvents="none"><circle cx={s0.x} cy={s0.y} r={4} /><path d={`M${s0.x - 2.6} ${s0.y - 2.6} l5.2 5.2 m0 -5.2 l-5.2 5.2`} /></g>;
      } else {
        const ex = s0.x + (down.x / f.scale) * Lpx; // foreshortened with the view
        const ey = s0.y + (down.y / f.scale) * Lpx;
        const ang = Math.atan2(ey - s0.y, ex - s0.x) / RAD;
        node = (
          <g className="pz-weight" pointerEvents="none">
            <line x1={s0.x} y1={s0.y} x2={ex} y2={ey} />
            <path d="M0 0 L-6 -2.8 L-6 2.8 Z" transform={`translate(${ex} ${ey}) rotate(${ang})`} />
          </g>
        );
      }
      items.push({ depth: s0.depth + 2e-6, key: `w${k}`, node });
    });
  }

  items.sort((p1, p2) => p1.depth - p2.depth);

  // labels: placed in screen space around everything drawn
  const captionBox: Box = { x1: 0, x2: 110, y1: H - 22, y2: H, text: true };
  const placed = placePoseLabels(labelReqs, [...obstacles, ...linkObstacles, captionBox], { W, H });
  const worst = pose.worstJoint;
  const aria = `Arm in 3D at the chosen pose. ${pose.joints.map((pj, i) => `J${i + 1} ${Math.round(pj.angleDeg)} degrees, ${u.fu('torque', pj.absTau_Nm, { fixed: true })}, ${pct(pj.util)} of T_des`).join('; ')}.${worst >= 0 ? ` Highest: J${worst + 1}.` : ''}`;

  return (
    <svg ref={svgRef} className={`pz-svg${dragging ? ` is-${dragging}` : ''}`} width={W} height={H} viewBox={`0 0 ${W} ${H}`}
      role="img" aria-label={aria}
      onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onLostPointerCapture={onUp}
      onAuxClick={(e) => e.preventDefault()}>
      <rect className="pz-bg" x={0} y={0} width={W} height={H} onPointerDown={startBackground} />
      <g className="pz-ground" pointerEvents="none">
        <polygon className="pz-ground-fill" points={groundPoly} />
        <g className="pz-grid">{gridLines}</g>
        <line className="pz-xaxis" x1={ax0.x} y1={ax0.y} x2={ax1.x} y2={ax1.y} />
      </g>
      {items.map((it) => <g key={it.key}>{it.node}</g>)}
      <g className="dr-labels pz-labels" pointerEvents="none">
        {placed.map((pl) => (
          <g key={pl.key}>
            {pl.lead && <line className="dr-lead" x1={pl.lead[0]} y1={pl.lead[1]} x2={pl.lead[2]} y2={pl.lead[3]} />}
            <text x={pl.box.x1} y={pl.box.y1 + LABEL_H - 3} className={`pz-label${pl.key === worst ? ' is-worst' : ''}`}
              textLength={pl.text.length * LABEL_CHAR_W} lengthAdjust="spacingAndGlyphs">{pl.text}</text>
          </g>
        ))}
      </g>
      <text className="pz-caption" x={8} y={H - 8}>{`Grid ${u.fu('length', gridStep, { dp: 0, trim: true })}`}</text>
    </svg>
  );
}

function FigLegend({ pose, theme }: { pose: PoseResult; theme: 'light' | 'dark' }) {
  const { u } = useStore();
  const stops = forceStops(theme);
  return (
    <div className="pz-legend legend">
      <div className="legend-row">
        <span className="pz-key"><i className="st-sq pz-key-ok" />≤ 85%</span>
        <span className="pz-key"><i className="st-sq pz-key-marginal" />≤ 100%</span>
        <span className="pz-key"><i className="st-sq pz-key-fail" />over 100%</span>
        <span className="muted">joints: torque here ÷ T_des</span>
      </div>
      <div className="legend-ramp">
        <span>0</span>
        <span className="legend-bar" style={{ background: `linear-gradient(90deg, ${stops.join(', ')})` }} />
        <span>{u.fu('torque', pose.Mref_Nm, { fixed: true })}</span>
      </div>
      <div className="legend-note">Links: bending moment, scaled to the worst-case maximum. Accent arcs: the direction each joint pushes. ▲ marks the highest share of T_des. Shift-drag on a joint snaps to 15°; a dashed ring means the joint is at a limit.</div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Readout table
// ---------------------------------------------------------------------------

function PoseTable({ arm, res, pose, angles }: { arm: ArmInputs; res: ArmResult; pose: PoseResult; angles: number[] }) {
  const { u } = useStore();
  const nm = u.sym('torque');
  const T = (x: number) => u.f('torque', x, { fixed: true });
  const worst = pose.worstJoint;
  return (
    <div className="pz-table">
      <ResponsiveTable threshold={620}>
        <thead>
          <tr>
            <th scope="col">Joint</th>
            <th scope="col" className="num">Angle<small>deg</small></th>
            <th scope="col" className="num">Torque at this pose<small>{nm}</small></th>
            <th scope="col" className="num">Worst-case static<small>{nm}</small></th>
            <th scope="col" className="num">T_des<small>{nm}</small></th>
            <th scope="col" className="num">% of T_des</th>
          </tr>
        </thead>
        <tbody>
          {pose.joints.map((pj, i) => (
            <tr key={pj.id} className={i === worst ? 'is-gov' : undefined}>
              <th scope="row" data-label="Joint"><JointTag joint={arm.joints[i]} index={i} /></th>
              <td className="num" data-label="Angle">{Math.round(angles[i])}°</td>
              <td className="num strong" data-label="Torque at this pose">{T(pj.tau_Nm)}<Cu>{nm}</Cu></td>
              <td className="num" data-label="Worst-case static">{T(res.joints[i]?.TstaticModel ?? 0)}<Cu>{nm}</Cu></td>
              <td className="num" data-label="T_des">{T(pj.Tdes_Nm)}<Cu>{nm}</Cu></td>
              <td className="num" data-label="% of T_des">
                <span className={`st st-${STATUS_CLASS[pj.status]}`}><i className="st-sq" aria-hidden="true" />{pct(pj.util)}</span>
                {i === worst && <span className="tag">highest</span>}
                <span className="visually-hidden"> {STATUS_TEXT[pj.status]}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
      <p className="card-foot small">
        Tip reach <strong className="mono">{u.fu('length', pose.reach_mm, { dp: 1 })}</strong> from the base axis, height{' '}
        <strong className="mono">{u.fu('length', pose.height_mm, { dp: 1 })}</strong> above {jointLabel(arm.joints[0], 0).split(' ')[0]}.
        Largest link bending here {u.fu('torque', pose.Mmax_Nm, { fixed: true })} (worst case {u.fu('torque', pose.Mref_Nm, { fixed: true })}).
      </p>
    </div>
  );
}
