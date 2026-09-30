import { useDeferredValue, useMemo } from 'react';
import { createGearboxModel, JOINT_PRESET_SPECS } from '../../calc';
import { JointChips } from '../components/JointChips';
import { StatusChip, verdictKind } from '../components/primitives';
import { StepHint } from '../components/StepHint';
import { useEffectiveInputs, useStore } from '../store';
import { util } from '../format';
import { plainName } from '../plain';
import { GearboxInputsPanel } from './GearboxInputsPanel';
import { CheckCards, DiscAndCharts, InvalidCard, KeyTiles, PolymerCard, VerdictBanner } from './GearboxResults';
import { SolverPanel } from './SolverPanel';

export function GearboxScreen() {
  const { state, select } = useStore();
  const slot = state.selected;
  const eff = useEffectiveInputs(slot);
  const deferred = useDeferredValue(eff);
  const model = useMemo(() => createGearboxModel(deferred), [deferred]);
  const r = model.result;
  const pending = deferred !== eff;
  const label = slot === 'custom' ? 'Custom' : JOINT_PRESET_SPECS[slot].label;

  return (
    <div className="screen">
      <StepHint step={2} />
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Gearbox <span className="screen-title-sub">{label}</span></h1>
        </div>
        <JointChips value={slot} onChange={select} label="Joint" />
      </div>
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
              <KeyTiles r={r} discs={deferred.discs} />
              <CheckCards r={r} />
              <DiscAndCharts model={model} />
            </>
          )}
          <SolverPanel slot={slot} eff={eff} K1={r.derived.K1} />
        </div>
      </div>
      <MiniVerdict slot={slot} verdict={r.verdict} util={r.maxUtilization} governing={r.governing ? plainName(r.governing) : null} />
    </div>
  );
}

/** Narrow screens: a fixed bottom bar so you see the verdict while you type. */
function MiniVerdict({ verdict, util: u, governing }: { slot: string; verdict: string; util: number; governing: string | null }) {
  const kind = verdictKind(verdict);
  const word = verdict === 'pass' ? 'PASS' : verdict === 'marginal' ? 'MARGINAL' : verdict === 'fail' ? 'FAIL' : 'INVALID';
  return (
    <button
      type="button"
      className={`miniverdict miniverdict-${kind}`}
      onClick={() => document.getElementById('gearbox-results')?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      aria-label={`Verdict ${word}. Jump to results.`}
    >
      <StatusChip kind={kind} size="sm">{word}</StatusChip>
      <span className="miniverdict-text">{governing ? `${governing} · ${util(u)}` : 'fix inputs to see results'}</span>
      <span className="miniverdict-go" aria-hidden="true">Results {'↓'}</span>
    </button>
  );
}
