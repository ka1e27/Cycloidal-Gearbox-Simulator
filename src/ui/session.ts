// Session model: everything the app remembers. Pure TypeScript (no React), so it is easy to test.

import {
  FALLBACK_PRESET,
  JOINT_IDS,
  PRESETS,
  closestPresetId,
  computeArm,
  defaultToleranceSpec,
  defaultArmInputs,
  defaultGearboxInputs,
  jointLabel,
  normalizeArmInputs,
  normalizeGearboxInputs,
  validateArmInputs,
  validateGearboxInputs,
  type ArmInputs,
  type ArmResult,
  type GearboxInputs,
  type JointId,
} from '../calc';
import { defaultLockState, normalizeLockState, type AdvisorLockState } from './advisorLocks';
import { METRIC, normalizeUnits, type UnitPrefs } from './units';
import type { PoseMode } from './viz/armLayout';
import { ZOOM_MAX, ZOOM_MIN } from './viz/view3d';
import { defaultWorkbench, normalizeWorkbench, workbenchFromStep, type WorkbenchState } from './workbench/wbState';

/** A gearbox slot: the id of a cycloidal joint of the arm (ArmJoint.id), or 'custom'. */
export type Slot = string;
export const CUSTOM: Slot = 'custom';
export type ThemePref = 'system' | 'light' | 'dark';

export const STORAGE_KEY = 'cgd.session.v1';
export const APP_ID = 'cycloidal-gearbox-designer';

export interface AdvisorUiOptions {
  target: number;
  /** Legacy (sessions from before the design-variable locks): true meant the ratio was free. The lock state is the source of truth now. */
  ratioVary: boolean;
  Dmin: number;
  Dmax: number;
  minPinClearance: number;
  altWindowMm: number;
}

/** Pose explorer display state. Angles in degrees keyed by joint id; a joint without one uses the ready pose. */
export interface PoseViewState {
  angles: Record<string, number>;
  /** Camera azimuth and elevation, degrees (0, 0 = side view) */
  az: number;
  el: number;
  /** Show the weight arrows */
  weights: boolean;
  /** View zoom (0.25..8) and pan (px) on top of the fitted frame */
  zoom: number;
  px: number;
  py: number;
}
export const defaultPoseView = (): PoseViewState => ({ angles: {}, az: 0, el: 0, weights: true, zoom: 1, px: 0, py: 0 });

/** Safe pose view state from anything. Angles wrapped to (-180, 180], camera clamped. */
export function normalizePoseView(raw: unknown): PoseViewState {
  const d = defaultPoseView();
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return d;
  const r = raw as Record<string, unknown>;
  const f = (v: unknown, lo: number, hi: number, dflt: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : dflt);
  const angles: Record<string, number> = {};
  if (r.angles && typeof r.angles === 'object' && !Array.isArray(r.angles)) {
    for (const [k, v] of Object.entries(r.angles as Record<string, unknown>)) {
      if (typeof v === 'number' && Number.isFinite(v) && k.length <= 24) angles[k] = Math.max(-180, Math.min(180, v));
    }
  }
  return {
    angles, az: f(r.az, -180, 180, d.az), el: f(r.el, 0, 90, d.el), weights: typeof r.weights === 'boolean' ? r.weights : d.weights,
    zoom: f(r.zoom, ZOOM_MIN, ZOOM_MAX, d.zoom), px: f(r.px, -1e5, 1e5, d.px), py: f(r.py, -1e5, 1e5, d.py),
  };
}

export interface Session {
  version: 2;
  /**
   * Workbench layout: selection, stage tab, open inspector sections, panel sizes. Display only, never exported.
   * Replaces the old `step` (1..4) field, which old sessions still carry and is migrated on load.
   */
  wb: WorkbenchState;
  theme: ThemePref;
  /** Which pose the arm drawing shows. Display only: the torques always use the worst case. Not exported. */
  armPose: PoseMode;
  /** Pose explorer: joint angles, camera and toggles. Display only (the checks use the worst case). Not exported. */
  poseView: PoseViewState;
  /** Display units only. Everything stored in this session stays SI (mm, g, N, N*m, MPa). */
  units: UnitPrefs;
  arm: ArmInputs;
  /**
   * Stored gearbox inputs, keyed by joint id, plus the Custom slot. Torques here are the manual ones. A joint that
   * is switched to a servo keeps its entry (hidden), so switching back restores it; removing a joint deletes it.
   */
  gearboxes: Record<Slot, GearboxInputs>;
  /** Which SPEC preset a joint without a preset of its own (an added joint) started from. Joints J1..J4 use their own. */
  presetBase: Record<string, JointId>;
  /** "Loads from arm model" toggle per joint id (Custom is always manual). */
  useArmLoads: Record<string, boolean>;
  selected: Slot;
  advisor: AdvisorUiOptions;
  /** Design Advisor locks per joint id (and Custom): which variables are locked, and their values */
  advisorLocks: Record<Slot, AdvisorLockState>;
  /** Steps whose first-visit hint was dismissed */
  hintsSeen: Record<string, boolean>;
}

/** The cycloidal joints of the arm, in order: these are the joints that get a gearbox. */
export const gearboxJoints = (arm: ArmInputs) => arm.joints.filter((j) => j.drive === 'cycloidal');
/** Gearbox slots of the arm: its cycloidal joint ids in order, then Custom. */
export const slotsOfArm = (arm: ArmInputs): Slot[] => [...gearboxJoints(arm).map((j) => j.id), CUSTOM];
export const slotsOf = (s: Pick<Session, 'arm'>): Slot[] => slotsOfArm(s.arm);

/** "J3 elbow pitch" for a slot, "Custom" for Custom, or the id when the joint no longer exists. */
export function slotLabel(arm: ArmInputs, slot: Slot): string {
  if (slot === CUSTOM) return 'Custom';
  const i = arm.joints.findIndex((j) => j.id === slot);
  return i < 0 ? slot : jointLabel(arm.joints[i], i);
}
/** "J3" (position only) for a slot, "custom" for Custom. */
export function slotShort(arm: ArmInputs, slot: Slot): string {
  if (slot === CUSTOM) return 'custom';
  const i = arm.joints.findIndex((j) => j.id === slot);
  return i < 0 ? slot : `J${i + 1}`;
}

export const defaultAdvisorLocks = (): Record<Slot, AdvisorLockState> => {
  const out = {} as Record<Slot, AdvisorLockState>;
  for (const s of slotsOfArm(defaultArmInputs())) out[s] = defaultLockState();
  return out;
};

export const defaultAdvisorOptions = (): AdvisorUiOptions => ({
  target: 0.85, ratioVary: false, Dmin: 30, Dmax: 150, minPinClearance: 1, altWindowMm: 15,
});

const isPresetId = (x: unknown): x is JointId => typeof x === 'string' && (JOINT_IDS as readonly string[]).includes(x);

/** The SPEC preset a slot is based on: J1..J4 use their own, an added joint the one it started from (J3 if unknown). */
export function presetIdFor(slot: Slot, presetBase: Record<string, JointId> = {}): JointId {
  if (isPresetId(slot)) return slot;
  const b = presetBase[slot];
  return isPresetId(b) ? b : FALLBACK_PRESET;
}

/** The geometry/material preset a slot starts from (and is compared against for the "modified" dots). */
export function presetFor(slot: Slot, presetBase: Record<string, JointId> = {}): GearboxInputs {
  return slot === CUSTOM ? defaultGearboxInputs() : PRESETS[presetIdFor(slot, presetBase)];
}

/** Stored inputs of a slot; a joint that has none (a transient state) reads as its preset. */
export function gearboxOf(s: Pick<Session, 'gearboxes' | 'presetBase'>, slot: Slot): GearboxInputs {
  return s.gearboxes[slot] ?? presetFor(slot, s.presetBase);
}

export function defaultSession(): Session {
  const arm = defaultArmInputs();
  const gearboxes = {} as Record<Slot, GearboxInputs>;
  for (const s of slotsOfArm(arm)) gearboxes[s] = structuredClone(presetFor(s));
  const useArmLoads: Record<string, boolean> = {};
  for (const j of gearboxJoints(arm)) useArmLoads[j.id] = true;
  return {
    version: 2,
    wb: defaultWorkbench(),
    theme: 'system',
    armPose: 'ready',
    poseView: defaultPoseView(),
    units: { ...METRIC },
    arm,
    gearboxes,
    presetBase: {},
    useArmLoads,
    selected: 'J2',
    advisor: defaultAdvisorOptions(),
    advisorLocks: defaultAdvisorLocks(),
    hintsSeen: {},
  };
}

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const fin = (x: unknown, fallback: number, lo: number, hi: number) =>
  typeof x === 'number' && Number.isFinite(x) ? Math.min(hi, Math.max(lo, x)) : fallback;

/**
 * Make the per-joint parts of a session agree with its arm: every cycloidal joint has gearbox inputs (a new one starts
 * from the SPEC preset whose torque is closest to its arm-model T_req), a "loads from arm" flag and advisor locks;
 * entries of joints that no longer exist are dropped; the selected slot is one that exists. Servo joints keep their
 * gearbox entry (hidden) so switching back restores it. Pure: returns the same object when nothing changed.
 */
export function reconcileSession(s: Session): Session {
  const ids = new Set(s.arm.joints.map((j) => j.id));
  const cyc = gearboxJoints(s.arm);
  let changed = false;
  const gearboxes: Record<Slot, GearboxInputs> = {};
  const advisorLocks: Record<Slot, AdvisorLockState> = {};
  const useArmLoads: Record<string, boolean> = {};
  const presetBase: Record<string, JointId> = {};
  for (const [k, v] of Object.entries(s.gearboxes)) {
    if (k === CUSTOM || ids.has(k)) gearboxes[k] = v; else changed = true;
  }
  for (const [k, v] of Object.entries(s.advisorLocks)) {
    if (k === CUSTOM || ids.has(k)) advisorLocks[k] = v; else changed = true;
  }
  for (const [k, v] of Object.entries(s.useArmLoads)) {
    if (ids.has(k)) useArmLoads[k] = v; else changed = true;
  }
  for (const [k, v] of Object.entries(s.presetBase)) {
    if (ids.has(k) && !isPresetId(k)) presetBase[k] = v; else changed = true;
  }
  let arm: ArmResult | null = null;
  for (const j of cyc) {
    if (!gearboxes[j.id]) {
      arm = arm ?? computeArm(s.arm);
      const load = arm.joints.find((x) => x.joint === j.id);
      const base = isPresetId(j.id) ? j.id : closestPresetId(arm.valid ? load?.Treq : null);
      if (!isPresetId(j.id)) presetBase[j.id] = base;
      gearboxes[j.id] = structuredClone(PRESETS[base]);
      changed = true;
    }
    if (!advisorLocks[j.id]) { advisorLocks[j.id] = defaultLockState(); changed = true; }
    if (typeof useArmLoads[j.id] !== 'boolean') { useArmLoads[j.id] = true; changed = true; }
  }
  if (!gearboxes[CUSTOM]) { gearboxes[CUSTOM] = structuredClone(presetFor(CUSTOM)); changed = true; }
  if (!advisorLocks[CUSTOM]) { advisorLocks[CUSTOM] = defaultLockState(); changed = true; }
  const slots = slotsOfArm(s.arm);
  let selected = s.selected;
  if (!slots.includes(selected)) { selected = slots[0]; changed = true; }
  // the workbench selection: the Arm item, Custom, or any joint (servo joints too)
  let wb = s.wb;
  if (wb.sel !== 'arm' && wb.sel !== CUSTOM && !ids.has(wb.sel)) { wb = { ...wb, sel: 'arm' }; changed = true; }
  return changed ? { ...s, gearboxes, advisorLocks, useArmLoads, presetBase, selected, wb } : s;
}

/** Build a full, safe Session from anything (localStorage, imported JSON). Never throws. */
export function normalizeSession(raw: unknown, base: Session = defaultSession()): Session {
  if (!isObj(raw)) return base;
  const out: Session = {
    ...base, gearboxes: { ...base.gearboxes }, useArmLoads: { ...base.useArmLoads }, advisorLocks: { ...base.advisorLocks },
    presetBase: { ...base.presetBase },
  };
  try {
    if (raw.theme === 'system' || raw.theme === 'light' || raw.theme === 'dark') out.theme = raw.theme;
    if (raw.armPose === 'ready' || raw.armPose === 'worst') out.armPose = raw.armPose;
    if ('poseView' in raw) out.poseView = normalizePoseView(raw.poseView);
    if ('units' in raw) out.units = normalizeUnits(raw.units);
    // An arm in the old fixed format (five joints) is converted here, with identical results; its joint ids are J1..J5,
    // so the old per-joint keys (gearboxes, locks, toggles) carry over unchanged.
    if ('arm' in raw) {
      out.arm = normalizeArmInputs(raw.arm);
      // the base session's per-joint entries belong to the base arm: keep only what the new arm still shares
      const keep = new Set(out.arm.joints.map((j) => j.id));
      for (const k of Object.keys(out.gearboxes)) if (k !== CUSTOM && !keep.has(k)) delete out.gearboxes[k];
      for (const k of Object.keys(out.advisorLocks)) if (k !== CUSTOM && !keep.has(k)) delete out.advisorLocks[k];
      for (const k of Object.keys(out.useArmLoads)) if (!keep.has(k)) delete out.useArmLoads[k];
      for (const k of Object.keys(out.presetBase)) if (!keep.has(k)) delete out.presetBase[k];
    }
    const ids = new Set(out.arm.joints.map((j) => j.id));
    const valid = (k: string) => k === CUSTOM || ids.has(k);
    if (isObj(raw.presetBase)) {
      for (const [k, v] of Object.entries(raw.presetBase)) if (ids.has(k) && !isPresetId(k) && isPresetId(v)) out.presetBase[k] = v;
    }
    if (isObj(raw.gearboxes)) {
      for (const s of Object.keys(raw.gearboxes)) {
        if (!valid(s)) continue; // a joint the arm no longer has
        const g = raw.gearboxes[s];
        if (g !== undefined) {
          const n = normalizeGearboxInputs(g);
          // a missing or garbled geometry/load field falls back to this joint's preset, not the generic default
          const p = presetFor(s, out.presetBase);
          const have = isObj(g) ? g : {};
          for (const k of ['D', 'e', 'Treq', 'Tdes', 'discs'] as const) {
            if (!(typeof have[k] === 'number' && Number.isFinite(have[k]))) n[k] = p[k];
          }
          out.gearboxes[s] = n;
        }
      }
    }
    if (isObj(raw.useArmLoads)) {
      for (const j of Object.keys(raw.useArmLoads)) {
        if (ids.has(j) && typeof raw.useArmLoads[j] === 'boolean') out.useArmLoads[j] = raw.useArmLoads[j] as boolean;
      }
    }
    if (typeof raw.selected === 'string' && valid(raw.selected)) out.selected = raw.selected;
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
    // Locks: sessions saved before they existed have none (every joint gets the defaults). Their old "let ratio vary"
    // switch becomes the ratio lock being off.
    const legacyVary = isObj(raw.advisor) && raw.advisor.ratioVary === true;
    const cycIds = new Set(gearboxJoints(out.arm).map((j) => j.id));
    for (const sl of [...ids, CUSTOM]) {
      const have = isObj(raw.advisorLocks) ? raw.advisorLocks[sl] : undefined;
      if (have === undefined && sl !== CUSTOM && !cycIds.has(sl)) continue; // a servo joint has no advisor state of its own
      if (have === undefined && out.advisorLocks[sl] && !legacyVary) continue;
      const st = normalizeLockState(have, defaultLockState());
      if (have === undefined && legacyVary) st.on.Zp = false;
      out.advisorLocks[sl] = st;
    }
    if (isObj(raw.hintsSeen)) {
      const h: Record<string, boolean> = {};
      for (const [k, v] of Object.entries(raw.hintsSeen)) if (v === true) h[k] = true;
      out.hintsSeen = h;
    }
    // Workbench layout. A session from before it has a `step` (1..4) and a selected gearbox slot instead.
    if (isObj(raw.wb)) out.wb = normalizeWorkbench(raw.wb, base.wb);
    else if ('step' in raw) out.wb = workbenchFromStep(raw.step, out.selected);
  } catch {
    return base;
  }
  return reconcileSession(out);
}

// ---------------------------------------------------------------------------
// Persistence (every storage access is wrapped: the app must work when storage throws)
// ---------------------------------------------------------------------------

/** Where the DXF panel keeps its allowances (ExportDxfPanel). */
export const DXF_OPTIONS_KEY = 'cycloid-calc-dxf-options-v1';
/** Set once the stored DXF clearances have been moved into the gearbox inputs. */
export const TOLERANCE_MIGRATED_KEY = 'cgd.tolerance-migrated.v1';

/**
 * Before Addition 13 the DXF panel held the profile clearance, the pin hole clearance and the disc hole clearance as its
 * own (app-wide) options. They are gearbox inputs now (tolerance.profileClearance, tolerance.holePlay = pin hole
 * clearance / 2, tolerance.innerHoleClearance). On load, every gearbox without a tolerance spec takes the stored DXF
 * values, so the drawings it exports stay the same. Gearboxes that have a spec, and sessions without stored DXF options,
 * are left as they are (a missing spec is the default: CNC mill with profile clearance 0).
 */
export function migrateDxfTolerance(s: Session, dxfRaw: unknown): Session {
  if (!isObj(dxfRaw)) return s;
  const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
  const pc = num(dxfRaw.profileClearance), ph = num(dxfRaw.pinHoleClearance), dh = num(dxfRaw.discHoleClearance);
  if (pc == null && ph == null && dh == null) return s;
  let changed = false;
  const gearboxes = { ...s.gearboxes };
  for (const [k, g] of Object.entries(gearboxes)) {
    if (g.tolerance !== undefined) continue;
    const t = defaultToleranceSpec();
    if (pc != null) t.profileClearance = pc;
    if (ph != null) t.holePlay = ph / 2;
    if (dh != null) t.innerHoleClearance = dh;
    gearboxes[k] = { ...g, tolerance: t };
    changed = true;
  }
  return changed ? { ...s, gearboxes } : s;
}

function storedDxfOptions(): unknown {
  try {
    const t = window.localStorage.getItem(DXF_OPTIONS_KEY);
    return t ? JSON.parse(t) : null;
  } catch {
    return null;
  }
}

export function loadSession(): Session {
  let s: Session;
  try {
    const txt = window.localStorage.getItem(STORAGE_KEY);
    s = txt ? normalizeSession(JSON.parse(txt)) : defaultSession();
  } catch {
    return defaultSession();
  }
  // once: later gearboxes (new joints) start from the default spec, not from the old DXF options
  try {
    if (window.localStorage.getItem(TOLERANCE_MIGRATED_KEY)) return s;
    const dxf = storedDxfOptions();
    window.localStorage.setItem(TOLERANCE_MIGRATED_KEY, '1');
    return migrateDxfTolerance(s, dxf);
  } catch {
    return s;
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

/** Export format 2: the arm is a joint list. Format 1 files (fixed five-joint arm) still import. */
export const EXPORT_VERSION = 2;

export function exportSession(s: Session): string {
  const { arm, gearboxes, presetBase, useArmLoads, selected, advisor, advisorLocks } = s;
  return JSON.stringify(
    {
      app: APP_ID,
      version: EXPORT_VERSION,
      exportedAt: new Date().toISOString(),
      note: 'All values in this file are SI: lengths in mm, masses in g, forces in N, torques in N*m, stresses in MPa, whatever display units were selected. The arm is an ordered list of joints; gearboxes, useArmLoads and advisorLocks are keyed by joint id.',
      arm, gearboxes, presetBase, useArmLoads, selected, advisor, advisorLocks,
    },
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
  if (typeof raw.version === 'number' && raw.version > EXPORT_VERSION) {
    return { ok: false, error: `That file was saved by a newer version of the app (format ${raw.version}).` };
  }
  // Keep the importing user's own UI state (layout, theme, hints); take the engineering data from the file.
  const { wb, theme, hintsSeen, units, armPose, poseView } = current;
  const base = defaultSession();
  const { step: _oldStep, ...rest } = raw;
  void _oldStep;
  const merged = normalizeSession({ ...rest, wb, theme, hintsSeen, units, armPose, poseView }, { ...base, wb, theme, hintsSeen, units, armPose, poseView });
  const issues: string[] = [];
  const armErr = validateArmInputs(merged.arm).errors;
  if (armErr.length) issues.push(`Arm: ${armErr[0]}`);
  for (const s of slotsOf(merged)) {
    const e = validateGearboxInputs(merged.gearboxes[s]).errors;
    if (e.length) issues.push(`${slotLabel(merged.arm, s)}: ${e[0]}`);
  }
  return { ok: true, session: merged, issues };
}

// ---------------------------------------------------------------------------
// Derived helpers
// ---------------------------------------------------------------------------

export function computeArmResult(arm: ArmInputs): ArmResult {
  return computeArm(arm);
}

/** True when the "loads from arm" toggle of a slot is on (Custom is always manual). */
export const armToggle = (s: Pick<Session, 'useArmLoads'>, slot: Slot): boolean => slot !== CUSTOM && s.useArmLoads[slot] !== false;

/** True when this slot takes T_req / T_des from the arm model right now. */
export function loadsFromArm(s: Session, slot: Slot, arm: ArmResult): boolean {
  return armToggle(s, slot) && arm.valid && arm.joints.some((j) => j.joint === slot);
}

/** The inputs that are actually checked: stored inputs with the arm torques applied when the toggle is on. */
export function effectiveInputs(s: Session, slot: Slot, arm: ArmResult): GearboxInputs {
  const g = gearboxOf(s, slot);
  if (!loadsFromArm(s, slot, arm)) return g;
  const load = arm.joints.find((j) => j.joint === slot)!;
  return { ...g, Treq: load.Treq, Tdes: load.Tdes };
}
