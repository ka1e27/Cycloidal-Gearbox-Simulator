// Pose explorer (CLAUDE.md Addition 9): display-only session state, the 3D projection helper, and the card on the
// Arm & Loads page for chains of 1 to 8 joints in metric and imperial.
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { defaultSession, exportSession, importSession, normalizePoseView, normalizeSession, STORAGE_KEY, type Session } from '../session';
import { IMPERIAL, METRIC } from '../units';
import { StoreProvider } from '../store';
import { Stage } from '../workbench/Stage';
import { PoseExplorer } from './workbenchScreens';
import { placePoseLabels, LABEL_CHAR_W } from '../viz/poseLabels';
import { NO_ZOOM, VIEW_PRESETS, ZOOM_MAX, ZOOM_MIN, applyZoomPan, basis, clampCamera, dot, fitFrame, knobDir, planeAngle, project, viewNameOf, zoomAbout, type V3 } from '../viz/view3d';
import { hit } from '../viz/armLayout';

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });
function render(session: Session, Screen: () => unknown = PoseExplorer): string {
  g.window = { localStorage: { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(session) : null), setItem: () => {}, removeItem: () => {} } };
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Screen as never)));
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('pose view session state', () => {
  it('old sessions load without it; garbage is cleaned; it is never exported; import keeps the current one', () => {
    const old = defaultSession() as Partial<Session>;
    delete old.poseView;
    const s = normalizeSession(JSON.parse(JSON.stringify(old)));
    expect(s.poseView).toEqual({ angles: {}, az: 0, el: 0, weights: true, zoom: 1, px: 0, py: 0 });
    expect(normalizePoseView({ angles: { J2: 400, J3: NaN, J4: 'x', J5: -30 }, az: 999, el: -5, weights: 'no', zoom: 50, px: NaN, py: 1e9 }))
      .toEqual({ angles: { J2: 180, J5: -30 }, az: 180, el: 0, weights: true, zoom: 8, px: 0, py: 1e5 });
    expect(normalizePoseView({ zoom: 0.01, px: 12.5, py: -40 })).toMatchObject({ zoom: 0.25, px: 12.5, py: -40 });
    expect(normalizePoseView(null)).toEqual({ angles: {}, az: 0, el: 0, weights: true, zoom: 1, px: 0, py: 0 });
    const mine = { ...defaultSession(), poseView: { angles: { J2: 12 }, az: 30, el: 20, weights: false, zoom: 2.5, px: 30, py: -12 } };
    expect(exportSession(mine)).not.toContain('poseView');
    const imp = importSession(exportSession(defaultSession()), mine);
    expect(imp.ok && imp.session.poseView).toEqual(mine.poseView);
  });
});

describe('3D projection helper', () => {
  it('side view: x right, z up, depth toward the viewer at -y; front looks from +x; top looks down', () => {
    const s = basis(VIEW_PRESETS.side);
    expect(s.right).toEqual([1, 0, 0]);
    expect(s.up.map((x) => Math.round(x * 1e12) / 1e12 + 0)).toEqual([0, 0, 1]);
    expect(dot(s.toward, [0, -1, 0])).toBeCloseTo(1, 12);
    expect(basis(VIEW_PRESETS.front).toward[0]).toBeCloseTo(1, 12);
    expect(basis(VIEW_PRESETS.top).toward[2]).toBeCloseTo(1, 12);
    for (const c of [VIEW_PRESETS.iso, { az: 123, el: 45 }]) {
      const b = basis(c);
      expect(dot(b.right, b.up)).toBeCloseTo(0, 12);
      expect(dot(b.right, b.toward)).toBeCloseTo(0, 12);
      expect(dot(b.up, b.up)).toBeCloseTo(1, 12);
    }
    expect(viewNameOf({ az: 0, el: 0 })).toBe('side');
    expect(viewNameOf({ az: 10, el: 0 })).toBeNull();
    expect(clampCamera({ az: 190, el: 120 })).toEqual({ az: -170, el: 90 });
  });
  it('fitFrame keeps the points inside the canvas; the drag angle about a pitch axis in the side view is the screen angle', () => {
    const b = basis(VIEW_PRESETS.side);
    const pts: V3[] = [[0, 0, 0], [500, 0, 0], [0, 0, 300]];
    const f = fitFrame(b, pts, 600, 400, 20);
    for (const p of pts) {
      const s = project(f, p);
      expect(s.x).toBeGreaterThanOrEqual(19.99); expect(s.x).toBeLessThanOrEqual(580.01);
      expect(s.y).toBeGreaterThanOrEqual(19.99); expect(s.y).toBeLessThanOrEqual(380.01);
    }
    // pitch axis -y faces the viewer: the pointer at 45 deg up-right of the joint is +45 deg about -y
    const c = project(f, [0, 0, 0]);
    const a: V3 = [0, -1, 0];
    const p0 = planeAngle(f, [0, 0, 0], a, c.x + 50, c.y)!;
    const p1 = planeAngle(f, [0, 0, 0], a, c.x + 50, c.y - 50)!;
    expect(((p1.phi - p0.phi) * 180) / Math.PI).toBeCloseTo(45, 9);
    // a vertical yaw axis seen from the side: grabbing the front and moving right turns it +q
    expect(knobDir(f, [0, 0, 1]).x).toBeCloseTo(1, 12);
  });
});

describe('the 3D arm in the workbench stage', () => {
  it('the stage loads the 3D view lazily: tabs and a light placeholder in the static render', () => {
    const html = render(defaultSession(), () => createElement(Stage));
    const t = text(html);
    for (const tab of ['3D arm', 'Schematic', 'Disc', 'Summary']) expect(t).toContain(tab);
    expect(html).toMatch(/role="tab" id="stage-tab-3d" aria-selected="true"/);
    expect(t).toContain('Loading the view');
    expect(t).toContain('Pick a joint on the left or in the 3D view');
  });
  const chains: Record<string, ('yaw' | 'pitch' | 'roll')[]> = {
    '1 joint': ['pitch'],
    '3-DOF': ['yaw', 'pitch', 'pitch'],
    '7-DOF': ['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll', 'pitch'],
    '8-DOF': ['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll', 'pitch', 'roll'],
    'no pitch': ['yaw', 'roll', 'yaw'],
  };
  for (const [name, motions] of Object.entries(chains)) {
    for (const units of [METRIC, IMPERIAL]) {
      it(`${name} / ${units.torque}: a joint symbol and a slider per joint, the readout table, finite coordinates`, () => {
        const base = defaultSession();
        const joints = motions.map((motion, i) => ({ ...base.arm.joints[Math.min(i, 4)], id: `J${i + 1}`, motion, drive: 'cycloidal' as const }));
        const s = normalizeSession({ ...base, arm: { ...base.arm, joints }, units, wb: { ...base.wb, drawer: true }, poseView: { angles: { J2: 33 }, az: -38, el: 26, weights: true, zoom: 1.5, px: 10, py: 0 } });
        const html = render(s);
        const card = html;
        expect(card).not.toMatch(/NaN|Infinity|undefined/);
        expect(card.match(/class="pz-jgrp"/g)).toHaveLength(motions.length);
        expect(card.match(/type="range"/g)).toHaveLength(motions.length);
        const t = text(card);
        expect(t).toContain('Pose loads');
        expect(t).toContain('Torque at this pose');
        expect(t).toContain('Worst-case static');
        expect(t).toMatch(/Tip reach/);
        if (units === IMPERIAL) expect(t).not.toMatch(/\d\s?(N·m|mm)\b/);
        for (const m of card.matchAll(/ (?:x|y|cx|cy|x1|y1|x2|y2)="(-?[\d.e+-]+)"/g)) expect(Number.isFinite(Number(m[1]))).toBe(true);
      });
    }
  }
  it('an invalid arm shows a note instead of the view', () => {
    const s = defaultSession();
    s.arm = { ...s.arm, payload_g: -5 };
    const t = text(render(s));
    expect(t).toContain('Waiting for valid arm inputs');
  });
  it('joint limits: the slider range follows them and a stored angle outside is shown clamped', () => {
    const s = defaultSession();
    s.arm = { ...s.arm, joints: s.arm.joints.map((j) => (j.id === 'J2' ? { ...j, limits: { min: -30, max: 60 } } : j)) };
    s.poseView = { angles: { J2: 90 }, az: 0, el: 0, weights: true, zoom: 1, px: 0, py: 0 };
    s.wb = { ...s.wb, drawer: true };
    const html = render(normalizeSession(JSON.parse(JSON.stringify(s))));
    expect(html).toMatch(/type="range" min="-30" max="60" step="1"[^>]*value="60"/);
    expect(text(html)).toContain('Limits -30° … 60°');
    expect(text(html)).toMatch(/J2 shoulder pitch 60°/); // the table shows the clamped angle
  });
});

describe('zoom and pan', () => {
  it('zoomAbout keeps the pointer fixed, clamps to 0.25..8, and applyZoomPan maps it', () => {
    const b = basis(VIEW_PRESETS.side);
    const f0 = fitFrame(b, [[0, 0, 0], [400, 0, 300]], 600, 400, 20);
    const pt: V3 = [123, 0, 77];
    const s0 = project(f0, pt);
    let z = zoomAbout(NO_ZOOM, 2.5, s0.x, s0.y, 600, 400);
    const s1 = project(applyZoomPan(f0, z, 600, 400), pt);
    expect(s1.x).toBeCloseTo(s0.x, 9);
    expect(s1.y).toBeCloseTo(s0.y, 9);
    expect(z.zoom).toBe(2.5);
    for (let k = 0; k < 20; k++) z = zoomAbout(z, 2, 10, 10, 600, 400);
    expect(z.zoom).toBe(ZOOM_MAX);
    for (let k = 0; k < 40; k++) z = zoomAbout(z, 0.5, 10, 10, 600, 400);
    expect(z.zoom).toBe(ZOOM_MIN);
    expect(applyZoomPan(f0, NO_ZOOM, 600, 400)).toEqual(f0);
  });
});

describe('label placement', () => {
  const crowd = (n: number, spread: number) => Array.from({ length: n }, (_, i) => ({
    key: i, ax: 100 + (i % 3) * spread, ay: 50 + Math.floor(i / 3) * spread, r: 10,
    full: `J${i + 1} 12.34 N·m · ${10 + i}%`, short: `J${i + 1} ${10 + i}%`, importance: i, keepFull: i === 5,
  }));
  it('labels never overlap each other when there is room, and the worst one keeps its full text', () => {
    const out = placePoseLabels(crowd(8, 70), [], { W: 700, H: 500 });
    expect(out).toHaveLength(8);
    for (let a = 0; a < out.length; a++) for (let c = a + 1; c < out.length; c++) expect(hit(out[a].box, out[c].box, 0)).toBe(false);
    expect(out.every((o) => !o.short)).toBe(true);
    for (const o of out) expect(o.box.x2 - o.box.x1).toBeCloseTo(o.text.length * LABEL_CHAR_W, 6);
  });
  it('a tight canvas shortens the less important labels first, never the worst one', () => {
    const out = placePoseLabels(crowd(8, 8), [], { W: 230, H: 120 }).map((o) => o);
    expect(out.find((o) => o.key === 5)!.short).toBe(false);
    expect(out.find((o) => o.key === 5)!.text).toContain('N·m');
    expect(out.some((o) => o.short)).toBe(true);
    for (const o of out) { expect(o.box.x1).toBeGreaterThanOrEqual(0); expect(o.box.x2).toBeLessThanOrEqual(230); }
  });
});
