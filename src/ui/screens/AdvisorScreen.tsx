import { useMemo } from 'react';
import { createGearboxModel, JOINT_PRESET_SPECS, type AdvisorDesign, type AdvisorLockKey, type RelaxHint } from '../../calc';
import { ExportDxfPanel } from '../components/ExportDxfPanel';
import { JointChips } from '../components/JointChips';
import { NumberField } from '../components/NumberField';
import {
  Advanced, Button, Card, Cu, DataTable, EmptyState, FieldRow, Notice, PageHead, ProgressBar, ResponsiveTable, Section,
  StatusChip, StepNav, STATUS_WORD, verdictKind,
} from '../components/primitives';
import { stepSubtitle } from '../components/StepHint';
import { HELP } from '../help';
import { fixed, num, thickness, util } from '../format';
import { toEngineLocks, type AdvisorLockState } from '../advisorLocks';
import { presetFor } from '../session';
import { advisorKey, defaultAdvisorOptions, useEffectiveInputs, useStore } from '../store';
import { DiscSvg } from '../viz/DiscFigure';
import { AdvisorLocksPanel } from './AdvisorLocksPanel';

const unlockKey = (key: RelaxHint['key']) => (l: AdvisorLockState): AdvisorLockState =>
  key === 'maxHousingOD' ? { ...l, limitOn: false } : { ...l, on: { ...l.on, [key]: false } };

export function AdvisorScreen() {
  const { state, select, dispatch, updateGearbox, runAdvisor, cancelAdvisor, advisorRun, setStep, notify, fromArm, u } = useStore();
  const slot = state.selected;
  const eff = useEffectiveInputs(slot);
  const opts = state.advisor;
  const lockState = state.advisorLocks[slot];
  const engine = useMemo(() => toEngineLocks(lockState, eff), [lockState, eff]);
  const ref = presetFor(slot);
  const set = (patch: Partial<typeof opts>) => dispatch({ type: 'advisorOpts', patch });
  const label = slot === 'custom' ? 'Custom' : JOINT_PRESET_SPECS[slot].label;
  const running = advisorRun.status === 'running';
  const res = advisorRun.result;
  const stale = res != null && (advisorRun.key !== advisorKey(eff, opts, engine) || advisorRun.slot !== slot);
  const fromArmNow = fromArm(slot);
  const dOpts = defaultAdvisorOptions();
  // D min / max only matter while D is free
  const dLo = !lockState.on.D && opts.Dmin >= opts.Dmax;
  const T = (x: number) => u.fu('torque', x, { fixed: true });
  const chosen = res && res.valid && !stale && advisorRun.slot === slot ? (res.best ?? res.closest) : null;

  const apply = (d: AdvisorDesign, which: string) => {
    updateGearbox(slot, (g) => ({ ...d.inputs, Treq: g.Treq, Tdes: g.Tdes }));
    notify('success', `Applied the ${which} design to ${label}. Checking it on the Gearbox page.`);
    setStep(2);
  };

  return (
    <div className="screen">
      <PageHead title="Design Advisor" suffix={label} sub={stepSubtitle(3)}>
        <JointChips value={slot} onChange={select} label="Joint to design" />
      </PageHead>
      <div className="split split-advisor">
        <div className="col col-inputs">
          <div className="panel">
            <div className="panel-head"><h2 className="panel-title">Search settings</h2></div>

            <DataTable columns={1} rows={[
              { label: 'Working torque, T_req', value: T(eff.Treq) },
              { label: 'Design torque, T_des', value: T(eff.Tdes), note: slot === 'custom' ? 'typed on the Gearbox page' : fromArmNow ? 'from the arm model' : 'typed on the Gearbox page (arm toggle off)' },
            ]} />
            <p className="section-note">
              <button type="button" className="linkish" onClick={() => setStep(slot === 'custom' || !fromArmNow ? 2 : 1)}>Change the loads</button>
            </p>

            <Section title="Target and wall">
              <FieldRow label="Target utilization" help={HELP.target} htmlFor="adv-target" stacked>
                <div className="target-row">
                  <input id="adv-target" type="range" min={0.7} max={1} step={0.01} value={opts.target}
                    onChange={(e) => set({ target: Number(e.target.value) })} aria-valuetext={`${opts.target.toFixed(2)} of each limit`} />
                  <output className="target-out" htmlFor="adv-target">{opts.target.toFixed(2)}</output>
                </div>
              </FieldRow>
              <NumberField label="Housing wall thickness" quantity="length" value={state.gearboxes[slot].wall}
                onChange={(x) => updateGearbox(slot, (g) => ({ ...g, wall: x ?? 0 }))} defaultValue={ref.wall} help={HELP.advWall} step={0.5} />
              <Advanced label="Advanced: search limits">
                <NumberField label="Smallest pin circle" symbol="D min" quantity="length" value={opts.Dmin} onChange={(x) => set({ Dmin: x ?? 0 })}
                  defaultValue={dOpts.Dmin} help={HELP.Dmin} step={1} error={dLo ? 'D min must be below D max' : null} />
                <NumberField label="Largest pin circle" symbol="D max" quantity="length" value={opts.Dmax} onChange={(x) => set({ Dmax: x ?? 0 })}
                  defaultValue={dOpts.Dmax} help={HELP.Dmax} step={1} />
                <NumberField label="Minimum gap between outer pins" quantity="length" value={opts.minPinClearance}
                  onChange={(x) => set({ minPinClearance: x ?? 0 })} defaultValue={dOpts.minPinClearance} help={HELP.minPinClearance} step={0.25} />
                <NumberField label="Alternatives search window" quantity="length" value={opts.altWindowMm}
                  onChange={(x) => set({ altWindowMm: x ?? 0 })} defaultValue={dOpts.altWindowMm} help={HELP.altWindowMm} step={1} />
              </Advanced>
            </Section>

            <div className="mat-summary">
              <div><span className="muted">Disc</span> {eff.discMaterial.kind === 'polymer' ? 'polymer' : 'metal'}, E {u.fu('stress', eff.discMaterial.E, { dp: 0 })}, Sy {u.fu('stress', eff.discMaterial.Sy, { dp: 0 })}</div>
              <div><span className="muted">Outer pins</span> {eff.outerPin.construction === 'solid' ? 'solid pins' : 'bolt + bushing'}</div>
              <div><span className="muted">Inner pins</span> {eff.innerPin.construction === 'solid' ? 'solid pins' : 'standoffs'}</div>
              <button type="button" className="linkish" onClick={() => setStep(2)}>Materials and pin type come from the Gearbox page</button>
            </div>

            <div className="run-row">
              {running ? (
                <Button variant="secondary" onClick={cancelAdvisor}>Cancel</Button>
              ) : (
                <Button variant="primary" disabled={dLo} onClick={() => runAdvisor(slot)}>{res ? 'Run again' : 'Run advisor'}</Button>
              )}
              {running && <span className="muted small">Searching in the background.</span>}
            </div>
          </div>
        </div>

        <div className="col col-results">
          <AdvisorLocksPanel slot={slot} eff={eff} chosen={chosen} running={running} hasResult={!!res} canRun={!dLo}
            onRun={() => runAdvisor(slot)} onCancel={cancelAdvisor} />
          {running && <RunningCard />}
          {!running && !res && (
            <Card>
              <EmptyState title="No design yet">
                <p>
                  Press <strong>Run advisor</strong>. It finds the smallest housing where every check stays at or under {opts.target.toFixed(2)},
                  optimizing only the variables you left free, then lists alternatives.
                </p>
              </EmptyState>
            </Card>
          )}
          {res && !running && (
            <>
              {stale && (
                <Notice kind="info" title="Inputs or locks changed since this run" actions={<Button size="sm" variant="secondary" onClick={() => runAdvisor(slot)}>Run again</Button>}>
                  The design below was found for the earlier settings.
                </Notice>
              )}
              {!res.valid && (
                <Notice kind="error" title="The advisor could not run">
                  {u.text(res.errors[0] ?? 'Check the inputs.')}{' '}
                  {res.errors[0]?.startsWith('Locked') ? 'Fix the locked value above and run again.' : 'Fix it on the Gearbox page and run again.'}
                </Notice>
              )}
              {res.valid && !res.best && (
                <Infeasible res={res} opts={opts} label={label} onApply={apply}
                  onRelax={(k) => runAdvisor(slot, unlockKey(k))} />
              )}
              {res.valid && res.best && (
                <>
                  <Hero d={res.best} target={res.target} elapsed={res.elapsedMs} evaluated={res.evaluated} joint={label}
                    locked={res.locked}
                    onApply={() => apply(res.best as AdvisorDesign, 'recommended')} />
                  <ExportDxfPanel inputs={res.best.inputs} label={`${label} advisor design`} />
                  <Alternatives res={res.alternatives} onApply={apply} />
                  {res.warnings.length > 0 && (
                    <ul className="plain-list warn-list">{res.warnings.map((w) => <li key={w}>{u.text(w)}</li>)}</ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
      <StepNav
        back={{ label: 'Back: Gearbox', onClick: () => setStep(2) }}
        next={{ label: 'Next: All Joints', onClick: () => setStep(4) }}
      />
    </div>
  );
}

function RunningCard() {
  const { advisorRun, u } = useStore();
  const p = advisorRun.progress;
  const sub = p?.phase === 'verify' ? 'Re-checking the best designs at full resolution.'
    : p?.phase === 'closest' ? 'No design meets the target. Looking for the closest one within your locks.'
    : p?.phase === 'hints' ? 'Checking which locks could be relaxed.'
    : 'Trying pin circle diameters from small to large.';
  return (
    <Card title="Searching…">
      <p className="card-sub">{sub}</p>
      <ProgressBar fraction={p?.fraction ?? 0} label="Advisor progress" />
      <div className="run-stats" aria-live="polite">
        <span>{Math.round((p?.fraction ?? 0) * 100)}%</span>
        <span>{p ? `D = ${u.fu('length', p.D, { dp: 0 })}` : 'starting'}</span>
        <span>{p ? `${num(p.evaluated, 0)} designs checked` : ''}</span>
        <span>{p?.bestHousingOD != null ? `best housing so far ${u.fu('length', p.bestHousingOD, { dp: 0 })}` : 'no passing design yet'}</span>
      </div>
    </Card>
  );
}

function Tag({ k, locked }: { k: AdvisorLockKey; locked: readonly AdvisorLockKey[] | undefined }) {
  if (!locked) return null;
  const isLocked = locked.includes(k);
  return <span className={`lk-tag ${isLocked ? 'is-locked' : 'is-opt'}`}>{isLocked ? 'Locked' : 'Optimized'}</span>;
}

/** The infeasible case: the closest design, what governs it, and the locks to relax (each with a one-click re-run). */
function Infeasible({ res, opts, label, onApply, onRelax }: {
  res: NonNullable<ReturnType<typeof useStore>['advisorRun']['result']>;
  opts: { Dmin: number; Dmax: number };
  label: string;
  onApply: (d: AdvisorDesign, which: string) => void;
  onRelax: (k: RelaxHint['key']) => void;
}) {
  const { u } = useStore();
  const hasLocks = res.locked.some((k) => k !== 'Zp') || res.maxHousingOD != null;
  // the card already says what the warnings below would repeat
  const extraWarnings = res.warnings.filter((w) => !/^No design (up to|meets)|^The closest design reaches/.test(w));
  return (
    <>
      <Card className="closest-card">
        <EmptyState title={`No design meets a target of ${res.target.toFixed(2)}${hasLocks ? ' with these locks' : ''}`}>
          {hasLocks
            ? <p>Nothing the free variables can reach keeps every check under the target while your locked values stay as they are.</p>
            : <p>Nothing between D = {u.fu('length', opts.Dmin, { dp: 1, trim: true })} and {u.fu('length', opts.Dmax, { dp: 1, trim: true })} keeps every check under the target with these loads and materials.</p>}
        </EmptyState>
      </Card>

      {res.closest && (
        <Hero d={res.closest} target={res.target} elapsed={res.elapsedMs} evaluated={res.evaluated} joint={label}
          locked={res.locked} closest onApply={() => onApply(res.closest as AdvisorDesign, 'closest')} />
      )}

      {res.relaxHints.length > 0 && (
        <Card title="Relax a lock">
          <p className="card-sub">Each line was checked by re-running the advisor with only that lock released: a design that meets {res.target.toFixed(2)} really exists.</p>
          <ul className="hint-list">
            {res.relaxHints.map((h) => (
              <li className="hint-item" key={h.key}>
                <span className="hint-text">
                  {u.text(h.text)}
                  <small className="hint-meta">All other locks stay as they are.</small>
                </span>
                <Button size="sm" variant="secondary" onClick={() => onRelax(h.key)}>
                  {h.key === 'maxHousingOD' ? 'Remove the limit and re-run' : `Unlock ${h.name} and re-run`}
                </Button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {res.relaxHints.length === 0 && hasLocks && (
        <Card title="Relax a lock">
          <p className="card-sub">Releasing any single lock is not enough. Free two or more variables, raise the target toward 1.00, use a stronger disc material, or lower the loads.</p>
        </Card>
      )}
      {!hasLocks && (
        <Card>
          <ul className="plain-list">
            <li>Raise the target toward 1.00, or unlock the gear ratio so it can vary.</li>
            <li>Use a stronger disc material or solid steel pins, or lower the loads on the arm page.</li>
            <li>Increase the largest pin circle.</li>
          </ul>
        </Card>
      )}
      {extraWarnings.length > 0 && (
        <ul className="plain-list warn-list">{extraWarnings.map((w) => <li key={w}>{u.text(w)}</li>)}</ul>
      )}
    </>
  );
}

export function Hero({ d, target, elapsed, evaluated, joint, onApply, locked, closest }: {
  d: AdvisorDesign; target: number; elapsed: number; evaluated: number; joint: string; onApply: () => void;
  /** Variables that were locked for this run: rows get a Locked / Optimized tag. Omit for no tags. */
  locked?: readonly AdvisorLockKey[];
  /** This is the closest design (it does not meet the target) */
  closest?: boolean;
}) {
  const { resolvedTheme, u } = useStore();
  const model = useMemo(() => createGearboxModel(d.inputs), [d.inputs]);
  const drawing = useMemo(() => model.drawingAt(0, 480), [model]);
  const r = d.result;
  const kind = verdictKind(r.verdict);
  const L = (mm: number, dp = 2) => u.fu('length', mm, { dp });
  const T = (k: AdvisorLockKey) => <Tag k={k} locked={locked} />;
  const outerDesc = d.inputs.outerPin.construction === 'solid'
    ? `${L(d.outerPinOD, 1)} solid pin`
    : `${L(d.outerPinOD, 1)} bushing on ${d.outerBolt ?? (d.outerCustom ? 'a custom bolt' : 'bolt')} (${L(d.shankDia ?? 0, 1)} shank)`;
  const innerDesc = d.inputs.innerPin.construction === 'solid'
    ? `${L(d.innerPinOD, 1)} solid pin`
    : `${L(d.innerPinOD, 1)} ${d.innerThread ?? ''} standoff, ${L(d.innerPinBore ?? 0, 2)} bore`;
  return (
    <section className={`card hero${closest ? ' closest-card' : ''}`}>
      <header className="card-head">
        <h3 className="card-title">{closest ? 'Closest design' : 'Recommended design'} · {joint}</h3>
        <StatusChip kind={kind}>{STATUS_WORD[kind]} · MAX {util(d.maxUtilization)}</StatusChip>
      </header>
      <h2 className="hero-title">
        {L(d.housingOD, 1)} housing, {num(d.ratio, 0)}:1, {d.discs} disc{d.discs > 1 ? 's' : ''}
      </h2>
      {closest ? (
        <p className="hero-sub closest-note">
          Lowest maximum utilization within your locks. It does not meet the target of {target.toFixed(2)}:{' '}
          <strong>{d.governingLabel}</strong> governs at {util(d.maxUtilization)}.
        </p>
      ) : (
        <p className="hero-sub">Smallest housing where every check stays at or under {target.toFixed(2)}.</p>
      )}

      <div className="hero-grid">
        <div className="hero-fig">
          <DiscSvg drawing={drawing} peak={Math.max(r.loads.FRingPeak, 1)} theme={resolvedTheme} Rp={r.derived.Rp} rr={d.inputs.rr} size={220}
            label={closest ? 'Preview of the closest disc at input angle zero' : 'Preview of the recommended disc at input angle zero'} />
          <div className="hero-fig-cap">Preview at θ = 0°</div>
        </div>
        <DataTable
          columns={1}
          rows={[
            { label: 'Pin circle diameter, D', value: L(d.D, 1), note: locked ? T('D') : undefined },
            { label: 'Housing outside diameter', value: L(d.housingOD, 1), note: `wall ${L(d.inputs.wall, 1)}` },
            { label: 'Eccentricity, e', value: L(d.e, 3), note: <>{`K1 ${fixed(d.K1, 3)}`}{T('e')}</> },
            { label: 'Gear ratio', value: `${num(d.ratio, 0)}:1`, note: <>{`Zp ${num(d.Zp, 0)}`}{T('Zp')}</> },
            { label: 'Outer pins', value: outerDesc, note: locked ? T('outerPin') : undefined },
            { label: 'Inner pins', value: innerDesc, note: <>{`Rw ${L(d.Rw, 1)}`}{T('innerPin')}</> },
            { label: 'Inner pin count, Zw', value: String(d.Zw), note: locked ? T('Zw') : undefined },
            { label: 'Disc thickness, L', value: thickness(u, d.L), note: locked ? T('L') : undefined },
            { label: 'Discs', value: String(d.discs), note: <>{`${u.fu('mass', r.mass.perDisc_g, { dp: 0 })} each`}{T('discs')}</> },
            { label: 'Eccentric bearing', value: d.bearingName, note: <>{`OD ${L(d.bearingOD, 0)}`}{T('bearing')}</> },
            { label: 'Disc mass', value: u.fu('mass', d.massTotal_g, { dp: 0 }) },
            { label: 'Governing check', value: d.governingLabel, note: `utilization ${util(d.maxUtilization)}` },
          ]}
        />
      </div>
      {locked && (
        <p className="lk-legend">
          <span><span className="lk-tag is-locked">Locked</span> your value, returned exactly</span>
          <span><span className="lk-tag is-opt">Optimized</span> chosen by the advisor</span>
        </p>
      )}

      <div className="hero-foot">
        <Button variant="primary" iconAfter="arrow" onClick={onApply}>{closest ? 'Apply closest to Gearbox' : 'Apply to Gearbox'}</Button>
        <p className="hero-note">
          Verify bearing ratings on the datasheet: the C and C0 values here are approximate. Searched {num(evaluated, 0)} designs in {num(elapsed / 1000, 1)} s.
        </p>
      </div>
    </section>
  );
}

export function Alternatives({ res, onApply }: {
  res: { oneDisc: AdvisorDesign | null; twoDisc: AdvisorDesign | null; lightest: AdvisorDesign | null; mostMargin: AdvisorDesign | null };
  onApply: (d: AdvisorDesign, which: string) => void;
}) {
  const { u } = useStore();
  const rows: { key: string; label: string; d: AdvisorDesign | null }[] = [
    { key: 'one', label: 'Best 1-disc', d: res.oneDisc },
    { key: 'two', label: 'Best 2-disc', d: res.twoDisc },
    { key: 'light', label: 'Lightest', d: res.lightest },
    { key: 'margin', label: 'Most margin', d: res.mostMargin },
  ];
  const ul = u.sym('length');
  const L = (mm: number, dp: number) => u.f('length', mm, { dp, fixed: true });
  return (
    <Card title="Alternatives">
      <p className="card-sub">Smallest with each disc count, then the lightest and the most margin within a few millimetres of the best housing.</p>
      <ResponsiveTable threshold={900} className="alt-table">
        <thead>
          <tr>
            <th scope="col">Option</th>
            <th scope="col" className="num">Housing OD<small>{ul}</small></th>
            <th scope="col" className="num">D<small>{ul}</small></th>
            <th scope="col" className="num">e<small>{ul}</small></th>
            <th scope="col" className="num">Pins out / in<small>{ul} OD</small></th>
            <th scope="col" className="num">L<small>{ul}</small></th>
            <th scope="col" className="num">Discs</th>
            <th scope="col">Bearing</th>
            <th scope="col" className="num">Mass<small>{u.sym('mass')}</small></th>
            <th scope="col" className="num">Max util.</th>
            <th scope="col"><span className="visually-hidden">Apply</span></th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ key, label, d }) => (
            <tr key={key}>
              <th scope="row" data-label="Option">
                {label}
                {d?.sameAsBest && <span className="tag">= recommended</span>}
              </th>
              {d ? (
                <>
                  <td className="num" data-label="Housing OD">{L(d.housingOD, 0)}<Cu>{ul}</Cu></td>
                  <td className="num" data-label="D">{L(d.D, 0)}<Cu>{ul}</Cu></td>
                  <td className="num" data-label="e">{L(d.e, 3)}<Cu>{ul}</Cu></td>
                  <td className="num" data-label="Pins out / in">{L(d.outerPinOD, 1)} / {L(d.innerPinOD, 1)}<Cu>{ul}</Cu></td>
                  <td className="num" data-label="L">{thickness(u, d.L, false)}<Cu>{ul}</Cu></td>
                  <td className="num" data-label="Discs">{d.discs}</td>
                  <td data-label="Bearing">{d.bearingName}</td>
                  <td className="num" data-label="Mass">{u.f('mass', d.massTotal_g, { dp: 0, fixed: true })}<Cu>{u.sym('mass')}</Cu></td>
                  <td className="num" data-label="Max util.">{util(d.maxUtilization)}</td>
                  <td className="act" data-label="">
                    <Button size="sm" variant="secondary" onClick={() => onApply(d, label.toLowerCase())}>Apply</Button>
                  </td>
                </>
              ) : (
                <td colSpan={10} className="none-found" data-label="">None found in the search window</td>
              )}
            </tr>
          ))}
        </tbody>
      </ResponsiveTable>
    </Card>
  );
}
