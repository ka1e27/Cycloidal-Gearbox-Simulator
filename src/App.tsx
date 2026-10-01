import { AssumptionsPanel } from './ui/components/AssumptionsPanel';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { Header } from './ui/components/Header';
import { Toasts } from './ui/components/Toasts';
import { lazy, Suspense, useEffect } from 'react';
import { ArmScreen } from './ui/screens/ArmScreen';
import { StoreProvider, useStore } from './ui/store';

// The first screen (Arm & Loads) is in the initial chunk; the other steps load on demand (and are prefetched when idle).
const loadGearbox = () => import('./ui/screens/GearboxScreen');
const loadAdvisor = () => import('./ui/screens/AdvisorScreen');
const loadJoints = () => import('./ui/screens/JointsScreen');
const GearboxScreen = lazy(() => loadGearbox().then((m) => ({ default: m.GearboxScreen })));
const AdvisorScreen = lazy(() => loadAdvisor().then((m) => ({ default: m.AdvisorScreen })));
const JointsScreen = lazy(() => loadJoints().then((m) => ({ default: m.JointsScreen })));

/** Light placeholder while a screen's chunk loads. */
export function ScreenLoading() {
  return (
    <div className="screen-loading" role="status" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      <div className="skel skel-head" />
      <div className="skel skel-card" />
    </div>
  );
}

function usePrefetchScreens() {
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const go = () => { void loadGearbox().catch(() => {}); void loadAdvisor().catch(() => {}); void loadJoints().catch(() => {}); };
    const t = w.requestIdleCallback ? w.requestIdleCallback(go) : window.setTimeout(go, 1500);
    return () => { if (!w.requestIdleCallback) window.clearTimeout(t); };
  }, []);
}

function Screens() {
  const { state } = useStore();
  usePrefetchScreens();
  return (
    <main id="main" className="main" tabIndex={-1}>
      <ErrorBoundary key={state.step}>
        <Suspense fallback={<ScreenLoading />}>
          {state.step === 1 && <ArmScreen />}
          {state.step === 2 && <GearboxScreen />}
          {state.step === 3 && <AdvisorScreen />}
          {state.step === 4 && <JointsScreen />}
        </Suspense>
      </ErrorBoundary>
      <AssumptionsPanel />
      <footer className="app-foot">
        Static calculator: everything runs in your browser and nothing is sent anywhere. Results are engineering estimates, not a substitute for testing.
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header />
      <Screens />
      <Toasts />
    </StoreProvider>
  );
}
