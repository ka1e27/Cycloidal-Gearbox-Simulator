// Machining tolerance analysis in the UI (CLAUDE.md Addition 13): runs the Monte Carlo (src/calc/tolerance.ts) in the calc
// worker for every gearbox slot (each cycloidal joint and Custom), debounced and one job at a time, the selected one first.
// Results are kept per input key. When one arrives its p95 Kc / Kc_life go into the engine's tolerance-Kc cache
// (setToleranceKc), so checkGearbox can use them when "use tolerance Kc" is on; the provider then bumps a version that
// the model caches (useSlotModel, rail statuses, fixes, summary) depend on.
// Outside a ToleranceProvider (static renders, tests) there are no results and the version stays 0.
import {
  createContext, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  getCalcClient, setToleranceKc, toleranceKey, type CalcJob, type GearboxInputs, type ToleranceResult,
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
}

const Ctx = createContext<ToleranceValue | null>(null);

/** Put a result's p95 factors into the engine cache (skipped when every build binds and the statistics are NaN). */
function remember(res: ToleranceResult, inputs: GearboxInputs) {
  const kc = res.kc.strength.p95, kl = res.kc.life.p95;
  if (Number.isFinite(kc) && Number.isFinite(kl)) setToleranceKc(inputs, { Kc: kc, KcLife: kl });
}

export function ToleranceProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
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

  const keys = useMemo(() => {
    const o: Record<string, string> = {};
    for (const w of list) o[w.slot] = w.key;
    return o;
  }, [list]);
  const value = useMemo(() => ({ keys, results, last, running, version }), [keys, results, last, running, version]);
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
