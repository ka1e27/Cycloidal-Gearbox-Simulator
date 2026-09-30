// Drivers for long computations written as generators: the generator yields a progress value
// roughly every SLICE_MS of work. The sync driver just keeps going; the async driver yields to
// the event loop between slices so a Web Worker can receive a cancel message.

export interface RunHooks<P> {
  onProgress?: (p: P) => void;
  /** Polled between slices; return true to stop. */
  shouldCancel?: () => boolean;
}

export const SLICE_MS = 30;

export const now: () => number =
  typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? () => performance.now()
    : () => Date.now();

/** Returns the generator's result, or null if cancelled. */
export function runSync<P, R>(gen: Generator<P, R, void>, hooks?: RunHooks<P>): R | null {
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
    try { hooks?.onProgress?.(step.value); } catch { /* a UI callback must not break the engine */ }
    if (hooks?.shouldCancel?.()) { gen.return(undefined as unknown as R); return null; }
  }
}

const yieldToLoop = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

/** Like runSync but awaits the event loop between slices. Returns null if cancelled. */
export async function runAsync<P, R>(gen: Generator<P, R, void>, hooks?: RunHooks<P>): Promise<R | null> {
  for (;;) {
    const step = gen.next();
    if (step.done) return step.value;
    try { hooks?.onProgress?.(step.value); } catch { /* ignore */ }
    await yieldToLoop();
    if (hooks?.shouldCancel?.()) { gen.return(undefined as unknown as R); return null; }
  }
}
