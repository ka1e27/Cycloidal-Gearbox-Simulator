// Design Advisor locks in the UI layer: session persistence (old sessions load), the lock model, and a real render of the table.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { adviseDesign, checkGearbox, presetInputs, PRESETS, JOINT_IDS } from '../../calc';
import {
  defaultLockState, lockAllToInputs, lockErrors, lockRowError, normalizeLockState, resolveLockValues, toEngineLocks, unlockAll,
  bearingFromInputs, innerPinFromInputs, outerPinFromInputs,
} from '../advisorLocks';
import { defaultSession, exportSession, importSession, loadSession, normalizeSession, saveSession, slotsOf, STORAGE_KEY, type Session } from '../session';

const SLOTS = slotsOf(defaultSession());
import { StoreProvider } from '../store';
import { Alternatives, Hero } from '../screens/AdvisorScreen';
import { AdvisorLocksPanel } from '../screens/AdvisorLocksPanel';
import { IMPERIAL, METRIC, type UnitPrefs } from '../units';

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

const strip = (r: unknown) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'elapsedMs' ? 0 : v)));

describe('lock state model', () => {
  it('defaults: ratio locked at the current Zp, everything else free, so the default run is today\'s advisor', () => {
    const d = defaultLockState();
    expect(d.on.Zp).toBe(true);
    for (const k of ['D', 'e', 'outerPin', 'innerPin', 'Zw', 'L', 'discs', 'bearing'] as const) expect(d.on[k], k).toBe(false);
    expect(d.limitOn).toBe(false);
    const inp = PRESETS.J3;
    const { locks, ratioVary } = toEngineLocks(d, inp);
    expect(locks).toEqual({ Zp: inp.Zp });
    expect(ratioVary).toBe(false);
    expect(strip(adviseDesign(inp, { locks, ratioVary }))).toEqual(strip(adviseDesign(inp)));
  });

  it('a free ratio means the advisor tries Zp 12..26', () => {
    const s = defaultLockState();
    s.on.Zp = false;
    const { locks, ratioVary } = toEngineLocks(s, PRESETS.J3);
    expect(locks.Zp).toBeUndefined();
    expect(ratioVary).toBe(true);
  });

  it('"Lock all to current Gearbox values" locks every variable to what the Gearbox page has', () => {
    for (const j of JOINT_IDS) {
      const inp = presetInputs(j);
      const s = lockAllToInputs(defaultLockState(), inp);
      const { locks } = toEngineLocks(s, inp);
      expect(Object.keys(locks).sort()).toEqual(['D', 'Zp', 'Zw', 'bearing', 'discs', 'e', 'innerPin', 'L', 'outerPin'].sort());
      expect(lockErrors(s, inp)).toEqual([]);
      // the catalog entries are recognised from the preset's radii
      expect(outerPinFromInputs(inp).kind).toBe('catalog');
      expect(innerPinFromInputs(inp).kind).toBe('catalog');
      expect(bearingFromInputs(inp).kind).toBe('catalog');
      // running the advisor with everything locked is a plain check of the Gearbox inputs
      const r = adviseDesign(inp, { locks });
      const plain = checkGearbox({ ...inp, RwOverride: null, discShare: null });
      const got = (r.best ?? r.closest)!;
      expect(strip(got.result)).toEqual(strip(plain));
      expect(got.D).toBe(inp.D);
      expect(got.e).toBe(inp.e);
    }
  });

  it('custom pin / bearing sizes are recognised as custom', () => {
    const inp = { ...PRESETS.J3, rr: 2.75, rw: 3.1, Db: 21.5, bearing: { name: 'X', C: 1111, C0: 555 } };
    expect(outerPinFromInputs(inp)).toEqual({ kind: 'custom', od: 5.5, shank: inp.outerPin.shankDia });
    expect(innerPinFromInputs(inp).kind).toBe('custom');
    expect(bearingFromInputs(inp)).toEqual({ kind: 'custom', name: 'X', OD: 21.5, C: 1111, C0: 555 });
  });

  it('"Unlock all" frees everything but remembers the values', () => {
    const inp = PRESETS.J2;
    const s = unlockAll(lockAllToInputs(defaultLockState(), inp));
    expect(Object.values(s.on).every((v) => v === false)).toBe(true);
    expect(s.values.D).toBe(inp.D);
    expect(toEngineLocks(s, inp).locks).toEqual({});
  });

  it('inline validation messages come from the engine rules', () => {
    const inp = PRESETS.J3;
    const s = defaultLockState();
    s.on.D = true; s.values.D = -5;
    expect(lockRowError('D', s, inp)).toMatch(/^D must be > 0/);
    s.on.Zw = true; s.values.Zw = 2;
    expect(lockRowError('Zw', s, inp)).toMatch(/^Zw must be an integer from 3 to 60/);
    s.on.bearing = true; s.values.bearing = { kind: 'custom', OD: 20, C: 0, C0: 100 };
    expect(lockRowError('bearing', s, inp)).toMatch(/earing C must be > 0/);
    s.limitOn = true; s.values.maxHousingOD = 0;
    expect(lockRowError('maxHousingOD', s, inp)).toMatch(/ousing OD limit must be > 0/);
    expect(lockErrors(s, inp).length).toBe(4);
    // a free variable never shows an error, whatever value it remembers
    s.on.D = false;
    expect(lockRowError('D', s, inp)).toBeNull();
    // D and e both locked with K1 >= 1
    const t = defaultLockState();
    t.on.D = true; t.values.D = 20; t.on.e = true; t.values.e = 2;
    expect(lockRowError('e', t, inp)).toMatch(/K1/);
    // resolution of "use the Gearbox value"
    expect(resolveLockValues(defaultLockState(), inp).D).toBe(inp.D);
  });
});

describe('session persistence', () => {
  it('an old session without locks loads with the defaults', () => {
    const old = JSON.parse(exportSession(defaultSession()));
    delete old.advisorLocks;
    old.app = 'cycloidal-gearbox-designer';
    const out = importSession(JSON.stringify(old), defaultSession());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    for (const sl of SLOTS) expect(out.session.advisorLocks[sl]).toEqual(defaultLockState());
    // raw localStorage payload from before the feature
    const raw = JSON.parse(JSON.stringify(defaultSession()));
    delete raw.advisorLocks;
    expect(normalizeSession(raw).advisorLocks.J3).toEqual(defaultLockState());
    expect(normalizeSession({ advisor: { target: 0.9 } }).advisorLocks.custom.on.Zp).toBe(true);
  });

  it('the old "let ratio vary" switch becomes the ratio lock being off', () => {
    const raw = JSON.parse(JSON.stringify(defaultSession()));
    delete raw.advisorLocks;
    raw.advisor.ratioVary = true;
    const s = normalizeSession(raw);
    for (const sl of SLOTS) expect(s.advisorLocks[sl].on.Zp).toBe(false);
    // but a session that already has lock states keeps them
    raw.advisorLocks = JSON.parse(JSON.stringify(s.advisorLocks));
    raw.advisorLocks.J2.on.Zp = true;
    expect(normalizeSession(raw).advisorLocks.J2.on.Zp).toBe(true);
  });

  it('lock states are stored per joint and round-trip through export / import and localStorage', () => {
    const s = defaultSession();
    s.advisorLocks.J2 = lockAllToInputs(s.advisorLocks.J2, s.gearboxes.J2);
    s.advisorLocks.J2.values.D = 61.37;
    s.advisorLocks.J3.on.L = true;
    s.advisorLocks.J3.values.L = 7.3;
    s.advisorLocks.J3.values.bearing = { kind: 'custom', name: 'MyBrg', bore: 12, OD: 22, C: 3000, C0: 1400 };
    s.advisorLocks.J3.limitOn = true;
    s.advisorLocks.J3.values.maxHousingOD = 88.5;
    const out = importSession(exportSession(s), defaultSession());
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.session.advisorLocks.J2).toEqual(s.advisorLocks.J2);
    expect(out.session.advisorLocks.J3).toEqual(s.advisorLocks.J3);
    expect(out.session.advisorLocks.J1).toEqual(defaultLockState());
    // localStorage
    const store: Record<string, string> = {};
    g.window = { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: () => {} } };
    expect(saveSession(s)).toBe(true);
    const back = loadSession();
    expect(back.advisorLocks.J2.values.D).toBe(61.37);
    expect(back.advisorLocks.J3.values.L).toBe(7.3);
    expect(back.advisorLocks.J3.values.bearing).toEqual({ kind: 'custom', name: 'MyBrg', bore: 12, OD: 22, C: 3000, C0: 1400 });
  });

  it('garbage lock data is normalized and never throws', () => {
    for (const bad of [null, 5, 'x', [], { on: 5 }, { on: { D: 'yes' }, values: { D: 'big', discs: 7, outerPin: { kind: 'catalog', index: 99 }, bearing: { kind: 'custom' } } }]) {
      const n = normalizeLockState(bad);
      expect(n.on.Zp).toBe(true);
      expect(n.on.D).toBe(false);
      expect(n.values.D).toBeNull();
      expect(n.values.discs).toBeNull();
      expect(n.values.outerPin).toBeNull();
      expect(n.values.bearing).toBeNull();
    }
    const raw = JSON.parse(JSON.stringify(defaultSession()));
    raw.advisorLocks = { J2: 'nope', J3: { on: { D: true }, values: { D: 52.5 } }, custom: [] };
    const s = normalizeSession(raw);
    expect(s.advisorLocks.J2).toEqual(defaultLockState());
    expect(s.advisorLocks.J3.on.D).toBe(true);
    expect(s.advisorLocks.J3.values.D).toBe(52.5);
    expect(s.advisorLocks.custom).toEqual(defaultLockState());
  });
});

// ---------------------------------------------------------------------------
// Real render of the table (server render; the browser checks cover interaction)
// ---------------------------------------------------------------------------

function render(units: UnitPrefs, mutate: (s: Session) => void, make: () => ReturnType<typeof createElement>): string {
  const s: Session = defaultSession();
  s.units = { ...units };
  mutate(s);
  g.window = { localStorage: { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(s) : null), setItem: () => {}, removeItem: () => {} } };
  const Wrap: ComponentType = () => make();
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Wrap)));
}
const text = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ');

describe('Design variables table render', () => {
  const inp = PRESETS.J2;
  const panel = (chosen = null as ReturnType<typeof adviseDesign>['best']) => () => createElement(AdvisorLocksPanel, {
    slot: 'J2', eff: inp, chosen, running: false, hasResult: false, canRun: true, onRun: () => {}, onCancel: () => {},
  });

  it('shows every variable with a Locked / Free toggle (aria-pressed) and "auto" for free ones', () => {
    const html = render(METRIC, () => {}, panel());
    const t = text(html);
    for (const name of ['Gear ratio', 'Pin circle diameter', 'Eccentricity', 'Outer pin size', 'Inner pin size', 'Inner pin count', 'Disc thickness', 'Number of discs', 'Eccentric bearing', 'Maximum housing OD']) {
      expect(t, name).toContain(name);
    }
    expect((html.match(/aria-pressed="true"/g) ?? []).length).toBe(1); // the ratio
    expect((html.match(/aria-pressed="false"/g) ?? []).length).toBe(9);
    expect(t).toContain('Locked');
    expect(t).toContain('Free');
    expect((t.match(/auto/g) ?? []).length).toBe(8);
    expect(t).toContain('1 of 9 locked');
    expect(t).toContain('Lock all to current Gearbox values');
    expect(t).toContain('Unlock all');
    expect(html).toContain('value="18"'); // locked ratio shows the current Zp
    expect(t).toContain('= 17:1');
    expect(t).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('locked rows are editable in the display unit; imperial shows inches, never mm', () => {
    const lock = (s: Session) => {
      s.advisorLocks.J2 = lockAllToInputs(s.advisorLocks.J2, s.gearboxes.J2);
    };
    const metric = render(METRIC, lock, panel());
    expect(metric).toContain(`value="${inp.D}"`);
    const imp = render(IMPERIAL, lock, panel());
    const t = text(imp);
    expect(imp).toContain(`value="${(inp.D / 25.4).toFixed(3)}`);
    expect(t).toContain('9 of 9 locked');
    expect(t).toMatch(/in\b/);
    expect(t).not.toMatch(/\d\s?mm\b/);
    expect(t).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('custom pin and bearing show their own fields; validation text is inline', () => {
    const html = render(METRIC, (s) => {
      const l = s.advisorLocks.J2;
      l.on.outerPin = true; l.values.outerPin = { kind: 'custom', od: 5.5, shank: 3.5 };
      l.on.bearing = true; l.values.bearing = { kind: 'custom', name: 'MyBrg', bore: 12, OD: 22, C: 3000, C0: 1400 };
      l.on.Zw = true; l.values.Zw = 2;
    }, panel());
    const t = text(html);
    expect(t).toContain('Custom…');
    expect(html).toContain('aria-label="Custom outer pin OD"');
    expect(html).toContain('aria-label="Custom bolt shank diameter"');
    expect(html).toContain('aria-label="Custom bearing OD"');
    expect(html).toContain('value="MyBrg"');
    expect(t).toContain('Zw must be an integer from 3 to 60');
    expect(t).toContain('Fix the highlighted locked values');
    expect(html).toContain('role="alert"');
    // the run button is disabled while a locked value is invalid
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Run advisor/);
  });

  it('free rows show the advisor\'s choice after a run; the result card marks Locked / Optimized', () => {
    const r = adviseDesign(inp, { locks: { Zp: inp.Zp, discs: 2 } });
    const best = r.best!;
    const html = render(METRIC, (s) => { s.advisorLocks.J2.on.discs = true; s.advisorLocks.J2.values.discs = 2; }, panel(best));
    const t = text(html);
    expect(t).toContain('advisor’s choice');
    expect(t).toContain(`${best.bearingName}`);
    const hero = text(render(METRIC, () => {}, () => createElement(Hero, {
      d: best, target: 0.85, elapsed: 10, evaluated: 5, joint: 'J2', locked: r.locked, onApply: () => {},
    })));
    expect(hero).toMatch(/Gear ratio .* Locked/);
    expect(hero).toMatch(/Discs .* Locked/);
    expect(hero).toMatch(/Pin circle diameter, D .* Optimized/);
    expect(hero).toMatch(/Eccentric bearing .* Optimized/);
    expect(hero).toContain('your value, returned exactly');
    const closestHero = text(render(METRIC, () => {}, () => createElement(Hero, {
      d: best, target: 0.85, elapsed: 10, evaluated: 5, joint: 'J2', locked: r.locked, closest: true, onApply: () => {},
    })));
    expect(closestHero).toContain('Closest design');
    expect(closestHero).toContain('Apply closest to Gearbox');
  });
});

describe('disc thickness shows stock sizes exactly', () => {
  const inp = PRESETS.J2;
  const stock = [3.175, 4.76, 6.35, 9.525, 12.7];
  const shown = ['3.175', '4.76', '6.35', '9.525', '12.7'];

  it('result card, alternatives table and locks table use up to 3 decimals in mm (no 9.53) and 3 in inches', () => {
    const base = adviseDesign(inp).best!;
    stock.forEach((L, i) => {
      const d = { ...base, L, inputs: { ...base.inputs, L } };
      const hero = text(render(METRIC, () => {}, () => createElement(Hero, { d, target: 0.85, elapsed: 1, evaluated: 1, joint: 'J2', onApply: () => {} })));
      expect(hero, `L=${L}`).toContain(`Disc thickness, L ${shown[i]} mm`);
      expect(hero).not.toContain('9.53');
      const heroIn = text(render(IMPERIAL, () => {}, () => createElement(Hero, { d, target: 0.85, elapsed: 1, evaluated: 1, joint: 'J2', onApply: () => {} })));
      expect(heroIn).toContain(`Disc thickness, L ${(L / 25.4).toFixed(3)} in`);
      const alt = text(render(METRIC, () => {}, () => createElement(Alternatives, { res: { oneDisc: d, twoDisc: null, lightest: null, mostMargin: null }, onApply: () => {} })));
      expect(` ${alt} `).toContain(` ${shown[i]} mm `);
      expect(alt).not.toContain('9.53');
      const panel = text(render(METRIC, () => {}, () => createElement(AdvisorLocksPanel, {
        slot: 'J2', eff: inp, chosen: d, running: false, hasResult: true, canRun: true, onRun: () => {}, onCancel: () => {},
      })));
      expect(panel).toContain(`${shown[i]} mm advisor’s choice`);
    });
    // the stock-size picker lists them exactly too
    const html = render(METRIC, (s) => { s.advisorLocks.J2.on.L = true; }, () => createElement(AdvisorLocksPanel, {
      slot: 'J2', eff: inp, chosen: null, running: false, hasResult: false, canRun: true, onRun: () => {}, onCancel: () => {},
    }));
    for (const s of shown) expect(html).toContain(`>${s} mm</option>`);
    expect(html).not.toContain('9.53');
  });
});
