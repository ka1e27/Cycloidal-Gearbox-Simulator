// Import / storage robustness beyond session.test.ts: hostile JSON shapes, prototype keys, deep garbage.
import { afterEach, describe, expect, it } from 'vitest';
import { checkGearbox, computeArm, summarizeAllJoints } from '../../calc';
import { defaultSession, importSession, loadSession, normalizeSession, saveSession, STORAGE_KEY, slotsOf } from '../session';

const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

const cur = defaultSession();

/** Whatever an import produces, every engine entry point must cope with it and return finite-or-flagged results. */
function engineCopes(s: ReturnType<typeof defaultSession>) {
  for (const slot of slotsOf(s)) {
    const r = checkGearbox(s.gearboxes[slot]);
    expect(typeof r.valid).toBe('boolean');
    if (r.valid) {
      for (const c of r.checks) expect(Number.isNaN(c.utilization), `${slot} ${c.id}`).toBe(false);
      expect(Number.isFinite(r.maxUtilization)).toBe(true);
    } else {
      expect(r.errors.length).toBeGreaterThan(0);
    }
  }
  const arm = computeArm(s.arm);
  expect(typeof arm.valid).toBe('boolean');
  const sum = summarizeAllJoints(s.arm, s.gearboxes, { useArmLoads: s.useArmLoads });
  expect(sum.rows.length + sum.servos.length).toBe(s.arm.joints.length);
}

describe('audit: malformed JSON imports', () => {
  const texts: [string, string][] = [
    ['empty', ''],
    ['truncated', '{"arm": {"payload_g": 12'],
    ['array', '[{"arm":{}}]'],
    ['string', '"hello"'],
    ['number', '42'],
    ['null', 'null'],
    ['wrong app', '{"app":"other","foo":1}'],
    ['BOM + garbage', '﻿{{{'],
    ['html', '<html><body>nope</body></html>'],
    ['future version', '{"version":99,"arm":{}}'],
  ];
  for (const [name, text] of texts) {
    it(`rejects with a friendly message: ${name}`, () => {
      const out = importSession(text, cur);
      expect(out.ok).toBe(false);
      if (!out.ok) {
        expect(out.error.length).toBeGreaterThan(20);
        expect(out.error).not.toMatch(/undefined|NaN|\[object|SyntaxError|node_modules/);
      }
    });
  }

  const shapes: [string, unknown][] = [
    ['arm is a string', { arm: 'abc' }],
    ['arm arrays are strings', { arm: { jointMass_g: 'abc', barMass_g: { 0: 1 }, barLength_mm: [null, 'x', {}, [], true], alpha: 7 } }],
    ['arm numbers are strings', { arm: { payload_g: '250', SF: 'high', TdesFloor: [] } }],
    ['override garbage', { arm: { override: 'x' } }],
    ['override entries garbage', { arm: { override: [null, 5, 'a', { Treq: 'x', Tdes: [] }, { Treq: -4 }] } }],
    ['gearboxes is an array', { gearboxes: [1, 2, 3] }],
    ['gearboxes entries are primitives', { gearboxes: { J1: 5, J2: 'x', J3: null, J4: [], custom: true } }],
    ['nested material garbage', { gearboxes: { J2: { discMaterial: 5, outerPin: null, innerPin: 'x', bearing: [] } } }],
    ['material numbers are null', { gearboxes: { J2: { discMaterial: { E: null, nu: 'a', Sy: {}, density: [] } } } }],
    ['enum garbage', { gearboxes: { J2: { outerPin: { construction: 'banana' }, innerPin: { construction: 7 } } }, selected: 99, advisor: [] }],
    ['units garbage', { units: { length: 'cubit', mass: 5 }, arm: {} }],
    ['useArmLoads garbage', { useArmLoads: { J1: 'yes', J2: 0, J9: true }, arm: {} }],
    ['extreme numbers', { gearboxes: { J2: { D: 1e308, e: -1e308, Zp: 1e9, Zw: -5, L: 5e-324 } }, arm: { payload_g: 1e308, SF: 5e-324 } }],
    ['prototype keys', JSON.parse('{"__proto__":{"Zp":3,"polluted":true},"arm":{"__proto__":{"SF":9}},"gearboxes":{"J2":{"__proto__":{"D":-5},"constructor":7,"toString":9,"hasOwnProperty":1}}}')],
    ['deep nesting', JSON.parse('{"arm":' + '{"a":'.repeat(500) + '1' + '}'.repeat(500) + '}')],
  ];
  for (const [name, obj] of shapes) {
    it(`never throws and the engine copes: ${name}`, () => {
      const text = JSON.stringify(obj);
      let out!: ReturnType<typeof importSession>;
      expect(() => { out = importSession(text, cur); }).not.toThrow();
      if (!out.ok) {
        expect(out.error.length).toBeGreaterThan(10);
        return;
      }
      engineCopes(out.session);
      // the app's own object prototype must be untouched
      expect(({} as Record<string, unknown>).polluted).toBeUndefined();
      expect(({} as Record<string, unknown>).Zp).toBeUndefined();
      expect(Object.prototype.hasOwnProperty.call(Object.prototype, 'polluted')).toBe(false);
      // a session that survives import also survives a save / load round trip
      const store = new Map<string, string>();
      g.window = {
        localStorage: {
          getItem: (k: string) => store.get(k) ?? null,
          setItem: (k: string, v: string) => void store.set(k, v),
          removeItem: (k: string) => void store.delete(k),
        },
      };
      expect(saveSession(out.session)).toBe(true);
      engineCopes(loadSession());
    });
  }

  it('normalizeSession never returns NaN or non-finite numbers from finite JSON', () => {
    const s = normalizeSession(JSON.parse(JSON.stringify({ gearboxes: { J2: { D: 'x', e: null, L: [1] } }, arm: { SF: 'a' } })));
    expect(s.gearboxes.J2.D).toBe(85);
    expect(s.gearboxes.J2.e).toBe(1.6);
    expect(s.gearboxes.J2.L).toBe(6.35);
    expect(s.arm.SF).toBe(1.5);
  });
});

describe('audit: localStorage that misbehaves', () => {
  it('getItem returning garbage types, throwing getters, quota errors', () => {
    const variants: unknown[] = [
      { localStorage: { getItem: () => 'not json', setItem: () => { throw new DOMException('quota', 'QuotaExceededError'); }, removeItem: () => {} } },
      { localStorage: { getItem: () => '{"arm":5,"gearboxes":7,"step":"2"}', setItem: () => {}, removeItem: () => {} } },
      { localStorage: { getItem: () => 123, setItem: () => {}, removeItem: () => {} } },
      { localStorage: { getItem: () => ({}), setItem: () => {}, removeItem: () => {} } },
      { get localStorage(): never { throw new Error('SecurityError'); } },
      { localStorage: null },
      { localStorage: undefined },
      {},
    ];
    for (const w of variants) {
      g.window = w;
      let s!: ReturnType<typeof loadSession>;
      expect(() => { s = loadSession(); }).not.toThrow();
      engineCopes(s);
      expect(() => saveSession(s)).not.toThrow();
    }
  });

  it('save reports failure (so the UI can show the "storage unavailable" note) instead of throwing', () => {
    g.window = { localStorage: { getItem: () => null, setItem: () => { throw new Error('full'); }, removeItem: () => {} } };
    expect(saveSession(defaultSession())).toBe(false);
    g.window = { localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} } };
    expect(saveSession(defaultSession())).toBe(true);
    expect(STORAGE_KEY).toBe('cgd.session.v1');
  });
});
