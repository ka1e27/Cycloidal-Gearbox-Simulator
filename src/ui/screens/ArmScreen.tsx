import { useEffect, useMemo, useRef, useState } from 'react';
import {
  DRIVE_LABEL, JOINT_PRESET_SPECS, MAX_JOINTS, MIN_JOINTS, MOTION_LABEL, defaultArmInputs, jointLabel, validateArmInputs,
  type ArmInputs, type ArmJoint, type ArmJointLoad, type ArmResult, type DriveType, type MotionType,
} from '../../calc';
import { Advanced, Button, Card, Cu, Notice, PageHead, ResponsiveTable, Segmented, StepNav } from '../components/primitives';
import { JointTag } from '../components/JointTag';
import { InfoTip } from '../components/InfoTip';
import { NumberField } from '../components/NumberField';
import { stepSubtitle } from '../components/StepHint';
import { HELP } from '../help';
import { DASH } from '../format';
import { addJoint, moveJoint, patchJoint, removeJoint, setMotion } from '../armEdit';
import { ArmDiagram } from '../viz/ArmDiagram';
import { MotionIcon } from '../viz/armSymbols';
import { useStore } from '../store';
import { presetIdFor, slotLabel } from '../session';

const D = defaultArmInputs();

const MOTION_OPTIONS = (['yaw', 'pitch', 'roll'] as MotionType[]).map((m) => ({
  value: m,
  label: <span className="seg-icon"><MotionIcon motion={m} size={20} /><span>{MOTION_LABEL[m]}</span></span>,
  title: { yaw: 'Turns about a vertical axis (the base)', pitch: 'Bends about an axis perpendicular to the link', roll: 'Turns about the link axis' }[m],
}));
const DRIVE_OPTIONS = (['cycloidal', 'servo'] as DriveType[]).map((d) => ({
  value: d, label: DRIVE_LABEL[d], title: d === 'cycloidal' ? 'Gets a gearbox check, an advisor run and an All Joints row' : 'Direct-drive servo: only the required torque is reported',
}));

export function ArmScreen() {
  const { state, arm, updateArm, setStep, u, notify } = useStore();
  const a = state.arm;
  const errors = useMemo(() => validateArmInputs(a), [a]);
  const err = (prefix: string) => errors.errors.find((e) => e.startsWith(prefix)) ?? null;
  const dirty = JSON.stringify(a) !== JSON.stringify(D);
  const n = a.joints.length;
  const [newType, setNewType] = useState<MotionType>('pitch');
  const [focusId, setFocusId] = useState<string | null>(null);

  const onAdd = () => {
    const next = addJoint(a, newType);
    if (next === a) return;
    const added = next.joints[next.joints.length - 1];
    updateArm(() => next);
    setFocusId(added.id);
    // the store gives it a gearbox started from the closest preset; say so
    window.setTimeout(() => notify('info', `Added ${jointLabel(added, next.joints.length - 1)}. Its gearbox starts from the preset whose torque is closest (see the Gearbox page), and you can change everything.`), 0);
  };

  return (
    <div className="screen">
      <PageHead title="Arm & Loads" sub={stepSubtitle(1)} />
      <div className="split split-arm">
        <div className="col col-inputs">
          <Notice kind="warning" title="Placeholder values">
            The default masses and lengths are placeholders until CAD masses exist. Replace them with your own.
          </Notice>
          <div className="panel">
            <div className="panel-head">
              <h2 className="panel-title">Joints <span className="dof-badge" aria-label={`${n} degrees of freedom`}>DOF {n}</span> <InfoTip help={HELP.jointCount} label="Degrees of freedom" /></h2>
              <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => updateArm(() => defaultArmInputs())}>
                Reset arm
              </Button>
            </div>
            <p className="section-note">Ordered from the base to the tip. Each joint carries the link that runs from it to the next joint; the last joint carries the tool.</p>

            <ol className="joint-list" aria-label="Joints, base to tip">
              {a.joints.map((j, i) => (
                <JointCard
                  key={j.id}
                  arm={a}
                  joint={j}
                  index={i}
                  load={arm.joints[i]}
                  armOk={arm.valid}
                  err={err}
                  focusMe={focusId === j.id}
                  onFocused={() => setFocusId(null)}
                  canRemove={n > MIN_JOINTS}
                />
              ))}
            </ol>

            <div className="joint-add">
              <Segmented<MotionType> value={newType} onChange={setNewType} label="Type of the joint to add" size="sm" options={MOTION_OPTIONS} />
              <Button variant="secondary" size="sm" disabled={n >= MAX_JOINTS} onClick={onAdd}
                title={n >= MAX_JOINTS ? `An arm has at most ${MAX_JOINTS} joints` : 'Add a joint at the tip of the arm'}>
                + Add joint
              </Button>
            </div>
            {n >= MAX_JOINTS && <p className="section-note">The arm is at the maximum of {MAX_JOINTS} joints.</p>}

            <h3 className="subgroup-h">Payload and safety factors</h3>
            <NumberField label="Payload at tool tip" quantity="mass" value={a.payload_g}
              onChange={(v) => updateArm((x) => ({ ...x, payload_g: v ?? 0 }))} defaultValue={D.payload_g}
              error={err('Payload')} help={HELP.payload} step={10} />
            <NumberField label="Service factor" symbol="SF" value={a.SF} onChange={(v) => updateArm((x) => ({ ...x, SF: v ?? 0 }))}
              defaultValue={D.SF} error={err('Service factor')} warning={errors.warnings[0] ?? null} help={HELP.SF} step={0.1} />
            <NumberField label="Minimum design torque" symbol="T_des floor" quantity="torque" value={a.TdesFloor}
              onChange={(v) => updateArm((x) => ({ ...x, TdesFloor: v ?? 0 }))} defaultValue={D.TdesFloor}
              error={err('T_des floor')} help={HELP.TdesFloor} step={0.1} />
            {errors.errors.length > 0 && !errors.errors.every((e) => /^(Joint mass|Bar mass|Bar length|Angular|Link offset|Manual|Payload|Service|T_des)/.test(e)) && (
              <Notice kind="error" title="The arm cannot be computed">{u.text(errors.errors[0])}</Notice>
            )}
          </div>
        </div>

        <div className="col col-results">
          <Card title="Arm side view" className="arm-diagram-card">
            <ArmDiagram arm={a} />
          </Card>
          <TorqueTable armInputs={a} arm={arm} errors={errors.errors} />
          {arm.valid && arm.notes.length > 0 && (
            <Notice kind="info" title="How these joints are modelled">
              <ul className="note-list">
                {arm.notes.map((t) => <li key={t}>{t}</li>)}
              </ul>
            </Notice>
          )}
          <ServoCards armInputs={a} arm={arm} />
        </div>
      </div>
      <StepNav next={{ label: 'Next: Gearbox', onClick: () => setStep(2) }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// One joint
// ---------------------------------------------------------------------------

function JointCard({ arm, joint: j, index: i, load, armOk, err, focusMe, onFocused, canRemove }: {
  arm: ArmInputs; joint: ArmJoint; index: number; load: ArmJointLoad | undefined; armOk: boolean;
  err: (prefix: string) => string | null; focusMe: boolean; onFocused: () => void; canRemove: boolean;
}) {
  const { updateArm, state, u } = useStore();
  const n = arm.joints.length;
  const last = i === n - 1;
  const [open, setOpen] = useState(n <= 5 || focusMe);
  const [confirming, setConfirming] = useState(false);
  const cardRef = useRef<HTMLLIElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  // "modified" dots compare with the default of the same joint (by id); an added joint has none
  const dflt = D.joints.find((x) => x.id === j.id);
  const dMotion = dflt ?? null;
  const label = jointLabel(j, i);
  const patch = (p: Partial<ArmJoint>) => updateArm((x) => patchJoint(x, j.id, p));

  useEffect(() => {
    if (!focusMe) return;
    setOpen(true);
    cardRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    nameRef.current?.focus({ preventScroll: true });
    onFocused();
  }, [focusMe, onFocused]);

  const summary = `${MOTION_LABEL[j.motion]} · ${DRIVE_LABEL[j.drive]} · ${u.fu('mass', j.mass_g, { dp: 0, trim: true })} · ${u.fu('length', j.length_mm, { dp: 0, trim: true })}`;
  const presetNote = j.drive === 'cycloidal' && !(['J1', 'J2', 'J3', 'J4'] as string[]).includes(j.id) && state.presetBase[j.id]
    ? `Gearbox started from the ${JOINT_PRESET_SPECS[presetIdFor(j.id, state.presetBase)].label} preset (closest torque).` : null;

  return (
    <li className={`jcard${open ? ' is-open' : ''}`} ref={cardRef} aria-label={label}>
      <div className="jcard-head">
        <button type="button" className="jcard-toggle" aria-expanded={open} onClick={() => setOpen((o) => !o)} title={open ? 'Collapse this joint' : 'Expand this joint'}>
          <span className="jcard-pos mono">J{i + 1}</span>
          <MotionIcon motion={j.motion} size={20} title={`${MOTION_LABEL[j.motion]} joint`} />
          <span className="jcard-name">{j.name.trim() || MOTION_LABEL[j.motion].toLowerCase()}</span>
          {!open && <span className="jcard-sum">{summary}</span>}
        </button>
        <div className="jcard-actions" role="group" aria-label={`Actions for ${label}`}>
          <button type="button" className="icon-btn" aria-label={`Move ${label} toward the base`} title="Move toward the base" disabled={i === 0}
            onClick={() => updateArm((x) => moveJoint(x, j.id, -1))}>▲</button>
          <button type="button" className="icon-btn" aria-label={`Move ${label} toward the tip`} title="Move toward the tip" disabled={last}
            onClick={() => updateArm((x) => moveJoint(x, j.id, 1))}>▼</button>
          <button type="button" className="icon-btn icon-btn-danger" aria-label={`Remove ${label}`} title="Remove this joint" disabled={!canRemove}
            onClick={() => setConfirming(true)}>✕</button>
        </div>
      </div>

      {confirming && (
        <div className="jcard-confirm" role="alertdialog" aria-label={`Remove ${label}?`}>
          <p>
            Remove <strong>{label}</strong>?
            {j.drive === 'cycloidal' && ' Its gearbox inputs and Design Advisor settings are deleted too.'}
            {' '}The link after it goes with it, so the previous joint then connects to the next one.
          </p>
          <div className="jcard-confirm-btns">
            <Button size="sm" variant="danger" onClick={() => { setConfirming(false); updateArm((x) => removeJoint(x, j.id)); }}>Remove {label.split(' ')[0]}</Button>
            <Button size="sm" variant="secondary" onClick={() => setConfirming(false)} autoFocus>Keep it</Button>
          </div>
        </div>
      )}

      {open && (
        <div className="jcard-body">
          <div className="row row-stacked">
            <div className="row-label">
              <label className="row-name" htmlFor={`jn-${j.id}`}>Name</label>
              <InfoTip help={HELP.jointName} label="Joint name" />
            </div>
            <div className="row-control">
              <input
                id={`jn-${j.id}`} ref={nameRef} className="text-input" type="text" value={j.name} maxLength={40} autoComplete="off" spellCheck={false}
                placeholder={MOTION_LABEL[j.motion].toLowerCase()} onChange={(e) => patch({ name: e.target.value })}
              />
              <span className="name-pre mono" aria-hidden="true">shown as {label}</span>
            </div>
          </div>
          <div className="row row-stacked">
            <div className="row-label"><span className="row-name">Motion</span><InfoTip help={HELP.jointMotion} label="Motion type" /></div>
            <div className="row-control">
              <Segmented<MotionType> value={j.motion} onChange={(m) => updateArm((x) => setMotion(x, j.id, m))} label={`Motion type of ${label}`} size="sm" fullWidth options={MOTION_OPTIONS} />
            </div>
          </div>
          <div className="row row-stacked">
            <div className="row-label"><span className="row-name">Drive</span><InfoTip help={HELP.jointDrive} label="Drive" /></div>
            <div className="row-control">
              <Segmented<DriveType> value={j.drive} onChange={(d) => patch({ drive: d })} label={`Drive of ${label}`} size="sm" fullWidth options={DRIVE_OPTIONS} />
            </div>
          </div>
          {presetNote && <p className="section-note">{presetNote}</p>}
          <NumberField label="Joint mass" quantity="mass" value={j.mass_g} onChange={(v) => patch({ mass_g: v ?? 0 })}
            defaultValue={dMotion?.mass_g} error={err(`Joint mass ${i + 1} `)} help={HELP.jointMass} step={10} />
          <NumberField label={last ? 'Tool length, joint to tip' : i === 0 && j.motion === 'yaw' ? 'Height from turntable to the next joint axis' : 'Link length to the next joint'} quantity="length" value={j.length_mm}
            onChange={(v) => patch({ length_mm: v ?? 0 })} defaultValue={dMotion?.length_mm} error={err(`Bar length ${i + 1} `)}
            help={last ? HELP.toolLength : i === 0 && j.motion === 'yaw' ? HELP.baseColumnLength : HELP.barLength} step={5} />
          <NumberField label={last ? 'Tool mass' : i === 0 && j.motion === 'yaw' ? 'Turntable / bracket mass' : 'Link mass'} quantity="mass" value={j.linkMass_g}
            onChange={(v) => patch({ linkMass_g: v ?? 0 })} defaultValue={dMotion?.linkMass_g} error={err(`Bar mass ${i + 1} `)}
            help={last ? HELP.toolMass : i === 0 && j.motion === 'yaw' ? HELP.baseColumnMass : HELP.barMass} step={5} />
          <Advanced label="Advanced: acceleration, bearing offset, manual torques" defaultOpen={j.override.Treq != null || j.override.Tdes != null}>
            <NumberField label="Acceleration" symbol="α" unit="rad/s²" value={j.alpha} onChange={(v) => patch({ alpha: v ?? 0 })}
              defaultValue={dflt?.alpha} error={err(`Angular acceleration ${i + 1} `)} help={HELP.alpha} step={0.5} />
            <NumberField label="Link offset from output bearing (along axis)" quantity="length" value={j.linkOffset_mm}
              onChange={(v) => patch({ linkOffset_mm: v ?? 0 })} defaultValue={dflt?.linkOffset_mm} error={err(`Link offset J${i + 1} `)} help={HELP.linkOffset} step={1}
              note={j.motion === 'roll' ? 'Not used by a roll joint (its tilt comes from the geometry).' : undefined} />
            <p className="section-note">Manual torques replace the model for this joint everywhere. Leave empty to use the model.</p>
            <NumberField label="Manual T_req" quantity="torque" value={j.override.Treq} nullable
              placeholder={armOk && load ? u.f('torque', load.TreqModel, { fixed: true }) : 'model'}
              onChange={(v) => patch({ override: { ...j.override, Treq: v } })} defaultValue={null} error={err(`Manual T_req for J${i + 1}`)} help={HELP.ovTreq} step={0.1} />
            <NumberField label="Manual T_des" quantity="torque" value={j.override.Tdes} nullable placeholder="auto"
              onChange={(v) => patch({ override: { ...j.override, Tdes: v } })} defaultValue={null} error={err(`Manual T_des for J${i + 1}`)} help={HELP.ovTdes} step={0.1} />
          </Advanced>
        </div>
      )}
    </li>
  );
}

// ---------------------------------------------------------------------------
// Results
// ---------------------------------------------------------------------------

function TorqueTable({ armInputs, arm, errors }: { armInputs: ArmInputs; arm: ArmResult; errors: string[] }) {
  const { u } = useStore();
  const ok = arm.valid;
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
      <ResponsiveTable threshold={640}>
        <thead>
          <tr>
            <th scope="col">Joint</th>
            <th scope="col" className="num">Gravity torque about axis<small>{nm}</small></th>
            <th scope="col" className="num">Dynamic<small>{nm}</small></th>
            <th scope="col" className="num">T_req<small>{nm}</small></th>
            <th scope="col" className="num">T_des<small>{nm}</small></th>
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
                  <JointTag joint={joint ?? j} index={i} />
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
      <p className="card-foot muted small">
        {ok
          ? `Total arm mass ${u.fu('mass', arm.totalMass_g, { dp: 1, trim: true })}${firstPitch >= 0 ? `, reach ${u.fu('length', arm.reach_mm, { dp: 1, trim: true })} from ${slotLabel(armInputs, armInputs.joints[firstPitch].id).split(' ')[0]} (the first pitch joint)` : ', no pitch joint, so no horizontal reach'}.`
          : ''}
      </p>
    </Card>
  );
}

function ServoCards({ armInputs, arm }: { armInputs: ArmInputs; arm: ArmResult }) {
  const { u } = useStore();
  const T = (x: number) => u.fu('torque', x, { fixed: true });
  const servos = arm.joints.map((j, i) => ({ j, i })).filter((x) => x.j.drive === 'servo');
  if (servos.length === 0) return null;
  return (
    <>
      {servos.map(({ j, i }) => (
        <Card key={j.joint} title={`${jointLabel(armInputs.joints[i] ?? j, i)} servo requirement`}>
          <p className="card-sub">Direct drive: no gearbox check, just size the servo.</p>
          {arm.valid ? (
            <>
              <dl className="dtable dtable-1">
                <div className="dtable-row"><dt>Continuous torque, T_req</dt><dd><span>{T(j.Treq)}</span></dd></div>
                <div className="dtable-row"><dt>Peak torque with service factor, T_des</dt><dd><span>{T(j.Tdes)}</span></dd></div>
                <div className="dtable-row"><dt>Static + dynamic</dt><dd><span>{T(j.TstaticModel)} + {T(j.TdynModel)}</span></dd></div>
              </dl>
              <p className="muted small">Pick a servo rated for at least T_req continuous whose stall torque covers T_des.</p>
            </>
          ) : (
            <p className="muted">{DASH} waiting for valid arm inputs</p>
          )}
        </Card>
      ))}
    </>
  );
}
