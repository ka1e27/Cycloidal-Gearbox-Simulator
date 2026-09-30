// Typed client for the calc Web Worker: promise + onProgress + cancel.
// Falls back to running on the main thread (still cancellable, yielding between slices) when
// Workers are unavailable (tests, old browsers, worker failed to start).

import { adviseDesignAsync, cancelledAdvisorResult, invalidAdvisor, type AdvisorOptions, type AdvisorProgress, type AdvisorResult } from './advisor';
import type { WorkerRequest, WorkerResponse } from './messages';
import { cancelledResult, solveMinimumSizeAsync, type SolverOptions, type SolverProgress, type SolverResult } from './solver';
import type { GearboxInputs } from './types';

export interface CalcJob<R> {
  id: number;
  /** Always resolves, never rejects. Check `result.cancelled` / `result.errors`. */
  promise: Promise<R>;
  /** Stop the job. The promise resolves right away with `cancelled: true`. */
  cancel(): void;
}

/** The subset of the Worker API the client uses (lets tests inject a fake). */
export interface WorkerLike {
  postMessage(msg: WorkerRequest): void;
  terminate(): void;
  onmessage: ((ev: { data: WorkerResponse }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}

export type WorkerFactory = () => WorkerLike | null;

const defaultFactory: WorkerFactory = () => {
  if (typeof Worker === 'undefined') return null;
  return new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' }) as unknown as WorkerLike;
};

interface Pending {
  kind: 'solve' | 'advise';
  resolve: (r: never) => void;
  onProgress?: (p: never) => void;
  target: number;
  Dmax: number;
}

export class CalcClient {
  private worker: WorkerLike | null = null;
  private workerFailed = false;
  private nextId = 1;
  private pending = new Map<number, Pending>();
  private factory: WorkerFactory;

  constructor(factory: WorkerFactory = defaultFactory) {
    this.factory = factory;
  }

  /** True if jobs currently run in a Web Worker (false = main-thread fallback). */
  get usingWorker(): boolean {
    return this.ensureWorker() !== null;
  }

  private ensureWorker(): WorkerLike | null {
    if (this.worker) return this.worker;
    if (this.workerFailed) return null;
    try {
      const w = this.factory();
      if (!w) { this.workerFailed = true; return null; }
      w.onmessage = (ev) => this.onMessage(ev.data);
      w.onerror = () => this.onWorkerFailure('The calculation worker crashed.');
      this.worker = w;
      return w;
    } catch {
      this.workerFailed = true;
      return null;
    }
  }

  private onWorkerFailure(message: string) {
    const w = this.worker;
    this.worker = null;
    try { w?.terminate(); } catch { /* ignore */ }
    for (const [id, p] of this.pending) this.fail(id, p, message);
    this.pending.clear();
  }

  private fail(_id: number, p: Pending, message: string) {
    if (p.kind === 'solve') {
      (p.resolve as (r: SolverResult) => void)({ ...cancelledResult(p.Dmax), cancelled: false, errors: [message] });
    } else {
      (p.resolve as (r: AdvisorResult) => void)(invalidAdvisor([message], p.target));
    }
  }

  private onMessage(m: WorkerResponse) {
    const p = this.pending.get(m.id);
    if (!p) return; // cancelled or finished
    if (m.type === 'progress') {
      try { (p.onProgress as ((x: unknown) => void) | undefined)?.(m.progress); } catch { /* ignore UI errors */ }
    } else if (m.type === 'result') {
      this.pending.delete(m.id);
      (p.resolve as (r: unknown) => void)(m.result);
    } else if (m.type === 'error') {
      this.pending.delete(m.id);
      this.fail(m.id, p, m.message);
    }
  }

  private start<R, P>(
    kind: 'solve' | 'advise',
    req: (id: number) => WorkerRequest,
    fallback: (hooks: { onProgress?: (p: P) => void; shouldCancel: () => boolean }) => Promise<R>,
    cancelledValue: () => R,
    onProgress: ((p: P) => void) | undefined,
    target: number,
    Dmax: number,
  ): CalcJob<R> {
    const id = this.nextId++;
    const w = this.ensureWorker();
    let promise: Promise<R>;
    let cancel: () => void;

    if (w) {
      promise = new Promise<R>((resolve) => {
        this.pending.set(id, { kind, resolve: resolve as (r: never) => void, onProgress: onProgress as never, target, Dmax });
      });
      cancel = () => {
        const p = this.pending.get(id);
        if (!p) return;
        this.pending.delete(id);
        try { w.postMessage({ type: 'cancel', id }); } catch { /* ignore */ }
        (p.resolve as (r: R) => void)(cancelledValue());
      };
      try {
        w.postMessage(req(id));
      } catch (err) {
        const p = this.pending.get(id);
        this.pending.delete(id);
        if (p) this.fail(id, p, `Could not start the calculation: ${err instanceof Error ? err.message : String(err)}`);
      }
    } else {
      let flag = false;
      let settled = false;
      let resolveOuter!: (r: R) => void;
      promise = new Promise<R>((resolve) => { resolveOuter = resolve; });
      fallback({ onProgress, shouldCancel: () => flag }).then(
        (r) => { settled = true; resolveOuter(r); },
        () => { settled = true; resolveOuter(cancelledValue()); },
      );
      cancel = () => {
        flag = true;
        if (!settled) { settled = true; resolveOuter(cancelledValue()); }
      };
    }
    return { id, promise, cancel };
  }

  /** Run the SPEC.md minimum-size solver. */
  solve(inputs: GearboxInputs, options?: SolverOptions, onProgress?: (p: SolverProgress) => void): CalcJob<SolverResult> {
    const Dmax = options?.Dmax ?? 120;
    return this.start<SolverResult, SolverProgress>(
      'solve',
      (id) => ({ type: 'solve', id, inputs, options }),
      (hooks) => solveMinimumSizeAsync(inputs, options, hooks),
      () => cancelledResult(Dmax),
      onProgress, 0.85, Dmax,
    );
  }

  /** Run the Design Advisor. */
  advise(inputs: GearboxInputs, options?: AdvisorOptions, onProgress?: (p: AdvisorProgress) => void): CalcJob<AdvisorResult> {
    const target = options?.target ?? 0.85;
    return this.start<AdvisorResult, AdvisorProgress>(
      'advise',
      (id) => ({ type: 'advise', id, inputs, options }),
      (hooks) => adviseDesignAsync(inputs, options, hooks),
      () => cancelledAdvisorResult(target),
      onProgress, target, 120,
    );
  }

  /** Stop the worker and fail any running jobs. The client can be used again afterwards. */
  terminate() {
    this.onWorkerFailure('Calculation stopped.');
    this.workerFailed = false;
  }
}

let shared: CalcClient | null = null;
/** One shared client for the whole app. */
export function getCalcClient(): CalcClient {
  if (!shared) shared = new CalcClient();
  return shared;
}
