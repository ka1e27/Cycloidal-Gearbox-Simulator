import { afterEach, describe, expect, it } from 'vitest';
import { checkGearbox, computeArm } from '../../calc';
import { checkValue, hours, num, torque, util } from '../format';
import { IMPERIAL, METRIC } from '../units';
import {
  defaultSession,
  effectiveInputs,
  exportSession,
  importSession,
  loadSession,
  normalizeSession,
  saveSession,
  STORAGE_KEY,
} from '../session';

const g = globalThis as unknown as { window?: unknown };

afterEach(() => {
  delete g.window;
});

describe('session persistence', () => {
  it('round-trips through export and import', () => {
    const s = defaultSession();
    s.arm.payload_g = 420;
    s.gearboxes.J3.D = 72;
    s.useArmLoads.J2 = false;
    s.selected = 'custom';
    const out = importSession(exportSession(s), defaultSession());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.arm.payload_g).toBe(420);
    expect(out.session.gearboxes.J3.D).toBe(72);
    expect(out.session.useArmLoads.J2).toBe(false);
    expect(out.session.selected).toBe('custom');
    expect(out.issues).toEqual([]);
  });

  it('gives friendly errors for bad files and never throws', () => {
    const cur = defaultSession();
    for (const text of ['', '{bad', 'null', '[1,2]', '42', '{"hello":1}', '"str"']) {
      const out = importSession(text, cur);
      expect(out.ok, text).toBe(false);
      if (!out.ok) expect(out.error.length).toBeGreaterThan(10);
    }
    const future = importSession(JSON.stringify({ version: 9, arm: {} }), cur);
    expect(future.ok).toBe(false);
  });

  it('normalizes garbage fields from a hand-edited file and reports invalid values', () => {
    const out = importSession(
      JSON.stringify({
        arm: { payload_g: 'lots', jointMass_g: [1, 2, null, 'x'], SF: -3 },
        gearboxes: { J3: { Zp: 'abc', D: 70, discs: 5, outerPin: 'nope' }, J9: { D: 1 } },
        selected: 'J7',
        advisor: { target: 5, ratioVary: 'yes' },
      }),
      defaultSession(),
    );
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.selected).toBe('J2');
    expect(out.session.advisor.target).toBe(1);
    expect(out.session.advisor.ratioVary).toBe(false);
    expect(out.session.gearboxes.J3.Zp).toBe(18);
    expect(out.session.gearboxes.J3.D).toBe(70);
    expect(out.session.arm.SF).toBe(-3); // a number, so kept; reported as an issue instead
    expect(out.issues.length).toBeGreaterThan(0);
    // the engine must still cope with every slot
    for (const slot of ['J1', 'J2', 'J3', 'J4', 'custom'] as const) {
      expect(() => checkGearbox(out.session.gearboxes[slot])).not.toThrow();
    }
    expect(() => computeArm(out.session.arm)).not.toThrow();
  });

  it('normalizeSession survives non-objects', () => {
    for (const bad of [null, undefined, 3, 'x', [], () => 1]) {
      expect(normalizeSession(bad)).toEqual(defaultSession());
    }
  });

  it('works when localStorage throws on every access', () => {
    const boom = () => {
      throw new Error('storage blocked');
    };
    g.window = { localStorage: { getItem: boom, setItem: boom, removeItem: boom } };
    expect(loadSession()).toEqual(defaultSession());
    expect(saveSession(defaultSession())).toBe(false);
  });

  it('works when there is no window at all', () => {
    expect(loadSession()).toEqual(defaultSession());
    expect(saveSession(defaultSession())).toBe(false);
  });

  it('loads a saved session and ignores corrupt JSON', () => {
    const store = new Map<string, string>();
    g.window = {
      localStorage: {
        getItem: (k: string) => store.get(k) ?? null,
        setItem: (k: string, v: string) => void store.set(k, v),
        removeItem: (k: string) => void store.delete(k),
      },
    };
    const s = defaultSession();
    s.wb = { ...s.wb, sel: 'J3', stage: 'disc', open: { advisor: true }, inspW: 500 };
    s.theme = 'dark';
    expect(saveSession(s)).toBe(true);
    const back = loadSession();
    expect(back.wb).toMatchObject({ sel: 'J3', stage: 'disc', open: { advisor: true }, inspW: 500 });
    expect(back.theme).toBe('dark');
    store.set(STORAGE_KEY, '{not json');
    expect(loadSession()).toEqual(defaultSession());
  });
});

describe('units in the session', () => {
  it('export stays SI whatever the display units are, and says so', () => {
    const a = defaultSession();
    const b = defaultSession();
    b.units = { ...IMPERIAL };
    const ja = JSON.parse(exportSession(a));
    const jb = JSON.parse(exportSession(b));
    expect(jb.arm).toEqual(ja.arm);
    expect(jb.gearboxes).toEqual(ja.gearboxes);
    expect(jb.gearboxes.J2.D).toBe(85);
    expect(jb.note).toMatch(/SI/);
    expect('units' in jb).toBe(false);
  });

  it('keeps the display units of the person importing and saves them with the session', () => {
    const cur = defaultSession();
    cur.units = { ...IMPERIAL };
    const out = importSession(exportSession(defaultSession()), cur);
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.session.units).toEqual(IMPERIAL);
    const round = normalizeSession(JSON.parse(JSON.stringify(cur)));
    expect(round.units).toEqual(IMPERIAL);
    expect(normalizeSession({ units: { length: 'cubit' } }).units).toEqual(METRIC);
  });

  it('switching units never changes the stored design', () => {
    const s = defaultSession();
    const before = JSON.stringify(s.gearboxes) + JSON.stringify(s.arm);
    for (const u of [IMPERIAL, METRIC, { ...METRIC, length: 'in' as const }]) s.units = u;
    expect(JSON.stringify(s.gearboxes) + JSON.stringify(s.arm)).toBe(before);
  });
});

describe('effective inputs', () => {
  it('applies arm torques only while the toggle is on and the arm is valid', () => {
    const s = defaultSession();
    const arm = computeArm(s.arm);
    const on = effectiveInputs(s, 'J2', arm);
    expect(on.Treq).toBeCloseTo(arm.joints[1].Treq, 12);
    expect(on.Tdes).toBeCloseTo(arm.joints[1].Tdes, 12);
    s.useArmLoads.J2 = false;
    const off = effectiveInputs(s, 'J2', arm);
    expect(off.Treq).toBe(5.85);
    expect(off.Tdes).toBe(8.8);
    expect(effectiveInputs(s, 'custom', arm)).toBe(s.gearboxes.custom);
    const bad = computeArm({ ...s.arm, SF: -1 });
    s.useArmLoads.J2 = true;
    expect(effectiveInputs(s, 'J2', bad).Treq).toBe(5.85);
  });

  it('SPEC check: J2 with D 85, e 1.3, 1 disc and manual 5.85 / 8.8 N*m fails at 497 / 327 MPa', () => {
    const s = defaultSession();
    s.useArmLoads.J2 = false;
    s.gearboxes.J2 = { ...s.gearboxes.J2, e: 1.3, discs: 1 };
    const r = checkGearbox(effectiveInputs(s, 'J2', computeArm(s.arm)));
    expect(r.verdict).toBe('fail');
    const ring = r.checks.find((c) => c.id === 'ringContactStrength')!;
    const life = r.checks.find((c) => c.id === 'ringContactLife')!;
    expect(ring.value).toBeGreaterThan(497 * 0.98);
    expect(ring.value).toBeLessThan(497 * 1.02);
    expect(life.value).toBeGreaterThan(327 * 0.98);
    expect(life.value).toBeLessThan(327 * 1.02);
  });
});

describe('number formatting', () => {
  it('never prints NaN or Infinity', () => {
    const bad = [NaN, Infinity, -Infinity, null, undefined];
    for (const x of bad) {
      for (const s of [num(x), torque(x), util(x as number), checkValue('ringContactStrength', x as number, 'MPa')]) {
        expect(s).not.toMatch(/NaN|Infinity/);
      }
    }
    expect(hours(Infinity)).toBe('> 10⁹ h');
    expect(hours(4632.4)).toBe('4,632 h');
    expect(hours(2.5e6)).toBe('2.5 M h');
    expect(util(99)).toBe('> 99');
    expect(checkValue('cusp', Infinity, 'mm')).toBe('no convex lobe');
  });
});
