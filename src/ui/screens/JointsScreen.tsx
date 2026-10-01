import { useDeferredValue, useMemo } from 'react';
import { summarizeAllJoints, type JointSummaryRow } from '../../calc';
import { Button, Card, Cu, Notice, PageHead, ResponsiveTable, STATUS_WORD, StatusChip, StepNav, UtilBar, verdictKind } from '../components/primitives';
import { stepSubtitle } from '../components/StepHint';
import { DASH, fixed, num, util } from '../format';
import { useStore } from '../store';

const KIND = ['base yaw', 'shoulder pitch', 'elbow pitch', 'forearm roll'];

export function JointsScreen() {
  const { state, select, setStep, runAdvisor, u } = useStore();
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
  const T = (x: number) => u.f('torque', x, { fixed: true });
  const nm = u.sym('torque');
  return (
    <div className="screen">
      <PageHead title="All Joints" sub={stepSubtitle(4)}>
        <div className="count-chips" aria-label="Verdict counts">
          <StatusChip kind="ok">{c.pass} PASS</StatusChip>
          <StatusChip kind="marginal">{c.marginal} MARGINAL</StatusChip>
          <StatusChip kind="fail">{c.fail + c.invalid} FAIL</StatusChip>
        </div>
      </PageHead>

      {!sum.arm.valid && (
        <Notice kind="warning" title="The arm model has an input error">
          {u.text(sum.arm.errors[0] ?? '')}. The typed torques of each joint are used until it is fixed.
          <div className="notice-actions"><Button size="sm" variant="secondary" onClick={() => setStep(1)}>Open Arm & Loads</Button></div>
        </Notice>
      )}

      <Card title="Gearbox joints J1 to J4">
        <p className="card-sub">Live check of the geometry stored for each joint, with loads from the arm model unless a joint has that switch off. Joint names open the Gearbox page.</p>
        <ResponsiveTable threshold={980} className="joints-table">
          <thead>
            <tr>
              <th scope="col">Joint</th>
              <th scope="col" className="num">T_req / T_des<small>{nm}</small></th>
              <th scope="col" className="num">Output bearing<small>load {u.sym('force')} · tilting moment {nm}</small></th>
              <th scope="col">Geometry</th>
              <th scope="col">Verdict</th>
              <th scope="col">Governing mode</th>
              <th scope="col" className="util-col">Max utilization</th>
              <th scope="col" className="num">Disc mass<small>{u.sym('mass')}</small></th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {sum.rows.map((row, i) => {
              const kind = verdictKind(row.verdict);
              const g = row.geometry;
              const word = row.verdict === 'invalid' ? 'INVALID' : STATUS_WORD[kind];
              return (
                <tr key={row.joint}>
                  <th scope="row" data-label="Joint">
                    <button type="button" className="linkish strong" onClick={() => open(row, 'gearbox')} title="Open this joint on the Gearbox page">
                      {row.joint}
                    </button>
                    <span className="joint-kind">{KIND[i]}</span>
                  </th>
                  <td className="num" data-label="T_req / T_des">
                    {T(row.Treq)} / {T(row.Tdes)}<Cu>{nm}</Cu>
                    <span className="tag">{row.loadsFromArm ? 'arm' : 'typed'}</span>
                  </td>
                  <td className="num" data-label="Output bearing">
                    {sum.arm.valid
                      ? <>
                          {row.bearingAxial_N > 0 ? 'axial ' : 'radial '}
                          {u.f('force', row.bearingAxial_N > 0 ? row.bearingAxial_N : row.bearingRadial_N, { fixed: true })}<Cu>{u.sym('force')}</Cu>
                          {' · tilt '}{T(row.bearingTiltMoment_Nm)}<Cu>{nm}</Cu>
                        </>
                      : DASH}
                  </td>
                  <td data-label="Geometry">
                    <span className="geo">
                      {num(g.ratio, 0)}:1, D {u.fu('length', g.D, { dp: 1, trim: true })}, e {u.fu('length', g.e, { dp: 3 })}
                      <small>K1 {Number.isFinite(g.K1) ? fixed(g.K1, 3) : DASH} · L {u.fu('length', g.L, { dp: 2, trim: true })} · {g.discs} disc{g.discs > 1 ? 's' : ''}</small>
                    </span>
                  </td>
                  <td data-label="Verdict"><StatusChip kind={kind}>{word}</StatusChip></td>
                  <td data-label="Governing">
                    {row.result.valid ? row.governing : <span className="muted">{u.text(row.result.errors[0] ?? 'invalid inputs')}</span>}
                  </td>
                  <td className="util-col" data-label="Max util.">
                    {row.result.valid ? (
                      <div className="util-cell">
                        <UtilBar value={row.maxUtilization} kind={kind} label={`Max utilization ${util(row.maxUtilization)}`} />
                        <span className="util-num">{util(row.maxUtilization)}</span>
                      </div>
                    ) : DASH}
                  </td>
                  <td className="num" data-label="Disc mass">
                    {row.result.valid ? <>{u.f('mass', row.discMass_g, { dp: 0, fixed: true })}<Cu>{u.sym('mass')}</Cu></> : DASH}
                  </td>
                  <td className="act" data-label="">
                    <Button size="sm" variant="primary" onClick={() => open(row, 'design')}>Design</Button>
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
                {sum.arm.valid ? <>{T(sum.servo.Treq)} / {T(sum.servo.Tdes)}<Cu>{nm}</Cu></> : DASH}
              </td>
              <td className="num" data-label="Output bearing">{DASH}</td>
              <td colSpan={5} className="servo-note" data-label="Note">
                Direct-drive servo, no gearbox check. Pick a servo rated for {sum.arm.valid ? u.fu('torque', sum.servo.Treq, { fixed: true }) : DASH} continuous
                and {sum.arm.valid ? u.fu('torque', sum.servo.Tdes, { fixed: true }) : DASH} peak
                {sum.arm.valid ? ` (static ${T(sum.servo.Tstatic)} + dynamic ${T(sum.servo.Tdyn)}).` : '.'}
              </td>
              <td className="act" data-label="" />
            </tr>
          </tbody>
        </ResponsiveTable>
      </Card>
      <StepNav back={{ label: 'Back: Design Advisor', onClick: () => setStep(3) }} />
    </div>
  );
}
