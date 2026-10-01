// "Motor" sub-section of a joint card on Arm & Loads (CLAUDE.md Addition 8): quick-fill presets, torque and speed fields,
// efficiency under Advanced, and a one-line live result.
import { useMemo } from 'react';
import { analyzeJointMotor, validateMotor, type ArmJoint, type ArmJointLoad, type MotorSpec } from '../../calc';
import { HELP } from '../help';
import { MOTOR_NOTE, MOTOR_PRESETS, applyPreset, makeCustom, patchMotor, presetIdOf, setMotor } from '../motorUi';
import { effectiveInputs, gearboxOf } from '../session';
import { useStore } from '../store';
import { NumberField } from './NumberField';
import { Advanced, SelectField, StatusChip } from './primitives';


export function MotorFields({ joint: j, load, armOk }: { joint: ArmJoint; load: ArmJointLoad | undefined; armOk: boolean }) {
  const { state, arm, updateArm, u } = useStore();
  const servo = j.drive === 'servo';
  const m = j.motor;
  const errors = useMemo(() => validateMotor(m).errors, [m]);
  const err = (prefix: string) => errors.find((e) => e.startsWith(prefix)) ?? null;
  const patch = (p: Partial<MotorSpec>) => updateArm((a) => patchMotor(a, j.id, p));

  const sel = presetIdOf(m);
  const onPick = (v: string) => {
    if (v === '') updateArm((a) => setMotor(a, j.id, undefined));
    else if (v === 'custom') updateArm((a) => makeCustom(a, j.id));
    else updateArm((a) => applyPreset(a, j.id, v));
  };

  return (
    <div className="motor-box" data-testid={`motor-${j.id}`}>
      <h4 className="subgroup-h">{servo ? 'Servo' : 'Motor'}</h4>
      <p className="section-note">
        {servo
          ? 'Optional: enter the servo’s torque ratings to check them against T_req and T_des (direct drive, no ratio).'
          : 'Optional: enter the motor’s max torque to get a recommended gear ratio for this joint.'}
      </p>
      <SelectField
        label={servo ? 'Quick fill (typical values)' : 'Quick fill (typical motor)'}
        help={HELP.motorPreset}
        value={sel}
        onChange={onPick}
        note={sel && sel !== 'custom' ? MOTOR_NOTE : undefined}
        options={[
          { value: '', label: 'No motor' },
          ...MOTOR_PRESETS.map((p) => ({ value: p.id, label: `${p.label} · ${u.fu('torque', p.Tpeak_Nm, { trim: true })}, ${p.maxSpeed_rpm} rpm` })),
          { value: 'custom', label: 'Custom (type your own values)' },
        ]}
      />
      <NumberField label={servo ? 'Servo peak torque' : 'Motor max torque'} symbol="T_peak" quantity="torque" value={m?.Tpeak_Nm ?? null} nullable
        onChange={(v) => patch({ Tpeak_Nm: v })} error={err('Motor peak torque')} help={servo ? HELP.servoPeak : HELP.motorPeak} step={0.05}
        placeholder="required" />
      <NumberField label={servo ? 'Servo rated torque' : 'Motor continuous torque'} symbol="T_cont" quantity="torque" value={m?.Tcont_Nm ?? null} nullable
        onChange={(v) => patch({ Tcont_Nm: v })} error={err('Motor continuous torque')} help={servo ? HELP.servoCont : HELP.motorCont} step={0.05}
        placeholder="optional" />
      <NumberField label={servo ? 'Servo max speed' : 'Motor max speed'} unit="rpm" value={m?.maxSpeed_rpm ?? null} nullable
        onChange={(v) => patch({ maxSpeed_rpm: v })} error={err('Motor max speed')} help={HELP.motorSpeed} step={50} placeholder="optional" />
      <NumberField label="Required joint speed" unit="deg/s" value={m?.requiredSpeed_degps ?? null} nullable
        onChange={(v) => patch({ requiredSpeed_degps: v })} error={err('Required joint speed')} help={HELP.motorReqSpeed} step={10} placeholder="optional" />
      {!servo && (
        <Advanced label="Advanced: gearbox efficiency" defaultOpen={!!m && m.efficiency !== 0.85}>
          <NumberField label="Gearbox efficiency" symbol="η" value={m ? m.efficiency : 0.85} disabled={!m}
            onChange={(v) => patch({ efficiency: v ?? 0.85 })} defaultValue={0.85} error={err('Gearbox efficiency')} help={HELP.motorEta} step={0.01}
            note={m ? undefined : 'Enter a motor torque first.'} />
        </Advanced>
      )}
      <MotorLine joint={j} load={load} armOk={armOk} state={state} arm={arm} />
    </div>
  );
}

/** One live line under the fields: the recommended ratio, or what is missing or wrong. */
function MotorLine({ joint: j, load, armOk, state, arm }: {
  joint: ArmJoint; load: ArmJointLoad | undefined; armOk: boolean; state: ReturnType<typeof useStore>['state']; arm: ReturnType<typeof useStore>['arm'];
}) {
  const { u } = useStore();
  if (!j.motor) return null;
  if (!armOk || !load) return <p className="motor-line muted small">Fix the arm inputs to see the recommended ratio.</p>;
  const cyc = j.drive === 'cycloidal';
  const eff = cyc ? effectiveInputs(state, j.id, arm) : null;
  const gb = cyc ? gearboxOf(state, j.id) : null;
  const info = analyzeJointMotor(j, eff ? { Treq: eff.Treq, Tdes: eff.Tdes } : { Treq: load.Treq, Tdes: load.Tdes }, gb ? gb.Zp : null);
  if (!info) return null;
  const rec = info.recommendation;
  if (cyc && rec) {
    if (rec.status === 'incomplete') return <p className="motor-line muted small">Enter the motor’s max torque to get a recommended ratio.</p>;
    if (rec.status === 'invalid') return <p className="motor-line is-bad small">{u.text(rec.errors[0] ?? 'The motor values need fixing.')}</p>;
    if (rec.status === 'infeasible') {
      return (
        <div className="motor-line is-bad" role="status">
          <StatusChip kind="fail">NO RATIO</StatusChip>
          <p className="small">{u.text(rec.reasons.slice(-2).join(' '))}</p>
        </div>
      );
    }
    return (
      <div className={`motor-line ${rec.status === 'warning' ? 'is-warn' : 'is-ok'}`} role="status">
        <StatusChip kind={rec.status === 'warning' ? 'marginal' : 'ok'}>RECOMMENDED {rec.headline}</StatusChip>
        <p className="small">
          {u.text(`Delivers ${rec.outputPeak_Nm == null ? '' : u.fu('torque', rec.outputPeak_Nm)} peak${rec.marginPeak != null ? ` (${rec.marginPeak.toFixed(2)}× T_des)` : ''}. `)}
          {rec.status === 'warning' && u.text(rec.reasons.filter((r) => /outside the Design Advisor|more than a single cycloidal/.test(r)).join(' '))}
        </p>
      </div>
    );
  }
  // servo
  const c = info.check;
  if (c.status === 'incomplete') return <p className="motor-line muted small">Enter the servo’s peak torque to check it.</p>;
  if (c.status === 'invalid') return <p className="motor-line is-bad small">{u.text(c.errors[0] ?? 'The servo values need fixing.')}</p>;
  return (
    <div className={`motor-line ${c.status === 'ok' ? 'is-ok' : 'is-bad'}`} role="status">
      <StatusChip kind={c.status === 'ok' ? 'ok' : 'fail'}>{c.status === 'ok' ? 'SERVO OK' : 'SERVO TOO SMALL'}</StatusChip>
      <p className="small">{u.text((c.status === 'ok' ? c.info : c.problems).join(' '))}</p>
    </div>
  );
}
