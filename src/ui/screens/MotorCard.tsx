// "Motor & ratio" card of a cycloidal joint (CLAUDE.md Addition 8): recommended ratio vs the current one, the torque the
// motor delivers through each, the overload warning, and a one-click "Use recommended ratio".
import { analyzeJointMotor, type GearboxInputs } from '../../calc';
import { InfoTip } from '../components/InfoTip';
import { Advanced, Button, Card, DataTable, Notice, StatusChip } from '../components/primitives';
import { fixed } from '../format';
import { HELP } from '../help';
import { motorChip, rescaleEForZp } from '../motorUi';
import type { AdvisorLockState } from '../advisorLocks';
import type { Slot } from '../session';
import { useStore } from '../store';
import { FixChip } from '../components/FixChips';
import { useApplyFix, useFixes } from '../fixes';

/** `inline`: shown under the motor fields in the inspector, so the "enter / edit motor" links are left out. */
export function MotorCard({ slot, eff, inline }: { slot: Slot; eff: GearboxInputs; inline?: boolean }) {
  const { state, applyGearboxChange, openSection, runAdvisor, u } = useStore();
  const fx = useFixes(slot);
  const applyFix = useApplyFix();
  const joint = state.arm.joints.find((j) => j.id === slot);
  if (!joint || joint.drive !== 'cycloidal') return null; // Custom has no joint, so no motor

  const spec = joint.motor;
  if (!spec) {
    if (inline) return null;
    return (
      <Card title="Motor & ratio" className="motor-card">
        <div className="motor-empty">
          <p className="card-sub">Enter this joint{'’'}s motor torque in its Motor & ratio section to get a recommended gear ratio and a check of the torque it delivers.</p>
          <Button size="sm" variant="secondary" onClick={() => openSection('motor', slot)}>Enter motor</Button>
        </div>
      </Card>
    );
  }

  const info = analyzeJointMotor(joint, { Treq: eff.Treq, Tdes: eff.Tdes }, eff.Zp);
  const rec = info?.recommendation ?? null;
  const check = info?.check ?? null;
  const chip = motorChip(info);
  const T = (x: number | null | undefined) => (x == null ? '—' : u.fu('torque', x, { fixed: true }));
  const curRatio = Number.isInteger(eff.Zp) && eff.Zp >= 2 ? eff.Zp - 1 : null;
  const recZp = rec?.Zp ?? null;
  const same = recZp != null && recZp === eff.Zp;
  const specLine = [
    spec.name ?? 'Motor',
    spec.Tpeak_Nm != null ? `${u.fu('torque', spec.Tpeak_Nm, { trim: true })} peak` : null,
    spec.Tcont_Nm != null ? `${u.fu('torque', spec.Tcont_Nm, { trim: true })} continuous` : null,
    spec.maxSpeed_rpm != null ? `${spec.maxSpeed_rpm} rpm` : null,
    spec.requiredSpeed_degps != null ? `${spec.requiredSpeed_degps} deg/s needed` : null,
    `η ${spec.efficiency}`,
  ].filter(Boolean).join(' · ');

  // K1 = e·Zp / Rp: the button rescales e so K1 stays where it is (D and everything else stay put)
  const resc = recZp != null ? rescaleEForZp(eff, recZp) : null;
  const eText = (x: number) => u.fu('length', x, { dp: 3 });
  const eChange = resc && !resc.unchanged ? `e ${eText(eff.e)} → ${eText(resc.e)} to keep K1 ${fixed(resc.k1After, 3)}` : null;

  const apply = () => {
    if (recZp == null) return;
    const r = rescaleEForZp(eff, recZp);
    const what = r && !r.unchanged
      ? `Zp ${eff.Zp} → ${recZp} (${recZp - 1}:1) and e ${eText(eff.e)} → ${eText(r.e)}, K1 ${fixed(r.k1Before, 3)} → ${fixed(r.k1After, 3)}`
      : `Zp ${eff.Zp} → ${recZp} (${recZp - 1}:1)`;
    applyGearboxChange(slot, (g) => ({ ...g, Zp: recZp, ...(r && !r.unchanged ? { e: r.e } : {}) }),
      u.text(`${joint.name.trim() || slot}: ${what}. D and everything else are unchanged; the checks recompute.`));
  };

  // the motor is too weak for this ratio: the fix engine's "use the recommended ratio" fix highlights the button
  const zpFix = fx.report?.fixes.find((f) => f.field === 'Zp') ?? null;

  const designHere = () => {
    if (recZp == null) return;
    const lockZp = (l: AdvisorLockState): AdvisorLockState => ({ ...l, ratioMotor: false, on: { ...l.on, Zp: true }, values: { ...l.values, Zp: recZp } });
    openSection('advisor', slot);
    runAdvisor(slot, lockZp);
  };

  const rows = [] as { label: string; value: React.ReactNode; note?: React.ReactNode; flag?: 'ok' | 'marginal' | 'fail' | 'neutral' }[];
  if (rec && rec.ratioMin != null) {
    rows.push({
      label: 'Ratio the motor needs',
      value: `≥ ${fixed(rec.ratioMin, 1)}:1${rec.ratioMax != null ? `, ≤ ${fixed(rec.ratioMax, 1)}:1` : ''}`,
      note: rec.minSetBy === 'continuous' ? 'set by the continuous rating' : 'set by the peak torque' + (rec.ratioMax != null ? '; the top by speed' : ''),
    });
  }
  if (rec && rec.outputPeak_Nm != null) {
    rows.push({
      label: `Capacity at ${rec.ratio}:1 (recommended)`,
      value: `${T(rec.outputPeak_Nm)} peak`,
      note: [rec.marginPeak != null ? `${fixed(rec.marginPeak, 2)}× T_des` : null, rec.outputCont_Nm != null ? `${T(rec.outputCont_Nm)} continuous${rec.marginCont != null ? `, ${fixed(rec.marginCont, 2)}× T_req` : ''}` : null].filter(Boolean).join(' · '),
    });
  }
  if (check && check.ratio != null && (check.status === 'ok' || check.status === 'short')) {
    rows.push({
      label: `Capacity at ${check.ratio}:1 (current)`,
      value: `${T(check.outputPeak_Nm)} peak`,
      flag: check.status === 'short' ? 'fail' : undefined,
      note: check.status === 'short' ? check.problems.join(' ') : check.peakUtil != null ? `T_des is ${Math.round(check.peakUtil * 100)}% of it` : '',
    });
  }
  const spd = rec?.outputSpeed_degps ?? null;
  if (rec && spd != null) {
    rows.push({ label: 'Joint speed at full motor speed', value: `${fixed(spd, 0)} deg/s`, note: `${fixed(rec.outputSpeed_rpm ?? 0, 1)} rpm at the recommended ratio` });
  }

  return (
    <Card
      title="Motor & ratio"
      className="motor-card"
      actions={<span title={chip.title}><StatusChip kind={chip.kind}>{chip.word}</StatusChip></span>}
    >
      <div className="mr-head">
        <span className="mr-spec">{u.text(specLine)}</span>
        {!inline && <Button size="sm" variant="ghost" onClick={() => openSection('motor', slot)}>Edit motor</Button>}
      </div>

      {rec && (rec.status === 'incomplete' || rec.status === 'invalid') && (
        <p className="card-sub">{u.text(rec.reasons[0] ?? 'Enter the motor’s max torque above.')}</p>
      )}

      {rec && (rec.status === 'ok' || rec.status === 'warning') && (
        <div className={`mr-compare${zpFix ? ' has-fix' : ''}`}>
          <div className="mr-cell">
            <div className="mr-label">Recommended <InfoTip help={HELP.recRatio} label="Recommended ratio" /></div>
            <div className="mr-big" data-testid="rec-ratio">{rec.ratio}:1</div>
            <div className="mr-sub">Zp {rec.Zp}{rec.status === 'warning' ? ' · see notes below' : ''}</div>
          </div>
          <div className="mr-cell">
            <div className="mr-label">Current gearbox</div>
            <div className={`mr-big${same ? ' is-same' : ''}`} data-testid="cur-ratio">{curRatio != null ? `${curRatio}:1` : '—'}</div>
            <div className="mr-sub">Zp {eff.Zp}{same ? ' · matches the recommendation' : ''}</div>
          </div>
        </div>
      )}

      {rec && rec.status === 'infeasible' && (
        <Notice kind="warning" title={rec.headline}>
          <ul className="plain-list">
            {rec.reasons.slice(-2).map((r) => <li key={r}>{u.text(r)}</li>)}
          </ul>
        </Notice>
      )}

      {rows.length > 0 && <DataTable columns={1} rows={rows.map((r) => ({ ...r, note: r.note ? u.text(String(r.note)) : undefined }))} />}

      {check?.overload?.exceeds && (
        <Notice kind="warning" title={<>Motor can overload this gearbox <InfoTip help={HELP.motorOverload} label="Motor overload" /></>}>
          {u.text(check.overload.message)}
          <span> This does not change the gearbox verdict above.</span>
        </Notice>
      )}

      {rec && rec.Zp != null && (
        <div className={`mr-actions${zpFix ? ' has-fix' : ''}`}>
          <Button variant="primary" disabled={same} onClick={apply} title={same ? 'The gearbox already uses this ratio' : `Set Zp to ${rec.Zp}`}>
            Use recommended ratio (Zp {rec.Zp})
          </Button>
          {zpFix && <FixChip fix={zpFix} onApply={(f) => applyFix(slot, f)} />}
          <Button variant="secondary" onClick={designHere} title={`Open the Design Advisor with the ratio locked to Zp ${rec.Zp} and run it`}>
            Design this ratio in the Advisor
          </Button>
          {same && <span className="muted small">Already using Zp {rec.Zp}.</span>}
          {!same && <span className="muted small">{eChange ? `${eChange}. D and the rest stay put.` : 'Only Zp changes; D, e and the rest stay put.'}</span>}
        </div>
      )}
      {resc && resc.clamped && !same && (
        <p className="rm-note">
          K1 was {fixed(resc.k1Before, 2)}, outside the usual 0.40 to 0.85, so e is set for K1 {fixed(resc.k1After, 2)}. D is unchanged; run the Design Advisor to size the whole gearbox.
        </p>
      )}

      {rec && rec.reasons.length > 0 && (
        <div className="mr-why">
          <Advanced label="How this was worked out">
            <ul className="plain-list">
              {rec.reasons.map((r) => <li key={r}>{u.text(r)}</li>)}
            </ul>
            <p className="section-note">η and the ratio come from your motor entries; torques are the ones this gearbox is checked for ({u.fu('torque', eff.Treq, { fixed: true })} T_req, {u.fu('torque', eff.Tdes, { fixed: true })} T_des).</p>
          </Advanced>
        </div>
      )}
    </Card>
  );
}
