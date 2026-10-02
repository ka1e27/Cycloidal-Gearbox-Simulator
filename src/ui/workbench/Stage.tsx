// Centre stage of the workbench (CLAUDE.md Addition 10): tabs 3D arm | Schematic | Disc | Summary. Every view loads on
// demand with a skeleton. The 3D arm is the Pose Explorer filling the stage; clicking a joint in it selects that joint.
import { lazy, Suspense, useRef, type KeyboardEvent } from 'react';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { CUSTOM, type Slot } from '../session';
import { useStore } from '../store';
import { useSlotModel } from '../screens/GearboxScreen';
import { STAGE_TABS, type StageTab } from './wbState';
import { selectionLabel } from './sections';

const PoseStage = lazy(() => import('../viz/PoseExplorer').then((m) => ({ default: m.PoseStage })));
const ArmDiagram = lazy(() => import('../viz/ArmDiagram').then((m) => ({ default: m.ArmDiagram })));
const DiscAndCharts = lazy(() => import('./DiscViews').then((m) => ({ default: m.DiscAndCharts })));
const JointsSummary = lazy(() => import('../screens/JointsScreen').then((m) => ({ default: m.JointsSummary })));

/** Preload the stage views and heavy sections when the browser is idle, so switching feels instant. */
export function prefetchWorkbench(): void {
  void import('../viz/PoseExplorer').catch(() => {});
  void import('../viz/ArmDiagram').catch(() => {});
  void import('./DiscViews').catch(() => {});
  void import('../screens/JointsScreen').catch(() => {});
  void import('../screens/AdvisorScreen').catch(() => {});
  void import('../screens/SolverPanel').catch(() => {});
  void import('../components/ExportDxfPanel').catch(() => {});
}

export function StageSkeleton({ label = 'Loading the view' }: { label?: string }) {
  return (
    <div className="stage-skel" role="status" aria-live="polite">
      <span className="visually-hidden">{label}</span>
      <div className="skel skel-stage" />
    </div>
  );
}

export function Stage({ showTabs = true }: { showTabs?: boolean }) {
  const { state, setStage, hintSeen, dismissHint } = useStageState();
  const tab = state.wb.stage;
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const onKey = (e: KeyboardEvent) => {
    const i = STAGE_TABS.findIndex((t) => t.id === tab);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % STAGE_TABS.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + STAGE_TABS.length) % STAGE_TABS.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = STAGE_TABS.length - 1;
    if (n < 0) return;
    e.preventDefault();
    setStage(STAGE_TABS[n].id);
    refs.current[n]?.focus();
  };
  return (
    <section className="stage" aria-label="Stage">
      {showTabs && (
        <div className="stage-tabs" role="tablist" aria-label="Stage view" onKeyDown={onKey}>
          {STAGE_TABS.map((t, i) => (
            <button key={t.id} ref={(el) => { refs.current[i] = el; }} type="button" role="tab" id={`stage-tab-${t.id}`}
              aria-selected={tab === t.id} aria-controls="stage-panel" tabIndex={tab === t.id ? 0 : -1}
              className={`stage-tab${tab === t.id ? ' is-on' : ''}`} onClick={() => setStage(t.id)}>
              {t.label}
            </button>
          ))}
        </div>
      )}
      <div className={`stage-panel stage-${tab}`} id="stage-panel" role="tabpanel" aria-labelledby={`stage-tab-${tab}`}>
        {!hintSeen && (
          <div className="stage-hint" role="note">
            <span className="hint-wide">Pick a joint on the left or in the 3D view; its details open on the right.</span>
            <span className="hint-narrow">Pick a joint above or in the 3D view; its details open under Details.</span>
            <button type="button" className="icon-btn" aria-label="Dismiss the hint" onClick={dismissHint}>×</button>
          </div>
        )}
        <ErrorBoundary key={tab}>
          <Suspense fallback={<StageSkeleton />}>
            <StageView tab={tab} />
          </Suspense>
        </ErrorBoundary>
      </div>
    </section>
  );
}

function useStageState() {
  const { state, setStage, dispatch } = useStore();
  return {
    state, setStage,
    hintSeen: !!state.hintsSeen.workbench,
    dismissHint: () => dispatch({ type: 'hint', key: 'workbench' }),
  };
}

function StageView({ tab }: { tab: StageTab }) {
  const { state, selectItem } = useStore();
  const sel = state.wb.sel;
  if (tab === '3d') return <PoseStage selectedId={sel} onSelectJoint={(id) => selectItem(id)} />;
  if (tab === 'schematic') {
    return (
      <div className="stage-scroll stage-schematic-inner">
        <ArmDiagram arm={state.arm} />
      </div>
    );
  }
  if (tab === 'summary') return <div className="stage-scroll"><JointsSummary /></div>;
  // disc: the selected cycloidal joint or Custom
  const joint = state.arm.joints.find((j) => j.id === sel);
  const slot: Slot | null = sel === CUSTOM ? CUSTOM : joint && joint.drive === 'cycloidal' ? joint.id : null;
  if (!slot) {
    return (
      <div className="stage-msg">
        <p className="stage-msg-title">No disc to show for {selectionLabel(state, sel)}</p>
        <p className="muted">{joint ? 'This joint is a direct-drive servo, so it has no cycloidal disc.' : 'The Arm item has no gearbox.'} Select a cycloidal joint or Custom gearbox on the left to see its disc, the θ animation and the charts.</p>
      </div>
    );
  }
  return <DiscStage slot={slot} />;
}

function DiscStage({ slot }: { slot: Slot }) {
  const { state } = useStore();
  const { model } = useSlotModel(slot);
  if (!model.result.valid) {
    return (
      <div className="stage-msg">
        <p className="stage-msg-title">{selectionLabel(state, slot)}: these inputs cannot be computed yet</p>
        <p className="muted">Open Checks in the inspector to see what to change.</p>
      </div>
    );
  }
  return (
    <div className="stage-scroll">
      <h2 className="stage-caption">{selectionLabel(state, slot)} · disc and charts</h2>
      <DiscAndCharts model={model} layout="stage" />
    </div>
  );
}
