import { AssumptionsPanel } from './ui/components/AssumptionsPanel';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { Header } from './ui/components/Header';
import { Toasts } from './ui/components/Toasts';
import { AdvisorScreen } from './ui/screens/AdvisorScreen';
import { ArmScreen } from './ui/screens/ArmScreen';
import { GearboxScreen } from './ui/screens/GearboxScreen';
import { JointsScreen } from './ui/screens/JointsScreen';
import { StoreProvider, useStore } from './ui/store';

function Screens() {
  const { state } = useStore();
  return (
    <main id="main" className="main" tabIndex={-1}>
      <ErrorBoundary key={state.step}>
        {state.step === 1 && <ArmScreen />}
        {state.step === 2 && <GearboxScreen />}
        {state.step === 3 && <AdvisorScreen />}
        {state.step === 4 && <JointsScreen />}
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
