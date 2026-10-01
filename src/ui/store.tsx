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
  type JointId,
} from '../calc';
import {
  computeArmResult,
  defaultAdvisorOptions,
  defaultSession,
  effectiveInputs,
  exportSession,
  importSession,
  loadSession,
  loadsFromArm,
  saveSession,
  clearSavedSession,
  type AdvisorUiOptions,
  type Session,
  type Slot,
  type Step,
  type ThemePref,
} from './session';
import { makeU, type U, type UnitPrefs } from './units';

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

type Action =
  | { type: 'step'; step: Step }
  | { type: 'theme'; theme: ThemePref }
  | { type: 'units'; units: UnitPrefs }
  | { type: 'select'; slot: Slot }
  | { type: 'arm'; fn: (a: ArmInputs) => ArmInputs }
  | { type: 'gearbox'; slot: Slot; fn: (g: GearboxInputs) => GearboxInputs }
  | { type: 'useArm'; joint: JointId; value: boolean }
  | { type: 'advisorOpts'; patch: Partial<AdvisorUiOptions> }
  | { type: 'hint'; key: string }
  | { type: 'replace'; session: Session }
  | { type: 'reset' };

function reducer(s: Session, a: Action): Session {
  switch (a.type) {
    case 'step': return s.step === a.step ? s : { ...s, step: a.step };
    case 'theme': return { ...s, theme: a.theme };
    case 'units': return { ...s, units: a.units };
    case 'select': return { ...s, selected: a.slot };
    case 'arm': return { ...s, arm: a.fn(s.arm) };
    case 'gearbox': return { ...s, gearboxes: { ...s.gearboxes, [a.slot]: a.fn(s.gearboxes[a.slot]) } };
    case 'useArm': return { ...s, useArmLoads: { ...s.useArmLoads, [a.joint]: a.value } };
    case 'advisorOpts': return { ...s, advisor: { ...s.advisor, ...a.patch } };
    case 'hint': return s.hintsSeen[a.key] ? s : { ...s, hintsSeen: { ...s.hintsSeen, [a.key]: true } };
    case 'replace': return a.session;
    case 'reset': {
      const d = defaultSession();
      return { ...d, theme: s.theme, units: s.units, hintsSeen: s.hintsSeen, step: s.step };
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
export interface Toast { id: number; kind: ToastKind; text: string }

export function advisorKey(inputs: GearboxInputs, opts: AdvisorUiOptions): string {
  // discShare is ignored by the advisor; Treq/Tdes matter.
  const { discShare: _ignored, ...rest } = inputs;
  void _ignored;
  return JSON.stringify([rest, opts]);
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
  setStep: (s: Step) => void;
  select: (slot: Slot) => void;
  updateArm: (fn: (a: ArmInputs) => ArmInputs) => void;
  updateGearbox: (slot: Slot, fn: (g: GearboxInputs) => GearboxInputs) => void;
  storageOk: boolean;
  resolvedTheme: 'light' | 'dark';
  advisorRun: AdvisorRun;
  runAdvisor: (slot: Slot) => void;
  cancelAdvisor: () => void;
  toasts: Toast[];
  notify: (kind: ToastKind, text: string) => void;
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
  const notify = useCallback((kind: ToastKind, text: string) => {
    const id = toastId.current++;
    setToasts((t) => [...t.slice(-2), { id, kind, text }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'error' ? 9000 : 4500);
  }, []);

  const setStep = useCallback((step: Step) => {
    dispatch({ type: 'step', step });
    try { window.scrollTo({ top: 0 }); } catch { /* ignore */ }
  }, []);
  const select = useCallback((slot: Slot) => dispatch({ type: 'select', slot }), []);
  const updateArm = useCallback((fn: (a: ArmInputs) => ArmInputs) => dispatch({ type: 'arm', fn }), []);
  const updateGearbox = useCallback(
    (slot: Slot, fn: (g: GearboxInputs) => GearboxInputs) => dispatch({ type: 'gearbox', slot, fn }), []);

  const cancelAdvisor = useCallback(() => {
    jobRef.current?.cancel();
    jobRef.current = null;
    setAdvisorRun((r) => (r.status === 'running' ? { ...r, status: r.result ? 'done' : 'idle', progress: null } : r));
  }, []);

  const runAdvisor = useCallback((slot: Slot) => {
    jobRef.current?.cancel();
    const s = stateRef.current;
    const inputs = effectiveInputs(s, slot, computeArmResult(s.arm));
    const o = s.advisor;
    const key = advisorKey(inputs, o);
    setAdvisorRun((r) => ({ ...r, status: 'running', slot, progress: null, usedTarget: o.target }));
    const job = getCalcClient().advise(
      inputs,
      { target: o.target, ratioVary: o.ratioVary, Dmin: o.Dmin, Dmax: o.Dmax, minPinClearance: o.minPinClearance, altWindowMm: o.altWindowMm },
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
    if (out.issues.length) {
      notify('info', `Imported, but some values need attention. ${out.issues.slice(0, 2).join(' ')}`);
    } else notify('success', 'Session imported.');
  }, [notify]);

  const resetAll = useCallback(() => {
    jobRef.current?.cancel();
    jobRef.current = null;
    dispatch({ type: 'reset' });
    setAdvisorRun(idleRun);
    clearSavedSession();
    notify('success', 'Everything is back to the default values.');
  }, [notify]);

  const value = useMemo<StoreValue>(() => ({
    state, dispatch, u, arm, effective, fromArm, setStep, select, updateArm, updateGearbox, storageOk,
    resolvedTheme, advisorRun, runAdvisor, cancelAdvisor, toasts, notify, dismissToast, exportJson,
    importJson, resetAll,
  }), [state, u, arm, effective, fromArm, setStep, select, updateArm, updateGearbox, storageOk, resolvedTheme,
    advisorRun, runAdvisor, cancelAdvisor, toasts, notify, dismissToast, exportJson, importJson, resetAll]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export { defaultAdvisorOptions };

/** Stored inputs of a slot with the arm torques applied when its toggle is on. Stable identity between renders. */
export function useEffectiveInputs(slot: Slot): GearboxInputs {
  const { state, arm } = useStore();
  const g = state.gearboxes[slot];
  const flag = slot === 'custom' ? false : state.useArmLoads[slot];
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => effectiveInputs(state, slot, arm), [g, flag, arm, slot]);
}

/** Unit helpers for the current display units. */
export function useU(): U {
  return useStore().u;
}
