// Tolerances & backlash in the workbench (CLAUDE.md Addition 13): the section, its results view, the Arm item's tip slop
// card, the DXF clearances that mirror the gearbox inputs, and moving the old stored DXF clearances into the inputs.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { analyzeTolerance, checkGearbox, fitClearances, processSpec, setToleranceKc, clearToleranceKc, withTolerance, type GearboxInputs } from '../../calc';
import { buildParts } from '../../export/parts';
import { DXF_OPTIONS_KEY, STORAGE_KEY, TOLERANCE_MIGRATED_KEY, defaultSession, loadSession, migrateDxfTolerance, type Session } from '../session';
import { StoreProvider } from '../store';
import { ToleranceView } from '../screens/TolerancePanel';
import { ARM_SECTIONS, CUSTOM_SECTIONS, CYCLOIDAL_SECTIONS } from '../workbench/wbState';
import { ArmScreen, GearboxScreen } from './workbenchScreens';

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; clearToleranceKc(); });

function install(store: Record<string, string>) {
  g.window = { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: (k: string, v: string) => { store[k] = v; }, removeItem: (k: string) => { delete store[k]; } } };
}
function render(session: Session, Screen: ComponentType): string {
  install({ [STORAGE_KEY]: JSON.stringify(session) });
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Screen)));
}

describe('section placement', () => {
  it('sits between Checks and Disc & charts for joints and Custom; the Arm item gets Tip slop', () => {
    expect(CYCLOIDAL_SECTIONS.indexOf('tolerance')).toBe(CYCLOIDAL_SECTIONS.indexOf('checks') + 1);
    expect(CYCLOIDAL_SECTIONS.indexOf('disc')).toBe(CYCLOIDAL_SECTIONS.indexOf('tolerance') + 1);
    expect(CUSTOM_SECTIONS.indexOf('tolerance')).toBe(CUSTOM_SECTIONS.indexOf('checks') + 1);
    expect(ARM_SECTIONS).toContain('armSlop');
  });

  it('renders the inputs (process, reamed toggle, every field) in the J2 inspector', () => {
    const html = render(defaultSession(), GearboxScreen);
    for (const t of ['Tolerances &amp; backlash', 'Machining process', 'CNC mill', 'Reamed / dowel-fit holes', 'Profile clearance', 'Inner hole clearance',
      'Bushing play', 'Bolt hole play', 'Bearing clearance', 'Profile error', 'Pin position', 'Pin diameter', 'Eccentricity error',
      'Inner hole position', 'Inner pin diameter', 'Use tolerance Kc in the checks', 'Random builds']) {
      expect(html, t).toContain(t);
    }
  });

  it('the Arm item lists the tip slop card', () => {
    const html = render(defaultSession(), ArmScreen);
    expect(html).toContain('Tip slop');
    expect(html).toContain('Arm total, RSS');
  });
});

describe('results view', () => {
  function view(inputs: GearboxInputs, slot = 'J2', index = 1): string {
    const s = defaultSession();
    s.gearboxes[slot] = inputs;
    install({ [STORAGE_KEY]: JSON.stringify(s) });
    const res = analyzeTolerance(inputs, { trials: 60, sensitivityTrials: 20 });
    const tol = { result: res, shown: res, pending: false, progress: null };
    return renderToStaticMarkup(createElement(StoreProvider, null,
      createElement(ToleranceView, { slot, eff: inputs, result: checkGearbox(inputs), index, tol })));
  }

  it('flags binding with one-click clearances, shows backlash, Kc, stiffness and the tip', () => {
    const s = defaultSession();
    // the preset itself is fitted: no binding
    expect(view(withTolerance(s.gearboxes.J2, processSpec('waterjet')))).toContain('NO BINDING');
    // a little too small: the worst stack binds (few builds do), with the one-click clearances
    const html = view(withTolerance(s.gearboxes.J2, { ...processSpec('mill'), profileClearance: 0.15, innerHoleClearance: 0.065 }));
    expect(html).toContain('can bind');
    expect(html).toMatch(/Profile clearance → 0\.155 mm/);
    expect(html).toMatch(/Inner hole clearance → 0\.070 mm/);
    expect(html).toContain('Custom (edited values)');
    expect(html).toContain('Use the fitted clearances');
    for (const t of ['Backlash at the output', 'Design (no errors)', 'Most builds (p95)', 'Typical build (p50)', 'Worst case', 'arcminutes', '1/60 of a degree', 'before run-in', 'Kc strength', 'Kc life', 'Torsional stiffness', 'Twist at T_req', 'Tool tip slop', 'What drives it']) {
      expect(html, t).toContain(t);
    }
    expect(html).toContain('The checks use the typed Kc');
  });

  it('most builds bind: no statistics, the binding share up front, and the fix', () => {
    const s = defaultSession();
    const html = view(withTolerance(s.gearboxes.J2, { ...processSpec('waterjet'), profileClearance: 0.05, innerHoleClearance: 0.05 }));
    expect(html).toMatch(/\d+% of the random builds bind/);
    expect(html).toContain('Most builds bind: raise the clearance');
    expect(html).not.toContain('Most builds (p95)');
    expect(html).toMatch(/Profile clearance → 0\.335 mm/);
  });

  it('statistical fit: the mode control, both fitted values, and the assembly note', () => {
    const s = defaultSession();
    const spec = fitClearances(s.gearboxes.J2, processSpec('mill', { keep: { fitMode: 'statistical', bindTarget: 0.01 } }));
    const html = view(withTolerance(s.gearboxes.J2, spec));
    expect(html).toContain('Fit clearance for');
    expect(html).toContain('Worst case (never binds)');
    expect(html).toContain('Statistical (≤ 1% of builds bind)');
    expect(html).toContain('Accepted binding');
    expect(html).toMatch(/profile worst case 0\.155 mm · 1%: 0\.\d{3} mm/);
    expect(html).toMatch(/of builds may bind at assembly/);
    expect(html).toContain('Select parts or lap the disc');
    expect(html).toMatch(/selected="">CNC mill/);
  });

  it('says which Kc the checks use', () => {
    const s = defaultSession();
    const inp: GearboxInputs = { ...withTolerance(s.gearboxes.J2, processSpec('mill')), useToleranceKc: true };
    expect(view(inp)).toContain('until the Monte Carlo has a value');
    setToleranceKc(inp, { Kc: 4.25, KcLife: 3.5 });
    const html = view(inp);
    expect(html).toContain('The checks use the tolerance Kc 4.25 and Kc life 3.50 (p95)');
    expect(html).not.toContain('can bind on the outer pins');
  });
});

describe('DXF clearances are gearbox inputs', () => {
  it('the DXF panel shows the gearbox values (profile, inner hole, 2 x hole play)', () => {
    const s = defaultSession();
    s.gearboxes.J2 = withTolerance(s.gearboxes.J2, { profileClearance: 0.065, innerHoleClearance: 0.07, holePlay: 0.005 });
    const html = render(s, GearboxScreen);
    expect(html).toContain('value="0.065"');
    expect(html).toContain('value="0.07"');
    expect(html).toContain('value="0.01"');
    expect(html).toContain('Disc bore clearance');
    const r = buildParts(s.gearboxes.J2, {}, 'J2');
    expect(r.info!.profileOffset).toBeCloseTo(s.gearboxes.J2.rr + 0.065, 12);
  });

  it('old stored DXF clearances move into every gearbox without a spec, once', () => {
    const s = defaultSession();
    s.gearboxes.J3 = withTolerance(s.gearboxes.J3, { profileClearance: 0.2 });
    const dxf = { units: 'mm', profileClearance: 0.08, pinHoleClearance: 0.3, discHoleClearance: 0.02, pointsPerLobe: 120 };
    const m = migrateDxfTolerance(s, dxf);
    expect(m.gearboxes.J2.tolerance).toMatchObject({ profileClearance: 0.08, holePlay: 0.15, innerHoleClearance: 0.02, profileError: 0.02 });
    expect(m.gearboxes.J3.tolerance!.profileClearance).toBe(0.2); // had a spec: untouched
    expect(migrateDxfTolerance(s, null)).toBe(s);
    // through loadSession: the drawing of an old session stays the same
    const old = defaultSession();
    const store: Record<string, string> = { [STORAGE_KEY]: JSON.stringify(old), [DXF_OPTIONS_KEY]: JSON.stringify(dxf) };
    install(store);
    const loaded = loadSession();
    expect(loaded.gearboxes.J2.tolerance!.profileClearance).toBe(0.08);
    expect(store[TOLERANCE_MIGRATED_KEY]).toBe('1');
    expect(buildParts(loaded.gearboxes.J2, {}, 'J2').info!.profileOffset).toBeCloseTo(old.gearboxes.J2.rr + 0.08, 12);
    // a second load does not migrate again (a new gearbox keeps the default spec)
    store[STORAGE_KEY] = JSON.stringify(old);
    expect(loadSession().gearboxes.J2.tolerance).toBeUndefined();
  });
});
