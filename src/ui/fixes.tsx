// "How to fix it" in the UI: runs the fix engine (src/calc/fixes.ts) in the calc worker for every gearbox that has a
// check above 0.85 (each cycloidal joint and Custom), debounced and one job at a time, the selected one first; stale
// runs are cancelled. Components read the report of a slot with useFixes(slot) and apply a fix with useApplyFix().
// Outside a FixesProvider (static renders, tests) there are simply no fixes.
import {
  createContext, useCallback, useContext, useDeferredValue, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import {
  GREEN_LIMIT, getCalcClient, kcTag, motorUtilization, type CalcJob, type Fix, type FixField, type FixReport, type GearboxInputs,
  type MotorSpec,
} from '../calc';
import { util } from './format';
import { motorUsable } from './motorUi';
import { CUSTOM, computeArmResult, effectiveInputs, type Session, type Slot } from './session';
import { useStore } from './store';
import { useToleranceVersion } from './tolerance';
import { modelFor } from './workbench/status';

const DEBOUNCE_MS = 300;
const KEEP = 24;

/** Identity of one fix search: the checked inputs, the motor (cycloidal joints) and the target. */
export function fixKey(inputs: GearboxInputs, motor: MotorSpec | null): string {
  // with "use tolerance Kc" the cached tolerance factors are part of what is being fixed
  return JSON.stringify([inputs, motor, GREEN_LIMIT]) + kcTag(inputs);
}

interface Want { slot: Slot; key: string; inputs: GearboxInputs; motor: MotorSpec | null }

/** Does this gearbox (and its motor) have any check above the target? */
export function needsFixes(inputs: GearboxInputs, motor: MotorSpec | null): boolean {
  const r = modelFor(inputs).result;
  if (!r.valid) return false;
  if (r.maxUtilization > GREEN_LIMIT + 1e-9) return true;
  const mu = motorUtilization(inputs, motor, inputs.Zp);
  return mu != null && mu > GREEN_LIMIT + 1e-9;
}

/** Every gearbox slot of the session: its key, and whether it needs fixes. */
function slotsOf(s: Session): (Want & { needed: boolean })[] {
  const arm = computeArmResult(s.arm);
  const out: (Want & { needed: boolean })[] = [];
  const add = (slot: Slot, motor: MotorSpec | null) => {
    const inputs = effectiveInputs(s, slot, arm);
    out.push({ slot, key: fixKey(inputs, motor), inputs, motor, needed: needsFixes(inputs, motor) });
  };
  for (const j of s.arm.joints) if (j.drive === 'cycloidal') add(j.id, motorUsable(j) ? j.motor! : null);
  add(CUSTOM, null);
  return out;
}

interface FixesValue {
  /** Per slot: the key of its current inputs and whether a search is needed */
  slots: Record<string, { key: string; needed: boolean }>;
  reports: Record<string, FixReport>;
}

const Ctx = createContext<FixesValue | null>(null);

export function FixesProvider({ children }: { children: ReactNode }) {
  const { state } = useStore();
  const d = useDeferredValue(state);
  const { arm: armIn, gearboxes, useArmLoads, presetBase } = d;
  const tv = useToleranceVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const list = useMemo(() => slotsOf(d), [armIn, gearboxes, useArmLoads, presetBase, tv]);
  const [reports, setReports] = useState<Record<string, FixReport>>({});
  const job = useRef<{ key: string; job: CalcJob<FixReport> } | null>(null);
  const sel = state.wb.sel;

  useEffect(() => {
    const wanted = list.filter((w) => w.needed);
    // a running search whose inputs are gone is cancelled right away
    if (job.current && !wanted.some((w) => w.key === job.current!.key)) {
      job.current.job.cancel();
      job.current = null;
    }
    if (job.current) return;
    const todo = wanted.filter((w) => !reports[w.key]).sort((a, b) => Number(b.slot === sel) - Number(a.slot === sel));
    if (!todo.length) return;
    const t = window.setTimeout(() => {
      if (job.current) return;
      const w = todo[0];
      const j = getCalcClient().fixes(w.inputs, { motor: w.motor });
      job.current = { key: w.key, job: j };
      void j.promise.then((res) => {
        if (job.current?.job !== j) return;
        job.current = null;
        if (res.cancelled) return;
        setReports((r) => {
          const keys = Object.keys(r);
          const next: Record<string, FixReport> = {};
          for (const k of keys.slice(Math.max(0, keys.length - KEEP + 1))) next[k] = r[k];
          next[w.key] = res;
          return next;
        });
      });
    }, DEBOUNCE_MS);
    return () => window.clearTimeout(t);
  }, [list, reports, sel]);

  useEffect(() => () => { job.current?.job.cancel(); }, []);

  const slots = useMemo(() => {
    const o: Record<string, { key: string; needed: boolean }> = {};
    for (const w of list) o[w.slot] = { key: w.key, needed: w.needed };
    return o;
  }, [list]);
  const value = useMemo(() => ({ slots, reports }), [slots, reports]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export interface SlotFixes {
  /** Some check is above 0.85 */
  needed: boolean;
  /** The report for the current inputs (null while it is being computed, or when not needed) */
  report: FixReport | null;
  pending: boolean;
}

const NONE: SlotFixes = { needed: false, report: null, pending: false };

/** Fix report of a gearbox slot for its current inputs. */
export function useFixes(slot: Slot | null): SlotFixes {
  const v = useContext(Ctx);
  if (!v || !slot) return NONE;
  const s = v.slots[slot];
  if (!s || !s.needed) return NONE;
  const report = v.reports[s.key] ?? null;
  return { needed: true, report: report && report.valid ? report : null, pending: !report };
}

/** True when some single change gets every check of this joint's gearbox to the target (rail mark). */
export function useFixAvailable(slot: Slot): boolean {
  const f = useFixes(slot);
  return !!f.report?.fixes.some((x) => x.passesTarget);
}

/** Apply a fix to a slot as one undoable step. */
export function useApplyFix() {
  const { applyGearboxChange, state, u } = useStore();
  return useCallback((slot: Slot, fix: Fix) => {
    const who = slot === CUSTOM ? 'Custom gearbox' : (() => {
      const i = state.arm.joints.findIndex((j) => j.id === slot);
      const j = state.arm.joints[i];
      return j ? `J${i + 1}${j.name.trim() ? ` ${j.name.trim()}` : ''}` : slot;
    })();
    const result = fix.passesTarget ? `every check now passes (max ${util(fix.newMaxUtil)})` : `max utilization ${util(fix.newMaxUtil)}`;
    applyGearboxChange(slot, (g) => ({ ...g, ...fix.patch }), u.text(`${who}: ${fix.label} ${fix.from} → ${fix.to}; ${result}.`));
  }, [applyGearboxChange, state.arm.joints, u]);
}

// ---------------------------------------------------------------------------
// Per-field view of a report (Gearbox design highlights)
// ---------------------------------------------------------------------------

/** The best fix per field (reports list at most one per field), plus whether the field only helps. */
export function fixesByField(report: FixReport | null): Partial<Record<FixField, Fix>> {
  const out: Partial<Record<FixField, Fix>> = {};
  if (!report) return out;
  for (const f of report.fixes) if (!out[f.field]) out[f.field] = f;
  return out;
}

/** "4 fixes" / "2 fixes, 3 partial" / "3 partial" for badges; null when there is nothing. */
export function fixCountText(fixes: Fix[]): string | null {
  const pass = fixes.filter((f) => f.passesTarget).length;
  const help = fixes.length - pass;
  if (!fixes.length) return null;
  if (pass && help) return `${pass} fix${pass > 1 ? 'es' : ''}, ${help} partial`;
  if (pass) return `${pass} fix${pass > 1 ? 'es' : ''}`;
  return `${help} partial`;
}

/** Result text of a fix: "passes" or the max utilization it reaches. */
export function fixResultText(f: Fix): string {
  return f.passesTarget ? 'passes' : util(f.newMaxUtil);
}
