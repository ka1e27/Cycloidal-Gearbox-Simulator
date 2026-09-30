import { useDeferredValue, useMemo } from 'react';
import { summarizeAllJoints, type JointSummaryRow } from '../../calc';
import { Button, Card, Cu, Notice, ResponsiveTable, StatusChip, UtilBar, verdictKind } from '../components/primitives';
import { StepHint } from '../components/StepHint';
import { DASH, fixed, num, torque, util } from '../format';
import { useStore } from '../store';

const KIND = ['base yaw', 'shoulder pitch', 'elbow pitch', 'forearm roll'];

export function JointsScreen() {
  const { state, select, setStep, runAdvisor } = useStore();
  const dep = useDeferredValue({ arm: state.arm, gb: state.gearboxes, use: state.useArmLoads });
  const sum = useMemo(
    () => summarizeAllJoints(dep.arm, { J1: dep.gb.J1, J2: dep.gb.J2, J3: dep.gb.J3, J4: dep.gb.J4 }, { useArmLoads: dep.use }),
    [dep],
  );

  const open = (row: JointSummaryRow, what: 'gearbox' | 'design') => {
    select(row.joint);
    if (what === 'design') {
      setStep(3);
      runAdvisor(row.joint);
    } else setStep(2);
  };

  const c = sum.counts;
  return (
    <div className="screen">
      <StepHint step={4} />
      <div className="screen-head">
        <h1 className="screen-title">All Joints</h1>
        <div className="count-chips" aria-label="Verdict counts">
          <StatusChip kind="ok" size="sm">{c.pass} pass</StatusChip>
          <StatusChip kind="marginal" size="sm">{c.marginal} marginal</StatusChip>
          <StatusChip kind="fail" size="sm">{c.fail + c.invalid} fail</StatusChip>
        </div>
      </div>

      {!sum.arm.valid && (
        <Notice kind="warning" title="Arm model has an input error">
          {sum.arm.errors[0]}. The typed torques of each joint are used until it is fixed.
          <div className="notice-actions"><Button size="sm" variant="secondary" onClick={() => setStep(1)}>Open Arm & Loads</Button></div>
        </Notice>
      )}

      <Card title="Gearbox joints J1 to J4" subtitle="Live check of the geometry stored for each joint, with the loads from the arm model (unless a joint has that toggle off).">
        <ResponsiveTable threshold={980} className="joints-table">
            <thead>
              <tr>
                <th scope="col">Joint</th>
                <th scope="col" className="num">T_req / T_des<small>{'N·m'}</small></th>
                <th scope="col" className="num">Bearing load<small>N / N{'·'}m</small></th>
                <th scope="col">Geometry</th>
                <th scope="col">Verdict</th>
                <th scope="col">Governing mode</th>
                <th scope="col" className="util-col">Max utilization</th>
                <th scope="col" className="num">Disc mass<small>g</small></th>
                <th scope="col"><span className="visually-hidden">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {sum.rows.map((row, i) => {
                const kind = verdictKind(row.verdict);
                const g = row.geometry;
                const word = row.verdict === 'pass' ? 'PASS' : row.verdict === 'marginal' ? 'MARGINAL' : row.verdict === 'fail' ? 'FAIL' : 'INVALID';
                return (
                  <tr key={row.joint}>
                    <th scope="row" data-label="Joint">
                      <button type="button" className="linkish strong" onClick={() => open(row, 'gearbox')} title="Open this joint in the Gearbox tab">
                        {row.joint}
                      </button>
                      <span className="joint-kind">{KIND[i]}</span>
                    </th>
                    <td className="num" data-label="T_req / T_des">
                      {torque(row.Treq)} / {torque(row.Tdes)}<Cu>N·m</Cu>
                      <span className="tag">{row.loadsFromArm ? 'arm' : 'typed'}</span>
                    </td>
                    <td className="num" data-label="Bearing load">
                      {sum.arm.valid ? <>{fixed(row.outboardWeight_N, 1)}<Cu>N</Cu> / {torque(row.overturningMoment_Nm)}<Cu>N·m</Cu></> : DASH}
                    </td>
                    <td data-label="Geometry">
                      <span className="geo">
                        {num(g.ratio, 0)}:1, D {num(g.D, 0)}, e {fixed(g.e, 2)}
                        <small>K1 {Number.isFinite(g.K1) ? fixed(g.K1, 2) : DASH} {'·'} L {num(g.L, 2)} {'·'} {g.discs} disc{g.discs > 1 ? 's' : ''}</small>
                      </span>
                    </td>
                    <td data-label="Verdict"><StatusChip kind={kind} size="sm">{word}</StatusChip></td>
                    <td data-label="Governing">
                      {row.result.valid ? row.governing : <span className="muted">{row.result.errors[0] ?? 'invalid inputs'}</span>}
                    </td>
                    <td className="util-col" data-label="Max util.">
                      {row.result.valid ? (
                        <div className="util-cell">
                          <UtilBar value={row.maxUtilization} kind={kind} label={`Max utilization ${util(row.maxUtilization)}`} />
                          <strong>{util(row.maxUtilization)}</strong>
                        </div>
                      ) : DASH}
                    </td>
                    <td className="num" data-label="Disc mass">{row.result.valid ? <>{num(row.discMass_g, 0)}<Cu>g</Cu></> : DASH}</td>
                    <td className="act" data-label="">
                      <Button size="sm" variant="primary" icon="sparkles" onClick={() => open(row, 'design')}>
                        Design
                      </Button>
                    </td>
                  </tr>
                );
              })}
              <tr className="is-servo">
                <th scope="row" data-label="Joint">
                  <span className="joint-name">J5</span>
                  <span className="joint-kind">wrist pitch servo</span>
                </th>
                <td className="num" data-label="T_req / T_des">
                  {sum.arm.valid ? <>{torque(sum.servo.Treq)} / {torque(sum.servo.Tdes)}<Cu>N·m</Cu></> : DASH}
                </td>
                <td className="num" data-label="Bearing load">{DASH}</td>
                <td colSpan={5} className="servo-note" data-label="Note">
                  Direct-drive servo, no gearbox check. Pick a servo rated for {sum.arm.valid ? torque(sum.servo.Treq) : DASH} {'N·m'} continuous
                  and {sum.arm.valid ? torque(sum.servo.Tdes) : DASH} {'N·m'} peak
                  {sum.arm.valid ? ` (static ${torque(sum.servo.Tstatic)} + dynamic ${torque(sum.servo.Tdyn)}).` : '.'}
                </td>
                <td className="act" data-label="" />
              </tr>
            </tbody>
          </ResponsiveTable>
        <p className="muted small table-foot">
          Design runs the advisor with the joint{'’'}s current loads and materials. Joint names open the Gearbox tab.
        </p>
      </Card>
    </div>
  );
}
