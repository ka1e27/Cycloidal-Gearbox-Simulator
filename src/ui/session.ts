// Session model: everything the app remembers. Pure TypeScript (no React), so it is easy to test.

import {
  JOINT_IDS,
  PRESETS,
  computeArm,
  defaultArmInputs,
  defaultGearboxInputs,
  normalizeArmInputs,
  normalizeGearboxInputs,
  validateArmInputs,
  validateGearboxInputs,
  type ArmInputs,
  type ArmResult,
  type GearboxInputs,
  type JointId,
} from '../calc';
import { METRIC, normalizeUnits, type UnitPrefs } from './units';

export type Step = 1 | 2 | 3 | 4;
export type Slot = JointId | 'custom';
export type ThemePref = 'system' | 'light' | 'dark';

export const SLOTS: readonly Slot[] = [...JOINT_IDS, 'custom'];
export const STORAGE_KEY = 'cgd.session.v1';
export const APP_ID = 'cycloidal-gearbox-designer';

export interface AdvisorUiOptions {
  target: number;
  ratioVary: boolean;
  Dmin: number;
  Dmax: number;
  minPinClearance: number;
  altWindowMm: number;
}

export interface Session {
  version: 1;
  step: Step;
  theme: ThemePref;
  /** Display units only. Everything stored in this session stays SI (mm, g, N, N*m, MPa). */
  units: UnitPrefs;
  arm: ArmInputs;
  /** Stored inputs for J1..J4 and the Custom slot. Torques here are the manual ones. */
  gearboxes: Record<Slot, GearboxInputs>;
  /** "Loads from arm model" toggle per joint (Custom is always manual). */
  useArmLoads: Record<JointId, boolean>;
  selected: Slot;
  advisor: AdvisorUiOptions;
  /** Steps whose first-visit hint was dismissed */
  hintsSeen: Record<string, boolean>;
}

export const defaultAdvisorOptions = (): AdvisorUiOptions => ({
  target: 0.85, ratioVary: false, Dmin: 30, Dmax: 150, minPinClearance: 1, altWindowMm: 15,
});

/** The geometry/material preset a slot starts from (and is compared against for the "modified" dots). */
export function presetFor(slot: Slot): GearboxInputs {
  return slot === 'custom' ? defaultGearboxInputs() : PRESETS[slot];
}

export function defaultSession(): Session {
  const gearboxes = {} as Record<Slot, GearboxInputs>;
  for (const s of SLOTS) gearboxes[s] = structuredClone(presetFor(s));
  return {
    version: 1,
    step: 1,
    theme: 'system',
    units: { ...METRIC },
    arm: defaultArmInputs(),
    gearboxes,
    useArmLoads: { J1: true, J2: true, J3: true, J4: true },
    selected: 'J2',
    advisor: defaultAdvisorOptions(),
    hintsSeen: {},
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown, fallback: number, lo: number, hi: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;

/** Build a full, safe Session from anything (localStorage, imported JSON). Never throws. */
export function normalizeSession(raw: unknown, base: Session = defaultSession()): Session {
  if (!isObj(raw)) return base;
  const out: Session = { ...base, gearboxes: { ...base.gearboxes }, useArmLoads: { ...base.useArmLoads } };
  try {
    if (raw.step === 1 || raw.step === 2 || raw.step === 3 || raw.step === 4) out.step = raw.step;
    if (raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark') out.theme = raw.theme;
    if ('units' in raw) out.units = normalizeUnits(raw.units);
    if ('arm' in raw) out.arm = normalizeArmInputs(raw.arm);
    if (isObj(raw.gearboxes)) {
      for (const s of SLOTS) {
        const g = raw.gearboxes[s];
        if (g !== undefined) {
          const n = normalizeGearboxInputs(g);
          // a missing or garbled geometry/load field falls back to this joint's preset, not the generic default
          const p = presetFor(s);
          const have = isObj(g) ? g : {};
          for (const k of ['D', 'e', 'Treq', 'Tdes', 'discs'] as const) {
            if (!(typeof have[k] === 'number' && Number.isFinite(have[k]))) n[k] = p[k];
          }
          out.gearboxes[s] = n;
        }
      }
    }
    if (isObj(raw.useArmLoads)) {
      for (const j of JOINT_IDS) if (typeof raw.useArmLoads[j] === 'boolean') out.useArmLoads[j] = raw.useArmLoads[j] as boolean;
    }
    if (typeof raw.selected === 'string' && (SLOTS as readonly string[]).includes(raw.selected)) out.selected = raw.selected as Slot;
    if (isObj(raw.advisor)) {
      const a = raw.advisor;
      const d = defaultAdvisorOptions();
      out.advisor = {
        target: fin(a.target, d.target, 0.7, 1.0),
        ratioVary: typeof a.ratioVary === 'boolean' ? a.ratioVary : d.ratioVary,
        Dmin: fin(a.Dmin, d.Dmin, 10, 400),
        Dmax: fin(a.Dmax, d.Dmax, 10, 400),
        minPinClearance: fin(a.minPinClearance, d.minPinClearance, 0, 20),
        altWindowMm: fin(a.altWindowMm, d.altWindowMm, 0, 100),
      };
    }
    if (isObj(raw.hintsSeen)) {
      const h: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(raw.hintsSeen)) if (v === true) h[k] = true;
      out.hintsSeen = h;
    }
  } catch {
    return base;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Persistence (every storage access is wrapped: the app must work when storage throws)
// ---------------------------------------------------------------------------

export function loadSession(): Session {
  try {
    const txt = window.localStorage.getItem(STORAGE_KEY);
    if (!txt) return defaultSession();
    return normalizeSession(JSON.parse(txt));
  } catch {
    return defaultSession();
  }
}

export function saveSession(s: Session): boolean {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    return true;
  } catch {
    return false;
  }
}

export function clearSavedSession(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable */
  }
}

// ---------------------------------------------------------------------------
// Export / import
// ---------------------------------------------------------------------------

export function exportSession(s: Session): string {
  const { arm, gearboxes, useArmLoads, selected, advisor } = s;
  return JSON.stringify(
    { app: APP_ID, version: 1, exportedAt: new Date().toISOString(), note: 'All values in this file are SI: lengths in mm, masses in g, forces in N, torques in N*m, stresses in MPa, whatever display units were selected.', arm, gearboxes, useArmLoads, selected, advisor },
    null,
    2,
  );
}

export type ImportOutcome =
  | { ok: true; session: Session; issues: string[] }
  | { ok: false; error: string };

/** Parse an exported file. Bad files give a friendly error; odd values are normalized and reported. */
export function importSession(text: string, current: Session): ImportOutcome {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'That file is not valid JSON. Choose a file exported from this app.' };
  }
  if (!isObj(raw)) return { ok: false, error: 'That file does not contain a saved session (expected a JSON object).' };
  if (!('arm' in raw) && !('gearboxes' in raw)) {
    return { ok: false, error: 'That file has no arm or gearbox data, so it does not look like a session exported from this app.' };
  }
  if (typeof raw.version === 'number' && raw.version > 1) {
    return { ok: false, error: `That file was saved by a newer version of the app (format ${raw.version}).` };
  }
  // Keep the importing user's own UI state (step, theme, hints); take the engineering data from the file.
  const { step, theme, hintsSeen, units } = current;
  const base = defaultSession();
  const merged = normalizeSession({ ...raw, step, theme, hintsSeen, units }, { ...base, step, theme, hintsSeen, units });
  const issues: string[] = [];
  const armErr = validateArmInputs(merged.arm).errors;
  if (armErr.length) issues.push(`Arm: ${armErr[0]}`);
  for (const s of SLOTS) {
    const e = validateGearboxInputs(merged.gearboxes[s]).errors;
    if (e.length) issues.push(`${s === 'custom' ? 'Custom' : s}: ${e[0]}`);
  }
  return { ok: true, session: merged, issues };
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export const jointIndex = (j: JointId): number => JOINT_IDS.indexOf(j);

export function computeArmResult(arm: ArmInputs): ArmResult {
  return computeArm(arm);
}

/** True when this slot takes T_req / T_des from the arm model right now. */
export function loadsFromArm(s: Session, slot: Slot, arm: ArmResult): boolean {
  return slot !== 'custom' && s.useArmLoads[slot] && arm.valid;
}

/** The inputs that are actually checked: stored inputs with the arm torques applied when the toggle is on. */
export function effectiveInputs(s: Session, slot: Slot, arm: ArmResult): GearboxInputs {
  const g = s.gearboxes[slot];
  if (!loadsFromArm(s, slot, arm) || slot === 'custom') return g;
  const load = arm.joints[jointIndex(slot)];
  return { ...g, Treq: load.Treq, Tdes: load.Tdes };
}
