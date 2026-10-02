// Every setting the user can change has an (i) info tip next to it. The workbench inspector sections, the Design
// Advisor (settings and lock rows), the DXF panel, the arm settings, the rail's add-joint chooser and the pose sliders are
// rendered to static markup in the real store, parsed into a small tree, and every form control must sit in a field
// container (a form row, a lock row, a switch row, ...) that also holds an "About …" button. A new control without help
// fails here.
import { createElement, type ComponentType } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it } from 'vitest';
import { materialProps, type MotorSpec } from '../../calc';
import { LOCK_VAR_KEYS } from '../advisorLocks';
import { DXF_HELP, HELP, LOCK_HELP, type HelpEntry } from '../help';
import { defaultSession, STORAGE_KEY, type Session } from '../session';
import { StoreProvider } from '../store';
import { IMPERIAL, localizeText } from '../units';
import { Rail } from '../workbench/Rail';
import { AdvisorScreen, ArmScreen, GearboxScreen, PoseExplorer } from './workbenchScreens';

const DXF_KEY = 'cycloid-calc-dxf-options-v1';
const g = globalThis as unknown as { window?: unknown };
afterEach(() => { delete g.window; });

function render(session: Session, Screen: ComponentType, dxf?: object): string {
  const store: Record<string, string> = { [STORAGE_KEY]: JSON.stringify(session) };
  if (dxf) store[DXF_KEY] = JSON.stringify(dxf);
  g.window = { localStorage: { getItem: (k: string) => store[k] ?? null, setItem: () => {}, removeItem: () => {} } };
  return renderToStaticMarkup(createElement(StoreProvider, null, createElement(Screen)));
}

// ---------------------------------------------------------------------------
// A small tree builder for React's static markup (well formed, attributes quoted and escaped)
// ---------------------------------------------------------------------------

interface El { tag: string; attrs: Record<string, string>; children: El[]; parent: El | null }

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const decode = (s: string) => s.replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

function parse(html: string): El {
  const root: El = { tag: '#root', attrs: {}, children: [], parent: null };
  let cur = root;
  const re = /<!--[\s\S]*?-->|<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s=>/]+(?:="[^"]*")?)*)\s*(\/?)>/g;
  let last = 0;
  for (let m = re.exec(html); m; m = re.exec(html)) {
    const between = html.slice(last, m.index);
    last = re.lastIndex;
    if (between) cur.children.push({ tag: '#text', attrs: { value: decode(between) }, children: [], parent: cur });
    if (m[0].startsWith('<!--')) continue;
    const [, close, rawTag, rawAttrs, selfClose] = m;
    const tag = rawTag.toLowerCase();
    if (close) {
      // pop to the matching open tag
      let n: El | null = cur;
      while (n && n.tag !== tag) n = n.parent;
      if (!n || !n.parent) throw new Error(`unbalanced </${tag}>`);
      cur = n.parent;
      continue;
    }
    const attrs: Record<string, string> = {};
    for (const a of rawAttrs.matchAll(/([^\s=>/]+)(?:="([^"]*)")?/g)) attrs[a[1]] = decode(a[2] ?? '');
    const el: El = { tag, attrs, children: [], parent: cur };
    cur.children.push(el);
    if (!selfClose && !VOID.has(tag)) cur = el;
  }
  return root;
}

function* walk(el: El): Generator<El> {
  for (const c of el.children) {
    yield c;
    yield* walk(c);
  }
}
const cls = (el: El) => (el.attrs.class ?? '').split(/\s+/).filter(Boolean);
const isAbout = (el: El) => el.tag === 'button' && cls(el).includes('infotip-btn') && /^About \S/.test(el.attrs['aria-label'] ?? '');

/** Containers that hold one setting (or one advisor variable) and its tip. */
const FIELD_CONTAINERS = ['row', 'lv-row', 'switch-row', 'seg-tip', 'dxf-toggle', 'dxf-units', 'pz-slider', 'insp-title-row', 'theta-controls'];

/** Everything the user can change: inputs, selects, segmented controls, switches and the advisor's lock buttons. */
function isControl(el: El): boolean {
  if (el.tag === 'input') return el.attrs.type !== 'hidden';
  if (el.tag === 'select' || el.tag === 'textarea') return true;
  const role = el.attrs.role;
  if (role === 'radiogroup' || role === 'switch') return true;
  return el.tag === 'button' && cls(el).includes('lock-btn');
}

const textOf = (el: El): string => el.children.map((c) => (c.tag === '#text' ? c.attrs.value : textOf(c))).join('');

function describeControl(el: El, root: El): string {
  const id = el.attrs.id;
  const lab = id ? [...walk(root)].find((x) => x.tag === 'label' && x.attrs.for === id) : undefined;
  const name = el.attrs['aria-label'] ?? (lab ? textOf(lab).trim() : undefined) ?? id ?? el.attrs.name ?? '';
  return `<${el.tag}${el.attrs.role ? ` role=${el.attrs.role}` : ''}${el.attrs.type ? ` type=${el.attrs.type}` : ''}> ${name}`;
}

/** Controls whose field container has no "About …" button (or that sit in no field container at all). */
function controlsWithoutHelp(html: string): { missing: string[]; controls: number; tips: number } {
  const root = parse(html);
  const missing: string[] = [];
  let controls = 0;
  let tips = 0;
  for (const el of walk(root)) {
    if (isAbout(el)) tips++;
    if (!isControl(el)) continue;
    controls++;
    let box: El | null = el.parent;
    while (box && !cls(box).some((c) => FIELD_CONTAINERS.includes(c))) box = box.parent;
    if (!box) { missing.push(`${describeControl(el, root)} (in no field container)`); continue; }
    const hasTip = [...walk(box)].some(isAbout);
    if (!hasTip) missing.push(`${describeControl(el, root)} (in .${cls(box).join('.')})`);
  }
  return { missing, controls, tips };
}

// ---------------------------------------------------------------------------
// Sessions that show every variant of the controls
// ---------------------------------------------------------------------------

const MOTOR: MotorSpec = { name: 'NEMA 17 (typical)', Tpeak_Nm: 0.45, Tcont_Nm: 0.3, maxSpeed_rpm: 1000, requiredSpeed_degps: 90, efficiency: 0.85 };

function withMotors(): Session {
  const s = defaultSession();
  s.arm.joints = s.arm.joints.map((j) => ({ ...j, motor: { ...MOTOR } }));
  return s;
}

/** Custom slot, solid pins of PLA, polymer disc: the solid-pin rows, the material type and the "copy from" select. */
function customSolid(): Session {
  const s = defaultSession();
  s.selected = 'custom';
  const gb = s.gearboxes.custom;
  s.gearboxes.custom = {
    ...gb,
    discMaterial: materialProps('petg' as never),
    outerPin: { ...gb.outerPin, construction: 'solid', material: materialProps('pla' as never) },
    innerPin: { ...gb.innerPin, construction: 'solid', material: materialProps('pla' as never) },
  };
  return s;
}

/** Every advisor variable locked, with custom pin and bearing values and the housing limit on, plus a motor. */
function allLocked(): Session {
  const s = withMotors();
  s.selected = 'J2';
  const on = Object.fromEntries(LOCK_VAR_KEYS.map((k) => [k, true])) as Record<(typeof LOCK_VAR_KEYS)[number], boolean>;
  s.advisorLocks.J2 = {
    on,
    ratioMotor: false,
    limitOn: true,
    values: {
      Zp: 18, D: 70, e: 1.2, Zw: 6, L: 6.35, discs: 2,
      outerPin: { kind: 'custom', od: 5, shank: 3 },
      innerPin: { kind: 'custom', od: 5, bore: 2.46 },
      bearing: { kind: 'custom', name: 'My bearing', bore: 10, OD: 19, C: 1380, C0: 585 },
      maxHousingOD: 100,
    },
  } as Session['advisorLocks'][string];
  return s;
}

const DXF_ALL_ON = { units: 'mm', profileClearance: 0.1, pointsPerLobe: null, maxChordError: 0.005, discHoleClearance: 0, pinHoleClearance: 0.2,
  shaftDia: 5, bearingBore: null, housingCentreHole: true, housingCentreDia: 10, plateOutlineDia: null, outputCentreHole: true, outputCentreDia: 10 };

const RailScreen = () => createElement(Rail);

const CASES: { name: string; session: () => Session; screen: ComponentType; dxf?: object; min: number }[] = [
  { name: 'J2 inspector, every section open (design, loads, motor, solver, advisor, DXF, disc)', session: withMotors, screen: GearboxScreen, min: 60 },
  { name: 'J2 inspector, DXF with chord error and both centre holes', session: defaultSession, screen: GearboxScreen, dxf: DXF_ALL_ON, min: 60 },
  { name: 'Custom gearbox with solid PLA pins and a PETG disc', session: customSolid, screen: GearboxScreen, min: 50 },
  { name: 'Arm item and every joint (Joint & link, Motor & ratio, Loads, pose sliders, schematic)', session: withMotors, screen: ArmScreen, min: 60 },
  { name: 'Design Advisor with every variable locked to custom values', session: allLocked, screen: AdvisorScreen, min: 20 },
  { name: 'Design Advisor, defaults', session: defaultSession, screen: AdvisorScreen, min: 10 },
  { name: 'Pose Explorer with the All angles popover', session: defaultSession, screen: PoseExplorer, min: 5 },
  { name: 'Rail add-joint chooser', session: defaultSession, screen: RailScreen, min: 1 },
];

describe('every editable control has an info tip', () => {
  for (const c of CASES) {
    it(c.name, () => {
      const html = render(c.session(), c.screen, c.dxf);
      const { missing, controls } = controlsWithoutHelp(html);
      expect(controls, 'the render should contain the controls this case is about').toBeGreaterThanOrEqual(c.min);
      expect(missing).toEqual([]);
    });
  }

  it('the check itself catches a control without a tip', () => {
    const bad = '<div class="row"><div class="row-label"><label for="x">Thing</label></div><div class="row-control"><input id="x" type="text"/></div></div>';
    expect(controlsWithoutHelp(bad).missing).toEqual(['<input type=text> Thing (in .row)']);
    const loose = '<div><select aria-label="Loose"><option>a</option></select></div>';
    expect(controlsWithoutHelp(loose).missing[0]).toMatch(/no field container/);
    const good = '<div class="row"><div class="row-label"><label for="x">Thing</label><button type="button" class="infotip-btn" aria-label="About Thing">i</button></div><input id="x" type="text"/></div>';
    expect(controlsWithoutHelp(good)).toMatchObject({ missing: [], controls: 1, tips: 1 });
  });

  it('the new control tips show their own entries', () => {
    const html = render(withMotors(), GearboxScreen);
    for (const label of ['Stock thickness', 'Bolt and bushing size', 'Bushing material', 'Standoff size', 'Standoff material', 'Inner pin support',
      'Eccentric bearing', 'Loads from arm model', 'Discs', 'Motion type', 'Drive', 'Pose angle', 'Points per lobe', 'Profile clearance']) {
      expect(html, label).toContain(`aria-label="About ${label}"`);
    }
    expect((html.match(/aria-label="About Construction"/g) ?? []).length).toBe(2);
  });
});

describe('help maps', () => {
  const all: [string, HelpEntry][] = [
    ...Object.entries(HELP).map(([k, h]) => [`HELP.${k}`, h] as [string, HelpEntry]),
    ...Object.entries(LOCK_HELP).map(([k, h]) => [`LOCK_HELP.${k}`, h] as [string, HelpEntry]),
    ...Object.entries(DXF_HELP).map(([k, h]) => [`DXF_HELP.${k}`, h] as [string, HelpEntry]),
  ];

  it('cover every advisor lock row and DXF option', () => {
    for (const k of [...LOCK_VAR_KEYS, 'maxHousingOD']) expect(LOCK_HELP[k], k).toBeDefined();
    for (const k of ['units', 'profileClearance', 'resolution', 'discHoleClearance', 'pinHoleClearance', 'shaftDia', 'bearingBore', 'housingCentre', 'plateOutline', 'outputCentre']) {
      expect(DXF_HELP[k], k).toBeDefined();
    }
  });

  it('every entry says what it is; every text is a sentence-like, non-empty string', () => {
    for (const [key, h] of all) {
      expect(h.what.trim().length, key).toBeGreaterThan(10);
      for (const f of ['why', 'up', 'down', 'typical', 'formula'] as const) {
        if (h[f] !== undefined) expect(h[f]!.trim().length, `${key}.${f}`).toBeGreaterThan(0);
      }
    }
  });

  it('no dimension chain like "10 × 19 × 5 mm" (only the last number would be converted to inches)', () => {
    for (const [key, h] of all) {
      for (const t of [h.what, h.why, h.up, h.down, h.typical, h.formula]) {
        if (!t) continue;
        expect(t, key).not.toMatch(/\d\s*[×x]\s*[\d.]+\s*[×x]\s*[\d.]+\s*(mm|in)\b/);
        // and the inch text never mixes a bare metric number into a converted one
        expect(localizeText(t, IMPERIAL), key).not.toMatch(/\d\s*[×x]\s*[\d.]+ in\b/);
      }
    }
  });
});
