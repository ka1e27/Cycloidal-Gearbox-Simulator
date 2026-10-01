// Render audit: mount the real screens to static markup (react-dom/server, no extra dependency) inside the
// real store, and read what a user would read. A stubbed `window.localStorage` seeds the session.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { checkGearbox, presetInputs } from '../../calc';
import { defaultSession, STORAGE_KEY, type Session, type Step } from '../session';
import { IMPERIAL, METRIC, type UnitPrefs } from '../units';
import { StoreProvider } from '../store';
import { ArmScreen } from '../screens/ArmScreen';
import { GearboxScreen } from '../screens/GearboxScreen';
import { JointsScreen } from '../screens/JointsScreen';
import { AdvisorScreen } from '../screens/AdvisorScreen';
import { AssumptionsPanel } from '../components/AssumptionsPanel';

const ALL: UnitPrefs = { length: 'in', mass: 'lb', force: 'lbf', torque: 'lbf·ft', stress: 'psi' };
const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

/** The SPEC.md J2 validation case: Gearbox tab, J2 preset, arm loads OFF, T 5.85 / 8.8, D 85, e 1.3, 1 disc. */
export function specCaseSession(units: UnitPrefs, step: Step = 2): Session {
  const s = defaultSession();
  s.step = step;
  s.selected = 'J2';
  s.units = { ...units };
  s.useArmLoads.J2 = false;
  s.gearboxes.J2 = { ...presetInputs('J2'), D: 85, e: 1.3, discs: 1, Treq: 5.85, Tdes: 8.8 };
  return s;
}

function render(session: Session, Screen: ComponentType): string {
  g.window = {
    localStorage: { getItem: (k: string) => (k === STORAGE_KEY ? JSON.stringify(session) : null), setItem: () => {}, removeItem: () => {} },
  };
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Screen)));
}

/** Visible text: tags removed, entities decoded, whitespace collapsed. */
function text(html: string): string {
  return html
    .replace(/<style[\s\S]*?<\/style>/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/\s+/g, ' ');
}

/** Rows of a <dl> data table or a checks table cell lookup: the text right after a label. */
const after = (t: string, label: string, len = 60) => {
  const i = t.indexOf(label);
  expect(i, `label "${label}" not found`).toBeGreaterThanOrEqual(0);
  return t.slice(i + label.length, i + label.length + len);
};

describe('audit: SPEC J2 case as displayed (metric)', () => {
  const html = render(specCaseSession(METRIC), GearboxScreen);
  const t = text(html);

  it('shows the validation numbers from SPEC.md', () => {
    const r = checkGearbox(specCaseSession(METRIC).gearboxes.J2);
    expect(r.verdict).toBe('fail');
    // engine sanity (these are the SPEC numbers within the stated tolerance)
    expect(r.loads.p0RingStrength).toBeCloseTo(497, -1);
    // checks table rows: value then limit
    const row = (label: string, value: RegExp) => expect(t, label).toMatch(new RegExp(`${label}.{0,200}?${value.source}`));
    row('Ring contact, strength', /497 MPa ≤ 461 MPa/);
    row('Ring contact, life', /327 MPa ≤ 240 MPa/);
    row('Inner hole contact, strength', /374 MPa ≤ 461 MPa/);
    row('Inner hole contact, life', /246 MPa ≤ 240 MPa/);
    row('Outer bolt bending', /122 MPa ≤ 256 MPa/);
    row('Inner standoff bending', /57 MPa ≤ 150 MPa/);
    row('Bearing static', /475 N ≤ 585 N/);
  });

  it('shows pin forces, bolt/standoff ranges, bearing, life and Rw', () => {
    expect(after(t, 'Peak ring pin force')).toMatch(/^\s*177 N/);
    expect(after(t, 'Peak inner pin force')).toMatch(/^\s*357 N/);
    expect(after(t, 'Peak eccentric bearing load')).toMatch(/^\s*475 N/);
    expect(after(t, 'Bearing life, L10h')).toMatch(/^\s*4,6[0-9]{2} h/); // ~4,632 h (SPEC, +-2%)
    const life = Number(after(t, 'Bearing life, L10h').match(/^\s*([\d,]+) h/)![1].replace(/,/g, ''));
    expect(Math.abs(life - 4632) / 4632).toBeLessThan(0.02);
    expect(after(t, 'Inner pin circle radius, Rw')).toMatch(/^\s*32\.9 mm/);
    expect(after(t, 'Housing outside diameter')).toMatch(/^\s*98\.0 mm/);
    expect(t).toMatch(/fixed-fixed 61 MPa, simply supported 122 MPa/); // 61-122
    expect(t).toMatch(/tie ring 57 MPa \(used\), cantilever 113 MPa/); // 57 / 113
    expect(after(t, 'K1 (eccentricity ratio)')).toMatch(/^\s*0\.551/);
  });

  it('shows the SPEC unit case torque inputs (arm loads OFF) and the FAIL verdict', () => {
    expect(t).toMatch(/Working torque/);
    expect(t).toMatch(/FAIL/);
    expect(html).toMatch(/value="5\.85"/);
    expect(html).toMatch(/value="8\.8"/);
    expect(html).toMatch(/value="85"/);
    expect(html).toMatch(/value="1\.3"/);
  });
});

describe('audit: SPEC J2 case as displayed (imperial, exact conversions)', () => {
  const sess = specCaseSession(IMPERIAL);
  const html = render(sess, GearboxScreen);
  const t = text(html);

  it('converts every read-out once', () => {
    const r = checkGearbox(sess.gearboxes.J2);
    const lbf = (n: number) => (n / 4.4482216152605).toFixed(1);
    const ksi = (m: number) => (m / 6.894757293168361).toFixed(1);
    expect(t).toMatch(/Ring contact, strength.{0,200}?72\.1 ksi ≤ 66\.[89] ksi/); // 497 MPa, limit 460.9 MPa
    expect(after(t, 'Peak ring pin force').trim().startsWith(`${lbf(r.loads.FRingPeak)} lbf`)).toBe(true);
    expect(lbf(r.loads.FRingPeak)).toBe('39.7'); // 176.6 N (SPEC 177)
    expect(after(t, 'Peak inner pin force').trim().startsWith(`${lbf(r.loads.FInnerPeak)} lbf`)).toBe(true);
    expect(lbf(r.loads.FInnerPeak)).toBe('80.2'); // 356.7 N (SPEC 357 -> 80.3 when rounded first)
    expect(after(t, 'Peak eccentric bearing load').trim().startsWith(`${lbf(r.loads.bearingPeak)} lbf`)).toBe(true);
    expect(after(t, 'Inner pin circle radius, Rw')).toMatch(/^\s*1\.295 in/); // 32.9 mm
    expect(after(t, 'Housing outside diameter')).toMatch(/^\s*3\.858 in/); // 98 mm
    expect(t).toContain(`fixed-fixed ${ksi(r.loads.boltBendingFixed)} ksi, simply supported ${ksi(r.loads.boltBendingSimple)} ksi`);
    expect(t).toContain(`tie ring ${ksi(r.loads.standoffBendingTie)} ksi (used), cantilever ${ksi(r.loads.standoffBendingCantilever)} ksi`);
    // typed inputs: exactly 5.85 N*m = 51.78 lbf*in, stored SI value unchanged by the display
    expect(html).toMatch(/value="51\.78"/);
    expect(html).toMatch(/value="3\.346"/); // D 85 mm
    expect(html).toMatch(/value="0\.0512"/); // e 1.3 mm
  });

  it('leaves no unconverted metric quantity on screen', () => {
    // bearing designations are catalog names (10x19x5 mm) and density is g/cm3 by design
    // "5 mm (0.197 in)" pin sizes show both on purpose
    const cleaned = t.replace(/\d+×\d+×\d+ mm/g, '').replace(/g\/cm³/g, '').replace(/\d+(?:\.\d+)? mm \(\d+\.\d+ in\)/g, '');
    const bad = cleaned.match(/\d(?:\.\d+)?\s?(mm|MPa|N·m|N\*m)(?![\w/·*²³])/g);
    expect(bad, bad?.join(' | ')).toBeNull();
  });
});

describe('audit: lengths in inches keep their zeros (lead request)', () => {
  it('shows 3 decimals everywhere, 4 below 0.1 in', () => {
    const t = text(render(specCaseSession(IMPERIAL), GearboxScreen));
    const inches = [...t.matchAll(/(\d+\.\d+) in\b/g)].map((m) => m[1]);
    expect(inches.length).toBeGreaterThan(10);
    for (const s of inches) {
      const v = Number(s);
      const dp = s.split('.')[1].length;
      expect(dp, `"${s} in" has ${dp} decimals`).toBe(v < 0.1 ? 4 : 3);
    }
  });
});

describe('audit: other screens render with numbers (metric and imperial)', () => {
  for (const [name, Screen, step] of [
    ['arm', ArmScreen, 1], ['gearbox', GearboxScreen, 2], ['advisor', AdvisorScreen, 3], ['joints', JointsScreen, 4],
  ] as const) {
    for (const units of [METRIC, IMPERIAL, { length: 'in', mass: 'lb', force: 'lbf', torque: 'lbf·ft', stress: 'psi' } as UnitPrefs]) {
      it(`${name} / ${units.length} ${units.mass} ${units.torque}: no NaN, undefined, Infinity, null`, () => {
        const s = defaultSession();
        s.step = step;
        s.units = { ...units };
        const html = render(s, Screen);
        const t = text(html);
        expect(t.length).toBeGreaterThan(200);
        expect(t).not.toMatch(/NaN|undefined|Infinity|\bnull\b|\[object/);
        expect(html).not.toMatch(/NaN|undefined|Infinity/);
      });
    }
  }

  it('imperial arm page: torque, mass, length tagged with the right unit', () => {
    const s = defaultSession();
    s.step = 1;
    s.units = { ...IMPERIAL };
    const html = render(s, ArmScreen);
    const t = text(html);
    expect(t).toMatch(/lbf·in/);
    expect(t).toMatch(/Total arm mass 94\.08 oz, reach 24\.409 in from J2/); // 2667 g, 620 mm
  });

  it('assumptions panel converts its torque numbers', () => {
    const s = defaultSession();
    s.units = { ...IMPERIAL };
    const t = text(render(s, AssumptionsPanel));
    expect(t).toMatch(/J2 \(51\.78 lbf·in\) and J3 \(19\.91 lbf·in\)/);
    expect(t).not.toMatch(/5\.85 N·m/);
  });
});

describe('audit: engine values behind the SPEC J2 read-outs (printed for the record)', () => {
  it('prints them', () => {
    const r = checkGearbox(specCaseSession(METRIC).gearboxes.J2);
    const v = {
      ringStr: r.loads.p0RingStrength, ringLife: r.loads.p0RingLife, inStr: r.loads.p0InnerStrength, inLife: r.loads.p0InnerLife,
      FRing: r.loads.FRingPeak, FInner: r.loads.FInnerPeak, bolt: [r.loads.boltBendingFixed, r.loads.boltBendingSimple],
      standoff: [r.loads.standoffBendingTie, r.loads.standoffBendingCantilever], brgPeak: r.loads.bearingPeak, L10h: r.loads.L10h,
      Rw: r.derived.Rw, housingOD: r.derived.housingOD,
    };
    // eslint-disable-next-line no-console
    console.log(JSON.stringify(v));
    expect(v.Rw).toBeCloseTo(32.9, 1);
  });
});

// ---------------------------------------------------------------------------
// Robustness: hostile numbers must never put NaN / Infinity / undefined on screen or crash a screen.
// ---------------------------------------------------------------------------
function hostile(name: string): Session {
  const s = defaultSession();
  const gb = (patch: Record<string, unknown>) => {
    for (const slot of ['J1', 'J2', 'J3', 'J4', 'custom'] as const) Object.assign(s.gearboxes[slot], patch);
  };
  switch (name) {
    case 'zp<8, negatives':
      gb({ Zp: 3, Zw: 0, D: -5, e: 500, L: 0, rr: -1, rw: 0, Db: 1e9, tMin: -2, discs: 7, gap: -1, Treq: -1, Tdes: -2, Kc: 0 });
      break;
    case 'e huge':
      gb({ e: 1e6 });
      break;
    case 'e huge, Zp 8':
      gb({ e: 1e6, Zp: 8 });
      break;
    case 'D huge':
      gb({ D: 1e308 });
      break;
    case 'everything 1e308':
      for (const slot of ['J1', 'J2', 'J3', 'J4', 'custom'] as const) {
        const g2 = s.gearboxes[slot] as unknown as Record<string, unknown>;
        for (const k of ['D', 'e', 'L', 'rr', 'rw', 'Db', 'tMin', 'gap', 'wall', 'Treq', 'Tdes', 'Kc', 'KcLife', 'rpm', 'reqLifeH']) g2[k] = 1e308;
      }
      break;
    case 'everything 0':
      for (const slot of ['J1', 'J2', 'J3', 'J4', 'custom'] as const) {
        const g2 = s.gearboxes[slot] as unknown as Record<string, unknown>;
        for (const k of ['Zp', 'Zw', 'D', 'e', 'L', 'rr', 'rw', 'Db', 'tMin', 'gap', 'wall', 'Treq', 'Tdes', 'Kc', 'KcLife', 'rpm', 'reqLifeH']) g2[k] = 0;
      }
      break;
    case 'arm negatives':
      s.arm.joints.forEach((j, i) => { j.mass_g = -(i + 1); j.length_mm = i === 0 ? -1 : 0; }); s.arm.SF = -1; s.arm.payload_g = -9;
      break;
    case 'arm 1e308':
      s.arm.joints.forEach((j) => { j.mass_g = 1e308; j.linkMass_g = 1e308; j.length_mm = 1e308; j.alpha = 1e308; }); s.arm.payload_g = 1e308;
      break;
    case 'arm zeros':
      s.arm.joints.forEach((j) => { j.mass_g = 0; j.linkMass_g = 0; j.length_mm = 0; j.alpha = 0; });
      s.arm.payload_g = 0; s.arm.SF = 0.0001; s.arm.TdesFloor = 0;
      break;
    case 'material zeros':
      for (const slot of ['J1', 'J2', 'J3', 'J4', 'custom'] as const) {
        const m = s.gearboxes[slot].discMaterial;
        m.E = 0; m.Sy = 0; m.sigmaF = 0; m.density = 0; m.nu = 0.9;
        s.gearboxes[slot].outerPin.shankDia = 0; s.gearboxes[slot].innerPin.bore = 99; s.gearboxes[slot].bearing.C = 0;
      }
      break;
    default:
      throw new Error(name);
  }
  return s;
}

describe('audit: hostile inputs never show NaN / Infinity / undefined and never crash a screen', () => {
  const names = ['zp<8, negatives', 'e huge', 'e huge, Zp 8', 'D huge', 'everything 1e308', 'everything 0', 'arm negatives',
    'arm 1e308', 'arm zeros', 'material zeros'];
  for (const name of names) {
    for (const [sn, Screen, step] of [['arm', ArmScreen, 1], ['gearbox', GearboxScreen, 2], ['advisor', AdvisorScreen, 3], ['joints', JointsScreen, 4]] as const) {
      for (const units of [METRIC, IMPERIAL]) {
        it(`${name} / ${sn} / ${units.length}`, () => {
          const s = hostile(name);
          s.step = step;
          s.units = { ...units };
          for (const slot of ['J1', 'J2', 'J3', 'J4', 'custom'] as const) {
            s.selected = slot === 'custom' ? 'J2' : s.selected; // keep default selection; all slots are hostile anyway
          }
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const html = render(s, Screen);
          const t = text(html);
          expect(t.length).toBeGreaterThan(100);
          expect(html, `${name}/${sn}`).not.toMatch(/NaN|Infinity|undefined|\[object/);
        });
      }
    }
  }
  it('custom slot selected', () => {
    for (const [Screen, step] of [[GearboxScreen, 2], [AdvisorScreen, 3]] as const) {
      const s = hostile('zp<8, negatives');
      s.selected = 'custom';
      s.step = step;
      const html = render(s, Screen);
      expect(html).not.toMatch(/NaN|Infinity|undefined|\[object/);
    }
  });
});

describe('audit: one bad field shows its own inline message, never the "cannot be computed" fallback', () => {
  type Patch = (g: Session['gearboxes']['J2']) => void;
  const cases: [string, Patch, string][] = [
    ['Zp 3', (g) => { g.Zp = 3; }, 'Zp must be an integer from 8 to 200'],
    ['Zp 8.5', (g) => { g.Zp = 8.5; }, 'Zp must be an integer'],
    ['Zw 2', (g) => { g.Zw = 2; }, 'Zw must be an integer'],
    ['D -1', (g) => { g.D = -1; }, 'D must be > 0 mm'],
    ['e 0', (g) => { g.e = 0; }, 'e must be > 0 mm'],
    ['e huge', (g) => { g.e = 40; }, 'K1 = e*Zp/Rp'],
    ['L 0', (g) => { g.L = 0; }, 'L must be > 0 mm'],
    ['rr 0', (g) => { g.rr = 0; }, 'rr must be > 0 mm'],
    ['rw 0', (g) => { g.rw = 0; }, 'rw must be > 0 mm'],
    ['Db -1', (g) => { g.Db = -1; }, 'Db must be >= 0 mm'],
    ['tMin -1', (g) => { g.tMin = -1; }, 't_min must be >= 0 mm'],
    ['gap -1', (g) => { g.gap = -1; }, 'gap must be >= 0 mm'],
    ['wall -1', (g) => { g.wall = -1; }, 'wall must be >= 0 mm'],
    ['Rw override -5', (g) => { g.RwOverride = -5; }, 'Rw override must be > 0 mm'],
    ['Kc 0', (g) => { g.Kc = 0; }, 'Kc must be > 0'],
    ['KcLife 0', (g) => { g.KcLife = 0; }, 'Kc_life must be > 0'],
    ['rpm 0', (g) => { g.rpm = 0; }, 'Input speed must be > 0 rpm'],
    ['life -1', (g) => { g.reqLifeH = -1; }, 'Required life must be >= 0 h'],
    ['share 2', (g) => { g.discShare = 2; }, 'Disc share must be in (0, 1]'],
    ['bearing C 0', (g) => { g.bearing.C = 0; }, 'Bearing C must be > 0 N'],
    ['bearing C0 0', (g) => { g.bearing.C0 = 0; }, 'Bearing C0 must be > 0 N'],
    ['E 0', (g) => { g.discMaterial.E = 0; }, 'E must be > 0 MPa'],
    ['nu 0.6', (g) => { g.discMaterial.nu = 0.6; }, 'Poisson ratio must be in'],
    ['Sy 0', (g) => { g.discMaterial.Sy = 0; }, 'yield strength must be > 0 MPa'],
    ['sigmaF 0', (g) => { g.discMaterial.sigmaF = 0; }, 'fatigue strength must be > 0 MPa'],
    ['density 0', (g) => { g.discMaterial.density = 0; }, 'density must be > 0 g/cm3'],
    ['shank 0', (g) => { g.outerPin.shankDia = 0; }, 'Bolt shank diameter must be > 0 mm'],
    ['bolt yield 0', (g) => { g.outerPin.boltYield = 0; }, 'Bolt yield must be > 0 MPa'],
    ['standoff od 0', (g) => { g.innerPin.od = 0; }, 'Standoff OD must be > 0 mm'],
    ['standoff bore 9', (g) => { g.innerPin.bore = 9; }, 'Standoff bore must be smaller than its OD'],
    ['standoff yield 0', (g) => { g.innerPin.standoffYield = 0; }, 'Standoff yield must be > 0 MPa'],
  ];
  for (const [name, patch, msg] of cases) {
    it(name, () => {
      const s = specCaseSession(METRIC);
      patch(s.gearboxes.J2);
      const t = text(render(s, GearboxScreen));
      expect(t).toContain(msg);
      // pure geometry failures (K1 >= 1, pin circle too small) are shown in the banner as well as on the field
      if (name !== 'e huge') expect(t).not.toContain('This geometry cannot be computed');
      expect(t).not.toMatch(/NaN|Infinity|undefined/);
    });
  }

  it('the same messages follow the unit choice in imperial', () => {
    const s = specCaseSession(IMPERIAL);
    s.gearboxes.J2.D = -1;
    s.gearboxes.J2.e = 0;
    const t = text(render(s, GearboxScreen));
    expect(t).toContain('D must be > 0.000 in');
    expect(t).not.toMatch(/must be > 0 mm/);
  });

  const armCases: [string, (a: Session['arm']) => void, string][] = [
    ['bar length', (a) => { a.joints[1].length_mm = -5; }, 'Bar length 2 must be >= 0'],
    ['joint mass', (a) => { a.joints[2].mass_g = -5; }, 'Joint mass 3 must be >= 0'],
    ['bar mass', (a) => { a.joints[0].linkMass_g = -5; }, 'Bar mass 1 must be >= 0'],
    ['alpha', (a) => { a.joints[4].alpha = -1; }, 'Angular acceleration 5 must be >= 0'],
    ['payload', (a) => { a.payload_g = -1; }, 'Payload must be >= 0 g'],
    ['SF', (a) => { a.SF = 0; }, 'Service factor must be > 0'],
    ['floor', (a) => { a.TdesFloor = -1; }, 'T_des floor must be >= 0 N*m'],
    ['override', (a) => { a.joints[1].override.Treq = -2; }, 'Manual T_req for J2 must be >= 0'],
  ];
  for (const [name, patch, msg] of armCases) {
    it(`arm: ${name}`, () => {
      const s = defaultSession();
      s.step = 1;
      patch(s.arm);
      const t = text(render(s, ArmScreen));
      expect(t).toContain(msg);
      expect(t).toContain('The arm model cannot be computed yet');
      expect(t).not.toMatch(/NaN|Infinity|undefined/);
    });
  }
});

describe('audit: every number is tagged with the right quantity', () => {
  it('check rows: value and limit always share one unit', () => {
    for (const units of [METRIC, IMPERIAL, ALL]) {
      const t = text(render(specCaseSession(units), GearboxScreen));
      const pairs = [...t.matchAll(/(-?[\d,]+(?:\.\d+)?|—) ([^\s\d]+) [≤≥] ([\d,]+(?:\.\d+)?) ([^\s\d]+)/g)];
      expect(pairs.length, `${units.length}: found check rows`).toBeGreaterThanOrEqual(10);
      for (const m of pairs) expect(m[2], m[0]).toBe(m[4]);
      // stress rows carry the stress unit, length rows the length unit, force the force unit
      const unitOf = (label: string) => new RegExp(label + String.raw`.{0,200}?[\d.,]+ ([^\s\d]+) [≤≥]`).exec(t)?.[1];
      expect(unitOf('Ring contact, strength')).toBe(units.stress);
      expect(unitOf('Inner hole contact, life')).toBe(units.stress);
      expect(unitOf('Outer bolt bending')).toBe(units.stress);
      expect(unitOf('Ligament to bore')).toBe(units.length);
      expect(unitOf('Ligament between holes')).toBe(units.length);
      expect(unitOf('Cusp / undercut')).toBe(units.length);
      expect(unitOf('Bearing static')).toBe(units.force);
      expect(unitOf('Bearing life .L10h.')).toBe('h');
    }
  });

  it('ratios, K1, counts, angles, utilization and rpm are never converted', () => {
    const base = text(render(specCaseSession(METRIC), GearboxScreen));
    const imp = text(render(specCaseSession(ALL), GearboxScreen));
    for (const label of ['Gear ratio', 'K1 (eccentricity ratio)', 'MAX UTILIZATION']) {
      expect(after(imp, label, 24), label).toBe(after(base, label, 24));
    }
    expect(imp).toMatch(/17:1/);
    expect(imp).toMatch(/θ = 0°/);
    expect(imp).toMatch(/Loaded outer pins \d+ of 18/);
    for (const m of imp.matchAll(/(?:Utilization|utilization)[^.]{0,40}?(\d\.\d\d)/g)) expect(Number(m[1])).toBeLessThan(100);
    // rpm and required life keep their own fixed units in the input boxes (Advanced is closed but rendered)
    const html = render(specCaseSession(ALL), GearboxScreen);
    expect(html).toMatch(/value="300"/);
    expect(html).toMatch(/value="2000"/);
    expect(html).toMatch(/<span class="nf-unit" aria-hidden="true">rpm<\/span>/);
    expect(html).toMatch(/<span class="nf-unit" aria-hidden="true">h<\/span>/);
  });

  it('arm diagram: lengths and masses on the right labels, converted once', () => {
    const s = defaultSession();
    s.step = 1;
    s.armPose = 'worst'; // the reach dimension belongs to the worst-case (straight out) view
    s.arm.joints[0].length_mm = 100; // the default column is 0 mm (no dimension drawn); give it the old 100 mm to check the unit conversion
    s.units = { ...IMPERIAL };
    const t = text(render(s, ArmScreen));
    // riser 100 mm / 80 g, bar A 230 mm / 110 g, B 200 / 90, C 80 / 40, D 110 / 70, payload 250 g
    expect(t).toContain('3.937 in 2.82 oz'); // riser
    for (const pair of ['9.055 in 3.88 oz', '7.874 in 3.17 oz', '3.150 in 1.41 oz', '4.331 in 2.47 oz']) expect(t).toContain(pair);
    expect(t).toContain('REACH 24.409 in');
    expect(t).toContain('8.82 oz'); // payload
    expect(t).toContain('15.87 oz'); // J1 450 g
    // inputs: lengths are lengths, masses are masses
    const html = render(s, ArmScreen);
    expect(html).toMatch(/value="9\.055"/); // bar A
    expect(html).toMatch(/value="15\.87"/); // J1 mass in oz
    expect(html).toMatch(/value="8\.82"/); // payload
    expect(html).toMatch(/value="1\.5"/);
  });

  it('arm diagram: J1 is a yaw turntable, J2 starts bar A, J4 is a roll collar, and the names agree everywhere', () => {
    const s = defaultSession();
    s.step = 1;
    const html = render(s, ArmScreen);
    const t = text(html);
    // joints are labelled "J<position> <name>" everywhere, in the drawing, the editor and the torque table
    for (const name of ['J1 base yaw', 'J2 shoulder pitch', 'J3 elbow pitch', 'J4 forearm roll', 'J5 wrist pitch']) expect(t, name).toContain(name);
    expect(t).not.toMatch(/riser/i);
    expect(html).toContain('Link length to the next joint');
    expect(html).toContain('Tool length, joint to tip'); // the last joint carries the tool
    const fig = html.slice(html.indexOf('<div class="armfig">'), html.indexOf('</svg>', html.indexOf('<div class="armfig">')));
    expect(fig).toContain('class="dr-roll"'); // roll symbol, not a pitch circle
    expect(fig).toContain('dr-axis'); // vertical J1 axis
    expect(fig.match(/class="dr-joint"/g)?.length).toBe(3); // pitch circles: J2, J3, J5, never J1 (turntable) or J4 (roll collar)
    expect(t).toContain('DOF 5');
    expect(t).toContain('Ready pose');
  });

  it('charts: axis units and limit labels follow the stress and force units', () => {
    for (const [units, stress, force, lim] of [[METRIC, 'MPa', 'N', 'strength limit 461'], [IMPERIAL, 'ksi', 'lbf', 'strength limit 67'], [ALL, 'psi', 'lbf', `strength limit ${Math.round(1.67 * 276 / (6.894757293168361 / 1000)).toLocaleString('en-US')}`]] as const) {
      const html = render(specCaseSession(units), GearboxScreen);
      expect(html).toMatch(new RegExp(`class="ch-axis ch-unit"[^>]*>${stress}<`));
      expect(html).toMatch(new RegExp(`class="ch-axis ch-unit"[^>]*>${force}<`));
      expect(text(html).match(/strength limit [\d,.]+/)?.[0]).toBe(lim);
    }
  });

  const esc = (x: string) => x.split('.').join(String.fromCharCode(92) + '.');

  it('stock thickness: option value is the exact mm and the label is the right fraction', () => {
    const html = render(specCaseSession(IMPERIAL), GearboxScreen);
    const want: [string, string][] = [['3.175', '1/8'], ['4.76', '3/16'], ['6.35', '1/4'], ['9.525', '3/8'], ['12.7', '1/2']];
    for (const [mm, frac] of want) {
      expect(html, mm).toMatch(new RegExp(String.raw`<option value="${esc(mm)}"[^>]*>${frac}(?:&quot;|")\s?plate</option>`));
    }
    // metric keeps millimetres, with enough digits to tell 3.175 from 3.18
    const m = render(specCaseSession(METRIC), GearboxScreen);
    for (const [mm] of want) expect(m, mm).toMatch(new RegExp(String.raw`<option value="${esc(mm)}"[^>]*>${mm} mm</option>`));
    // the selected stock for the 6.35 mm default
    expect(m).toMatch(/<option value="6\.35" selected/);
  });

  it('imperial: no unconverted metric quantity on any screen', () => {
    for (const [Screen, step] of [[ArmScreen, 1], [GearboxScreen, 2], [AdvisorScreen, 3], [JointsScreen, 4]] as const) {
      const s = defaultSession();
      s.step = step;
      s.units = { ...ALL };
      const t = text(render(s, Screen))
        .replace(/\d+×\d+×\d+ mm/g, '').replace(/g\/cm³/g, '').replace(/\d+(?:\.\d+)? mm \(\d+\.\d+ in\)/g, '');
      const bad = t.match(/\d(?:\.\d+)?\s?(mm|MPa|GPa|N·m|N\*m)(?![\w/·*²³])/g);
      expect(bad, `step ${step}: ${bad?.join(' | ')}`).toBeNull();
      expect(t).not.toMatch(/\d\s?N(?![\w·*])/); // forces are lbf here
    }
  });
});
