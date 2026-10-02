import { AssumptionsPanel } from './ui/components/AssumptionsPanel';
import { ErrorBoundary } from './ui/components/ErrorBoundary';
import { Header } from './ui/components/Header';
import { Toasts } from './ui/components/Toasts';
import { StoreProvider } from './ui/store';
import { Workbench } from './ui/workbench/Workbench';
import './styles/workbench.css';

/** Light placeholder while a chunk loads. */
export function ScreenLoading() {
  return (
    <div className="screen-loading" role="status" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      <div className="skel skel-head" />
      <div className="skel skel-card" />
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <div className="app-shell">
        <a className="skip-link" href="#main">Skip to the stage</a>
        <Header />
        <ErrorBoundary>
          <Workbench />
        </ErrorBoundary>
      </div>
      <AssumptionsPanel />
      <Toasts />
    </StoreProvider>
  );
}
