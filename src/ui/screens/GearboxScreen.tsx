import { useDeferredValue, useMemo } from 'react';
import { createGearboxModel } from '../../calc';
import { ExportDxfPanel } from '../components/ExportDxfPanel';
import { JointChips } from '../components/JointChips';
import { PageHead, StatusChip, StepNav, STATUS_WORD, verdictKind } from '../components/primitives';
import { stepSubtitle } from '../components/StepHint';
import { useEffectiveInputs, useStore } from '../store';
import { slotLabel, slotShort } from '../session';
import { util } from '../format';
import { plainName } from '../plain';
import { GearboxInputsPanel } from './GearboxInputsPanel';
import { CheckCards, DiscAndCharts, InvalidCard, KeyData, PolymerCard, VerdictBanner } from './GearboxResults';
import { SolverPanel } from './SolverPanel';

export function GearboxScreen() {
  const { state, select, setStep } = useStore();
  const slot = state.selected;
  const eff = useEffectiveInputs(slot);
  const deferred = useDeferredValue(eff);
  const model = useMemo(() => createGearboxModel(deferred), [deferred]);
  const r = model.result;
  const pending = deferred !== eff;
  const label = slotLabel(state.arm, slot);

  return (
    <div className="screen">
      <PageHead title="Gearbox" suffix={label} sub={stepSubtitle(2)}>
        <JointChips value={slot} onChange={select} label="Joint" />
      </PageHead>
      <div className="split split-gearbox">
        <div className="col col-inputs">
          <GearboxInputsPanel slot={slot} eff={eff} result={r} />
        </div>
        <div className={`col col-results${pending ? ' is-pending' : ''}`} id="gearbox-results">
          <VerdictBanner r={r} />
          {!r.valid ? (
            <InvalidCard r={r} />
          ) : (
            <>
              {r.polymerWarning && <PolymerCard />}
              <KeyData r={r} discs={deferred.discs} />
              <CheckCards r={r} />
              <DiscAndCharts model={model} />
            </>
          )}
          <SolverPanel slot={slot} eff={eff} K1={r.derived.K1} />
          <ExportDxfPanel inputs={deferred} label={slotShort(state.arm, slot)} model={model} />
        </div>
      </div>
      <StepNav
        back={{ label: 'Back: Arm & Loads', onClick: () => setStep(1) }}
        next={{ label: 'Next: Design Advisor', onClick: () => setStep(3) }}
      />
      <MiniVerdict verdict={r.verdict} util={r.maxUtilization} governing={r.governing ? plainName(r.governing) : null} />
    </div>
  );
}

/** Narrow screens: a fixed bottom bar so you see the verdict while you type. */
function MiniVerdict({ verdict, util: u, governing }: { verdict: string; util: number; governing: string | null }) {
  const kind = verdictKind(verdict);
  return (
    <button
      type="button"
      className={`miniverdict miniverdict-${kind}`}
      onClick={() => document.getElementById('gearbox-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      aria-label={`Verdict ${verdict === 'invalid' ? 'invalid' : STATUS_WORD[kind]}. Jump to results.`}
    >
      <StatusChip kind={kind}>{verdict === 'invalid' ? 'INVALID' : STATUS_WORD[kind]}</StatusChip>
      <span className="miniverdict-text">{governing ? `${governing} · ${util(u)}` : 'fix inputs to see results'}</span>
      <span className="miniverdict-go" aria-hidden="true">Results ↓</span>
    </button>
  );
}
