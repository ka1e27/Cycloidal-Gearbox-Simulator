// The disc's input angle θ and its Play state, shared by the inspector's "Disc & charts" section and the Disc stage so
// both show the same moment (CLAUDE.md Addition 10). Display only, not saved.
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

export interface DiscTheta {
  deg: number;
  setDeg: (d: number) => void;
  playing: boolean;
  setPlaying: (p: boolean | ((x: boolean) => boolean)) => void;
}

const Ctx = createContext<DiscTheta | null>(null);

/** The shared θ inside the workbench, or null (a panel rendered on its own keeps its own). */
export function useDiscThetaOptional(): DiscTheta | null {
  return useContext(Ctx);
}

/** θ from the workbench when there is one, else local state. Animates at 60°/s while playing. */
export function useDiscTheta(): DiscTheta {
  const shared = useContext(Ctx);
  const local = useThetaState(!shared);
  return shared ?? local;
}

function useThetaState(active: boolean): DiscTheta {
  const [deg, setDeg] = useState(0);
  const [playing, setPlaying] = useState(false);
  useEffect(() => {
    if (!playing || !active) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setDeg((d) => (d + dt * 60) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, active]);
  return useMemo(() => ({ deg, setDeg, playing, setPlaying }), [deg, playing]);
}

export function DiscThetaProvider({ children }: { children: ReactNode }) {
  const v = useThetaState(true);
  return <Ctx.Provider value={v}>{children}</Ctx.Provider>;
}
