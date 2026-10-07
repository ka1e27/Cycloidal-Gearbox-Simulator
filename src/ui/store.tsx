// One store for the whole session: React context + reducer, persisted to localStorage (try/catch everywhere).

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  getCalcClient,
  type AdvisorProgress,
  type AdvisorResult,
  type ArmInputs,
  type ArmResult,
  type CalcJob,
  type GearboxInputs,
  type SolverResult,
} from '../calc';
import {
  armToggle,
  computeArmResult,
  defaultAdvisorOptions,
  defaultSession,
  effectiveInputs,
  exportSession,
  gearboxOf,
  importSession,
  loadSession,
  loadsFromArm,
  reconcileSession,
  saveSession,
  clearSavedSession,
  type AdvisorUiOptions,
  type Session,
  type Slot,
  type ThemePref,
  CUSTOM,
} from './session';
import type { SectionId, StageTab, WorkbenchState } from './workbench/wbState';
import { defaultLockState, toEngineLocks, type AdvisorLockState } from './advisorLocks';
import { ratioPlanFor } from './motorUi';
import { makeU, type U, type UnitPrefs } from './units';

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type Action =
  | { type: 'wb'; patch: Partial<WorkbenchState> }
  /** Select the Arm item, Custom or a joint; a gearbox slot (cycloidal joint or Custom) also becomes the selected slot */
  | { type: 'wbSelect'; sel: string }
  | { type: 'wbOpen'; id: SectionId; open: boolean }
  | { type: 'theme'; theme: ThemePref }
  | { type: 'pose'; pose: Session['armPose'] }
  | { type: 'poseView'; value: Session['poseView'] }
  | { type: 'units'; units: UnitPrefs }
  | { type: 'select'; slot: Slot }
  | { type: 'arm'; fn: (a: ArmInputs) => ArmInputs }
  | { type: 'gearbox'; slot: Slot; fn: (g: GearboxInputs) => GearboxInputs }
  | { type: 'useArm'; joint: string; value: boolean }
  | { type: 'advisorOpts'; patch: Partial<AdvisorUiOptions> }
  | { type: 'locks'; slot: Slot; fn: (l: AdvisorLockState) => AdvisorLockState }
  | { type: 'hint'; key: string }
  | { type: 'replace'; session: Session }
  | { type: 'reset' };

function reducer(s: Session, a: Action): Session {
  switch (a.type) {
    case 'wb': {
      const keys = Object.keys(a.patch) as (keyof WorkbenchState)[];
      if (keys.every((k) => s.wb[k] === a.patch[k])) return s;
      return { ...s, wb: { ...s.wb, ...a.patch } };
    }
    case 'wbSelect': {
      const isJoint = s.arm.joints.some((j) => j.id === a.sel);
      if (a.sel !== 'arm' && a.sel !== CUSTOM && !isJoint) return s;
      const cyc = a.sel === CUSTOM || s.arm.joints.some((j) => j.id === a.sel && j.drive === 'cycloidal');
      const selected = cyc ? a.sel : s.selected;
      if (s.wb.sel === a.sel && s.selected === selected) return s;
      return { ...s, selected, wb: { ...s.wb, sel: a.sel } };
    }
    case 'wbOpen':
      return !!s.wb.open[a.id] === a.open ? s : { ...s, wb: { ...s.wb, open: { ...s.wb.open, [a.id]: a.open } } };
    case 'theme': return { ...s, theme: a.theme };
    case 'pose': return s.armPose === a.pose ? s : { ...s, armPose: a.pose };
    case 'poseView': return s.poseView === a.value ? s : { ...s, poseView: a.value };
    case 'units': return { ...s, units: a.units };
    case 'select': return { ...s, selected: a.slot };
    // Editing the arm can add or remove joints: keep the per-joint gearbox / advisor state in step with it.
    case 'arm': return reconcileSession({ ...s, arm: a.fn(s.arm) });
    case 'gearbox': return { ...s, gearboxes: { ...s.gearboxes, [a.slot]: a.fn(gearboxOf(s, a.slot)) } };
    case 'useArm': return { ...s, useArmLoads: { ...s.useArmLoads, [a.joint]: a.value } };
    case 'advisorOpts': return { ...s, advisor: { ...s.advisor, ...a.patch } };
    case 'locks': return { ...s, advisorLocks: { ...s.advisorLocks, [a.slot]: a.fn(s.advisorLocks[a.slot] ?? defaultLockState()) } };
    case 'hint': return s.hintsSeen[a.key] ? s : { ...s, hintsSeen: { ...s.hintsSeen, [a.key]: true } };
    case 'replace': return a.session;
    case 'reset': {
      const d = defaultSession();
      return reconcileSession({ ...d, theme: s.theme, units: s.units, hintsSeen: s.hintsSeen, wb: s.wb, armPose: s.armPose, poseView: s.poseView });
    }
    default: return s;
  }
}

// ---------------------------------------------------------------------------
// Advisor run state (lives in the store so it survives switching tabs)
// ---------------------------------------------------------------------------

export interface AdvisorRun {
  status: 'idle' | 'running' | 'done';
  slot: Slot | null;
  progress: AdvisorProgress | null;
  result: AdvisorResult | null;
  /** JSON of the inputs + options the result was computed for, to flag stale results */
  key: string;
  /** Options and inputs used for the run */
  usedTarget: number;
}

const idleRun: AdvisorRun = { status: 'idle', slot: null, progress: null, result: null, key: '', usedTarget: 0.85 };

export type ToastKind = 'info' | 'success' | 'error';
/** A button on a toast (e.g. "Undo"). */
export interface ToastAction { label: string; run: () => void }
export interface Toast { id: number; kind: ToastKind; text: string; action?: ToastAction }

/** Shoulder bolt sizes the advisor searches: inch when lengths show in inches, else metric. */
export function shoulderSystemFor(units: { length?: string } | undefined): 'metric' | 'inch' {
  return units?.length === 'in' ? 'inch' : 'metric';
}

export function advisorKey(inputs: GearboxInputs, opts: AdvisorUiOptions, locks?: unknown): string {
  // discShare is ignored by the advisor; Treq/Tdes matter. `locks` is what the advisor was given (toEngineLocks).
  const { discShare: _ignored, ...rest } = inputs;
  void _ignored;
  return JSON.stringify([rest, opts, locks ?? null]);
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

interface StoreValue {
  state: Session;
  dispatch: (a: Action) => void;
  /** Unit helpers bound to the chosen display units */
  u: U;
  arm: ArmResult;
  /** Inputs actually checked for a slot (arm torques applied when the toggle is on). */
  effective: (slot: Slot) => GearboxInputs;
  fromArm: (slot: Slot) => boolean;
  /** Select a gearbox slot (a cycloidal joint or Custom) in the workbench. */
  select: (slot: Slot) => void;
  /** Select the Arm item ('arm'), Custom or any joint in the workbench. */
  selectItem: (sel: string) => void;
  setStage: (tab: StageTab) => void;
  patchWb: (patch: Partial<WorkbenchState>) => void;
  /** Open or close one inspector section (remembered per section). */
  setSectionOpen: (id: SectionId, open: boolean) => void;
  /** Open a section and bring it into view (switches to the Details tab on narrow screens). `sel` selects first. */
  openSection: (id: SectionId, sel?: string) => void;
  /** Last minimum-size solver result per slot (kept while the app is open, not saved) with the inputs key it was run for */
  solverMemo: Record<Slot, { res: SolverResult; key: string }>;
  rememberSolver: (slot: Slot, res: SolverResult, key: string) => void;
  /** The last openSection request, for the inspector to scroll to (n increments on every request) */
  jump: { id: SectionId; n: number } | null;
  updateArm: (fn: (a: ArmInputs) => ArmInputs) => void;
  updateGearbox: (slot: Slot, fn: (g: GearboxInputs) => GearboxInputs) => void;
  /** Change the advisor lock state of a joint */
  updateLocks: (slot: Slot, fn: (l: AdvisorLockState) => AdvisorLockState) => void;
  storageOk: boolean;
  resolvedTheme: 'light' | 'dark';
  advisorRun: AdvisorRun;
  /** Run the advisor. `change` first edits the lock state (e.g. "unlock D") and the run uses the edited state. */
  runAdvisor: (slot: Slot, change?: (l: AdvisorLockState) => AdvisorLockState) => void;
  cancelAdvisor: () => void;
  toasts: Toast[];
  notify: (kind: ToastKind, text: string, action?: ToastAction) => void;
  /**
   * Change a slot's gearbox inputs as one undoable step (applying a fix, the recommended ratio): shows `message` in a
   * toast with an Undo button. Only the last change can be undone.
   */
  applyGearboxChange: (slot: Slot, fn: (g: GearboxInputs) => GearboxInputs, message: string) => void;
  /** Undo the last applyGearboxChange (no-op when there is none). */
  undoLast: () => void;
  dismissToast: (id: number) => void;
  exportJson: () => void;
  importJson: (text: string) => void;
  resetAll: () => void;
}

const Ctx = createContext<StoreValue | null>(null);

export function useStore(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('StoreProvider missing');
  return v;
}

function systemPrefersDark(): boolean {
  try {
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  } catch {
    return false;
  }
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadSession);
  const [storageOk, setStorageOk] = useState(true);
  const [sysDark, setSysDark] = useState(systemPrefersDark);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [advisorRun, setAdvisorRun] = useState<AdvisorRun>(idleRun);
  const stateRef = useRef(state);
  stateRef.current = state;
  const toastId = useRef(1);
  const jobRef = useRef<CalcJob<AdvisorResult> | null>(null);

  // Persist (debounced)
  useEffect(() => {
    const t = window.setTimeout(() => setStorageOk(saveSession(state)), 250);
    return () => window.clearTimeout(t);
  }, [state]);

  // Theme: follow the OS unless the user picked one
  useEffect(() => {
    let mq: MediaQueryList | null = null;
    try {
      mq = window.matchMedia('(prefers-color-scheme: dark)');
    } catch {
      return;
    }
    const on = () => setSysDark(mq!.matches);
    mq.addEventListener('change', on);
    return () => mq!.removeEventListener('change', on);
  }, []);
  const resolvedTheme: 'light' | 'dark' = state.theme === 'system' ? (sysDark ? 'dark' : 'light') : state.theme;
  useEffect(() => {
    const el = document.documentElement;
    if (state.theme === 'system') el.removeAttribute('data-theme');
    else el.setAttribute('data-theme', state.theme);
  }, [state.theme]);

  const arm = useMemo(() => computeArmResult(state.arm), [state.arm]);
  const u = useMemo(() => makeU(state.units), [state.units]);

  const effective = useCallback((slot: Slot) => effectiveInputs(state, slot, arm), [arm, state]);
  const fromArm = useCallback((slot: Slot) => loadsFromArm(state, slot, arm), [arm, state]);

  const dismissToast = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const notify = useCallback((kind: ToastKind, text: string, action?: ToastAction) => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-2), { id, kind, text, ...(action ? { action } : {}) }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' || action ? 9000 : 4500);
  }, []);

  // one-step undo for applied fixes and the recommended ratio
  const undoRef = useRef<{ slot: Slot; before: GearboxInputs; n: number } | null>(null);
  const undoN = useRef(0);
  const undoLast = useCallback(() => {
    const u = undoRef.current;
    if (!u) return;
    undoRef.current = null;
    dispatch({ type: 'gearbox', slot: u.slot, fn: () => u.before });
    setToasts((t) => t.filter((x) => !x.action));
    notify('info', 'Undone: the previous values are back.');
  }, [notify]);
  const applyGearboxChange = useCallback((slot: Slot, fn: (g: GearboxInputs) => GearboxInputs, message: string) => {
    const before = gearboxOf(stateRef.current, slot);
    const n = ++undoN.current;
    undoRef.current = { slot, before, n };
    dispatch({ type: 'gearbox', slot, fn });
    notify('success', message, {
      label: 'Undo',
      run: () => { if (undoRef.current?.n === n) undoLast(); },
    });
  }, [notify, undoLast]);

  const [jump, setJump] = useState<{ id: SectionId; n: number } | null>(null);
  const [solverMemo, setSolverMemo] = useState<Record<Slot, { res: SolverResult; key: string }>>({});
  const rememberSolver = useCallback((slot: Slot, res: SolverResult, key: string) => setSolverMemo((m) => ({ ...m, [slot]: { res, key } })), []);
  const select = useCallback((slot: Slot) => dispatch({ type: 'wbSelect', sel: slot }), []);
  const selectItem = useCallback((sel: string) => dispatch({ type: 'wbSelect', sel }), []);
  const setStage = useCallback((stage: StageTab) => dispatch({ type: 'wb', patch: { stage } }), []);
  const patchWb = useCallback((patch: Partial<WorkbenchState>) => dispatch({ type: 'wb', patch }), []);
  const setSectionOpen = useCallback((id: SectionId, open: boolean) => dispatch({ type: 'wbOpen', id, open }), []);
  const openSection = useCallback((id: SectionId, sel?: string) => {
    if (sel) dispatch({ type: 'wbSelect', sel });
    dispatch({ type: 'wbOpen', id, open: true });
    dispatch({ type: 'wb', patch: { mobile: 'details' } });
    setJump((j) => ({ id, n: (j?.n ?? 0) + 1 }));
  }, []);
  const updateArm = useCallback((fn: (a: ArmInputs) => ArmInputs) => dispatch({ type: 'arm', fn }), []);
  const updateGearbox = useCallback(
    (slot: Slot, fn: (g: GearboxInputs) => GearboxInputs) => dispatch({ type: 'gearbox', slot, fn }), []);

  const updateLocks = useCallback(
    (slot: Slot, fn: (l: AdvisorLockState) => AdvisorLockState) => dispatch({ type: 'locks', slot, fn }), []);

  const cancelAdvisor = useCallback(() => {
    jobRef.current?.cancel();
    jobRef.current = null;
    setAdvisorRun((r) => (r.status === 'running' ? { ...r, status: r.result ? 'done' : 'idle', progress: null } : r));
  }, []);

  const runAdvisor = useCallback((slot: Slot, change?: (l: AdvisorLockState) => AdvisorLockState) => {
    jobRef.current?.cancel();
    const s = stateRef.current;
    const inputs = effectiveInputs(s, slot, computeArmResult(s.arm));
    const o = s.advisor;
    const lockState = change ? change(s.advisorLocks[slot] ?? defaultLockState()) : (s.advisorLocks[slot] ?? defaultLockState());
    if (change) dispatch({ type: 'locks', slot, fn: () => lockState });
    // ratio mode "from motor": only the motor-feasible Zp are searched (Addition 8)
    const plan = ratioPlanFor(s.arm.joints.find((j) => j.id === slot), inputs, lockState);
    const engine = toEngineLocks(lockState, inputs, plan.mode === 'motor' ? plan.zps : null);
    const { locks, ratioVary, zpSet } = engine;
    const shoulderSystem = shoulderSystemFor(s.units);
    const key = advisorKey(inputs, o, inputs.outerPin.construction === 'shoulderBolt' ? { ...engine, shoulderSystem } : engine);
    setAdvisorRun((r) => ({ ...r, status: 'running', slot, progress: null, usedTarget: o.target }));
    const job = getCalcClient().advise(
      inputs,
      { target: o.target, ratioVary, zpSet, locks, Dmin: o.Dmin, Dmax: o.Dmax, minPinClearance: o.minPinClearance, altWindowMm: o.altWindowMm, shoulderSystem },
      (p) => setAdvisorRun((r) => (jobRef.current === job ? { ...r, progress: p } : r)),
    );
    jobRef.current = job;
    void job.promise.then((res) => {
      if (jobRef.current !== job) return; // superseded or cancelled
      jobRef.current = null;
      if (res.cancelled) {
        setAdvisorRun((r) => ({ ...r, status: r.result ? 'done' : 'idle', progress: null }));
        return;
      }
      setAdvisorRun({ status: 'done', slot, progress: null, result: res, key, usedTarget: o.target });
    });
  }, []);

  useEffect(() => () => { jobRef.current?.cancel(); }, []);

  const exportJson = useCallback(() => {
    try {
      const blob = new Blob([exportSession(stateRef.current)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'cycloidal-gearbox-session.json';
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 2000);
      notify('success', 'Session exported as cycloidal-gearbox-session.json');
    } catch {
      notify('error', 'Could not create the download in this browser.');
    }
  }, [notify]);

  const importJson = useCallback((text: string) => {
    const out = importSession(text, stateRef.current);
    if (!out.ok) {
      notify('error', out.error);
      return;
    }
    dispatch({ type: 'replace', session: out.session });
    setAdvisorRun(idleRun);
    setSolverMemo({});
    if (out.issues.length) {
      notify('info', `Imported, but some values need attention. ${out.issues.slice(0, 2).join(' ')}`);
    } else notify('success', 'Session imported.');
  }, [notify]);

  const resetAll = useCallback(() => {
    jobRef.current?.cancel();
    jobRef.current = null;
    dispatch({ type: 'reset' });
    setAdvisorRun(idleRun);
    setSolverMemo({});
    clearSavedSession();
    notify('success', 'Everything is back to the default values.');
  }, [notify]);

  const value = useMemo<StoreValue>(() => ({
    state, dispatch, u, arm, effective, fromArm, select, selectItem, setStage, patchWb, setSectionOpen, openSection, jump, solverMemo, rememberSolver,
    updateArm, updateGearbox, updateLocks, storageOk,
    resolvedTheme, advisorRun, runAdvisor, cancelAdvisor, toasts, notify, dismissToast, exportJson,
    importJson, resetAll, applyGearboxChange, undoLast,
  }), [applyGearboxChange, undoLast, state, u, arm, effective, fromArm, select, selectItem, setStage, patchWb, setSectionOpen, openSection, jump, solverMemo, rememberSolver,
    updateArm, updateGearbox, updateLocks, storageOk, resolvedTheme,
    advisorRun, runAdvisor, cancelAdvisor, toasts, notify, dismissToast, exportJson, importJson, resetAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { defaultAdvisorOptions };

/** Stored inputs of a slot with the arm torques applied when its toggle is on. Stable identity between renders. */
export function useEffectiveInputs(slot: Slot): GearboxInputs {
  const { state, arm } = useStore();
  const g = state.gearboxes[slot];
  const flag = armToggle(state, slot);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => effectiveInputs(state, slot, arm), [g, flag, arm, slot]);
}

/** Unit helpers for the current display units. */
export function useU(): U {
  return useStore().u;
}
