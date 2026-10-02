// Motor torque and recommended ratio (CLAUDE.md Addition 8): session persistence, migration, import/export, lock modes,
// the pure UI helpers and what the screens render.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { PRESETS, defaultArmInputs, recommendRatio, type ArmInputs, type MotorSpec } from '../../calc';
import { defaultLockState, lockedCount, normalizeLockState, ratioModeOf, toEngineLocks } from '../advisorLocks';
import {
  MOTOR_PRESETS, applyPreset, makeCustom, motorChip, motorUsable, patchMotor, presetIdOf, ratioPlanFor, recommendedText, rescaleEForZp, setMotor,
} from '../motorUi';
import {
  STORAGE_KEY, defaultSession, exportSession, importSession, loadSession, normalizeSession, saveSession, type Session,
} from '../session';
import { StoreProvider } from '../store';
import { IMPERIAL, METRIC, type UnitPrefs } from '../units';
import { AdvisorLocksPanel } from '../screens/AdvisorLocksPanel';
import { AdvisorScreen } from './workbenchScreens';
import { ArmScreen } from './workbenchScreens';
import { GearboxScreen } from './workbenchScreens';
import { JointsScreen } from './workbenchScreens';

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

const NEMA17: MotorSpec = { name: 'NEMA 17 (typical)', Tpeak_Nm: 0.45, Tcont_Nm: null, maxSpeed_rpm: 1000, requiredSpeed_degps: null, efficiency: 0.85 };

function withMotor(s: Session, id: string, m: MotorSpec): Session {
  return { ...s, arm: setMotor(s.arm, id, m) };
}

function render(session: Session, Screen: ComponentType): string {
  g.window = {
    localStorage: { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(session) : null), setItem: () => {}, removeItem: () => {} },
  };
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Screen)));
}
const text = (html: string) =>
  html.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');

describe('editing the motor of a joint', () => {
  it('patchMotor creates a motor on first input and removes it when everything is cleared', () => {
    const a0 = defaultArmInputs();
    expect(a0.joints[1].motor).toBeUndefined();
    const a1 = patchMotor(a0, 'J2', { Tpeak_Nm: 0.45 });
    expect(a1.joints[1].motor).toEqual({ Tpeak_Nm: 0.45, Tcont_Nm: null, maxSpeed_rpm: null, requiredSpeed_degps: null, efficiency: 0.85 });
    expect(a1.joints[0]).toBe(a0.joints[0]); // other joints are untouched
    const a2 = patchMotor(a1, 'J2', { Tpeak_Nm: null });
    expect('motor' in a2.joints[1]).toBe(false);
    // an efficiency alone does not keep a motor alive
    const a3 = patchMotor(patchMotor(a0, 'J2', { efficiency: 0.7 }), 'J2', {});
    expect('motor' in a3.joints[1]).toBe(false);
    expect(patchMotor(a0, 'nope', { Tpeak_Nm: 1 })).toBe(a0);
  });

  it('presets fill torque and speed, keep efficiency and required speed, and read back as the preset', () => {
    let a: ArmInputs = patchMotor(defaultArmInputs(), 'J2', { efficiency: 0.8, requiredSpeed_degps: 120, Tcont_Nm: 0.2 });
    a = applyPreset(a, 'J2', 'nema23');
    const m = a.joints[1].motor!;
    expect([m.name, m.Tpeak_Nm, m.maxSpeed_rpm, m.Tcont_Nm, m.efficiency, m.requiredSpeed_degps]).toEqual(['NEMA 23 (typical)', 1.26, 1000, null, 0.8, 120]);
    expect(presetIdOf(m)).toBe('nema23');
    expect(MOTOR_PRESETS.map((p) => [p.Tpeak_Nm, p.maxSpeed_rpm])).toEqual([[0.45, 1000], [0.26, 1000], [1.26, 1000]]);
    // editing a preset's torque turns it into a custom motor
    const edited = patchMotor(a, 'J2', { Tpeak_Nm: 1.4 });
    expect(presetIdOf(edited.joints[1].motor)).toBe('custom');
    expect(edited.joints[1].motor!.name).toBe('Custom');
    // editing the continuous torque keeps the preset
    expect(presetIdOf(patchMotor(a, 'J2', { Tcont_Nm: 0.9 }).joints[1].motor)).toBe('nema23');
    expect(presetIdOf(undefined)).toBe('');
    expect(applyPreset(a, 'J2', 'bogus')).toBe(a);
  });

  it('Custom starts a blank motor that disappears again when left empty; No motor removes it', () => {
    const a = makeCustom(defaultArmInputs(), 'J3');
    expect(a.joints[2].motor).toMatchObject({ name: 'Custom', Tpeak_Nm: null });
    expect(presetIdOf(a.joints[2].motor)).toBe('custom');
    const b = patchMotor(patchMotor(a, 'J3', { Tpeak_Nm: 1 }), 'J3', { Tpeak_Nm: null });
    expect('motor' in b.joints[2]).toBe(false);
    expect('motor' in setMotor(a, 'J3', undefined).joints[2]).toBe(false);
  });
});

describe('session: motor data persists, migrates and travels in the export', () => {
  const s0 = withMotor(withMotor(defaultSession(), 'J2', NEMA17), 'J5', { Tpeak_Nm: 0.3, Tcont_Nm: 0.1, efficiency: 0.85 });
  s0.advisorLocks.J2 = { ...s0.advisorLocks.J2, ratioMotor: false };

  it('export then import keeps the motors and the ratio mode', () => {
    const out = importSession(exportSession(s0), defaultSession());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.arm.joints[1].motor).toEqual(NEMA17);
    expect(out.session.arm.joints[4].motor).toEqual({ Tpeak_Nm: 0.3, Tcont_Nm: 0.1, maxSpeed_rpm: null, requiredSpeed_degps: null, efficiency: 0.85 });
    expect('motor' in out.session.arm.joints[0]).toBe(false);
    expect(out.session.advisorLocks.J2.ratioMotor).toBe(false);
    expect(out.session.advisorLocks.J3.ratioMotor).toBeNull();
    expect(out.issues).toEqual([]);
    // the export text itself carries the motor
    expect(JSON.parse(exportSession(s0)).arm.joints[1].motor.Tpeak_Nm).toBe(0.45);
  });

  it('localStorage save and load round-trip', () => {
    const store: Record<string, string> = {};
    g.window = { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } };
    expect(saveSession(s0)).toBe(true);
    const back = loadSession();
    expect(back.arm.joints[1].motor).toEqual(NEMA17);
    expect(back.advisorLocks.J2.ratioMotor).toBe(false);
  });

  it('old sessions without motor data load with no motor and no recommendation', () => {
    const d = defaultSession();
    // format 2 as saved before Addition 8: no motor keys, lock states without ratioMotor
    const old = JSON.parse(JSON.stringify(d));
    for (const k of Object.keys(old.advisorLocks)) delete old.advisorLocks[k].ratioMotor;
    const n = normalizeSession(old);
    expect(n.arm.joints.every((j) => !('motor' in j))).toBe(true);
    expect(n.advisorLocks.J2.ratioMotor).toBeNull();
    expect(JSON.stringify(n.arm)).toBe(JSON.stringify(defaultArmInputs()));
    const plan = ratioPlanFor(n.arm.joints[1], { Treq: 5.87, Tdes: 8.81 }, n.advisorLocks.J2);
    expect(plan.rec).toBeNull();
    expect(plan.usable).toBe(false);
    expect(plan.mode).toBe('locked'); // today's default
    // a format 1 file (fixed five-joint arm) too
    const f1 = normalizeSession({ version: 1, arm: { jointMass_g: [450, 700, 577, 180, 120] } });
    expect(f1.arm.joints.every((j) => !('motor' in j))).toBe(true);
  });

  it('garbled motor data is dropped or repaired, never fatal', () => {
    const raw = JSON.parse(exportSession(defaultSession()));
    raw.arm.joints[1].motor = 'a lot';
    raw.arm.joints[2].motor = { Tpeak_Nm: 'x', maxSpeed_rpm: Infinity, efficiency: 'high' };
    raw.arm.joints[3].motor = { Tpeak_Nm: -5, efficiency: 2 };
    raw.advisorLocks.J2 = { ratioMotor: 'yes' };
    const out = importSession(JSON.stringify(raw), defaultSession());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    const j = out.session.arm.joints;
    expect('motor' in j[1]).toBe(false);
    expect(j[2].motor).toEqual({ Tpeak_Nm: null, Tcont_Nm: null, maxSpeed_rpm: null, requiredSpeed_degps: null, efficiency: 0.85 });
    expect(j[3].motor!.Tpeak_Nm).toBe(-5); // kept so the field can show its error message
    expect(out.session.advisorLocks.J2.ratioMotor).toBeNull();
    expect(motorUsable(j[3])).toBe(false);
    expect(motorUsable(j[2])).toBe(false);
  });
});

describe('advisor ratio mode "From motor"', () => {
  const load = { Treq: 5.87, Tdes: 8.81 };

  it('is the default only when the joint has usable motor data', () => {
    const lock = defaultLockState();
    expect(lock.ratioMotor).toBeNull();
    expect(ratioModeOf(lock, false)).toBe('locked');
    expect(ratioModeOf({ ...lock, on: { ...lock.on, Zp: false } }, false)).toBe('free');
    expect(ratioModeOf(lock, true)).toBe('motor');
    // the user's explicit choice wins
    expect(ratioModeOf({ ...lock, ratioMotor: false }, true)).toBe('locked');
    expect(ratioModeOf({ ...lock, ratioMotor: false, on: { ...lock.on, Zp: false } }, true)).toBe('free');
    // motor data was removed: back to the lock
    expect(ratioModeOf({ ...lock, ratioMotor: true }, false)).toBe('locked');
  });

  it('plans the Zp set from the motor and turns it into engine options', () => {
    const arm = setMotor(defaultArmInputs(), 'J2', NEMA17);
    const plan = ratioPlanFor(arm.joints[1], load, defaultLockState());
    expect(plan.mode).toBe('motor');
    expect(plan.usable).toBe(true);
    expect(plan.feasible).toBe(true);
    expect(plan.zps).toEqual([25, 26]);
    expect(plan.rec!.Zp).toBe(25);
    const e = toEngineLocks(defaultLockState(), PRESETS.J2, plan.zps);
    expect(e.zpSet).toEqual([25, 26]);
    expect(e.ratioVary).toBe(false);
    expect(e.locks.Zp).toBeUndefined();
    // without a motor set: today's behaviour
    expect(toEngineLocks(defaultLockState(), PRESETS.J2)).toEqual({ locks: { Zp: 18 }, ratioVary: false });
    expect(toEngineLocks(defaultLockState(), PRESETS.J2, [])).toEqual({ locks: { Zp: 18 }, ratioVary: false });
  });

  it('counts the ratio as locked only in Locked mode', () => {
    const lock = defaultLockState();
    expect(lockedCount(lock)).toBe(1);
    expect(lockedCount(lock, 'locked')).toBe(1);
    expect(lockedCount(lock, 'motor')).toBe(0);
    expect(lockedCount(lock, 'free')).toBe(0);
  });

  it('a servo or an incomplete motor does not restrict the ratio', () => {
    const arm = defaultArmInputs();
    const servo = setMotor(arm, 'J5', NEMA17).joints[4];
    expect(ratioPlanFor(servo, load, defaultLockState()).usable).toBe(false);
    const noPeak = patchMotor(arm, 'J2', { maxSpeed_rpm: 500 }).joints[1];
    expect(ratioPlanFor(noPeak, load, defaultLockState()).mode).toBe('locked');
  });

  it('nothing feasible: the nearest Zp is searched and the plan says so', () => {
    const arm = setMotor(defaultArmInputs(), 'J2', { ...NEMA17, requiredSpeed_degps: 360 });
    const plan = ratioPlanFor(arm.joints[1], load, defaultLockState());
    expect(plan.mode).toBe('motor');
    expect(plan.feasible).toBe(false);
    expect(plan.zps).toEqual([25]);
    expect(plan.note).toMatch(/Nearest is 24:1 \(Zp 25\)/);
  });

  it('lock states: ratioMotor survives normalization', () => {
    expect(normalizeLockState({ ratioMotor: true }).ratioMotor).toBe(true);
    expect(normalizeLockState({ ratioMotor: false }).ratioMotor).toBe(false);
    expect(normalizeLockState({ ratioMotor: 3 }).ratioMotor).toBeNull();
    expect(normalizeLockState({}).ratioMotor).toBeNull();
    expect(normalizeLockState(null)).toEqual(defaultLockState());
  });
});

describe('applying a recommended Zp keeps K1', () => {
  it('rescales e = K1·Rp/Zp_new and leaves D alone (J2: Zp 18 -> 25)', () => {
    const r = rescaleEForZp({ D: 85, e: 1.6, Zp: 18 }, 25)!;
    expect(r.k1Before).toBeCloseTo((1.6 * 18) / 42.5, 12); // 0.6776
    expect(r.e).toBeCloseTo(1.152, 4);
    expect(r.k1After).toBeCloseTo(r.k1Before, 4);
    expect(r.clamped).toBe(false);
    expect(r.unchanged).toBe(false);
    expect(rescaleEForZp({ D: 85, e: 1.6, Zp: 18 }, 18)!.unchanged).toBe(true);
  });

  it('clamps a K1 outside 0.40..0.85 into the range and says so', () => {
    const hi = rescaleEForZp({ D: 85, e: 2.5, Zp: 18 }, 25)!; // K1 1.06
    expect(hi.clamped).toBe(true);
    expect(hi.k1After).toBeCloseTo(0.85, 3);
    const lo = rescaleEForZp({ D: 85, e: 0.3, Zp: 18 }, 25)!; // K1 0.13
    expect(lo.clamped).toBe(true);
    expect(lo.k1After).toBeCloseTo(0.4, 3);
  });

  it('unusable numbers give null', () => {
    expect(rescaleEForZp({ D: 0, e: 1, Zp: 18 }, 25)).toBeNull();
    expect(rescaleEForZp({ D: 85, e: NaN, Zp: 18 }, 25)).toBeNull();
    expect(rescaleEForZp({ D: 85, e: 1, Zp: 18 }, 0)).toBeNull();
  });
});

describe('short texts', () => {
  it('recommendedText and motorChip', () => {
    const ok = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, NEMA17);
    expect(recommendedText(ok)).toEqual({ text: '24:1 (Zp 25)', reason: null });
    const warn = recommendRatio({ Treq: 2.25, Tdes: 3.38 }, NEMA17);
    expect(recommendedText(warn).text).toBe('9:1 (Zp 10)');
    expect(recommendedText(warn).reason).toMatch(/advisor/);
    const bad = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, requiredSpeed_degps: 360 });
    expect(recommendedText(bad)).toEqual({ text: '—', reason: 'No ratio fits torque and speed' });
    expect(recommendedText(null).text).toBe('—');
    expect(motorChip(null).word).toBe('NO MOTOR');
  });
});

describe('screens', () => {
  const base = (units: UnitPrefs = METRIC) => {
    const s = withMotor(defaultSession(), 'J2', { ...NEMA17, name: undefined } as MotorSpec);
    s.units = { ...units };
    return s;
  };

  it('Arm & Loads: a Motor section per joint, and the recommendation column once a motor exists', () => {
    const plain = text(render(defaultSession(), ArmScreen));
    expect(plain).toContain('Quick fill (typical motor)');
    expect(plain).toContain('Quick fill (typical values)'); // J5 is a servo
    expect(plain).not.toContain('Recommended ratio');
    expect(plain).toContain('Add a motor to a joint');
    const t = text(render(base(), ArmScreen));
    expect(t).toContain('Recommended ratio');
    expect(t).toContain('Motor margin');
    expect(t).toContain('24:1 (Zp 25)');
    expect(t).toContain('1.04×');
    expect(t).toContain('RECOMMENDED 24:1 (Zp 25)');
    expect(t).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('Arm & Loads: servo check and imperial torque', () => {
    const s = withMotor(base(IMPERIAL), 'J5', { Tpeak_Nm: 0.3, Tcont_Nm: 0.1, efficiency: 0.85 });
    const t = text(render(s, ArmScreen));
    expect(t).toContain('SERVO TOO SMALL');
    expect(t).toMatch(/Peak torque falls short: 2.66 lbf·in available, 4.21 lbf·in needed/);
    expect(t).toContain('direct drive');
  });

  it('Gearbox: the Motor & ratio card, the apply button and the overload warning', () => {
    const t = text(render(base(), GearboxScreen));
    expect(t).toContain('Motor & ratio');
    expect(t).toContain('Use recommended ratio (Zp 25)');
    expect(t).toContain('Recommended');
    expect(t).toContain('24:1');
    expect(t).toContain('Current gearbox');
    expect(t).toContain('17:1'); // J2 preset Zp 18
    expect(t).toContain('TOO WEAK'); // 17:1 gives 6.50 N·m against 8.81
    expect(t).toContain('Peak torque falls short: 6.5 N·m available, 8.81 N·m needed');
    // the button rescales e to keep K1, and says so; the second button opens the advisor
    expect(t).toContain('e 1.600 mm → 1.152 mm to keep K1 0.678. D and the rest stay put.');
    expect(t).toContain('Design this ratio in the Advisor');
    expect(t).not.toContain('Only Zp changes');
    expect(t).not.toMatch(/NaN|undefined|Infinity/);
    // already at the recommended ratio: overload warning, button disabled
    const s = base();
    s.gearboxes.J2 = { ...s.gearboxes.J2, Zp: 25 };
    const html = render(s, GearboxScreen);
    const t2 = text(html);
    expect(t2).toContain('Motor can overload this gearbox');
    expect(t2).toContain('Motor stall can exceed the gearbox design torque');
    expect(t2).toContain('Already using Zp 25');
    expect(t2).toContain('LIMIT CURRENT');
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Use recommended ratio \(Zp 25\)/);
  });

  it('Gearbox: units follow the chosen torque unit; without a motor a one-line prompt', () => {
    const t = text(render(base(IMPERIAL), GearboxScreen));
    expect(t).toMatch(/Motor · 3\.98 lbf·in peak/);
    expect(t).not.toContain('N·m peak');
    const none = text(render(defaultSession(), GearboxScreen));
    expect(none).toContain('Motor & ratio');
    // the motor fields sit right above in the same section, so the card itself only appears once a motor exists
    expect(none).toContain('Optional: enter the motor’s max torque to get a recommended gear ratio for this joint.');
    expect(none).not.toContain('Use recommended ratio');
  });

  it('All Joints: ratio and motor columns only with motor data', () => {
    const none = text(render(defaultSession(), JointsScreen));
    expect(none).not.toContain('current vs motor');
    const t = text(render(base(), JointsScreen));
    expect(t).toContain('current vs motor');
    expect(t).toContain('motor wants 24:1 (Zp 25)');
    expect(t).toContain('TOO WEAK');
    expect(t).toContain('17:1');
  });

  it('Advisor: From motor is offered and selected once the joint has a motor', () => {
    const html = render(base(), AdvisorScreen);
    const t = text(html);
    expect(t).toContain('From motor');
    expect(html).toMatch(/role="radio"[^>]*aria-checked="true"[^>]*>From motor/);
    expect(t).toContain('Motor-feasible ratios in the advisor range: 24:1 to 25:1 (Zp 25 to 26)');
    expect(t).toContain('0 of 9 locked');
    // no motor: today's plain lock toggle
    const plain = render(defaultSession(), AdvisorScreen);
    expect(text(plain)).not.toContain('From motor');
    expect(text(plain)).toContain('1 of 9 locked');
  });

  it('Advisor locks panel without a plan behaves exactly as before', () => {
    const html = render(defaultSession(), () => createElement(AdvisorLocksPanel, {
      slot: 'J2', eff: PRESETS.J2, chosen: null, running: false, hasResult: false, canRun: true, onRun: () => {}, onCancel: () => {},
    }));
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1);
  });
});
