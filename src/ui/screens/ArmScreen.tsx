// Arm & Loads content for the workbench (CLAUDE.md Additions 1, 7 and 10): the Arm item's settings and torque table,
// the "Joint & link" fields of one joint, adding joints, and a servo joint's requirement. These used to make up the
// 01 Arm & Loads page; they now live in the inspector.
import { useId, useMemo, useState } from 'react';
import {
  DRIVE_LABEL, JOINT_PRESET_SPECS, MAX_JOINTS, MOTION_LABEL, analyzeJointMotor, defaultArmInputs, jointLabel, validateArmInputs,
  type ArmInputs, type ArmJoint, type ArmResult, type DriveType, type MotionType,
} from '../../calc';
import { Advanced, Button, Card, Cu, DataTable, Notice, ResponsiveTable, Segmented, StatusChip } from '../components/primitives';
import { JointTag } from '../components/JointTag';
import { InfoTip } from '../components/InfoTip';
import { NumberField } from '../components/NumberField';
import { HELP } from '../help';
import { DASH, fixed } from '../format';
import { recommendedText } from '../motorUi';
import { addJoint, patchJoint } from '../armEdit';
import { MotionIcon } from '../viz/armSymbols';
import { JointSlider } from '../viz/JointSlider';
import { useStore } from '../store';
import { gearboxOf, presetIdFor, slotLabel } from '../session';
import { usePoseLiveOptional } from '../workbench/poseLive';

const D = defaultArmInputs();

export const MOTION_OPTIONS = (['yaw', 'pitch', 'roll'] as MotionType[]).map((m) => ({
  value: m,
  label: <span className="seg-icon"><MotionIcon motion={m} size={20} /><span>{MOTION_LABEL[m]}</span></span>,
  title: { yaw: 'Turns about a vertical axis (the base)', pitch: 'Bends about an axis perpendicular to the link', roll: 'Turns about the link axis' }[m],
}));
export const DRIVE_OPTIONS = (['cycloidal', 'servo'] as DriveType[]).map((d) => ({
  value: d, label: DRIVE_LABEL[d], title: d === 'cycloidal' ? 'Gets a gearbox check, an advisor run and a Summary row' : 'Direct-drive servo: only the required torque is reported',
}));

/** Errors of the arm inputs, looked up by message prefix. */
function useArmErrors(a: ArmInputs) {
  const errors = useMemo(() => validateArmInputs(a), [a]);
  const err = (prefix: string) => errors.errors.find((e) => e.startsWith(prefix)) ?? null;
  return { errors, err };
}

// ---------------------------------------------------------------------------
// Adding a joint (rail and Arm item)
// ---------------------------------------------------------------------------

/** Motion type chooser plus "+ Add joint" (adds at the tip). `onAdded` receives the new joint's id. */
export function AddJoint({ onAdded, compact }: { onAdded?: (id: string) => void; compact?: boolean }) {
  const { state, updateArm, notify } = useStore();
  const a = state.arm;
  const n = a.joints.length;
  const [newType, setNewType] = useState<MotionType>('pitch');
  const onAdd = () => {
    const next = addJoint(a, newType);
    if (next === a) return;
    const added = next.joints[next.joints.length - 1];
    updateArm(() => next);
    onAdded?.(added.id);
    // the store gives it a gearbox started from the closest preset; say so
    window.setTimeout(() => notify('info', `Added ${jointLabel(added, next.joints.length - 1)}. Its gearbox starts from the preset whose torque is closest (see Gearbox design), and you can change everything.`), 0);
  };
  return (
    <div className={`joint-add${compact ? ' is-compact' : ''}`}>
      <Segmented<MotionType> value={newType} onChange={setNewType} label="Type of the joint to add" size="sm"
        options={compact ? MOTION_OPTIONS.map((o) => ({ ...o, label: <span className="seg-icon" title={MOTION_LABEL[o.value]}><MotionIcon motion={o.value} size={18} /><span className="visually-hidden">{MOTION_LABEL[o.value]}</span></span> })) : MOTION_OPTIONS} />
      <Button variant="secondary" size="sm" disabled={n >= MAX_JOINTS} onClick={onAdd}
        title={n >= MAX_JOINTS ? `An arm has at most ${MAX_JOINTS} joints` : 'Add a joint at the tip of the arm'}>
        + Add joint
      </Button>
      {n >= MAX_JOINTS && <p className="section-note">The arm is at the maximum of {MAX_JOINTS} joints.</p>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Arm item: settings and totals
// ---------------------------------------------------------------------------

export function ArmSettings() {
  const { state, arm, updateArm, u } = useStore();
  const a = state.arm;
  const { errors, err } = useArmErrors(a);
  const dirty = JSON.stringify(a) !== JSON.stringify(D);
  const n = a.joints.length;
  const firstPitch = a.joints.findIndex((j) => j.motion === 'pitch');
  return (
    <div className="arm-settings">
      <Notice kind="warning" title="Placeholder values">
        The default masses and lengths are placeholders until CAD masses exist. Replace them with your own.
      </Notice>
      <NumberField label="Payload at tool tip" quantity="mass" value={a.payload_g}
        onChange={(v) => updateArm((x) => ({ ...x, payload_g: v ?? 0 }))} defaultValue={D.payload_g}
        error={err('Payload')} help={HELP.payload} step={10} />
      <NumberField label="Service factor" symbol="SF" value={a.SF} onChange={(v) => updateArm((x) => ({ ...x, SF: v ?? 0 }))}
        defaultValue={D.SF} error={err('Service factor')} warning={errors.warnings[0] ?? null} help={HELP.SF} step={0.1} />
      <NumberField label="Minimum design torque" symbol="T_des floor" quantity="torque" value={a.TdesFloor}
        onChange={(v) => updateArm((x) => ({ ...x, TdesFloor: v ?? 0 }))} defaultValue={D.TdesFloor}
        error={err('T_des floor')} help={HELP.TdesFloor} step={0.1} />
      {errors.errors.length > 0 && (
        <Notice kind="error" title="The arm cannot be computed">{u.text(errors.errors[0])}. Select the joint it names to fix it.</Notice>
      )}
      <h4 className="subgroup-h">Totals <InfoTip help={HELP.jointCount} label="Degrees of freedom" /></h4>
      <DataTable columns={1} rows={[
        { label: 'Degrees of freedom', value: <span className="dof-badge" aria-label={`${n} degrees of freedom`}>DOF {n}</span> },
        { label: 'Total arm mass', value: arm.valid ? u.fu('mass', arm.totalMass_g, { dp: 1, trim: true }) : DASH, note: 'joints, links, tool and payload' },
        {
          label: 'Reach', value: arm.valid && firstPitch >= 0 ? u.fu('length', arm.reach_mm, { dp: 1, trim: true }) : DASH,
          note: firstPitch >= 0 ? `straight out from ${slotLabel(a, a.joints[firstPitch].id).split(' ')[0]} (the first pitch joint)` : 'no pitch joint, so no horizontal reach',
        },
      ]} />
      <h4 className="subgroup-h">Joints</h4>
      <AddJoint onAdded={undefined} />
      <div className="arm-settings-foot">
        <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => updateArm(() => defaultArmInputs())}>Reset arm to defaults</Button>
      </div>
      {arm.valid && arm.notes.length > 0 && (
        <Notice kind="info" title="How these joints are modelled">
          <ul className="note-list">
            {arm.notes.map((t) => <li key={t}>{t}</li>)}
          </ul>
        </Notice>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One joint: "Joint & link" fields (the name, motion and drive sit in the inspector header)
// ---------------------------------------------------------------------------

export function JointLinkFields({ joint: j, index: i }: { joint: ArmJoint; index: number }) {
  const { state, arm, updateArm, u } = useStore();
  const a = state.arm;
  const { err } = useArmErrors(a);
  const last = i === a.joints.length - 1;
  const load = arm.joints[i];
  const armOk = arm.valid;
  // "modified" dots compare with the default of the same joint (by id); an added joint has none
  const dflt = D.joints.find((x) => x.id === j.id);
  const patch = (p: Partial<ArmJoint>) => updateArm((x) => patchJoint(x, j.id, p));
  const presetNote = j.drive === 'cycloidal' && !(['J1', 'J2', 'J3', 'J4'] as string[]).includes(j.id) && state.presetBase[j.id]
    ? `Gearbox started from the ${JOINT_PRESET_SPECS[presetIdFor(j.id, state.presetBase)].label} preset (closest torque).` : null;
  return (
    <div className="joint-fields">
      {presetNote && <p className="section-note">{presetNote}</p>}
      <NumberField label="Joint mass" quantity="mass" value={j.mass_g} onChange={(v) => patch({ mass_g: v ?? 0 })}
        defaultValue={dflt?.mass_g} error={err(`Joint mass ${i + 1} `)} help={HELP.jointMass} step={10} />
      <NumberField label={last ? 'Tool length, joint to tip' : i === 0 && j.motion === 'yaw' ? 'Height from turntable to the next joint axis' : 'Link length to the next joint'} quantity="length" value={j.length_mm}
        onChange={(v) => patch({ length_mm: v ?? 0 })} defaultValue={dflt?.length_mm} error={err(`Bar length ${i + 1} `)}
        help={last ? HELP.toolLength : i === 0 && j.motion === 'yaw' ? HELP.baseColumnLength : HELP.barLength} step={5} />
      <NumberField label={last ? 'Tool mass' : i === 0 && j.motion === 'yaw' ? 'Turntable / bracket mass' : 'Link mass'} quantity="mass" value={j.linkMass_g}
        onChange={(v) => patch({ linkMass_g: v ?? 0 })} defaultValue={dflt?.linkMass_g} error={err(`Bar mass ${i + 1} `)}
        help={last ? HELP.toolMass : i === 0 && j.motion === 'yaw' ? HELP.baseColumnMass : HELP.barMass} step={5} />
      <NumberField label="Acceleration" symbol="α" unit="rad/s²" value={j.alpha} onChange={(v) => patch({ alpha: v ?? 0 })}
        defaultValue={dflt?.alpha} error={err(`Angular acceleration ${i + 1} `)} help={HELP.alpha} step={0.5} />
      <NumberField label="Link offset from output bearing (along axis)" quantity="length" value={j.linkOffset_mm}
        onChange={(v) => patch({ linkOffset_mm: v ?? 0 })} defaultValue={dflt?.linkOffset_mm} error={err(`Link offset J${i + 1} `)} help={HELP.linkOffset} step={1}
        note={j.motion === 'roll' ? 'Not used by a roll joint (its tilt comes from the geometry).' : undefined} />
      <PoseAngle joint={j} index={i} />
      <Advanced label="Manual torques" defaultOpen={j.override.Treq != null || j.override.Tdes != null}>
        <p className="section-note">Manual torques replace the model for this joint everywhere. Leave empty to use the model.</p>
        <NumberField label="Manual T_req" quantity="torque" value={j.override.Treq} nullable
          placeholder={armOk && load ? u.f('torque', load.TreqModel, { fixed: true }) : 'model'}
          onChange={(v) => patch({ override: { ...j.override, Treq: v } })} defaultValue={null} error={err(`Manual T_req for J${i + 1}`)} help={HELP.ovTreq} step={0.1} />
        <NumberField label="Manual T_des" quantity="torque" value={j.override.Tdes} nullable placeholder="auto"
          onChange={(v) => patch({ override: { ...j.override, Tdes: v } })} defaultValue={null} error={err(`Manual T_des for J${i + 1}`)} help={HELP.ovTdes} step={0.1} />
      </Advanced>
    </div>
  );
}

/** The joint's angle in the 3D view and its limits (display only: the torques always use the worst case). */
function PoseAngle({ joint: j, index: i }: { joint: ArmJoint; index: number }) {
  const live = usePoseLiveOptional();
  const { updateArm } = useStore();
  const uid = useId().replace(/:/g, '');
  if (!live) return null;
  return (
    <div className="pose-angle">
      <h4 className="subgroup-h">Pose (3D view only)</h4>
      <JointSlider joint={j} index={i} uid={uid} angle={live.angles[i] ?? 0} atStop={live.stop?.i === i ? live.stop.side : null} label="Pose angle"
        onAngle={(d) => { live.setPlaying(false); live.setOne(i, d); }}
        onLimits={(lim) => updateArm((x) => patchJoint(x, j.id, { limits: lim }))} />
      <p className="section-note">Moves this joint in the 3D view. The torques and every check keep using the worst case (arm straight out).</p>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

export function TorqueTable({ armInputs, arm, errors, onSelect }: { armInputs: ArmInputs; arm: ArmResult; errors: string[]; onSelect?: (id: string) => void }) {
  const { u, state } = useStore();
  const ok = arm.valid;
  // motor columns appear once any joint has motor data (the torques used are the arm model's, as listed in this table)
  const anyMotor = armInputs.joints.some((j) => !!j.motor);
  const motorInfo = arm.joints.map((l, i) => {
    const j = armInputs.joints[i];
    return ok && j?.motor ? analyzeJointMotor(j, { Treq: l.Treq, Tdes: l.Tdes }, gearboxOf(state, j.id).Zp) : null;
  });
  const T = (x: number) => u.f('torque', x, { fixed: true });
  const nm = u.sym('torque');
  const firstPitch = armInputs.joints.findIndex((j) => j.motion === 'pitch');
  return (
    <Card title="Torque each joint must carry">
      <p className="card-sub">Always the worst case: the arm straight out, whichever pose is drawn. Gravity torque about the axis plus α·I goes through the gearbox. The bearing loads (radial, axial, tilting moment) are for sizing the joint{'’'}s own output bearing and are not checked.</p>
      {!ok && (
        <Notice kind="error" title="The arm model cannot be computed yet">
          {u.text(errors[0] ?? '')}. Fix the highlighted field to see the torques.
        </Notice>
      )}
      <ResponsiveTable threshold={anyMotor ? 900 : 640}>
        <thead>
          <tr>
            <th scope="col">Joint</th>
            <th scope="col" className="num">Gravity torque about axis<small>{nm}</small></th>
            <th scope="col" className="num">Dynamic<small>{nm}</small></th>
            <th scope="col" className="num">T_req<small>{nm}</small></th>
            <th scope="col" className="num">T_des<small>{nm}</small></th>
            {anyMotor && (
              <>
                <th scope="col" className="num">Recommended ratio<small>from the motor <InfoTip help={HELP.recRatio} label="Recommended ratio" /></small></th>
                <th scope="col" className="num">Motor margin<small>peak · continuous <InfoTip help={HELP.motorMargin} label="Motor margin" /></small></th>
              </>
            )}
            <th scope="col" className="num">Bearing radial<small>{u.sym('force')}</small></th>
            <th scope="col" className="num">Bearing axial<small>{u.sym('force')}</small></th>
            <th scope="col" className="num">Bearing tilting moment<small>{nm}</small></th>
          </tr>
        </thead>
        <tbody>
          {arm.joints.map((j, i) => {
            const servo = j.drive === 'servo';
            const joint = armInputs.joints[i];
            return (
              <tr key={j.joint} className={servo ? 'is-servo' : undefined}>
                <th scope="row" data-label="Joint">
                  <JointTag joint={joint ?? j} index={i}>
                    {onSelect ? <button type="button" className="linkish strong" onClick={() => onSelect(j.joint)} title="Open this joint in the inspector">J{i + 1}</button> : undefined}
                  </JointTag>
                </th>
                <td className="num" data-label="Gravity torque about axis">{ok ? T(j.TstaticModel) : DASH}{ok && <Cu>{nm}</Cu>}</td>
                <td className="num" data-label="Dynamic">{ok ? T(j.TdynModel) : DASH}{ok && <Cu>{nm}</Cu>}</td>
                <td className="num strong" data-label="T_req">
                  {ok ? T(j.Treq) : DASH}{ok && <Cu>{nm}</Cu>}
                  {ok && j.treqOverridden && <span className="tag">manual</span>}
                </td>
                <td className="num strong" data-label="T_des">
                  {ok ? T(j.Tdes) : DASH}{ok && <Cu>{nm}</Cu>}
                  {ok && j.tdesOverridden && <span className="tag">manual</span>}
                </td>
                {anyMotor && <MotorCells info={motorInfo[i]} servo={servo} hasMotor={!!joint?.motor} />}
                <td className="num" data-label="Bearing radial">
                  {ok && !servo && (j.motion !== 'yaw' || j.tiltedYaw) ? <>{u.f('force', j.bearingRadial_N, { fixed: true })}<Cu>{u.sym('force')}</Cu></> : DASH}
                </td>
                <td className="num" data-label="Bearing axial">
                  {ok && !servo && j.motion === 'yaw' ? <>{u.f('force', j.bearingAxial_N, { fixed: true })}<Cu>{u.sym('force')}</Cu></> : DASH}
                </td>
                <td className="num" data-label="Bearing tilting moment">
                  {ok && !servo ? <>{T(j.bearingTiltMoment_Nm)}<Cu>{nm}</Cu></> : DASH}
                </td>
              </tr>
            );
          })}
        </tbody>
      </ResponsiveTable>
      {!anyMotor && (
        <p className="card-foot muted small">Add a motor to a joint (select it, Motor & ratio section) to see the gear ratio it needs and the torque margin here.</p>
      )}
      <p className="card-foot muted small">
        {ok
          ? `Total arm mass ${u.fu('mass', arm.totalMass_g, { dp: 1, trim: true })}${firstPitch >= 0 ? `, reach ${u.fu('length', arm.reach_mm, { dp: 1, trim: true })} from ${slotLabel(armInputs, armInputs.joints[firstPitch].id).split(' ')[0]} (the first pitch joint)` : ', no pitch joint, so no horizontal reach'}.`
          : ''}
      </p>
    </Card>
  );
}

/** The two motor cells of a torque-table row: recommended ratio and margin. */
function MotorCells({ info, servo, hasMotor }: { info: ReturnType<typeof analyzeJointMotor>; servo: boolean; hasMotor: boolean }) {
  const { u } = useStore();
  if (!hasMotor || !info) {
    return (
      <>
        <td className="num" data-label="Recommended ratio">{DASH}<small className="cell-sub">{hasMotor ? 'fix the arm first' : 'no motor'}</small></td>
        <td className="num" data-label="Motor margin">{DASH}</td>
      </>
    );
  }
  if (servo) {
    const c = info.check;
    const margin = c.outputPeak_Nm != null && c.peakUtil ? 1 / c.peakUtil : null;
    return (
      <>
        <td className="num" data-label="Recommended ratio">direct drive<small className="cell-sub">no gearbox</small></td>
        <td className={`num${c.status === 'short' ? ' flag-fail' : ''}`} data-label="Motor margin">
          {c.status === 'incomplete' || c.status === 'invalid' ? DASH : <>{margin != null ? `${fixed(margin, 2)}×` : DASH}<small className="cell-sub">{c.status === 'ok' ? 'servo OK' : 'servo too small'}</small></>}
        </td>
      </>
    );
  }
  const rec = info.recommendation;
  const rt = recommendedText(rec);
  const bad = !rec || rec.status === 'infeasible' || rec.status === 'invalid';
  return (
    <>
      <td className={`num${bad ? ' flag-fail' : ''}`} data-label="Recommended ratio">
        <span className="strong">{rt.text}</span>
        {rt.reason && <small className="cell-sub">{u.text(rt.reason)}</small>}
      </td>
      <td className="num" data-label="Motor margin">
        {rec && rec.marginPeak != null ? (
          <>
            {fixed(rec.marginPeak, 2)}×{rec.marginCont != null && <> · {fixed(rec.marginCont, 2)}×</>}
            <small className="cell-sub">{rec.marginCont != null ? 'peak · continuous' : 'peak'}</small>
          </>
        ) : DASH}
      </td>
    </>
  );
}

/** One joint's worst-case torques and output-bearing loads from the arm model (the Loads section). */
export function JointArmLoads({ index: i }: { index: number }) {
  const { arm, u } = useStore();
  const l = arm.joints[i];
  if (!arm.valid || !l) return <p className="muted small">{DASH} waiting for valid arm inputs</p>;
  const T = (x: number) => u.fu('torque', x, { fixed: true });
  const F = (x: number) => u.fu('force', x, { fixed: true });
  const servo = l.drive === 'servo';
  const rows = [
    { label: 'Gravity torque about the axis', value: T(l.TstaticModel), note: 'worst case, arm straight out' },
    { label: 'Dynamic, α·I', value: T(l.TdynModel) },
    { label: 'Model T_req', value: T(l.TreqModel), note: l.treqOverridden ? `manual ${T(l.Treq)} used` : undefined },
  ];
  if (!servo) {
    if (l.motion !== 'yaw' || l.tiltedYaw) rows.push({ label: 'Output bearing, radial', value: F(l.bearingRadial_N), note: 'outboard weight' });
    if (l.motion === 'yaw') rows.push({ label: 'Output bearing, axial thrust', value: F(l.bearingAxial_N), note: 'outboard weight' });
    rows.push({ label: l.motion === 'yaw' ? 'Overturning moment' : 'Bearing tilting moment', value: T(l.bearingTiltMoment_Nm), note: 'information, not checked' });
  }
  return <DataTable columns={1} rows={rows} />;
}

/** A servo joint's requirement: T_req / T_des, static + dynamic, and its entered ratings checked against them. */
export function ServoRequirement({ index: i }: { index: number }) {
  const { state, arm, u } = useStore();
  const T = (x: number) => u.fu('torque', x, { fixed: true });
  const j = arm.joints[i];
  const joint = state.arm.joints[i];
  if (!j) return null;
  return (
    <Card title={`${jointLabel(joint ?? j, i)} servo requirement`}>
      <p className="card-sub">Direct drive: no gearbox check, just size the servo.</p>
      {arm.valid ? (
        <>
          <dl className="dtable dtable-1">
            <div className="dtable-row"><dt>Continuous torque, T_req</dt><dd><span>{T(j.Treq)}</span></dd></div>
            <div className="dtable-row"><dt>Peak torque with service factor, T_des</dt><dd><span>{T(j.Tdes)}</span></dd></div>
            <div className="dtable-row"><dt>Static + dynamic</dt><dd><span>{T(j.TstaticModel)} + {T(j.TdynModel)}</span></dd></div>
          </dl>
          <p className="muted small">Pick a servo rated for at least T_req continuous whose stall torque covers T_des.</p>
          <ServoCheck joint={joint} Treq={j.Treq} Tdes={j.Tdes} />
        </>
      ) : (
        <p className="muted">{DASH} waiting for valid arm inputs</p>
      )}
    </Card>
  );
}

/** Servo card: the entered servo ratings against T_req / T_des (pass / fail), or a hint to enter them. */
function ServoCheck({ joint, Treq, Tdes }: { joint: ArmJoint | undefined; Treq: number; Tdes: number }) {
  const { u } = useStore();
  const info = joint ? analyzeJointMotor(joint, { Treq, Tdes }, null) : null;
  if (!info) return <p className="muted small">Enter the servo’s torque ratings in the Motor & ratio section to check them here.</p>;
  const c = info.check;
  if (c.status === 'incomplete') return <p className="muted small">Enter the servo’s peak torque in the Motor & ratio section to check it.</p>;
  if (c.status === 'invalid') return <p className="small flag-fail">{u.text(c.errors[0] ?? '')}</p>;
  return (
    <div className="servo-check" role="status">
      <StatusChip kind={c.status === 'ok' ? 'ok' : 'fail'}>{c.status === 'ok' ? 'SERVO OK' : 'SERVO TOO SMALL'}</StatusChip>
      <ul className="plain-list small">
        {(c.status === 'ok' ? c.info : [...c.problems, ...c.info]).map((t) => <li key={t}>{u.text(t)}</li>)}
      </ul>
    </div>
  );
}
