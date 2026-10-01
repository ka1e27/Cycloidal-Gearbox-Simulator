// Render the advisor result cards and the solver heat map with real engine results, in several unit sets.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { adviseDesign, presetInputs, solveMinimumSize } from '../../calc';
import { defaultSession, STORAGE_KEY, type Session } from '../session';
import { IMPERIAL, METRIC, type UnitPrefs } from '../units';
import { StoreProvider } from '../store';
import { Alternatives, Hero } from '../screens/AdvisorScreen';
import { Heat } from '../screens/SolverPanel';

const ALL: UnitPrefs = { length: 'in', mass: 'lb', force: 'lbf', torque: 'lbf·ft', stress: 'psi' };
const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

function render(units: UnitPrefs, make: () => ReturnType<typeof createElement>): string {
  const s: Session = defaultSession();
  s.units = { ...units };
  g.window = { localStorage: { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(s) : null), setItem: () => {}, removeItem: () => {} } };
  const Wrap: ComponentType = () => make();
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Wrap)));
}
const text = (html: string) =>
  html.replace(/<[^>]+>/g, ' ').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/\s+/g, ' ');

const inputs = { ...presetInputs('J2'), D: 85, e: 1.3, discs: 1, Treq: 5.85, Tdes: 8.8 };
const res = adviseDesign(inputs, { target: 0.85 });

describe('audit: advisor cards show the design in the chosen units', () => {
  it('has a design to show', () => {
    expect(res.valid).toBe(true);
    expect(res.best).not.toBeNull();
  });
  const best = res.best!;

  it('metric: housing OD, D, e, L, pins, bearing, mass', () => {
    const t = text(render(METRIC, () => createElement(Hero, { d: best, target: 0.85, elapsed: 100, evaluated: 10, joint: 'J2', onApply: () => {} })));
    expect(t).toContain(`${best.housingOD.toFixed(1)} mm housing`);
    expect(t).toMatch(new RegExp(`Pin circle diameter, D ${best.D.toFixed(1)} mm`));
    expect(t).toMatch(new RegExp(`Eccentricity, e ${best.e.toFixed(3)} mm K1 ${best.K1.toFixed(3)}`));
    expect(t).toMatch(new RegExp(`Disc thickness, L ${best.L.toFixed(2)} mm`));
    expect(t).toContain(`Eccentric bearing ${best.bearingName} OD ${best.bearingOD.toFixed(0)} mm`);
    expect(t).toMatch(/Disc mass \d+ g/);
    expect(t).not.toMatch(/NaN|undefined|Infinity/);
  });

  it('imperial: every length is inches with 3 decimals (4 below 0.1), mass in oz, e in 4 decimals', () => {
    const t = text(render(IMPERIAL, () => createElement(Hero, { d: best, target: 0.85, elapsed: 100, evaluated: 10, joint: 'J2', onApply: () => {} })));
    const inch = (mm: number) => (mm / 25.4).toFixed(mm / 25.4 < 0.1 ? 4 : 3);
    expect(t).toContain(`${inch(best.housingOD)} in housing`);
    expect(t).toContain(`Pin circle diameter, D ${inch(best.D)} in`);
    expect(t).toContain(`Eccentricity, e ${inch(best.e)} in`);
    expect(t).toContain(`Disc thickness, L ${inch(best.L)} in`);
    expect(t).toContain(`OD ${inch(best.bearingOD)} in`);
    expect(t).toMatch(/Disc mass [\d.]+ oz/);
    expect(t).not.toMatch(/\d\s?(mm|MPa|N·m)\b/);
  });

  it('alternatives table: header units and cells agree, in metric and fully converted units', () => {
    for (const units of [METRIC, IMPERIAL, ALL]) {
      const html = render(units, () => createElement(Alternatives, { res: res.alternatives, onApply: () => {} }));
      const t = text(html);
      expect(t).not.toMatch(/NaN|undefined|Infinity/);
      expect(t).toContain(`Housing OD ${units.length}`);
      expect(t).toContain(`Mass ${units.mass}`);
      const row = (res.alternatives.oneDisc ?? res.alternatives.twoDisc)!;
      const f = units.length === 'in' ? 25.4 : 1;
      const dp = units.length === 'in' ? 3 : 0;
      expect(t).toContain((row.housingOD / f).toFixed(dp));
      // e column: 3 decimals in mm, 4 in inches (below 0.1 in) -- never rounded to the 1/1000 inch
      expect(t).toContain((row.e / f).toFixed(units.length === 'in' ? 4 : 3));
    }
  });
});

describe('audit: solver heat map axis follows the length unit', () => {
  const sol = solveMinimumSize(presetInputs('J3'));
  it('labels the D axis in the display unit and places ticks at the right D', () => {
    for (const [units, label, firstTick] of [[METRIC, 'D, mm', '30'], [IMPERIAL, 'D, in', '1.25'], [ALL, 'D, in', '1.25']] as const) {
      const html = render(units, () => createElement(Heat, { res: sol, curD: 70, curK1: 0.55 }));
      expect(html).toContain(`>${label}<`);
      const ticks = [...html.matchAll(/<text class="ch-axis" x="([\d.]+)" y="[\d.]+" text-anchor="middle">([\d.]+)<\/text>/g)].map((m) => ({ x: Number(m[1]), v: Number(m[2]) }));
      expect(ticks.length, `${units.length}: ${sol.grid.D[0]}..${sol.grid.D[sol.grid.D.length - 1]} ${html.match(/class="ch-axis"[^>]*>[^<]*</g)?.join(' ')}`).toBeGreaterThanOrEqual(2);
      expect(String(ticks[0].v)).toBe(firstTick);
      // tick positions increase with value and are evenly spaced in D (linear axis)
      for (let i = 1; i < ticks.length; i++) expect(ticks[i].x).toBeGreaterThan(ticks[i - 1].x);
      const mmPer = units.length === 'in' ? 25.4 : 1;
      const px = (ticks[1].x - ticks[0].x) / ((ticks[1].v - ticks[0].v) * mmPer);
      for (let i = 2; i < ticks.length; i++) {
        const px2 = (ticks[i].x - ticks[i - 1].x) / ((ticks[i].v - ticks[i - 1].v) * mmPer);
        expect(Math.abs(px2 - px) / px).toBeLessThan(1e-3);
      }
      expect(html).not.toMatch(/NaN|undefined|Infinity/);
    }
  });
});
