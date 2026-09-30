import { describe, expect, it } from 'vitest';
import { CalcClient, PRESETS, adviseDesign, solveMinimumSize } from '../index';
import type { AdvisorProgress, GearboxInputs, SolverProgress, WorkerLike, WorkerRequest, WorkerResponse } from '../index';
import { createWorkerHandler } from '../workerCore';

/** A fake Worker that runs the real worker-side handler, delivering messages asynchronously. */
function fakeWorker(): WorkerLike & { sent: WorkerRequest[]; terminated: boolean } {
  const w = {
    sent: [] as WorkerRequest[],
    terminated: false,
    onmessage: null as ((ev: { data: WorkerResponse }) => void) | null,
    onerror: null as ((ev: unknown) => void) | null,
    postMessage(msg: WorkerRequest) {
      w.sent.push(msg);
      // deliver on a macrotask like a real postMessage
      setTimeout(() => { void handle(msg); }, 0);
    },
    terminate() { w.terminated = true; },
  };
  const handle = createWorkerHandler({
    post: (m) => { setTimeout(() => w.onmessage?.({ data: m }), 0); },
  });
  return w;
}

const strip = (r: unknown) => JSON.parse(JSON.stringify(r, (k, v) => (k === 'elapsedMs' ? 0 : v)));

describe('CalcClient with a (fake) worker', () => {
  it('solve: promise + progress, same answer as the sync solver', async () => {
    const w = fakeWorker();
    const client = new CalcClient(() => w);
    expect(client.usingWorker).toBe(true);
    const prog: SolverProgress[] = [];
    const job = client.solve(PRESETS.J2, {}, (p) => prog.push(p));
    const res = await job.promise;
    expect(w.sent[0].type).toBe('solve');
    expect(strip(res)).toEqual(strip(solveMinimumSize(PRESETS.J2)));
    for (const p of prog) expect(p.fraction).toBeGreaterThanOrEqual(0);
  });

  it('advise: promise + progress, same answer as the sync advisor', async () => {
    const w = fakeWorker();
    const client = new CalcClient(() => w);
    const prog: AdvisorProgress[] = [];
    const job = client.advise(PRESETS.J3, { target: 0.85 }, (p) => prog.push(p));
    const res = await job.promise;
    expect(res.best).not.toBeNull();
    expect(strip(res)).toEqual(strip(adviseDesign(PRESETS.J3, { target: 0.85 })));
    for (let i = 1; i < prog.length; i++) expect(prog[i].fraction).toBeGreaterThanOrEqual(prog[i - 1].fraction - 1e-12);
  });

  it('cancel resolves immediately with cancelled:true and tells the worker', async () => {
    const w = fakeWorker();
    const client = new CalcClient(() => w);
    const job = client.advise(PRESETS.J2, { ratioVary: true });
    job.cancel();
    const res = await job.promise;
    expect(res.cancelled).toBe(true);
    expect(res.best).toBeNull();
    expect(w.sent.some((m) => m.type === 'cancel' && m.id === job.id)).toBe(true);
    // the client is still usable afterwards
    const again = await client.solve(PRESETS.J4).promise;
    expect(again.minD).toBe(45);
  });

  it('the worker actually stops a cancelled job (cancel message is received between slices)', async () => {
    const out: WorkerResponse[] = [];
    const handle = createWorkerHandler({ post: (m) => out.push(m) });
    const p = handle({ type: 'advise', id: 7, inputs: PRESETS.J2, options: { ratioVary: true } });
    setTimeout(() => { void handle({ type: 'cancel', id: 7 }); }, 0);
    await p;
    const result = out.find((m) => m.type === 'result');
    expect(result && result.type === 'result' && result.kind === 'advise' && result.result.cancelled).toBe(true);
  });

  it('two jobs at once are kept apart', async () => {
    const client = new CalcClient(() => fakeWorker());
    const a = client.solve(PRESETS.J3);
    const b = client.solve(PRESETS.J4);
    const [ra, rb] = await Promise.all([a.promise, b.promise]);
    expect(Math.abs(ra.minD! - 63)).toBeLessThanOrEqual(1);
    expect(rb.minD).toBe(45);
  });

  it('a crashing worker resolves pending jobs with errors instead of hanging', async () => {
    const w = fakeWorker();
    w.postMessage = () => { /* swallow: never answers */ };
    const client = new CalcClient(() => w);
    const job = client.solve(PRESETS.J3);
    w.onerror?.({});
    const res = await job.promise;
    expect(res.valid).toBe(false);
    expect(res.errors.join(' ')).toMatch(/crashed/);
  });

  it('bad input comes back as a result with errors, not a rejection', async () => {
    const client = new CalcClient(() => fakeWorker());
    const bad = { ...PRESETS.J3, Zp: 2 } as GearboxInputs;
    const r1 = await client.solve(bad).promise;
    expect(r1.valid).toBe(false);
    expect(r1.errors.length).toBeGreaterThan(0);
    const r2 = await client.advise(bad).promise;
    expect(r2.valid).toBe(false);
  });
});

describe('CalcClient without Worker support (main-thread fallback)', () => {
  it('falls back, still gives progress and supports cancel', async () => {
    const client = new CalcClient(() => null);
    expect(client.usingWorker).toBe(false);
    const res = await client.advise(PRESETS.J3).promise;
    expect(res.best).not.toBeNull();
    const s = await client.solve(PRESETS.J4).promise;
    expect(s.minD).toBe(45);
    const job = client.advise(PRESETS.J2, { ratioVary: true });
    job.cancel();
    expect((await job.promise).cancelled).toBe(true);
  });

  it('the default factory uses the fallback under Node (no Worker global)', async () => {
    const client = new CalcClient();
    const r = await client.solve(PRESETS.J4).promise;
    expect(r.minD).toBe(45);
  });
});
