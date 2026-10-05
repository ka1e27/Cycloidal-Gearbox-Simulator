// The machined (integral) ring in the workbench: fields, checks, notice, disc drawing, advisor lock row (Addition 12).
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { patchMotor } from '../motorUi';
import { defaultSession, STORAGE_KEY, type Session } from '../session';
import { StoreProvider } from '../store';
import { AdvisorScreen, GearboxScreen } from './workbenchScreens';

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

function render(session: Session, Screen: ComponentType): string {
  const store: Record<string, string> = { [STORAGE_KEY]: JSON.stringify(session) };
  g.window = { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: () => {}, removeItem: () => {} } };
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Screen)));
}

function session(construction: 'boltBushing' | 'integral', motor = false): Session {
  const s = defaultSession();
  s.selected = 'J2';
  s.gearboxes.J2 = { ...s.gearboxes.J2, outerPin: { ...s.gearboxes.J2.outerPin, construction } };
  if (motor) s.arm = patchMotor(s.arm, 'J2', { Tpeak_Nm: 0.45, efficiency: 0.85 });
  return s;
}

describe('integral ring UI', () => {
  it('shows the integral fields, checks and notice instead of the bolt and bushing', () => {
    const html = render(session('integral', true), GearboxScreen);
    for (const t of ['Machined into housing', 'Tooth radius', 'Housing material', 'Root clearance', 'Tool radius', 'Largest that fits',
      'Ring tooth root (integral)', 'Tool fillet clearance', 'the disc slides on the teeth', 'Set η 0.78', 'Ring root diameter',
      'disc-ring-housing', 'Ring housing (integral teeth)', 'Ring housing mounting holes']) {
      expect(html, t).toContain(t);
    }
    for (const t of ['Bolt shank diameter', 'Bolt yield strength', 'Bolt and bushing size', 'Outer bolt bending', 'Bushing material']) {
      expect(html, t).not.toContain(t);
    }
  });

  it('without a motor the notice says where to enter one, and bolt + bushing has no notice', () => {
    expect(render(session('integral'), GearboxScreen)).toContain('Enter a motor under Motor &amp; ratio');
    const bolt = render(session('boltBushing', true), GearboxScreen);
    expect(bolt).not.toContain('the disc slides on the teeth');
    expect(bolt).not.toContain('disc-ring-housing');
    expect(bolt).toContain('Outer bolt bending');
    expect(bolt).toContain('Bolt + bushing');
  });

  it('the advisor shows a tooth radius lock row', () => {
    const html = render(session('integral'), AdvisorScreen);
    expect(html).toContain('Tooth radius rr');
    expect(html).toContain('machined into the housing (no pins)');
  });
});
