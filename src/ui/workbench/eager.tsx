// Every inspector section body loaded eagerly. The app uses the lazy set (sections.tsx); tests and server rendering use
// this one, because a lazy body only renders its skeleton until its chunk arrives.
import type { ComponentType } from 'react';
import { withTolerance } from '../../calc';
import { ExportDxfPanel } from '../components/ExportDxfPanel';
import { slotShort } from '../session';
import { useStore } from '../store';
import { AdvisorPanel } from '../screens/AdvisorScreen';
import { SolverPanel } from '../screens/SolverPanel';
import { JointsSummary } from '../screens/JointsScreen';
import { DiscAndCharts, DiscPreview } from './DiscViews';
import { LIGHT_BODIES, type SectionBodies, type SectionCtx } from './sections';

function DiscBody({ sm }: SectionCtx) {
  const { setStage } = useStore();
  if (!sm) return null;
  return <DiscPreview model={sm.model} onOpenStage={() => setStage('disc')} />;
}
function SolverBody({ slot, sm }: SectionCtx) {
  if (!slot || !sm) return null;
  return <SolverPanel slot={slot} eff={sm.eff} K1={sm.model.result.derived.K1} />;
}
function AdvisorBody({ slot }: SectionCtx) {
  if (!slot) return null;
  return <AdvisorPanel slot={slot} />;
}
function DxfBody({ slot, sm }: SectionCtx) {
  const { state, updateGearbox } = useStore();
  if (!slot || !sm) return null;
  return <ExportDxfPanel inputs={sm.deferred} label={slotShort(state.arm, slot)} model={sm.model}
    onTolerance={(p) => updateGearbox(slot, (g) => withTolerance(g, p))} />;
}

export const EAGER_BODIES: SectionBodies = {
  joint: LIGHT_BODIES.JointBody,
  motor: LIGHT_BODIES.MotorBody,
  loads: LIGHT_BODIES.LoadsBody,
  design: LIGHT_BODIES.DesignBody,
  checks: LIGHT_BODIES.ChecksBody,
  tolerance: LIGHT_BODIES.ToleranceBody,
  disc: DiscBody,
  solver: SolverBody,
  advisor: AdvisorBody,
  dxf: DxfBody,
  armSettings: LIGHT_BODIES.ArmSettingsBody,
  armTorques: LIGHT_BODIES.ArmTorquesBody,
  armSlop: LIGHT_BODIES.ArmSlopBody,
};

export { DiscAndCharts, JointsSummary };
export type { ComponentType };
