// The old 01-04 pages as they now appear in the workbench (CLAUDE.md Addition 10), for the render tests: each "screen"
// renders the inspector sections (all open, loaded eagerly) and stage views that hold the same content as that page did.
import type { ReactNode } from 'react';
import { useStore } from '../store';
import { Inspector } from '../workbench/Inspector';
import { EAGER_BODIES } from '../workbench/eager';
import { DiscAndCharts } from '../workbench/DiscViews';
import { JointsSummary } from '../screens/JointsScreen';
import { AdvisorPanel } from '../screens/AdvisorScreen';
import { useSlotModel } from '../screens/GearboxScreen';
import { ArmDiagram } from '../viz/ArmDiagram';
import { PoseStage } from '../viz/PoseExplorer';
import { PoseLiveProvider } from '../workbench/poseLive';
import { DiscThetaProvider } from '../workbench/discTheta';

function Providers({ children }: { children: ReactNode }) {
  return <PoseLiveProvider><DiscThetaProvider>{children}</DiscThetaProvider></PoseLiveProvider>;
}

/** 01 Arm & Loads: the Arm item (settings, totals, torque table), the schematic, and every joint's Joint & link, Motor and Loads. */
export function ArmScreen() {
  const { state } = useStore();
  return (
    <Providers>
      <Inspector bodies={EAGER_BODIES} sel="arm" forceOpen />
      <ArmDiagram arm={state.arm} />
      {state.arm.joints.map((j) => (
        <div key={j.id} className="test-joint">
          <JointSections sel={j.id} />
        </div>
      ))}
    </Providers>
  );
}

/** One joint's Joint & link, Motor & ratio and Loads only (what its card on the arm page held). */
function JointSections({ sel }: { sel: string }) {
  const only = { ...EAGER_BODIES };
  for (const k of ['design', 'checks', 'disc', 'solver', 'advisor', 'dxf'] as const) only[k] = () => null;
  return <Inspector bodies={only} sel={sel} forceOpen />;
}

/** 02 Gearbox: the selected slot's inspector with every section open, plus the Disc stage (disc and both charts). */
export function GearboxScreen() {
  const { state } = useStore();
  const slot = state.selected;
  return (
    <Providers>
      <Inspector bodies={EAGER_BODIES} sel={slot} forceOpen />
      <DiscStageFor slot={slot} />
    </Providers>
  );
}

function DiscStageFor({ slot }: { slot: string }) {
  const { model } = useSlotModel(slot);
  return model.result.valid ? <DiscAndCharts model={model} layout="stage" /> : null;
}

/** 03 Design Advisor: the Design Advisor section of the selected slot. */
export function AdvisorScreen() {
  const { state } = useStore();
  return <Providers><AdvisorPanel slot={state.selected} /></Providers>;
}

/** 04 All Joints: the Summary stage. */
export function JointsScreen() {
  return <Providers><JointsSummary /></Providers>;
}

/** The Pose Explorer: the 3D stage with its drawer and the "All angles" popover open. */
export function PoseExplorer() {
  return <Providers><PoseStage anglesOpen /></Providers>;
}
