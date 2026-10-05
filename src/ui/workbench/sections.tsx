// Inspector section bodies and their one-line summaries (CLAUDE.md Addition 10). The light sections live in the main
// chunk; the heavy ones (Disc, Solver, Advisor, DXF) load on demand, with a skeleton while they load.
import { lazy, type ComponentType, type ReactNode } from 'react';
import { MOTION_LABEL, analyzeJointMotor, type ArmJoint, type Fix } from '../../calc';
import { useApplyFix, useFixes } from '../fixes';
import { MotorFields } from '../components/MotorFields';
import { num, util } from '../format';
import { plainName } from '../plain';
import { gearboxOf, slotLabel, slotShort, CUSTOM, type Session, type Slot } from '../session';
import { useStore, type AdvisorRun } from '../store';
import type { U } from '../units';
import { GearboxInputsPanel } from '../screens/GearboxInputsPanel';
import { CheckCards, InvalidCard, KeyData, PolymerCard, VerdictBanner } from '../screens/GearboxResults';
import { MotorCard } from '../screens/MotorCard';
import type { SlotModel } from '../screens/GearboxScreen';
import { ArmSettings, JointArmLoads, JointLinkFields, ServoRequirement, TorqueTable } from '../screens/ArmScreen';
import type { SectionId } from './wbState';
import { solverKey } from './solverKey';

/** What a section body gets: the selection, its joint (if any), the gearbox slot (if any) and its live model. */
export interface SectionCtx {
  sel: string;
  joint: ArmJoint | null;
  /** Position of the joint in the arm (0-based), -1 for Custom / Arm */
  index: number;
  /** Gearbox slot: a cycloidal joint id or 'custom'; null for a servo joint and the Arm item */
  slot: Slot | null;
  sm: SlotModel | null;
}

export type SectionBodies = Record<SectionId, ComponentType<SectionCtx>>;

// ---------------------------------------------------------------------------
// Light bodies (main chunk)
// ---------------------------------------------------------------------------

function JointBody({ joint, index }: SectionCtx) {
  if (!joint) return null;
  return <JointLinkFields joint={joint} index={index} />;
}

function MotorBody({ joint, index, slot, sm }: SectionCtx) {
  const { arm } = useStore();
  if (!joint) return null;
  return (
    <>
      <MotorFields joint={joint} load={arm.joints[index]} armOk={arm.valid} />
      {slot && sm && <MotorCard slot={slot} eff={sm.eff} inline />}
    </>
  );
}

function LoadsBody({ joint, index, slot, sm }: SectionCtx) {
  if (!joint) return null;
  if (joint.drive === 'servo' || !slot || !sm) {
    return (
      <>
        <ServoRequirement index={index} />
        <h4 className="subgroup-h">From the arm model</h4>
        <JointArmLoads index={index} />
      </>
    );
  }
  return (
    <>
      <GearboxInputsPanel slot={slot} eff={sm.eff} result={sm.model.result} part="loads" />
      <h4 className="subgroup-h">From the arm model (worst case)</h4>
      <JointArmLoads index={index} />
    </>
  );
}

function DesignBody({ slot, sm }: SectionCtx) {
  if (!slot || !sm) return null;
  return <GearboxInputsPanel slot={slot} eff={sm.eff} result={sm.model.result} part="design" />;
}

function ChecksBody({ slot, sm }: SectionCtx) {
  const fx = useFixes(slot);
  const apply = useApplyFix();
  if (!sm) return null;
  const r = sm.model.result;
  const view = { report: fx.report, pending: fx.pending, onApply: slot ? (f: Fix) => apply(slot, f) : undefined };
  return (
    <div className={`checks-body${sm.pending ? ' is-pending' : ''}`}>
      <VerdictBanner r={r} fixes={view} />
      {!r.valid ? <InvalidCard r={r} /> : (
        <>
          {r.polymerWarning && <PolymerCard />}
          <KeyData r={r} discs={sm.deferred.discs} />
          <CheckCards r={r} compact fixes={view} />
        </>
      )}
    </div>
  );
}

function ArmSettingsBody() {
  return <ArmSettings />;
}

function ArmTorquesBody() {
  const { state, arm, selectItem } = useStore();
  return <TorqueTable armInputs={state.arm} arm={arm} errors={arm.errors} onSelect={selectItem} />;
}

// ---------------------------------------------------------------------------
// Heavy bodies (lazy)
// ---------------------------------------------------------------------------

const LazyDisc = lazy(() => import('./DiscViews').then((m) => ({
  default: function DiscBody({ sm }: SectionCtx) {
    const { setStage, patchWb } = useStore();
    if (!sm) return null;
    return <m.DiscPreview model={sm.model} onOpenStage={() => { setStage('disc'); patchWb({ mobile: 'view' }); }} />;
  },
})));
const LazySolver = lazy(() => import('../screens/SolverPanel').then((m) => ({
  default: function SolverBody({ slot, sm }: SectionCtx) {
    if (!slot || !sm) return null;
    return <m.SolverPanel slot={slot} eff={sm.eff} K1={sm.model.result.derived.K1} />;
  },
})));
const LazyAdvisor = lazy(() => import('../screens/AdvisorScreen').then((m) => ({
  default: function AdvisorBody({ slot }: SectionCtx) {
    if (!slot) return null;
    return <m.AdvisorPanel slot={slot} />;
  },
})));
const LazyDxf = lazy(() => import('../components/ExportDxfPanel').then((m) => ({
  default: function DxfBody({ slot, sm }: SectionCtx) {
    const { state } = useStore();
    if (!slot || !sm) return null;
    return <m.ExportDxfPanel inputs={sm.deferred} label={slotShort(state.arm, slot)} model={sm.model} />;
  },
})));

/** Section bodies as the app uses them (heavy ones lazy). Tests pass eager ones instead (see eager.tsx). */
export const LAZY_BODIES: SectionBodies = {
  joint: JointBody,
  motor: MotorBody,
  loads: LoadsBody,
  design: DesignBody,
  checks: ChecksBody,
  disc: LazyDisc as unknown as ComponentType<SectionCtx>,
  solver: LazySolver as unknown as ComponentType<SectionCtx>,
  advisor: LazyAdvisor as unknown as ComponentType<SectionCtx>,
  dxf: LazyDxf as unknown as ComponentType<SectionCtx>,
  armSettings: ArmSettingsBody,
  armTorques: ArmTorquesBody,
};

export const LIGHT_BODIES = { JointBody, MotorBody, LoadsBody, DesignBody, ChecksBody, ArmSettingsBody, ArmTorquesBody };

// ---------------------------------------------------------------------------
// One-line summaries shown on a collapsed section
// ---------------------------------------------------------------------------

export interface SummaryInput {
  state: Session;
  arm: ReturnType<typeof useStore>['arm'];
  u: U;
  advisorRun: AdvisorRun;
  solverMemo: ReturnType<typeof useStore>['solverMemo'];
  discDeg: number;
}

export function sectionSummary(id: SectionId, c: SectionCtx, x: SummaryInput): ReactNode {
  const { state, arm, u } = x;
  const j = c.joint;
  const T = (v: number) => u.fu('torque', v, { fixed: true });
  switch (id) {
    case 'joint':
      if (!j) return null;
      return `${u.fu('mass', j.mass_g, { dp: 0, trim: true })} · link ${u.fu('length', j.length_mm, { dp: 0, trim: true })} / ${u.fu('mass', j.linkMass_g, { dp: 0, trim: true })}`;
    case 'motor': {
      if (!j) return null;
      if (!j.motor) return j.drive === 'servo' ? 'no servo data' : 'no motor';
      const name = (j.motor.name ?? 'Custom').replace(/ \(typical\)$/, '');
      if (j.drive === 'servo') {
        const l = arm.joints[c.index];
        const info = l && arm.valid ? analyzeJointMotor(j, { Treq: l.Treq, Tdes: l.Tdes }, null) : null;
        const st = info?.check.status;
        return `${name} · ${st === 'ok' ? 'servo OK' : st === 'short' ? 'too small' : 'incomplete'}`;
      }
      const eff = c.sm?.eff;
      const info = eff ? analyzeJointMotor(j, { Treq: eff.Treq, Tdes: eff.Tdes }, eff.Zp) : null;
      const rec = info?.recommendation;
      const cur = eff && Number.isInteger(eff.Zp) ? `${eff.Zp - 1}:1` : '—';
      return `${name} · rec ${rec?.ratio != null ? `${rec.ratio}:1` : '—'} · current ${cur}`;
    }
    case 'loads': {
      if (!j) return null;
      if (c.sm) return `T_des ${T(c.sm.eff.Tdes)} · ${c.slot && state.useArmLoads[c.slot] !== false && arm.valid ? 'arm' : 'typed'}`;
      const l = arm.joints[c.index];
      return l && arm.valid ? `T_des ${T(l.Tdes)} · servo` : '—';
    }
    case 'design': {
      if (!c.slot) return null;
      const g = gearboxOf(state, c.slot);
      const L = (v: number, dp: number) => u.f('length', v, { dp, trim: true });
      return `D ${L(g.D, 1)} · e ${L(g.e, 3)} · ${Number.isInteger(g.Zp) ? g.Zp - 1 : '—'}:1 · ${g.discs} disc${g.discs > 1 ? 's' : ''}`;
    }
    case 'checks': {
      const r = c.sm?.model.result;
      if (!r) return null;
      if (r.verdict === 'invalid') return 'INVALID · fix the inputs';
      const word = r.verdict === 'pass' ? 'PASS' : r.verdict === 'marginal' ? 'MARGINAL' : 'FAIL';
      return `${word} ${util(r.maxUtilization)}${r.governing ? ` · ${plainName(r.governing)}` : ''}`;
    }
    case 'disc': {
      const m = c.sm?.model;
      if (!m || !m.result.valid) return '—';
      const pins = m.pinsAt((x.discDeg * Math.PI) / 180);
      return `θ ${num(x.discDeg, 0)}° · ${pins ? pins.filter((p) => p.loaded).length : '—'} of ${pins?.length ?? '—'} pins loaded`;
    }
    case 'solver': {
      if (!c.slot || !c.sm) return null;
      const memo = x.solverMemo[c.slot];
      if (!memo) return 'not run';
      const r = memo.res;
      const stale = memo.key !== solverKey(c.sm.eff) ? ' (stale)' : '';
      if (!r.valid) return 'could not run';
      if (r.noSolution || r.minD == null) return `no solution${stale}`;
      return `D ${u.fu('length', r.minD, { dp: 0 })} · K1 ${r.bestK1 != null ? r.bestK1.toFixed(3) : '—'}${stale}`;
    }
    case 'advisor': {
      if (!c.slot) return null;
      const run = x.advisorRun;
      if (run.slot !== c.slot) return 'not run';
      if (run.status === 'running') return `running ${Math.round((run.progress?.fraction ?? 0) * 100)}%`;
      const res = run.result;
      if (!res) return 'not run';
      if (!res.valid) return 'could not run';
      const d = res.best ?? res.closest;
      if (!d) return 'no design';
      const kind = d.result.verdict === 'pass' ? 'PASS' : d.result.verdict === 'marginal' ? 'MARGINAL' : 'FAIL';
      return `${u.fu('length', d.housingOD, { dp: 0 })} housing ${kind} ${util(d.maxUtilization)}${res.best ? '' : ' (closest)'}`;
    }
    case 'dxf':
      return `5 parts + sheet · ${u.prefs.length === 'in' ? 'in' : 'mm'}`;
    case 'armSettings':
      return `payload ${u.fu('mass', state.arm.payload_g, { dp: 0, trim: true })} · SF ${state.arm.SF} · DOF ${state.arm.joints.length}`;
    case 'armTorques': {
      if (!arm.valid) return 'arm input error';
      let k = -1;
      arm.joints.forEach((l, i) => { if (k < 0 || l.Tdes > arm.joints[k].Tdes) k = i; });
      return k >= 0 ? `highest T_des J${k + 1} ${T(arm.joints[k].Tdes)}` : '—';
    }
    default:
      return null;
  }
}

/** Header label of a selection: "J2 shoulder", "Custom gearbox", "Arm". */
export function selectionLabel(state: Session, sel: string): string {
  if (sel === 'arm') return 'Arm';
  if (sel === CUSTOM) return 'Custom gearbox';
  return slotLabel(state.arm, sel);
}

export const motionWord = (j: ArmJoint) => MOTION_LABEL[j.motion];
