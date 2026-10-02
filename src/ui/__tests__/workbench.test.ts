// Workbench layout (CLAUDE.md Addition 10): its display-only session state and the migration from the old 01-04 step,
// the URL hash, the joint statuses, the section summaries and what each kind of selection shows.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { presetInputs } from '../../calc';
import { addJoint } from '../armEdit';
import { computeArmResult, defaultSession, exportSession, importSession, normalizeSession, reconcileSession, STORAGE_KEY, type Session } from '../session';
import { StoreProvider } from '../store';
import { IMPERIAL } from '../units';
import { Inspector } from '../workbench/Inspector';
import { EAGER_BODIES } from '../workbench/eager';
import { Rail, JointStrip } from '../workbench/Rail';
import { jointStatus } from '../workbench/status';
import {
  defaultWorkbench, formatHash, normalizeWorkbench, parseHash, workbenchFromStep, INSP_MAX, INSP_MIN,
} from '../workbench/wbState';

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });
function render(session: Session, el: () => ReturnType<typeof h>): string {
  g.window = { localStorage: { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(session) : null), setItem: () => {}, removeItem: () => {} } };
  const C = () => el();
  return renderToStaticMarkup(h(StoreProvider, null, h(C)));
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('workbench session state', () => {
  it('defaults: J2 selected, 3D stage, Gearbox design and Checks open, 420 px inspector, drawer closed', () => {
    const s = defaultSession();
    expect(s.wb).toEqual(defaultWorkbench());
    expect(s.wb).toMatchObject({ sel: 'J2', stage: '3d', inspW: 420, drawer: false, railCollapsed: false });
    expect(s.wb.open).toMatchObject({ design: true, checks: true });
    expect(s.wb.open.advisor).toBeFalsy();
    expect('step' in s).toBe(false);
  });

  it('old sessions with a step land on the place that now holds that page', () => {
    const old = (step: number, selected = 'J3') => {
      const raw = JSON.parse(JSON.stringify(defaultSession())) as Record<string, unknown>;
      delete raw.wb;
      return normalizeSession({ ...raw, step, selected });
    };
    expect(old(1).wb).toMatchObject({ sel: 'arm', stage: '3d' });
    expect(old(2).wb).toMatchObject({ sel: 'J3', stage: '3d', open: { design: true, checks: true } });
    expect(old(3).wb).toMatchObject({ sel: 'J3', open: { advisor: true } });
    expect(old(4).wb).toMatchObject({ sel: 'J3', stage: 'summary' });
    expect(old(2, 'custom').wb.sel).toBe('custom');
    expect(workbenchFromStep('x', 'J1').sel).toBe('J1');
  });

  it('garbage is cleaned; the width is clamped; a selection the arm no longer has falls back to the Arm item', () => {
    const w = normalizeWorkbench({ sel: 7, stage: 'nope', open: { checks: 'yes', advisor: true, bogus: true }, inspW: 5000, railCollapsed: 1, drawer: true, mobile: 'x' });
    expect(w.sel).toBe('J2');
    expect(w.stage).toBe('3d');
    expect(w.open).toEqual({ advisor: true });
    expect(w.inspW).toBe(INSP_MAX);
    expect(normalizeWorkbench({ inspW: 10 }).inspW).toBe(INSP_MIN);
    expect(w.drawer).toBe(true);
    expect(w.railCollapsed).toBe(false);
    const s = defaultSession();
    expect(reconcileSession({ ...s, wb: { ...s.wb, sel: 'J9' } }).wb.sel).toBe('arm');
    expect(reconcileSession({ ...s, wb: { ...s.wb, sel: 'J5' } }).wb.sel).toBe('J5'); // a servo joint can be selected
    expect(reconcileSession({ ...s, wb: { ...s.wb, sel: 'custom' } }).wb.sel).toBe('custom');
  });

  it('is display only: never exported, and an import keeps the current layout', () => {
    const mine = defaultSession();
    mine.wb = { ...mine.wb, sel: 'J4', stage: 'schematic', inspW: 600, open: { solver: true } };
    expect(exportSession(mine)).not.toContain('"wb"');
    expect(exportSession(mine)).not.toContain('"step"');
    const file = JSON.parse(exportSession(defaultSession()));
    file.step = 3; // an old export that still carries a step does not move the layout
    const imp = importSession(JSON.stringify(file), mine);
    expect(imp.ok && imp.session.wb).toEqual(mine.wb);
  });
});

describe('URL hash', () => {
  it('round-trips selections and sections', () => {
    expect(formatHash('J2')).toBe('#/joint/J2');
    expect(formatHash('J2', 'advisor')).toBe('#/joint/J2/advisor');
    expect(formatHash('arm', 'checks')).toBe('#/arm');
    expect(formatHash('custom', 'dxf')).toBe('#/custom/dxf');
    expect(parseHash('#/joint/J2/advisor')).toEqual({ sel: 'J2', section: 'advisor' });
    expect(parseHash('#/joint/J7')).toEqual({ sel: 'J7', section: undefined });
    expect(parseHash('#/custom/solver')).toEqual({ sel: 'custom', section: 'solver' });
    expect(parseHash('#/arm')).toEqual({ sel: 'arm' });
    expect(parseHash('#/summary')).toEqual({ stage: 'summary' });
    expect(parseHash('#/joint/J2/bogus')).toEqual({ sel: 'J2', section: undefined });
    expect(parseHash('')).toBeNull();
    expect(parseHash('#assumptions')).toBeNull();
  });
});

describe('joint status dots', () => {
  it('gearbox verdict per cycloidal joint, the servo check, and a motor warning when it is worse', () => {
    const s = defaultSession();
    const arm = computeArmResult(s.arm);
    const st = s.arm.joints.map((j, i) => jointStatus(s, arm, j, i));
    expect(st.map((x) => x.kind)).toEqual(['ok', 'marginal', 'marginal', 'ok', 'neutral']);
    expect(st[1].text).toMatch(/^J2 shoulder pitch: gearbox MARGINAL 0\.9\d \(ring-pin contact fatigue\)$/);
    expect(st[4].word).toBe('NO SERVO DATA');
    // a NEMA 17 on J2 at 17:1 falls short: the motor is worse than the gearbox verdict
    const m = defaultSession();
    m.arm.joints[1].motor = { name: 'NEMA 17 (typical)', Tpeak_Nm: 0.45, Tcont_Nm: null, maxSpeed_rpm: 1000, requiredSpeed_degps: null, efficiency: 0.85 };
    const s2 = jointStatus(m, computeArmResult(m.arm), m.arm.joints[1], 1);
    expect(s2.kind).toBe('fail');
    expect(s2.word).toBe('TOO WEAK');
    // a servo with enough torque
    m.arm.joints[4].motor = { Tpeak_Nm: 2, Tcont_Nm: 1, maxSpeed_rpm: null, requiredSpeed_degps: null, efficiency: 0.85 };
    expect(jointStatus(m, computeArmResult(m.arm), m.arm.joints[4], 4).word).toBe('SERVO OK');
    // invalid gearbox inputs
    const bad = defaultSession();
    bad.useArmLoads.J3 = false;
    bad.gearboxes.J3 = { ...presetInputs('J3'), Zp: 3 };
    expect(jointStatus(bad, computeArmResult(bad.arm), bad.arm.joints[2], 2)).toMatchObject({ kind: 'fail', word: 'INVALID' });
  });

  it('the rail: Arm, one row per joint with motion, drive tag and a labelled dot, the selected row marked, then Summary and Custom', () => {
    const html = render(defaultSession(), () => h(Rail));
    const t = text(html);
    expect(t).toContain('Arm');
    for (const n of ['J1', 'J2', 'J3', 'J4', 'J5']) expect(t).toContain(n);
    expect(html.match(/class="rail-dot dot-/g)).toHaveLength(5);
    expect(html).toMatch(/aria-current="true"[^>]*aria-label="J2 shoulder pitch, Pitch, Cycloidal, status marginal"/);
    expect(html).toMatch(/title="J2 shoulder pitch: gearbox MARGINAL/);
    expect(t).toMatch(/servo/i);
    expect(t).toContain('+ Add joint');
    expect(t).toContain('Summary');
    expect(t).toContain('Custom gearbox');
    expect(html).toContain('aria-label="Actions for J2"');
  });

  it('the narrow strip lists the same joints with dots', () => {
    const html = render(defaultSession(), () => h(JointStrip));
    expect(html.match(/class="strip-chip/g)?.length).toBe(1 + 5 + 1 + 1);
    expect(html.match(/class="rail-dot dot-/g)).toHaveLength(5);
  });
});

describe('inspector', () => {
  const insp = (s: Session) => render(s, () => h(Inspector, { bodies: EAGER_BODIES }));

  it('default J2: header, verdict badge, chip bar, Gearbox design and Checks open, the rest collapsed with live summaries', () => {
    const html = insp(defaultSession());
    const t = text(html);
    expect(html).toMatch(/aria-label="Name of J2" value="shoulder pitch"/);
    expect(t).toMatch(/MARGINAL max 0\.9\d · ring-pin contact fatigue/);
    for (const c of ['Joint', 'Motor', 'Loads', 'Design', 'Checks', 'Disc', 'Solver', 'Advisor', 'DXF']) expect(t).toContain(c);
    // open: the inputs and the checks table
    expect(t).toContain('Pin circle diameter');
    expect(t).toContain('Ring contact, strength');
    // collapsed sections show a one-line summary and no body
    expect(t).toMatch(/Joint & link i? ?700 g · link 230 mm \/ 110 g/);
    expect(t).toMatch(/Motor & ratio i? ?no motor/);
    expect(t).toMatch(/Loads i? ?T_des 8\.81 N·m · arm/);
    expect(t).toMatch(/Disc & charts i? ?θ 0° · \d+ of 18 pins loaded/);
    expect(t).toMatch(/Min-size solver i? ?not run/);
    expect(t).toMatch(/Design Advisor i? ?not run/);
    expect(t).toMatch(/Export DXF i? ?5 parts \+ sheet · mm/);
    expect(t).not.toContain('Run advisor');
    expect(html.match(/aria-expanded="true"/g)?.length).toBeGreaterThanOrEqual(2);
  });

  it('summaries follow the units, and closed sections show the gearbox summary', () => {
    const s = defaultSession();
    s.units = { ...IMPERIAL };
    s.wb = { ...s.wb, open: {} };
    const t = text(insp(s));
    expect(t).toMatch(/Gearbox design D 3\.346 · e 0\.0630 · 17:1 · 2 discs/);
    expect(t).toMatch(/Checks i? ?MARGINAL 0\.9\d · ring-pin contact fatigue/);
    expect(t).toMatch(/Loads i? ?T_des 77\.\d\d lbf·in/);
  });

  it('a servo joint shows Joint & link, Motor & ratio and Loads only; Custom shows the gearbox sections only; the Arm item its settings', () => {
    const s = defaultSession();
    s.wb = { ...s.wb, sel: 'J5', open: { loads: true } };
    const servo = text(insp(s));
    for (const x of ['Joint & link', 'Motor & ratio', 'Loads', 'servo requirement']) expect(servo).toContain(x);
    for (const x of ['Gearbox design', 'Checks', 'Design Advisor', 'Export DXF']) expect(servo).not.toContain(x);
    s.wb = { ...s.wb, sel: 'custom', open: { design: true } };
    const custom = text(insp(s));
    expect(custom).toContain('Custom gearbox');
    for (const x of ['Gearbox design', 'Checks', 'Disc & charts', 'Min-size solver', 'Design Advisor', 'Export DXF']) expect(custom).toContain(x);
    expect(custom).not.toContain('Joint & link');
    expect(custom).toContain('Working torque'); // Custom types its torques in Gearbox design
    s.wb = { ...s.wb, sel: 'arm', open: { armSettings: true, armTorques: true } };
    const arm = text(insp(s));
    for (const x of ['Payload at tool tip', 'Service factor', 'DOF 5', 'Total arm mass', 'Torque each joint must carry', '+ Add joint']) expect(arm).toContain(x);
  });

  it('a joint added at the tip can be selected and shows its own sections', () => {
    let s = defaultSession();
    s = reconcileSession({ ...s, arm: addJoint(s.arm, 'pitch') });
    s.wb = { ...s.wb, sel: 'J6', open: { design: true } };
    const t = text(insp(s));
    expect(t).toContain('Started from a preset');
  });
});
