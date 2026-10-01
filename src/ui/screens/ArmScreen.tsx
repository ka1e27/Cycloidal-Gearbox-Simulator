import { useMemo } from 'react';
import { ARM_JOINT_NAMES, defaultArmInputs, validateArmInputs, type ArmInputs, type ArmResult } from '../../calc';
import { Advanced, Button, Card, Cu, Notice, PageHead, ResponsiveTable, Section, StepNav } from '../components/primitives';
import { NumberField } from '../components/NumberField';
import { stepSubtitle } from '../components/StepHint';
import { HELP } from '../help';
import { DASH } from '../format';
import { ArmDiagram } from '../viz/ArmDiagram';
import { useStore } from '../store';
import { JOINT_KIND } from '../jointNames';

const BAR_NAMES = ['Base column, J1 to J2', 'Bar A, J2 to J3', 'Bar B, J3 to J4', 'Bar C, J4 to J5', 'Bar D (tool), J5 to tip'];
const BAR_SHORT = ['Base column', 'Bar A', 'Bar B', 'Bar C', 'Bar D'];
const D = defaultArmInputs();

function setAt<T>(arr: T[], i: number, v: T): T[] {
  const c = arr.slice();
  c[i] = v;
  return c;
}

export function ArmScreen() {
  const { state, arm, updateArm, setStep, u } = useStore();
  const a = state.arm;
  const errors = useMemo(() => validateArmInputs(a), [a]);
  const err = (prefix: string) => errors.errors.find((e) => e.startsWith(prefix)) ?? null;
  const tup = <K extends 'jointMass_g' | 'barMass_g' | 'barLength_mm' | 'alpha'>(key: K, i: number) =>
    (v: number | null) =>
      updateArm((x) => ({ ...x, [key]: setAt(x[key], i, v ?? 0) }) as ArmInputs);
  const setOv = (i: number, k: 'Treq' | 'Tdes') => (v: number | null) =>
    updateArm((x) => ({ ...x, override: x.override.map((o, j) => (j === i ? { ...o, [k]: v } : o)) }) as ArmInputs);
  const dirty = JSON.stringify(a) !== JSON.stringify(D);

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
              <h2 className="panel-title">Arm inputs</h2>
              <Button size="sm" variant="ghost" disabled={!dirty} onClick={() => updateArm(() => defaultArmInputs())}>
                Reset arm
              </Button>
            </div>

            <Section title="Link lengths" summary="centre to centre">
              {BAR_NAMES.map((n, i) => (
                <NumberField key={n} label={n} quantity="length" value={a.barLength_mm[i]} onChange={tup('barLength_mm', i)}
                  defaultValue={D.barLength_mm[i]} error={err(`Bar length ${i + 1}`)} help={i === 0 ? HELP.baseColumnLength : HELP.barLength} step={5} />
              ))}
            </Section>

            <Section title="Joint masses" summary="motor + gearbox + housing">
              {ARM_JOINT_NAMES.map((n, i) => (
                <NumberField key={n} label={`${n} mass`} quantity="mass" value={a.jointMass_g[i]} onChange={tup('jointMass_g', i)}
                  defaultValue={D.jointMass_g[i]} error={err(`Joint mass ${i + 1}`)} help={HELP.jointMass} step={10} />
              ))}
            </Section>

            <Section title="Link masses and payload">
              {BAR_SHORT.map((n, i) => (
                <NumberField key={n} label={`${n} mass`} quantity="mass" value={a.barMass_g[i]} onChange={tup('barMass_g', i)}
                  defaultValue={D.barMass_g[i]} error={err(`Bar mass ${i + 1}`)} help={i === 0 ? HELP.baseColumnMass : HELP.barMass} step={5} />
              ))}
              <NumberField label="Payload at tool tip" quantity="mass" value={a.payload_g}
                onChange={(v) => updateArm((x) => ({ ...x, payload_g: v ?? 0 }))} defaultValue={D.payload_g}
                error={err('Payload')} help={HELP.payload} step={10} />
            </Section>

            <Section title="Safety factors">
              <NumberField label="Service factor" symbol="SF" value={a.SF} onChange={(v) => updateArm((x) => ({ ...x, SF: v ?? 0 }))}
                defaultValue={D.SF} error={err('Service factor')} warning={errors.warnings[0] ?? null} help={HELP.SF} step={0.1} />
              <NumberField label="Minimum design torque" symbol="T_des floor" quantity="torque" value={a.TdesFloor}
                onChange={(v) => updateArm((x) => ({ ...x, TdesFloor: v ?? 0 }))} defaultValue={D.TdesFloor}
                error={err('T_des floor')} help={HELP.TdesFloor} step={0.1} />
              <Advanced label="Advanced: bearing offsets, acceleration and manual torques" defaultOpen={a.override.some((o) => o.Treq != null || o.Tdes != null)}>
                {(['J2', 'J3'] as const).map((n, i) => (
                  <NumberField key={n} label={`${n} link offset from output bearing (along axis)`} quantity="length" value={a.linkOffset_mm[i]}
                    onChange={(v) => updateArm((x) => ({ ...x, linkOffset_mm: setAt(x.linkOffset_mm, i, v ?? 0) as [number, number] }))}
                    defaultValue={D.linkOffset_mm[i]} error={err(`Link offset ${n}`)} help={HELP.linkOffset} step={1} />
                ))}
                {ARM_JOINT_NAMES.map((n, i) => (
                  <NumberField key={n} label={`${n} acceleration`} symbol="α" unit="rad/s²" value={a.alpha[i]} onChange={tup('alpha', i)}
                    defaultValue={D.alpha[i]} error={err(`Angular acceleration ${i + 1}`)} help={HELP.alpha} step={0.5} />
                ))}
                <p className="section-note">Manual torques replace the model for that joint everywhere. Leave empty to use the model.</p>
                {ARM_JOINT_NAMES.map((n, i) => (
                  <div key={n} className="row-pair">
                    <NumberField label={`${n} T_req`} quantity="torque" value={a.override[i].Treq} nullable
                      placeholder={arm.valid ? u.f('torque', arm.joints[i].TreqModel, { fixed: true }) : 'model'}
                      onChange={setOv(i, 'Treq')} defaultValue={null} error={err(`Manual T_req for ${n}`)} help={HELP.ovTreq} step={0.1} />
                    <NumberField label={`${n} T_des`} quantity="torque" value={a.override[i].Tdes} nullable placeholder="auto"
                      onChange={setOv(i, 'Tdes')} defaultValue={null} error={err(`Manual T_des for ${n}`)} help={HELP.ovTdes} step={0.1} />
                  </div>
                ))}
              </Advanced>
            </Section>
          </div>
        </div>

        <div className="col col-results">
          <Card title="Arm side view" className="arm-diagram-card">
            <ArmDiagram arm={a} />
          </Card>
          <TorqueTable arm={arm} errors={errors.errors} />
          <ServoCard arm={arm} />
        </div>
      </div>
      <StepNav next={{ label: 'Next: Gearbox', onClick: () => setStep(2) }} />
    </div>
  );
}

function TorqueTable({ arm, errors }: { arm: ArmResult; errors: string[] }) {
  const { u } = useStore();
  const ok = arm.valid;
  const T = (x: number) => u.f('torque', x, { fixed: true });
  const nm = u.sym('torque');
  return (
    <Card title="Torque each joint must carry">
      <p className="card-sub">Arm straight out. Gravity torque about the axis plus α·I goes through the gearbox. The bearing loads (radial, axial, tilting moment) are for sizing the joint{'’'}s own output bearing and are not checked.</p>
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
            const servo = i === 4;
            return (
              <tr key={j.joint} className={servo ? 'is-servo' : undefined}>
                <th scope="row" data-label="Joint">
                  <span className="joint-name">{j.joint}</span>
                  <span className="joint-kind">
                    {JOINT_KIND[i]}
                  </span>
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
                  {ok && !servo && i !== 0 ? <>{u.f('force', j.bearingRadial_N, { fixed: true })}<Cu>{u.sym('force')}</Cu></> : DASH}
                </td>
                <td className="num" data-label="Bearing axial">
                  {ok && i === 0 ? <>{u.f('force', j.bearingAxial_N, { fixed: true })}<Cu>{u.sym('force')}</Cu></> : DASH}
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
        {ok ? `Total arm mass ${u.fu('mass', arm.totalMass_g, { dp: 1, trim: true })}, reach ${u.fu('length', arm.reach_mm, { dp: 1, trim: true })} from J2.` : ''}
      </p>
    </Card>
  );
}

function ServoCard({ arm }: { arm: ArmResult }) {
  const { u } = useStore();
  const j5 = arm.joints[4];
  const T = (x: number) => u.fu('torque', x, { fixed: true });
  return (
    <Card title="J5 servo requirement">
      <p className="card-sub">Direct drive: no gearbox check, just size the servo.</p>
      {arm.valid ? (
        <>
          <dl className="dtable dtable-1">
            <div className="dtable-row"><dt>Continuous torque, T_req</dt><dd><span>{T(j5.Treq)}</span></dd></div>
            <div className="dtable-row"><dt>Peak torque with service factor, T_des</dt><dd><span>{T(j5.Tdes)}</span></dd></div>
            <div className="dtable-row"><dt>Static + dynamic</dt><dd><span>{T(j5.TstaticModel)} + {T(j5.TdynModel)}</span></dd></div>
          </dl>
          <p className="muted small">Pick a servo rated for at least T_req continuous whose stall torque covers T_des.</p>
        </>
      ) : (
        <p className="muted">{DASH} waiting for valid arm inputs</p>
      )}
    </Card>
  );
}
