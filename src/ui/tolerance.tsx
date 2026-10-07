// Machining tolerance analysis in the UI (CLAUDE.md Addition 13): runs the Monte Carlo (src/calc/tolerance.ts) in the calc
// worker for every gearbox slot (each cycloidal joint and Custom), debounced and one job at a time, the selected one first.
// Results are kept per input key. When one arrives its p95 Kc / Kc_life go into the engine's tolerance-Kc cache
// (setToleranceKc), so checkGearbox can use them when "use tolerance Kc" is on; the provider then bumps a version that
// the model caches (useSlotModel, rail statuses, fixes, summary) depend on.
// Outside a ToleranceProvider (static renders, tests) there are no results and the version stays 0.
import {
  createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  getCalcClient, setToleranceKc, statFitKey, toleranceKey, toleranceOf, withTolerance,
  type CalcJob, type GearboxInputs, type StatisticalFit, type ToleranceResult, type ToleranceSpec,
} from '../calc';
import { CUSTOM, computeArmResult, effectiveInputs, type Session, type Slot } from './session';
import { useStore } from './store';

const DEBOUNCE_MS = 350;
const KEEP = 32;

interface Want { slot: Slot; key: string; inputs: GearboxInputs }

function slotsOf(s: Session): Want[] {
  const arm = computeArmResult(s.arm);
  const out: Want[] = [];
  const add = (slot: Slot) => {
    const inputs = effectiveInputs(s, slot, arm);
    out.push({ slot, key: toleranceKey(inputs), inputs });
  };
  for (const j of s.arm.joints) if (j.drive === 'cycloidal') add(j.id);
  add(CUSTOM);
  return out;
}

interface ToleranceValue {
  /** Per slot: the key of its current inputs */
  keys: Record<string, string>;
  results: Record<string, ToleranceResult>;
  /** Last finished result per slot (shown while a new one is computed) */
  last: Record<string, ToleranceResult>;
  running: { key: string; fraction: number } | null;
  /** Bumps whenever a result enters the engine's tolerance-Kc cache */
  version: number;
  /** Slots whose statistical clearance fit is running in the worker */
  fitting: Record<string, boolean>;
  requestFit: (slot: Slot, inputs: GearboxInputs, spec: ToleranceSpec) => void;
}

const Ctx = createContext<ToleranceValue | null>(null);

/** Put a result's p95 factors into the engine cache (skipped when every build binds and the statistics are NaN). */
function remember(res: ToleranceResult, inputs: GearboxInputs) {
  const kc = res.kc.strength.p95, kl = res.kc.life.p95;
  if (Number.isFinite(kc) && Number.isFinite(kl)) setToleranceKc(inputs, { Kc: kc, KcLife: kl });
}

export function ToleranceProvider({ children }: { children: ReactNode }) {
  const { state, updateGearbox } = useStore();
  const d = useDeferredValue(state);
  const { arm: armIn, gearboxes, useArmLoads, presetBase } = d;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => slotsOf(d), [armIn, gearboxes, useArmLoads, presetBase]);
  const [results, setResults] = useState<Record<string, ToleranceResult>>({});
  const [last, setLast] = useState<Record<string, ToleranceResult>>({});
  const [running, setRunning] = useState<{ key: string; fraction: number } | null>(null);
  const [version, setVersion] = useState(0);
  const job = useRef<{ key: string; job: CalcJob<ToleranceResult> } | null>(null);
  const sel = state.wb.sel;

  useEffect(() => {
    if (job.current && !list.some((w) => w.key === job.current!.key)) {
      job.current.job.cancel();
      job.current = null;
      setRunning(null);
    }
    if (job.current) return;
    const todo = list.filter((w) => !results[w.key]).sort((a, b) => Number(b.slot === sel) - Number(a.slot === sel));
    if (!todo.length) return;
    const t = window.setTimeout(() => {
      if (job.current) return;
      const w = todo[0];
      const j = getCalcClient().tolerance(w.inputs, {}, (p) => {
        if (job.current?.job === j) setRunning({ key: w.key, fraction: p.fraction });
      });
      job.current = { key: w.key, job: j };
      setRunning({ key: w.key, fraction: 0 });
      void j.promise.then((res) => {
        if (job.current?.job !== j) return;
        job.current = null;
        setRunning(null);
        if (res.cancelled) return;
        if (res.valid) remember(res, w.inputs);
        setResults((r) => {
          const keys = Object.keys(r);
          const next: Record<string, ToleranceResult> = {};
          for (const k of keys.slice(Math.max(0, keys.length - KEEP + 1))) next[k] = r[k];
          next[w.key] = res;
          return next;
        });
        setLast((l) => ({ ...l, [w.slot]: res }));
        setVersion((v) => v + 1);
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [list, results, sel]);

  useEffect(() => () => { job.current?.job.cancel(); }, []);

  // Statistical clearance fits: the stored spec already holds the worst-case fit; when the worker's fit returns, the
  // clearances are replaced, unless the process values changed or the user edited a clearance in the meantime.
  const [fitting, setFitting] = useState<Record<string, boolean>>({});
  const fitJobs = useRef<Record<string, CalcJob<StatisticalFit | null>>>({});
  const requestFit = useCallback((slot: Slot, inputs: GearboxInputs, spec: ToleranceSpec) => {
    fitJobs.current[slot]?.cancel();
    const key = statFitKey(inputs, spec);
    const applied = { p: spec.profileClearance, i: spec.innerHoleClearance };
    const j = getCalcClient().statFit(inputs, spec);
    fitJobs.current[slot] = j;
    setFitting((f) => ({ ...f, [slot]: true }));
    void j.promise.then((f) => {
      if (fitJobs.current[slot] !== j) return;
      delete fitJobs.current[slot];
      setFitting((x) => ({ ...x, [slot]: false }));
      if (!f || !Number.isFinite(f.profileClearance) || !Number.isFinite(f.innerHoleClearance)) return;
      updateGearbox(slot, (g) => {
        const cur = toleranceOf(g);
        if (cur.fitMode !== 'statistical' || statFitKey(g, cur) !== key) return g;
        if (Math.abs(cur.profileClearance - applied.p) > 1e-9 || Math.abs(cur.innerHoleClearance - applied.i) > 1e-9) return g;
        return withTolerance(g, { profileClearance: f.profileClearance, innerHoleClearance: f.innerHoleClearance });
      });
    });
  }, [updateGearbox]);
  useEffect(() => () => { for (const j of Object.values(fitJobs.current)) j.cancel(); }, []);

  const keys = useMemo(() => {
    const o: Record<string, string> = {};
    for (const w of list) o[w.slot] = w.key;
    return o;
  }, [list]);
  const value = useMemo(() => ({ keys, results, last, running, version, fitting, requestFit }), [keys, results, last, running, version, fitting, requestFit]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface SlotTolerance {
  /** The result for the slot's current inputs (null while computing) */
  result: ToleranceResult | null;
  /** The last finished result of the slot, possibly for older inputs (shown dimmed while a new one runs) */
  shown: ToleranceResult | null;
  pending: boolean;
  /** Progress 0..1 of the running job for this slot, or null */
  progress: number | null;
}

const NONE: SlotTolerance = { result: null, shown: null, pending: false, progress: null };

/** Tolerance analysis of a gearbox slot for its current inputs. */
export function useTolerance(slot: Slot | null): SlotTolerance {
  const v = useContext(Ctx);
  if (!v || !slot) return NONE;
  const key = v.keys[slot];
  if (!key) return NONE;
  const result = v.results[key] ?? null;
  const shown = result ?? v.last[slot] ?? null;
  return { result, shown, pending: !result, progress: v.running?.key === key ? v.running.fraction : null };
}

/** Every slot's current result (null while computing), keyed by slot. */
export function useAllTolerance(): Record<string, ToleranceResult | null> {
  const v = useContext(Ctx);
  return useMemo(() => {
    const o: Record<string, ToleranceResult | null> = {};
    if (!v) return o;
    for (const [slot, key] of Object.entries(v.keys)) o[slot] = v.results[key] ?? null;
    return o;
  }, [v]);
}

/** Changes whenever a tolerance Kc enters the engine cache (add it to memos that call checkGearbox). 0 outside the provider. */
export function useToleranceVersion(): number {
  return useContext(Ctx)?.version ?? 0;
}

/** Start the statistical clearance fit of a slot in the worker (no-op outside the provider), and whether one is running. */
export function useStatFit(slot: Slot | null): { fitting: boolean; request: (inputs: GearboxInputs, spec: ToleranceSpec) => void } {
  const v = useContext(Ctx);
  return {
    fitting: !!(v && slot && v.fitting[slot]),
    request: (inputs, spec) => { if (v && slot) v.requestFit(slot, inputs, spec); },
  };
}
