// Web Worker entry. The UI does not talk to this directly: use CalcClient from './workerClient'.
// Loaded with: new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })

import type { WorkerRequest, WorkerResponse } from './messages';
import { createWorkerHandler } from './workerCore';

interface WorkerScope {
  onmessage: ((ev: { data: WorkerRequest }) => void) | null;
  postMessage(msg: WorkerResponse): void;
}
const scope = self as unknown as WorkerScope;

const handle = createWorkerHandler({ post: (m) => scope.postMessage(m) });
scope.onmessage = (ev) => {
  void handle(ev.data);
};
