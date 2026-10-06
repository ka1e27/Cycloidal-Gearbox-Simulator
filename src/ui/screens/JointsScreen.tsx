import { useDeferredValue, useMemo } from 'react';
import { summarizeAllJoints, type JointSummaryRow, type ServoRow } from '../../calc';
import { Button, Card, Cu, Notice, ResponsiveTable, STATUS_WORD, StatusChip, UtilBar, verdictKind } from '../components/primitives';
import { InfoTip } from '../components/InfoTip';
import { HELP } from '../help';
import { motorChip } from '../motorUi';
import { DASH, fixed, num, thickness, util } from '../format';
import { useToleranceVersion } from '../tolerance';
import { useStore } from '../store';
import { JointTag } from '../components/JointTag';


/** Current ratio and what the motor recommends. */
function RatioCell({ zp, info }: { zp: number; info: JointSummaryRow['motor'] }) {
  const { u } = useStore();
  const rec = info?.recommendation ?? null;
  const cur = Number.isFinite(zp) ? `${num(zp - 1, 0)}:1` : DASH;
  let sub: string | null = null;
  let cls = '';
  if (rec) {
    if (rec.Zp != null) {
      const same = rec.Zp === zp;
      sub = same ? 'matches the motor' : `motor wants ${rec.Zp - 1}:1 (Zp ${rec.Zp})`;
      cls = same ? 'is-same' : '';
    } else if (rec.status === 'incomplete') sub = 'no peak torque yet';
    else { sub = rec.headline; cls = 'is-bad'; }
  }
  return (
    <td data-label="Ratio">
      <span className="ratio-cmp">{cur}{sub && <small className={cls}>{u.text(sub)}</small>}</span>
    </td>
  );
}

function MotorChipCell({ info }: { info: JointSummaryRow['motor'] }) {
  if (!info) return <td data-label="Motor" className="muted">{DASH}</td>;
  const c = motorChip(info);
  return <td data-label="Motor"><span title={c.title}><StatusChip kind={c.kind}>{c.word}</StatusChip></span></td>;
}

/** The All Joints table (CLAUDE.md Addition 4), shown as the Summary stage. Clicking a row selects that joint. */
export function JointsSummary() {
  const { state, selectItem, openSection, patchWb, runAdvisor, u } = useStore();
  const dep = useDeferredValue({ arm: state.arm, gb: state.gearboxes, use: state.useArmLoads });
  const tv = useToleranceVersion();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const sum = useMemo(() => summarizeAllJoints(dep.arm, dep.gb, { useArmLoads: dep.use }), [dep, tv]);
  // gearbox rows and servo rows together, in arm order
  const lines = useMemo(() => {
    const all: ({ kind: 'gear'; i: number; row: JointSummaryRow } | { kind: 'servo'; i: number; row: ServoRow })[] = [
      ...sum.rows.map((row) => ({ kind: 'gear' as const, i: row.index, row })),
      ...sum.servos.map((row) => ({ kind: 'servo' as const, i: row.index, row })),
    ];
    return all.sort((a, b) => a.i - b.i);
  }, [sum]);
  const nGear = sum.rows.length;
  const nServo = sum.servos.length;
  // ratio and motor columns appear once any joint has motor data
  const anyMotor = lines.some((l) => !!l.row.motor);

  const open = (joint: string, what: 'gearbox' | 'design') => {
    if (what === 'design') {
      openSection('advisor', joint);
      runAdvisor(joint);
    } else {
      selectItem(joint);
      patchWb({ mobile: 'details' });
    }
  };
  /** Row click: select the joint unless the click was on a button inside the row */
  const rowClick = (joint: string) => (e: React.MouseEvent) => {
    if ((e.target as HTMLElement).closest('button, a, input')) return;
    selectItem(joint);
  };
  const selCls = (joint: string) => (state.wb.sel === joint ? ' is-selected' : '');

  const c = sum.counts;
  const T = (x: number) => u.f('torque', x, { fixed: true });
  const nm = u.sym('torque');
  return (
    <div className="summary-view">
      <div className="summary-head">
        <h2 className="summary-title">All joints</h2>
        <div className="count-chips" aria-label="Verdict counts">
          <StatusChip kind="ok">{c.pass} PASS</StatusChip>
          <StatusChip kind="marginal">{c.marginal} MARGINAL</StatusChip>
          <StatusChip kind="fail">{c.fail + c.invalid} FAIL</StatusChip>
        </div>
      </div>

      {!sum.arm.valid && (
        <Notice kind="warning" title="The arm model has an input error">
          {u.text(sum.arm.errors[0] ?? '')}. The typed torques of each joint are used until it is fixed.
          <div className="notice-actions"><Button size="sm" variant="secondary" onClick={() => selectItem('arm')}>Open the Arm settings</Button></div>
        </Notice>
      )}

      <Card title={`Joints: ${nGear} gearbox${nGear === 1 ? '' : 'es'}${nServo ? `, ${nServo} servo${nServo === 1 ? '' : 's'}` : ''}`}>
        <p className="card-sub">Live check of the geometry stored for each cycloidal joint, with loads from the arm model unless a joint has that switch off. Servo joints show only the torque the servo must deliver. Click a row to open that joint in the inspector.</p>
        {nGear === 0 && (
          <Notice kind="info" title="No cycloidal joints">
            Every joint of this arm is a servo, so there is no gearbox to check. Select a joint and set its drive to Cycloidal.
          </Notice>
        )}
        <ResponsiveTable threshold={anyMotor ? 1180 : 980} className="joints-table">
          <thead>
            <tr>
              <th scope="col">Joint</th>
              <th scope="col" className="num">T_req / T_des<small>{nm}</small></th>
              <th scope="col" className="num">Output bearing<small>load {u.sym('force')} · tilting moment {nm}</small></th>
              <th scope="col">Geometry</th>
              {anyMotor && <th scope="col">Ratio<small>current vs motor <InfoTip help={HELP.recRatio} label="Recommended ratio" /></small></th>}
              {anyMotor && <th scope="col">Motor</th>}
              <th scope="col">Verdict</th>
              <th scope="col">Governing mode</th>
              <th scope="col" className="util-col">Max utilization</th>
              <th scope="col" className="num">Disc mass<small>{u.sym('mass')}</small></th>
              <th scope="col"><span className="visually-hidden">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => {
              const jn = state.arm.joints[line.i];
              if (!jn) return null;
              if (line.kind === 'servo') {
                const sv = line.row;
                return (
                  <tr className={`is-servo is-clickable${selCls(sv.joint)}`} key={sv.joint} onClick={rowClick(sv.joint)}>
                    <th scope="row" data-label="Joint">
                      <JointTag joint={jn} index={line.i}>
                        <button type="button" className="linkish strong" onClick={() => open(sv.joint, 'gearbox')} title="Open this joint in the inspector">J{line.i + 1}</button>
                      </JointTag>
                    </th>
                    <td className="num" data-label="T_req / T_des">
                      {sum.arm.valid ? <>{T(sv.Treq)} / {T(sv.Tdes)}<Cu>{nm}</Cu></> : DASH}
                    </td>
                    <td className="num" data-label="Output bearing">{DASH}</td>
                    <td colSpan={anyMotor ? 7 : 5} className="servo-note" data-label="Note">
                      {sv.motor && (() => { const c = motorChip(sv.motor); return <span title={c.title} className="servo-chip"><StatusChip kind={c.kind}>{c.word}</StatusChip>{' '}</span>; })()}
                      Direct-drive servo, no gearbox check. Pick a servo rated for {sum.arm.valid ? u.fu('torque', sv.Treq, { fixed: true }) : DASH} continuous
                      and {sum.arm.valid ? u.fu('torque', sv.Tdes, { fixed: true }) : DASH} peak
                      {sum.arm.valid ? ` (static ${T(sv.Tstatic)} + dynamic ${T(sv.Tdyn)}).` : '.'}
                    </td>
                    <td className="act" data-label="" />
                  </tr>
                );
              }
              const row = line.row;
              const kind = verdictKind(row.verdict);
              const g = row.geometry;
              const word = row.verdict === 'invalid' ? 'INVALID' : STATUS_WORD[kind];
              return (
                <tr key={row.joint} className={`is-clickable${selCls(row.joint)}`} onClick={rowClick(row.joint)}>
                  <th scope="row" data-label="Joint">
                    <JointTag joint={jn} index={line.i} showDrive={false}>
                      <button type="button" className="linkish strong" onClick={() => open(row.joint, 'gearbox')} title="Open this joint in the inspector">
                        J{line.i + 1}
                      </button>
                    </JointTag>
                  </th>
                  <td className="num" data-label="T_req / T_des">
                    {T(row.Treq)} / {T(row.Tdes)}<Cu>{nm}</Cu>
                    <span className="tag">{row.loadsFromArm ? 'arm' : 'typed'}</span>
                  </td>
                  <td className="num" data-label="Output bearing">
                    {sum.arm.valid
                      ? <>
                          {row.motion === 'yaw' ? 'axial ' : 'radial '}
                          {u.f('force', row.motion === 'yaw' ? row.bearingAxial_N : row.bearingRadial_N, { fixed: true })}<Cu>{u.sym('force')}</Cu>
                          {' · tilt '}{T(row.bearingTiltMoment_Nm)}<Cu>{nm}</Cu>
                        </>
                      : DASH}
                  </td>
                  <td data-label="Geometry">
                    <span className="geo">
                      {num(g.ratio, 0)}:1, D {u.fu('length', g.D, { dp: 1, trim: true })}, e {u.fu('length', g.e, { dp: 3 })}
                      <small>K1 {Number.isFinite(g.K1) ? fixed(g.K1, 3) : DASH} · L {thickness(u, g.L)} · {g.discs} disc{g.discs > 1 ? 's' : ''}</small>
                    </span>
                  </td>
                  {anyMotor && <RatioCell zp={g.Zp} info={row.motor} />}
                  {anyMotor && <MotorChipCell info={row.motor} />}
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
                    <Button size="sm" variant="primary" onClick={() => open(row.joint, 'design')} title="Open the Design Advisor for this joint and run it">Design</Button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </ResponsiveTable>
      </Card>
    </div>
  );
}
