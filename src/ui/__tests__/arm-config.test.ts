// Configurable arm in the session: per-joint gearboxes / advisor state follow the joint list, old sessions migrate
// without loss, and the screens (chips, All Joints, Gearbox, Advisor, Arm) follow the dynamic list.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import {
  closestPresetId, computeArm, defaultArmInputs, defaultGearboxInputs, presetInputs, PRESETS, summarizeAllJoints, type ArmInputs,
} from '../../calc';
import { computeArm as legacyCompute, defaultArmInputs as legacyDefault } from '../../calc/__tests__/legacyArm';
import { addJoint, moveJoint, patchJoint, removeJoint, setMotion } from '../armEdit';
import { defaultLockState } from '../advisorLocks';
import {
  defaultSession, effectiveInputs, exportSession, importSession, loadSession, normalizeSession, reconcileSession, saveSession,
  slotLabel, slotsOf, STORAGE_KEY, type Session,
} from '../session';
import { StoreProvider } from '../store';
import { AdvisorScreen } from './workbenchScreens';
import { ArmScreen } from './workbenchScreens';
import { GearboxScreen } from './workbenchScreens';
import { JointsScreen } from './workbenchScreens';
import { Rail } from '../workbench/Rail';
import { Inspector } from '../workbench/Inspector';
import { EAGER_BODIES } from '../workbench/eager';
import { createElement as h } from 'react';

const InspectorOnly = () => h(Inspector, { bodies: EAGER_BODIES, forceOpen: true });

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

/** A session after the arm was edited the way the store does it. */
const edit = (s: Session, fn: (a: ArmInputs) => ArmInputs): Session => reconcileSession({ ...s, arm: fn(s.arm) });

describe('adding, removing and retyping joints keeps the per-joint state in step', () => {
  it('a new cycloidal joint gets a gearbox from the closest preset, a toggle and locks, and says where it started', () => {
    const s0 = defaultSession();
    const s = edit(s0, (a) => addJoint(a, 'pitch'));
    const id = s.arm.joints[5].id;
    expect(id).toBe('J6');
    expect(slotsOf(s)).toEqual(['J1', 'J2', 'J3', 'J4', 'J6', 'custom']);
    expect(s.useArmLoads.J6).toBe(true);
    expect(s.advisorLocks.J6).toEqual(defaultLockState());
    // the previous tool becomes a link and the new joint's own tool is the last link; its arm-model torque picks the preset
    const Treq = computeArm(s.arm).joints[5].Treq;
    const want = closestPresetId(Treq);
    expect(s.presetBase.J6).toBe(want);
    expect(s.gearboxes.J6).toEqual(PRESETS[want]);
    expect(s.gearboxes.J6).not.toBe(PRESETS[want]);
    // everything else is untouched
    for (const k of ['J1', 'J2', 'J3', 'J4', 'custom']) expect(s.gearboxes[k]).toBe(s0.gearboxes[k]);
  });

  it('removing a joint deletes its gearbox, advisor state and toggle; other joints and ids stay', () => {
    let s = defaultSession();
    s.gearboxes.J3.D = 71;
    s.advisorLocks.J3.on.D = true;
    s = edit(s, (a) => removeJoint(a, 'J2'));
    expect(s.arm.joints.map((j) => j.id)).toEqual(['J1', 'J3', 'J4', 'J5']);
    expect(Object.keys(s.gearboxes).sort()).toEqual(['J1', 'J3', 'J4', 'custom']);
    expect(Object.keys(s.advisorLocks).sort()).toEqual(['J1', 'J3', 'J4', 'custom']);
    expect(Object.keys(s.useArmLoads).sort()).toEqual(['J1', 'J3', 'J4']);
    expect(s.gearboxes.J3.D).toBe(71);
    expect(s.advisorLocks.J3.on.D).toBe(true);
    // the selected slot (J2 by default) was removed: fall back to the first gearbox joint
    expect(s.selected).toBe('J1');
    // adding again never reuses J2
    s = edit(s, (a) => addJoint(a, 'roll'));
    expect(s.arm.joints.at(-1)!.id).toBe('J6');
    expect(removeJoint(defaultArmInputs(), 'nope')).toEqual(defaultArmInputs());
    const one = { ...defaultArmInputs(), joints: [defaultArmInputs().joints[0]] };
    expect(removeJoint(one, 'J1')).toBe(one); // the last joint cannot be removed
  });

  it('a servo joint has no slot but keeps its gearbox, so switching back restores it', () => {
    let s = defaultSession();
    s.gearboxes.J3.D = 71;
    s.selected = 'J3';
    s = edit(s, (a) => patchJoint(a, 'J3', { drive: 'servo' }));
    expect(slotsOf(s)).toEqual(['J1', 'J2', 'J4', 'custom']);
    expect(s.selected).toBe('J1');
    expect(s.gearboxes.J3.D).toBe(71);
    s = edit(s, (a) => patchJoint(a, 'J3', { drive: 'cycloidal' }));
    expect(slotsOf(s)).toEqual(['J1', 'J2', 'J3', 'J4', 'custom']);
    expect(s.gearboxes.J3.D).toBe(71);
    // the wrist servo becoming cycloidal gets a fresh gearbox (J5 is not a SPEC preset id)
    s = edit(s, (a) => patchJoint(a, 'J5', { drive: 'cycloidal' }));
    expect(slotsOf(s)).toContain('J5');
    expect(s.presetBase.J5).toBeDefined();
    expect(s.gearboxes.J5).toEqual(PRESETS[s.presetBase.J5]);
  });

  it('renaming and reordering change labels, never ids or stored gearboxes', () => {
    let s = defaultSession();
    s = edit(s, (a) => patchJoint(a, 'J3', { name: 'Elbow' }));
    expect(slotLabel(s.arm, 'J3')).toBe('J3 Elbow');
    s = edit(s, (a) => moveJoint(a, 'J3', -1));
    expect(s.arm.joints.map((j) => j.id)).toEqual(['J1', 'J3', 'J2', 'J4', 'J5']);
    expect(slotLabel(s.arm, 'J3')).toBe('J2 Elbow'); // position follows the list
    expect(s.gearboxes.J3).toEqual(PRESETS.J3);
    expect(moveJoint(s.arm, 'J1', -1)).toBe(s.arm);
    expect(moveJoint(s.arm, 'J5', 1)).toBe(s.arm);
  });

  it('retyping follows an auto name, keeps a typed one', () => {
    const a = addJoint(defaultArmInputs(), 'pitch');
    const id = a.joints[5].id;
    expect(a.joints[5].name).toBe('pitch');
    expect(setMotion(a, id, 'roll').joints[5].name).toBe('roll');
    const named = patchJoint(a, id, { name: 'Wrist 2' });
    expect(setMotion(named, id, 'roll').joints[5].name).toBe('Wrist 2');
    expect(setMotion(named, id, 'roll').joints[5].motion).toBe('roll');
  });

  it('the arm is capped at 8 joints', () => {
    let a = defaultArmInputs();
    for (let i = 0; i < 6; i++) a = addJoint(a, 'pitch');
    expect(a.joints).toHaveLength(8);
    expect(addJoint(a, 'roll')).toBe(a);
  });

  it('the effective inputs of an added joint use the arm torques (toggle on) or its own (off)', () => {
    const s = edit(defaultSession(), (a) => addJoint(a, 'pitch'));
    const arm = computeArm(s.arm);
    const load = arm.joints[5];
    expect(effectiveInputs(s, 'J6', arm).Treq).toBe(load.Treq);
    s.useArmLoads.J6 = false;
    expect(effectiveInputs(s, 'J6', arm).Treq).toBe(s.gearboxes.J6.Treq);
  });
});

describe('sessions saved before the configurable arm load without loss', () => {
  /** The shape the previous version exported and stored: fixed arm arrays, gearboxes J1..J4 + custom, locks, toggles. */
  function oldSession() {
    const arm = legacyDefault();
    arm.payload_g = 400;
    arm.jointMass_g[2] = 610;
    arm.barLength_mm[1] = 250;
    arm.alpha[3] = 5;
    arm.linkOffset_mm = [22, 18];
    arm.override[1] = { Treq: 7, Tdes: null };
    const gb: Record<string, unknown> = {};
    for (const k of ['J1', 'J2', 'J3', 'J4', 'custom']) gb[k] = structuredClone(k === 'custom' ? defaultGearboxInputs() : presetInputs(k as 'J1'));
    (gb.J3 as { D: number }).D = 66;
    (gb.J3 as { Treq: number }).Treq = 2.1;
    (gb.custom as { Zp: number }).Zp = 20;
    const locks: Record<string, unknown> = {};
    for (const k of ['J1', 'J2', 'J3', 'J4', 'custom']) locks[k] = defaultLockState();
    (locks.J3 as { on: Record<string, boolean> }).on.D = true;
    (locks.J3 as { values: Record<string, unknown> }).values.D = 64;
    return {
      app: 'cycloidal-gearbox-designer', version: 1, exportedAt: '2026-09-01T00:00:00.000Z', arm, gearboxes: gb,
      useArmLoads: { J1: true, J2: false, J3: true, J4: true }, selected: 'J3',
      advisor: { target: 0.8, ratioVary: false, Dmin: 30, Dmax: 150, minPinClearance: 1, altWindowMm: 15 },
      advisorLocks: locks,
    };
  }

  it('an old export imports: arm numbers, per-joint gearboxes, locks, toggles and selection are all kept', () => {
    const old = oldSession();
    const out = importSession(JSON.stringify(old), defaultSession());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const s = out.session;
    expect(out.issues).toEqual([]);
    expect(s.arm.joints.map((j) => j.id)).toEqual(['J1', 'J2', 'J3', 'J4', 'J5']);
    expect(s.arm.joints.map((j) => `${j.motion}/${j.drive}`)).toEqual(['yaw/cycloidal', 'pitch/cycloidal', 'pitch/cycloidal', 'roll/cycloidal', 'pitch/servo']);
    expect(s.arm.payload_g).toBe(400);
    expect(s.arm.joints[2].mass_g).toBe(610);
    expect(s.arm.joints[1].length_mm).toBe(250);
    expect(s.arm.joints[3].alpha).toBe(5);
    expect(s.arm.joints[1].linkOffset_mm).toBe(22);
    expect(s.arm.joints[2].linkOffset_mm).toBe(18);
    expect(s.arm.joints[1].override).toEqual({ Treq: 7, Tdes: null });
    expect(slotsOf(s)).toEqual(['J1', 'J2', 'J3', 'J4', 'custom']);
    expect(s.gearboxes.J3.D).toBe(66);
    expect(s.gearboxes.J3.Treq).toBe(2.1);
    expect(s.gearboxes.custom.Zp).toBe(20);
    expect(s.gearboxes.J2).toEqual(PRESETS.J2);
    expect(s.useArmLoads).toEqual({ J1: true, J2: false, J3: true, J4: true });
    expect(s.selected).toBe('J3');
    expect(s.advisorLocks.J3.on.D).toBe(true);
    expect(s.advisorLocks.J3.values.D).toBe(64);
    expect(s.advisor.target).toBe(0.8);
    // the loads the engine computes are the ones the old engine computed
    const was = legacyCompute(old.arm);
    const now = computeArm(s.arm);
    now.joints.forEach((j, i) => {
      expect(j.Treq).toBeCloseTo(was.joints[i].Treq, 12);
      expect(j.Tdes).toBeCloseTo(was.joints[i].Tdes, 12);
      expect(j.bearingTiltMoment_Nm).toBeCloseTo(was.joints[i].bearingTiltMoment_Nm, 12);
    });
    // and the all-joints table works on it
    const sum = summarizeAllJoints(s.arm, s.gearboxes, { useArmLoads: s.useArmLoads });
    expect(sum.rows.map((r) => r.joint)).toEqual(['J1', 'J2', 'J3', 'J4']);
    expect(sum.servos.map((r) => r.joint)).toEqual(['J5']);
    expect(sum.rows[1].loadsFromArm).toBe(false);
  });

  it('an old localStorage payload loads (and is rewritten in the new format on the next save)', () => {
    const store: Record<string, string> = { [STORAGE_KEY]: JSON.stringify(oldSession()) };
    g.window = { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } };
    const s = loadSession();
    expect(s.arm.joints).toHaveLength(5);
    expect(s.gearboxes.J3.D).toBe(66);
    expect(saveSession(s)).toBe(true);
    const saved = JSON.parse(store[STORAGE_KEY]);
    expect(Array.isArray(saved.arm.joints)).toBe(true);
    expect(saved.arm.jointMass_g).toBeUndefined();
    expect(loadSession()).toEqual(s);
  });

  it('old sessions without locks, link offsets or toggles still load', () => {
    const old = oldSession() as Record<string, unknown>;
    delete old.advisorLocks;
    delete old.useArmLoads;
    delete (old.arm as Record<string, unknown>).linkOffset_mm;
    const s = normalizeSession(old);
    expect(s.advisorLocks.J2).toEqual(defaultLockState());
    expect(s.useArmLoads).toEqual({ J1: true, J2: true, J3: true, J4: true });
    expect(s.arm.joints[1].linkOffset_mm).toBe(15);
  });

  it('a new export round-trips: joints, ids, gearboxes of added joints, preset base', () => {
    let s = edit(defaultSession(), (a) => addJoint(a, 'roll'));
    s = edit(s, (a) => patchJoint(a, 'J6', { name: 'tool roll', mass_g: 222 }));
    s = edit(s, (a) => patchJoint(a, 'J3', { drive: 'servo' }));
    s.gearboxes.J6.D = 52;
    s.useArmLoads.J6 = false;
    s.selected = 'J6';
    const txt = exportSession(s);
    const o = JSON.parse(txt);
    expect(o.version).toBe(2);
    expect(o.arm.joints).toHaveLength(6);
    const out = importSession(txt, defaultSession());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.arm).toEqual(s.arm);
    expect(out.session.gearboxes).toEqual(s.gearboxes);
    expect(out.session.presetBase).toEqual(s.presetBase);
    expect(out.session.useArmLoads).toEqual(s.useArmLoads);
    expect(out.session.selected).toBe('J6');
    expect(out.session.advisorLocks).toEqual(s.advisorLocks);
  });

  it('a joint list with ids that have no stored gearbox is repaired, and stray gearboxes are dropped', () => {
    const base = JSON.parse(exportSession(defaultSession()));
    base.arm.joints.push({ id: 'X9', name: 'extra', motion: 'roll', drive: 'cycloidal', mass_g: 100, alpha: 3, linkOffset_mm: 15, length_mm: 50, linkMass_g: 20, override: { Treq: null, Tdes: null } });
    base.gearboxes.GHOST = { D: 99 };
    base.advisorLocks.GHOST = defaultLockState();
    base.selected = 'GHOST';
    const s = normalizeSession(base);
    expect(slotsOf(s)).toEqual(['J1', 'J2', 'J3', 'J4', 'X9', 'custom']);
    expect(s.gearboxes.GHOST).toBeUndefined();
    expect(s.advisorLocks.GHOST).toBeUndefined();
    expect(s.gearboxes.X9).toBeDefined();
    expect(s.selected).toBe('J2');
  });
});

// ---------------------------------------------------------------------------
// Screens follow the joint list
// ---------------------------------------------------------------------------

function render(session: Session, Screen: ComponentType): string {
  g.window = {
    localStorage: { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(session) : null), setItem: () => {}, removeItem: () => {} },
  };
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Screen)));
}
const text = (html: string) => html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const railLabels = (html: string) => [...html.matchAll(/class="rail-main"[^>]*aria-label="([^"]*)"/g)].map((m) => m[1]);

describe('screens follow the dynamic joint list', () => {
  /** 6 joints: yaw, pitch(servo), pitch, roll, pitch, roll(servo) with a renamed joint */
  function sixDof(): Session {
    let s = defaultSession();
    s = edit(s, () => ({
      ...s.arm,
      joints: [
        { ...s.arm.joints[0] },
        { ...s.arm.joints[1], name: 'Shoulder', drive: 'servo' },
        { ...s.arm.joints[2], name: 'Elbow' },
        { ...s.arm.joints[3] },
        { ...s.arm.joints[4], drive: 'cycloidal' },
        { ...addJoint(s.arm, 'roll', 'servo').joints[5], name: 'Spin' },
      ],
    }));
    s.selected = 'J3';
    return s;
  }

  it('the rail lists every joint in order with its drive and the renamed labels, then Custom; gearbox slots are the cycloidal ones', () => {
    const s = sixDof();
    expect(slotsOf(s)).toEqual(['J1', 'J3', 'J4', 'J5', 'custom']);
    const rail = render(s, Rail);
    const rows = railLabels(rail).filter((l) => /^J\d/.test(l));
    expect(rows.map((l) => l.split(',')[0])).toEqual(['J1 base yaw', 'J2 Shoulder', 'J3 Elbow', 'J4 forearm roll', 'J5 wrist pitch', 'J6 Spin']);
    expect(rows.map((l) => l.split(', ')[2])).toEqual(['Cycloidal', 'Servo', 'Cycloidal', 'Cycloidal', 'Cycloidal', 'Servo']);
    expect(railLabels(rail)).toContain('Custom gearbox');
    // the inspector of the selected gearbox slot: its name, and the gearbox sections
    const html = render(s, GearboxScreen);
    expect(html).toMatch(/<span class="insp-jpos mono">J3<\/span><input[^>]*value="Elbow"/);
    expect(text(html)).toContain('Gearbox design');
    // a servo joint shows only Joint & link, Motor & ratio and Loads
    const servo = { ...s, wb: { ...s.wb, sel: 'J2' } };
    const st = text(render(servo, InspectorOnly));
    expect(st).toContain('Joint & link');
    expect(st).toContain('Loads');
    expect(st).not.toContain('Gearbox design');
    expect(st).not.toContain('Design Advisor');
  });

  it('All Joints lists gearbox rows and "servo" rows in arm order', () => {
    const t = text(render(sixDof(), JointsScreen));
    const order = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6'].map((j) => t.indexOf(` ${j} `));
    for (const i of order) expect(i).toBeGreaterThan(0);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(t).toContain('Shoulder');
    expect(t).toContain('Spin');
    expect(t.match(/Direct-drive servo, no gearbox check/g)).toHaveLength(2);
    expect(t).toContain('4 gearboxes, 2 servos');
  });

  it('Arm & Loads shows DOF, one card per joint, a servo requirement card per servo, and 8 joints disables Add', () => {
    const s = sixDof();
    const html = render(s, ArmScreen);
    const t = text(html);
    expect(t).toContain('DOF 6');
    expect(html.match(/class="insp-name"/g)).toHaveLength(6); // one joint inspector (name, motion, drive, fields) per joint
    expect(t).toContain('J2 Shoulder servo requirement');
    expect(t).toContain('J6 Spin servo requirement');
    expect(t).not.toContain('J5 wrist pitch servo requirement');
    expect(text(render(defaultSession(), ArmScreen))).toContain('Tool length, joint to tip');
    let full = defaultSession();
    full = edit(full, (a) => addJoint(addJoint(addJoint(a, 'pitch'), 'roll'), 'yaw'));
    expect(full.arm.joints).toHaveLength(8);
    expect(render(full, ArmScreen)).toMatch(/<button[^>]*disabled=""[^>]*>\+ Add joint<\/button>/);
  });

  it('an added joint says which preset it started from on the Gearbox page', () => {
    const s = edit(defaultSession(), (a) => addJoint(a, 'pitch'));
    s.selected = 'J6';
    const t = text(render(s, GearboxScreen));
    expect(t).toContain('Started from a preset');
    expect(t).toContain('J6');
    expect(render(s, GearboxScreen)).toMatch(/<input[^>]*placeholder="pitch" aria-label="Name of J6"/); // unnamed: shown as its motion
  });

  it('a one-joint arm renders every screen', () => {
    const s = defaultSession();
    s.arm = { ...s.arm, joints: [s.arm.joints[1]] };
    const one = normalizeSession(JSON.parse(JSON.stringify({ ...s })));
    expect(one.arm.joints).toHaveLength(1);
    expect(slotsOf(one)).toEqual(['J2', 'custom']);
    for (const Screen of [ArmScreen, GearboxScreen, AdvisorScreen, JointsScreen]) {
      const html = render(one, Screen);
      expect(html).not.toMatch(/NaN|Infinity|undefined|\[object/);
    }
  });

  it('a servo-only arm renders every screen and offers only Custom', () => {
    let s = defaultSession();
    s = edit(s, (a) => ({ ...a, joints: a.joints.map((j) => ({ ...j, drive: 'servo' as const })) }));
    expect(slotsOf(s)).toEqual(['custom']);
    expect(s.selected).toBe('custom');
    for (const Screen of [ArmScreen, GearboxScreen, AdvisorScreen, JointsScreen]) {
      expect(render(s, Screen)).not.toMatch(/NaN|Infinity|undefined|\[object/);
    }
    expect(text(render(s, JointsScreen))).toContain('No cycloidal joints');
  });
});

describe('the arm drawing for chains of 1 to 8 joints', () => {
  const MOTIONS: Record<string, ('yaw' | 'pitch' | 'roll')[]> = {
    '1 joint': ['pitch'],
    '3-DOF': ['yaw', 'pitch', 'pitch'],
    '6-DOF': ['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll'],
    '8-DOF': ['yaw', 'pitch', 'pitch', 'roll', 'pitch', 'roll', 'pitch', 'roll'],
    'no pitch': ['yaw', 'roll', 'yaw'],
    'roll first': ['roll', 'yaw', 'pitch', 'yaw', 'pitch'],
  };
  for (const [name, motions] of Object.entries(MOTIONS)) {
    for (const pose of ['ready', 'worst'] as const) {
      it(`${name}, ${pose}: one symbol per joint, a label per joint, finite coordinates, labels inside the canvas`, () => {
        const base = defaultSession();
        const joints = motions.map((motion, i) => ({
          ...base.arm.joints[Math.min(i, 4)], id: `J${i + 1}`, name: `joint ${i + 1}`, motion, drive: 'cycloidal' as const,
        }));
        const s = normalizeSession({ ...base, arm: { ...base.arm, joints }, armPose: pose });
        const html = render(s, ArmScreen);
        const fig = html.slice(html.indexOf('<div class="armfig">'), html.indexOf('</svg>', html.indexOf('<div class="armfig">')));
        expect(fig).not.toMatch(/NaN|Infinity|undefined/);
        const pitch = motions.filter((m) => m === 'pitch').length;
        const roll = motions.filter((m) => m === 'roll').length;
        // pitch circles and in-chain yaw circles, and roll collars (the base yaw is a turntable, not a circle)
        expect(fig.match(/class="dr-roll"/g)?.length ?? 0).toBe(roll);
        const circles = fig.match(/class="dr-joint"><circle/g)?.length ?? 0;
        const inChainYaw = motions.filter((m, i) => m === 'yaw' && i > 0).length;
        expect(circles).toBe(pitch + inChainYaw);
        for (let i = 1; i <= motions.length; i++) expect(fig).toContain(`J${i} joint ${i}`);
        // every text sits inside the canvas
        const w = Number(/<svg width="(\d+)"/.exec(fig)![1]);
        const h = Number(/<svg width="\d+" height="(\d+)"/.exec(fig)![1]);
        for (const m of fig.matchAll(/<text x="(-?[\d.]+)" y="(-?[\d.]+)"/g)) {
          expect(Number(m[1])).toBeGreaterThan(-1);
          expect(Number(m[1])).toBeLessThan(w + 1);
          expect(Number(m[2])).toBeGreaterThan(-1);
          expect(Number(m[2])).toBeLessThan(h + 1);
        }
      });
    }
  }
});
