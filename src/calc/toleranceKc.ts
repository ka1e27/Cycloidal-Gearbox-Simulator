// Tolerance-based load concentration factors (CLAUDE.md Addition 13): the cache that lets checkGearbox use the p95 Kc of
// the Monte Carlo tolerance analysis (src/calc/tolerance.ts) when `inputs.useToleranceKc` is on.
//
// The Monte Carlo is too slow for the main thread, so it runs in the calc worker. When its result arrives the UI stores
// the two factors here with `setToleranceKc(inputs, ...)`, keyed by everything the analysis depends on (all inputs except
// the typed Kc, Kc_life and the switch itself). `resolveKc` then returns the factors in effect: the tolerance ones when
// the switch is on and a result for exactly these inputs is cached, else the typed ones ('pending' while the switch is on
// but nothing is cached yet). Pure module state, no DOM; it has no imports so gearbox.ts can use it without a cycle.

import type { GearboxInputs } from './types';

export type KcSource = 'typed' | 'tolerance' | 'pending';

export interface ResolvedKc {
  /** Where the factors in effect come from */
  source: KcSource;
  /** Factors in effect (the checks use these) */
  Kc: number;
  KcLife: number;
  /** The typed factors */
  typedKc: number;
  typedKcLife: number;
}

export interface ToleranceKcValue { Kc: number; KcLife: number }

/** Identity of a tolerance analysis: every input except the typed Kc, Kc_life and the switch (they do not change it). */
export function toleranceKey(inputs: GearboxInputs): string {
  const { Kc: _a, KcLife: _b, useToleranceKc: _c, ...rest } = inputs;
  void _a; void _b; void _c;
  return JSON.stringify(rest);
}

const MAX = 64;
const cache = new Map<string, ToleranceKcValue>();

/** Remember the tolerance Kc (p95 strength, p95 life) of a set of inputs. Non-finite or non-positive values are ignored. */
export function setToleranceKc(inputs: GearboxInputs, v: ToleranceKcValue): void {
  if (!(Number.isFinite(v.Kc) && v.Kc > 0 && Number.isFinite(v.KcLife) && v.KcLife > 0)) return;
  const key = toleranceKey(inputs);
  cache.delete(key);
  cache.set(key, { Kc: v.Kc, KcLife: v.KcLife });
  if (cache.size > MAX) cache.delete(cache.keys().next().value as string);
}

/** The cached tolerance Kc of a set of inputs, or null. */
export function getToleranceKc(inputs: GearboxInputs): ToleranceKcValue | null {
  return cache.get(toleranceKey(inputs)) ?? null;
}

/** Forget every cached value (tests). */
export function clearToleranceKc(): void {
  cache.clear();
}

/**
 * The load concentration factors in effect. `override` (e.g. sent along with a worker job) wins over the cache.
 * Without the switch the typed values are always used.
 */
export function resolveKc(inputs: GearboxInputs, override?: ToleranceKcValue | null): ResolvedKc {
  const typed = { typedKc: inputs.Kc, typedKcLife: inputs.KcLife };
  if (inputs.useToleranceKc !== true) return { source: 'typed', Kc: inputs.Kc, KcLife: inputs.KcLife, ...typed };
  const v = override ?? getToleranceKc(inputs);
  if (!v) return { source: 'pending', Kc: inputs.Kc, KcLife: inputs.KcLife, ...typed };
  return { source: 'tolerance', Kc: v.Kc, KcLife: v.KcLife, ...typed };
}

/**
 * Inputs with the factors in effect written into Kc / Kc_life and the switch turned off, so code that reads `inputs.Kc`
 * directly (the coarse searches) sees the same factors as the checks.
 */
export function withResolvedKc(inputs: GearboxInputs, override?: ToleranceKcValue | null): GearboxInputs {
  if (inputs.useToleranceKc !== true) return inputs;
  const r = resolveKc(inputs, override);
  return { ...inputs, Kc: r.Kc, KcLife: r.KcLife, useToleranceKc: false };
}

/** Short text for the cache identity of the factors in effect (the UI adds it to its model cache keys). */
export function kcTag(inputs: GearboxInputs): string {
  if (inputs.useToleranceKc !== true) return '';
  const v = getToleranceKc(inputs);
  return v ? `|tolKc:${v.Kc}:${v.KcLife}` : '|tolKc:pending';
}
