// Worker-side request handling, separated from `self` so it can be tested without a real Worker.

import { adviseDesignAsync } from './advisor';
import { suggestFixesAsync } from './fixes';
import type { WorkerRequest, WorkerResponse } from './messages';
import { solveMinimumSizeAsync } from './solver';
import { analyzeToleranceAsync, statisticalFitFor } from './tolerance';

export interface WorkerHost {
  post(msg: WorkerResponse): void;
}

/**
 * Handles one request. `cancelled` holds job ids that the UI asked to cancel; it is polled
 * between work slices (the async drivers yield to the event loop, so cancel messages get through).
 */
export function createWorkerHandler(host: WorkerHost) {
  const cancelled = new Set<number>();
  return async function handle(msg: WorkerRequest): Promise<void> {
    if (msg.type === 'cancel') {
      cancelled.add(msg.id);
      return;
    }
    const id = msg.id;
    try {
      if (msg.type === 'solve') {
        const result = await solveMinimumSizeAsync(msg.inputs, msg.options, {
          onProgress: (progress) => host.post({ type: 'progress', id, kind: 'solve', progress }),
          shouldCancel: () => cancelled.has(id),
        });
        host.post({ type: 'result', id, kind: 'solve', result });
      } else if (msg.type === 'advise') {
        const result = await adviseDesignAsync(msg.inputs, msg.options, {
          onProgress: (progress) => host.post({ type: 'progress', id, kind: 'advise', progress }),
          shouldCancel: () => cancelled.has(id),
        });
        host.post({ type: 'result', id, kind: 'advise', result });
      } else if (msg.type === 'fixes') {
        const result = await suggestFixesAsync(msg.inputs, msg.options, {
          onProgress: (progress) => host.post({ type: 'progress', id, kind: 'fixes', progress }),
          shouldCancel: () => cancelled.has(id),
        });
        host.post({ type: 'result', id, kind: 'fixes', result });
      } else if (msg.type === 'tolerance') {
        const result = await analyzeToleranceAsync(msg.inputs, msg.options, {
          onProgress: (progress) => host.post({ type: 'progress', id, kind: 'tolerance', progress }),
          shouldCancel: () => cancelled.has(id),
        });
        host.post({ type: 'result', id, kind: 'tolerance', result });
      } else if (msg.type === 'statFit') {
        // binding-only Monte Carlo, 0.2-1 s; not sliced (a cancel simply drops the answer)
        host.post({ type: 'result', id, kind: 'statFit', result: statisticalFitFor(msg.inputs, msg.spec) });
      }
    } catch (err) {
      host.post({ type: 'error', id, message: err instanceof Error ? err.message : String(err) });
    } finally {
      cancelled.delete(id);
    }
  };
}
