// Pose explorer (CLAUDE.md Additions 9 and 10): a movable 3D arm in an orthographic SVG with the static gravity load at the
// chosen pose, filling the workbench stage. Display only: every gearbox check keeps using the worst case (arm straight out).
// The live angles, camera and toggles come from the workbench's PoseLiveProvider (shared with the inspector's slider).
import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import {
  computePose, clampPose, hasLimits, jointLabel, jointLimits, posePreset,
  type ArmInputs, type ArmResult, type PosePresetName, type PoseResult, type PoseStatus,
} from '../../calc';
import { Button, Cu, Notice, ResponsiveTable, Segmented } from '../components/primitives';
import { InfoTip } from '../components/InfoTip';
import { JointTag } from '../components/JointTag';
import { DASH } from '../format';
import { useStore } from '../store';
import { patchJoint } from '../armEdit';
import { PRESET_LABEL, usePoseLive } from '../workbench/poseLive';
import { forceColor, forceStops } from './colors';
import { type Box } from './armLayout';
import { JointSlider } from './JointSlider';
import { LABEL_CHAR_W, LABEL_H, placePoseLabels, type PoseLabelReq } from './poseLabels';
import {
  NO_ZOOM, VIEW_PRESETS, ZOOM_MAX, ZOOM_MIN, add, applyZoomPan, basis, boxOf, cylinder, dot, frameFromBox, knobDir, len,
  perpRef, planeAngle, project, projectDir, ringPoints, scl, sub, unionBox, unit, viewNameOf, zoomAbout,
  type Box2, type Camera, type Cyl, type Ellipse, type Frame, type V3, type ViewName, type ZoomPan,
} from './view3d';

const RAD = Math.PI / 180;
const LINK_W = 9;
const SEG_PX = 16; // links are cut into pieces about this long on screen, each depth-sorted on its own
const FILL_OV = 0.75; // px each piece's colour fill runs past its ends
const EDGE_OV = 0.4; // px each piece's outline runs past its ends (less than the fill)
const CLICK_PX = 4; // a press on a joint that moves less than this is a click (select), not a drag (rotate)
const PRESET_BUTTONS: { key: PosePresetName | 'random'; title: string; short: string }[] = [
  { key: 'ready', title: 'Upper arm up, forearm out (the drawing’s ready pose)', short: 'Ready' },
  { key: 'straight', title: 'Every angle 0: the pose all torques are computed for', short: 'Straight' },
  { key: 'folded', title: 'Tucked in', short: 'Folded' },
  { key: 'reachUp', title: 'Everything from the first pitch joint points up', short: 'Reach up' },
  { key: 'random', title: 'A random pose inside the joint limits', short: 'Random' },
];
const VIEW_OPTIONS: { value: ViewName | 'custom'; label: string; title: string }[] = [
  { value: 'side', label: 'Side', title: 'Looking along the pitch axes (like the schematic)' },
  { value: 'front', label: 'Front', title: 'Looking back along the arm' },
  { value: 'top', label: 'Top', title: 'Looking down' },
  { value: 'iso', label: 'Iso', title: 'Three-quarter view' },
];
const pct = (u: number | null) => (u == null ? DASH : `${Math.round(u * 100)}%`);
const STATUS_TEXT: Record<PoseStatus, string> = { ok: 'OK', marginal: 'MARGINAL', fail: 'OVER', none: 'N/A' };
const STATUS_CLASS: Record<PoseStatus, string> = { ok: 'ok', marginal: 'marginal', fail: 'fail', none: 'neutral' };

export { usePrefersReducedMotion } from '../workbench/poseLive';

const HOW_TO = {
  what: 'Click a joint (or the link after it) to select it; drag it to turn it. Drag the background to orbit, Shift-drag or middle-drag to pan, and scroll or pinch to zoom.',
  typical: 'Shift while dragging a joint snaps to 15°. A dashed ring means the joint is at a limit.',
};

type DragKind = 'orbit' | 'joint' | 'pan' | 'pinch';
type Drag =
  | { kind: 'orbit'; x: number; y: number; cam: Camera; id: number }
  | { kind: 'pan'; x: number; y: number; zp: ZoomPan; id: number }
  | { kind: 'pinch'; d0: number; mx: number; my: number; zp: ZoomPan }
  | { kind: 'joint'; i: number; jid: string; method: 'plane' | 'knob'; prevPhi: number | null; x: number; y: number; x0: number; y0: number; moved: boolean; acc: number; id: number };

/** Width and height of an element (the stage figure fills its box). */
function useSize<T extends HTMLElement>(initial: { w: number; h: number }): [React.RefObject<T | null>, { w: number; h: number }] {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState(initial);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const read = () => {
      const r = el.getBoundingClientRect();
      const w = Math.max(160, Math.floor(r.width));
      const h = Math.max(200, Math.floor(r.height));
      setSize((s) => (s.w === w && s.h === h ? s : { w, h }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', read);
      return () => window.removeEventListener('resize', read);
    }
    const ro = new ResizeObserver(read);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, size];
}

/**
 * The 3D arm filling the stage, with compact overlays: view, zoom and Fit at the top right; presets, Sweep, weights and
 * the "All angles" popover at the bottom; the pose-loads table in a drawer under the view (closed by default).
 */
export function PoseStage({ selectedId, onSelectJoint, anglesOpen = false }: {
  /** Joint highlighted in the view (the workbench selection) */
  selectedId?: string | null;
  /** A joint was clicked (not dragged) in the view */
  onSelectJoint?: (id: string) => void;
  /** Start with the "All angles" popover open */
  anglesOpen?: boolean;
}) {
  const { state, arm: armRes } = useStore();
  const a = state.arm;
  if (!armRes.valid || a.joints.length === 0) {
    return (
      <div className="pz-stage pz-stage-empty">
        <Notice kind="info" title="Waiting for valid arm inputs">Fix the arm inputs (the Arm item or the joint named in the error) to move the arm and see the load at each pose.</Notice>
      </div>
    );
  }
  return <PoseStageBody arm={a} res={armRes} selectedId={selectedId ?? null} onSelectJoint={onSelectJoint} anglesOpen={anglesOpen} />;
}

function PoseStageBody({ arm, res, selectedId, onSelectJoint, anglesOpen }: {
  arm: ArmInputs; res: ArmResult; selectedId: string | null; onSelectJoint?: (id: string) => void; anglesOpen: boolean;
}) {
  const { resolvedTheme, state, patchWb, updateArm } = useStore();
  const live = usePoseLive();
  const { angles, cam, setCam, zp, setZp, weights, setWeights, playing, setPlaying, stop, setStop, note, setNote, reduced, setOne, applyPreset } = live;
  const joints = arm.joints;
  const uid = useId().replace(/:/g, '');
  const [dragging, setDragging] = useState<DragKind | null>(null);
  const [showAngles, setShowAngles] = useState(anglesOpen);
  const drawer = state.wb.drawer;

  const pose = useMemo(() => computePose(arm, angles, res), [arm, res, angles]);
  const [figRef, size] = useSize<HTMLDivElement>({ w: 720, h: 520 });
  const W = size.w;
  const H = size.h;
  // room kept for the overlay controls, measured (they wrap to more rows on a narrow stage)
  const trRef = useRef<HTMLDivElement>(null);
  const blRef = useRef<HTMLDivElement>(null);
  const [insets, setInsets] = useState({ top: 48, bottom: 46 });
  useLayoutEffect(() => {
    const read = () => {
      const top = (trRef.current?.offsetHeight ?? 32) + 16;
      const bottom = (blRef.current?.offsetHeight ?? 30) + 16;
      setInsets((v) => (v.top === top && v.bottom === bottom ? v : { top, bottom }));
    };
    read();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(read);
    if (trRef.current) ro.observe(trRef.current);
    if (blRef.current) ro.observe(blRef.current);
    return () => ro.disconnect();
  }, []);
  // the arm's on-screen bounds at the current pose, written by the drawing on every render
  const armBox = useRef<{ x1: number; x2: number; y1: number; y2: number } | null>(null);
  /** +/- zoom about the arm's on-screen centre (the view centre when the arm is off-screen), so it never drifts out. */
  const zoomBy = (k: number) => setZp((z) => {
    const bx = armBox.current;
    const cx = bx ? (bx.x1 + bx.x2) / 2 : W / 2;
    const cy = bx ? (bx.y1 + bx.y2) / 2 : H / 2;
    const on = bx && cx >= 0 && cx <= W && cy >= 0 && cy <= H;
    return zoomAbout(z, k, on ? cx : W / 2, on ? cy : H / 2, W, H);
  });
  /** Fit: frame the arm's current-pose bounds with a margin (room for the labels and the overlays). */
  const fit = () => setZp((z) => {
    const bx = armBox.current;
    if (!bx) return NO_ZOOM;
    const m = Math.min(90, Math.max(40, W * 0.08));
    const bw = Math.max(bx.x2 - bx.x1, 24);
    const bh = Math.max(bx.y2 - bx.y1, 24);
    const availH = Math.max(80, H - insets.top - insets.bottom);
    const k = Math.min((W - 2 * m) / bw, (availH - 2 * m) / bh);
    const cx = (bx.x1 + bx.x2) / 2;
    const cy = (bx.y1 + bx.y2) / 2;
    const z1 = zoomAbout(z, k, cx, cy, W, H);
    // the box centre stays put under zoomAbout; then move it to the centre of the area between the overlays
    return { ...z1, px: z1.px + (W / 2 - cx), py: z1.py + (insets.top + availH / 2 - cy) };
  });

  const worst = pose.worstJoint;
  const worstText = worst >= 0 ? `J${worst + 1} ${pct(pose.joints[worst]?.util ?? null)} of T_des` : 'no load';
  const selIndex = selectedId ? joints.findIndex((j) => j.id === selectedId) : -1;
  const drawerId = `${uid}-drawer`;
  const anglesId = `${uid}-angles`;

  // Escape closes the angles popover
  useEffect(() => {
    if (!showAngles) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setShowAngles(false); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [showAngles]);

  return (
    <div className="pz-stage">
      <div className="pz-figwrap" ref={figRef}>
        <PoseSvg
          arm={arm} pose={pose} cam={cam} zp={zp} W={W} H={H} uid={uid} theme={resolvedTheme} weights={weights} dragging={dragging}
          hold={playing || dragging === 'joint'} stop={stop} armBox={armBox} selected={selIndex}
          insets={insets}
          onOrbit={(c) => setCam(c)}
          onZoomPan={setZp}
          onJoint={(i, deg) => {
            const L = jointLimits(joints[i]);
            const lim = hasLimits(joints[i]);
            setOne(i, deg);
            setStop(lim && deg < L.min - 1e-9 ? { i, side: 'min' } : lim && deg > L.max + 1e-9 ? { i, side: 'max' } : null);
          }}
          onClickJoint={(i) => { const j = joints[i]; if (j) onSelectJoint?.(j.id); }}
          onDragState={(d) => { setDragging(d); if (d) setPlaying(false); if (!d) setStop(null); if (d === 'joint') setNote(null); }}
        />

        <div className="pz-ov pz-ov-tr" ref={trRef}>
          <Segmented<ViewName | 'custom'> value={viewNameOf(cam) ?? 'custom'} onChange={(v) => { if (v !== 'custom') setCam({ ...VIEW_PRESETS[v] }); }}
            label="Camera view" size="sm" options={VIEW_OPTIONS} />
          <div className="pz-zoom" role="group" aria-label="Zoom">
            <button type="button" className="icon-btn pz-zbtn" onClick={() => zoomBy(1 / 1.25)} disabled={zp.zoom <= ZOOM_MIN + 1e-9} aria-label="Zoom out" title="Zoom out">−</button>
            <span className="pz-zval mono" aria-live="off">{Math.round(zp.zoom * 100)}%</span>
            <button type="button" className="icon-btn pz-zbtn" onClick={() => zoomBy(1.25)} disabled={zp.zoom >= ZOOM_MAX - 1e-9} aria-label="Zoom in" title="Zoom in">+</button>
            <Button size="sm" variant="secondary" onClick={fit} title="Frame the arm at its current pose">Fit</Button>
            <button type="button" className="icon-btn pz-zbtn" onClick={() => { setCam({ ...VIEW_PRESETS.side }); setZp(NO_ZOOM); }}
              aria-label="Reset view" title="Side view, zoom and pan reset">⟲</button>
            <InfoTip help={HOW_TO} label="How to move the arm" />
          </div>
        </div>

        <div className="pz-ov pz-ov-bl" ref={blRef}>
          <div className="pz-presets" role="group" aria-label="Pose presets">
            {PRESET_BUTTONS.map((p) => (
              <Button key={p.key} size="sm" variant="secondary" title={p.title} onClick={() => applyPreset(p.key)} aria-label={PRESET_LABEL[p.key]}>{p.short}</Button>
            ))}
            <Button size="sm" variant="primary" icon={playing ? 'pause' : 'play'} aria-pressed={playing}
              title={reduced ? 'Steps through the presets (reduced motion is on)' : 'Animate a smooth path through the presets'}
              onClick={() => setPlaying((x) => !x)}>
              {playing ? 'Pause' : 'Sweep'}
            </Button>
            <button type="button" className={`btn btn-secondary btn-sm pz-toggle${weights ? ' is-on' : ''}`} aria-pressed={weights}
              title="An arrow at every mass, length in proportion to the mass" onClick={() => setWeights(!weights)}>
              Weights
            </button>
            <button type="button" className={`btn btn-secondary btn-sm pz-toggle${showAngles ? ' is-on' : ''}`} aria-expanded={showAngles} aria-controls={anglesId}
              onClick={() => setShowAngles((o) => !o)} title="Every joint angle and its limits">
              All angles
            </button>
          </div>
          {reduced && <p className="muted small pz-rm">Reduced motion is on: Sweep steps through the presets.</p>}
          {note && <p className="pz-note small" role="status">{note}</p>}
        </div>

        {showAngles && (
          <div className="pz-angles popover" id={anglesId} role="dialog" aria-label="All joint angles"
            style={{ bottom: insets.bottom - 8, maxHeight: Math.max(160, H - insets.bottom - insets.top) }}>
            <div className="pz-angles-head">
              <strong className="small">Joint angles <span className="muted">(display only)</span></strong>
              <button type="button" className="icon-btn" aria-label="Close joint angles" onClick={() => setShowAngles(false)}>×</button>
            </div>
            <div className="pz-sliders">
              {joints.map((j, i) => (
                <JointSlider key={j.id} joint={j} index={i} uid={uid} angle={angles[i]} atStop={stop?.i === i ? stop.side : null}
                  onAngle={(d) => { setPlaying(false); setOne(i, d); }}
                  onLimits={(lim) => updateArm((x) => patchJoint(x, j.id, { limits: lim }))} />
              ))}
            </div>
          </div>
        )}
      </div>

      <section className={`pz-drawer${drawer ? ' is-open' : ''}`} aria-label="Pose loads">
        <h3 className="pz-drawer-h">
          <button type="button" className="pz-drawer-toggle" aria-expanded={drawer} aria-controls={drawerId} onClick={() => patchWb({ drawer: !drawer })}>
            <span className="pz-drawer-title">Pose loads</span>
            <span className={`pz-drawer-sum st st-${worst >= 0 ? STATUS_CLASS[pose.joints[worst].status] : 'neutral'}`}>
              <i className="st-sq" aria-hidden="true" />{worstText}
            </span>
            <span className="pz-drawer-chev" aria-hidden="true">{drawer ? '▾' : '▴'}</span>
          </button>
        </h3>
        {drawer && (
          <div className="pz-drawer-body" id={drawerId}>
            <PoseTable arm={arm} res={res} pose={pose} angles={angles} />
            <FigLegend pose={pose} theme={resolvedTheme} />
            <p className="card-foot muted small">
              The gearbox checks always use the worst case (arm straight out, the T_static column), whatever the joint limits. This view shows the static
              gravity load at the chosen pose only: no dynamics (α·I), so a joint can need more while it accelerates.
              Positive torque means the joint pushes in its + angle direction; + pitch lifts the link.
            </p>
          </div>
        )}
      </section>
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
  /** Receives the arm's on-screen bounds (joints, link ends, tip) every render */
  armBox: { current: { x1: number; x2: number; y1: number; y2: number } | null };
  /** A joint being dragged against one of its limits */
  stop: { i: number; side: 'min' | 'max' } | null;
  /** Index of the selected joint (ringed), or -1 */
  selected: number;
  /** Screen space kept clear for the overlay controls when framing the arm, px */
  insets?: { top: number; bottom: number };
  /** A joint was pressed and released without moving (a click) */
  onClickJoint: (i: number) => void;
  onOrbit: (c: Camera) => void;
  onZoomPan: (z: ZoomPan) => void;
  onJoint: (i: number, deg: number) => void;
  onDragState: (d: DragKind | null) => void;
}

const clean = (x: number) => (Number.isFinite(x) && x > 0 ? Math.min(x, 1e7) : 0);

function PoseSvg({ arm, pose, cam, zp, W, H, uid, theme, weights, dragging, hold, stop, armBox, selected, insets, onOrbit, onZoomPan, onJoint, onClickJoint, onDragState }: SvgProps) {
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
  const it = insets ?? { top: 0, bottom: 0 };
  const base = frameFromBox(b, box, W, Math.max(120, H - it.top - it.bottom), 34);
  const f: Frame = applyZoomPan({ ...base, oy: base.oy + it.top }, zp, W, H);
  const frameRef = useRef(f);
  frameRef.current = f;
  const poseRef = useRef(pose);
  poseRef.current = pose;
  {
    // the arm's on-screen bounds for the zoom buttons and Fit: joints (with their symbol radius) and the tip
    let x1 = Infinity, x2 = -Infinity, y1 = Infinity, y2 = -Infinity;
    pose.joints.forEach((pj) => { const q = project(f, pj.pos_mm as V3); x1 = Math.min(x1, q.x - 16); x2 = Math.max(x2, q.x + 16); y1 = Math.min(y1, q.y - 16); y2 = Math.max(y2, q.y + 16); });
    const t = project(f, pose.tip_mm as V3);
    x1 = Math.min(x1, t.x - 12); x2 = Math.max(x2, t.x + 12); y1 = Math.min(y1, t.y - 12); y2 = Math.max(y2, t.y + 12);
    armBox.current = Number.isFinite(x1) ? { x1, x2, y1, y2 } : null;
  }
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
    drag.current = { kind: 'joint', i, jid: joints[i].id, method, prevPhi, x, y, x0: x, y0: y, moved: false, acc: pj.angleDeg, id: e.pointerId };
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
    // a press that has not moved past the threshold is still a click: the joint does not turn yet
    if (!d.moved) {
      if (Math.hypot(x - d.x0, y - d.y0) < CLICK_PX) return;
      d.moved = true;
    }
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
    if (d.id === e.pointerId) {
      drag.current = null;
      onDragState(null);
      if (d.kind === 'joint' && !d.moved && e.type === 'pointerup') onClickJoint(d.i);
    }
  };

  // the wheel (and a trackpad pinch, which arrives as ctrl + wheel) zooms about the pointer: the view fills the stage, which does not scroll
  const onWheelRef = useRef<(e: WheelEvent) => void>(() => {});
  onWheelRef.current = (e: WheelEvent) => {
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
      // Neighbouring pieces overlap a little in screen space so no hairline shows between them at any zoom. The colour fill
      // overlaps more than the outline, so whichever neighbour is drawn last, its fill covers the other's outline end.
      const sl = Math.hypot(s1.x - s0.x, s1.y - s0.y);
      const ux = sl > 1e-9 ? (s1.x - s0.x) / sl : 0;
      const uy = sl > 1e-9 ? (s1.y - s0.y) / sl : 0;
      const capA = k === 0;
      const capB = k === n - 1;
      const EW = LINK_W + 2.5;
      items.push({
        depth, key: `l${i}-${k}`,
        node: (
          <g className="pz-link" onPointerDown={startJoint(i)} data-joint={i}>
            <line className="pz-link-hit" x1={s0.x} y1={s0.y} x2={s1.x} y2={s1.y} />
            <line className="pz-link-edge" x1={s0.x - ux * EDGE_OV} y1={s0.y - uy * EDGE_OV} x2={s1.x + ux * EDGE_OV} y2={s1.y + uy * EDGE_OV} strokeWidth={EW} />
            {capA && <circle className="pz-link-cap" cx={s0.x} cy={s0.y} r={EW / 2} />}
            {capB && <circle className="pz-link-cap" cx={s1.x} cy={s1.y} r={EW / 2} />}
            <line x1={s0.x - ux * FILL_OV} y1={s0.y - uy * FILL_OV} x2={s1.x + ux * FILL_OV} y2={s1.y + uy * FILL_OV} stroke={color} strokeWidth={LINK_W} />
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
    const axisLine = (ext: number, through: V3 = c) => {
      const e = ext / f.scale;
      const q1 = P(add(through, scl(a, -e)));
      const q2 = P(add(through, scl(a, e)));
      return <line className="dr-axis" x1={q1.x} y1={q1.y} x2={q2.x} y2={q2.y} />;
    };
    // the housing cylinder, its axis and its half length along that axis (px)
    let cy: Cyl;
    let hPx: number;
    let axisEl: ReactNode = null;
    let frontExtra: ReactNode = null;
    if (i === 0 && j.motion === 'yaw') {
      hPx = Math.max(1.5, toPx(turnH / 2));
      cy = cylinder(f, center, Z, rr, hPx);
      axisEl = axisLine(rr + 14, [0, 0, zG / 2 + colH / 2] as V3);
    } else if (j.motion === 'pitch') {
      hPx = r * 0.55;
      cy = cylinder(f, c, a, r, hPx);
      const cr = Math.min(3.5, r * 0.4);
      const fc = cy.front;
      if (Math.abs(dot(a, tor)) > 0.5) frontExtra = <path className="dr-cross" d={`M${fc.cx - cr} ${fc.cy - cr} l${2 * cr} ${2 * cr} m0 ${-2 * cr} l${-2 * cr} ${2 * cr}`} />;
    } else if (j.motion === 'yaw') {
      hPx = r * 0.4;
      cy = cylinder(f, c, a, r, hPx);
      axisEl = axisLine(r + 12);
    } else {
      hPx = 4;
      cy = cylinder(f, c, a, rr, hPx);
      axisEl = axisLine(rr + 14);
    }
    const cylAxis = i === 0 && j.motion === 'yaw' ? Z : a;
    const capOff = scl(cylAxis, (cy.frontSign * hPx) / f.scale);

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
    // Three depth-sorted parts, so a joint interleaves correctly with an overlapping neighbour: the back cap (with the
    // axis line) at the back cap's depth, the side at the centre, the front cap (cross, torque arc, stop ring) at the front cap's depth.
    const grab = startJoint(i);
    items.push({
      depth: P(sub(center, capOff)).depth, key: `j${i}b`,
      node: <g className={`pz-jpart ${st}`} onPointerDown={grab} data-joint={i}>{axisEl}{ell(cy.back, 'pz-cap pz-back')}</g>,
    });
    items.push({
      depth: jointDepth[i], key: `j${i}s`,
      node: <g className={`pz-jpart ${st}`} onPointerDown={grab} data-joint={i}><polygon className="pz-side" points={cy.side.map((q) => q.join(',')).join(' ')} /></g>,
    });
    items.push({
      depth: P(add(center, capOff)).depth + 1e-9, key: `j${i}f`,
      node: (
        <g className={`pz-jgrp${atStop ? ' is-stop' : ''}`} onPointerDown={grab} data-joint={i}>
          <g className={st}>{ell(cy.front, 'pz-cap')}{frontExtra}</g>
          {arc}
          {atStop && <circle className="pz-stop" cx={cs.x} cy={cs.y} r={rr + 4} />}
          {selected === i && <circle className="pz-selring" cx={cs.x} cy={cs.y} r={rr + 7} />}
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
  const capY = H - 8 - it.bottom;
  const captionBox: Box = { x1: 0, x2: 110, y1: capY - 14, y2: capY + 8, text: true };
  // the overlay controls cover the top-right corner and the bottom strip: keep labels out of them
  const overlayBoxes: Box[] = it.top > 0 || it.bottom > 0
    ? [{ x1: Math.max(0, W - 440), x2: W, y1: 0, y2: it.top }, { x1: 0, x2: W, y1: H - it.bottom, y2: H }]
    : [];
  const placed = placePoseLabels(labelReqs, [...obstacles, ...linkObstacles, captionBox, ...overlayBoxes], { W, H });
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
      <text className="pz-caption" x={8} y={capY}>{`Grid ${u.fu('length', gridStep, { dp: 0, trim: true })}`}</text>
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
