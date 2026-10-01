import { useMemo } from 'react';
import { createGearboxModel, JOINT_PRESET_SPECS, type AdvisorDesign } from '../../calc';
import { JointChips } from '../components/JointChips';
import { NumberField } from '../components/NumberField';
import {
  Advanced, Button, Card, Cu, DataTable, EmptyState, FieldRow, Notice, PageHead, ProgressBar, ResponsiveTable, Section,
  Segmented, StatusChip, StepNav, STATUS_WORD, verdictKind,
} from '../components/primitives';
import { stepSubtitle } from '../components/StepHint';
import { HELP } from '../help';
import { fixed, num, util } from '../format';
import { presetFor } from '../session';
import { advisorKey, defaultAdvisorOptions, useEffectiveInputs, useStore } from '../store';
import { DiscSvg } from '../viz/DiscFigure';

export function AdvisorScreen() {
  const { state, select, dispatch, updateGearbox, runAdvisor, cancelAdvisor, advisorRun, setStep, notify, fromArm, u } = useStore();
  const slot = state.selected;
  const eff = useEffectiveInputs(slot);
  const opts = state.advisor;
  const ref = presetFor(slot);
  const set = (patch: Partial<typeof opts>) => dispatch({ type: 'advisorOpts', patch });
  const label = slot === 'custom' ? 'Custom' : JOINT_PRESET_SPECS[slot].label;
  const running = advisorRun.status === 'running';
  const res = advisorRun.result;
  const stale = res != null && (advisorRun.key !== advisorKey(eff, opts) || advisorRun.slot !== slot);
  const fromArmNow = fromArm(slot);
  const dOpts = defaultAdvisorOptions();
  const dLo = opts.Dmin >= opts.Dmax;
  const T = (x: number) => u.fu('torque', x, { fixed: true });

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

            <Section title="Target and ratio">
              <FieldRow label="Target utilization" help={HELP.target} htmlFor="adv-target" stacked>
                <div className="target-row">
                  <input id="adv-target" type="range" min={0.7} max={1} step={0.01} value={opts.target}
                    onChange={(e) => set({ target: Number(e.target.value) })} aria-valuetext={`${opts.target.toFixed(2)} of each limit`} />
                  <output className="target-out" htmlFor="adv-target">{opts.target.toFixed(2)}</output>
                </div>
              </FieldRow>
              <FieldRow label="Gear ratio" stacked
                message={opts.ratioVary ? 'Tries Zp = 12, 14, …, 26 (ratios 11:1 to 25:1). Takes a few seconds.' : `Uses your current Zp = ${num(eff.Zp, 0)}. Fastest.`}>
                <Segmented label="Gear ratio mode" value={opts.ratioVary ? 'vary' : 'fixed'} fullWidth
                  onChange={(v) => set({ ratioVary: v === 'vary' })}
                  options={[{ value: 'fixed', label: `Keep ${num(eff.Zp - 1, 0)}:1` }, { value: 'vary', label: 'Let ratio vary' }]} />
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
          {running && <RunningCard />}
          {!running && !res && (
            <Card>
              <EmptyState title="No design yet">
                <p>
                  Press <strong>Run advisor</strong>. It finds the smallest housing where every check stays at or under {opts.target.toFixed(2)},
                  then lists alternatives.
                </p>
              </EmptyState>
            </Card>
          )}
          {res && !running && (
            <>
              {stale && (
                <Notice kind="info" title="Inputs changed since this run" actions={<Button size="sm" variant="secondary" onClick={() => runAdvisor(slot)}>Run again</Button>}>
                  The design below was found for the earlier settings.
                </Notice>
              )}
              {!res.valid && (
                <Notice kind="error" title="The advisor could not run">
                  {u.text(res.errors[0] ?? 'Check the inputs.')} Fix it on the Gearbox page and run again.
                </Notice>
              )}
              {res.valid && !res.best && (
                <Card>
                  <EmptyState title={`No design meets a target of ${res.target.toFixed(2)}`}>
                    <p>Nothing between D = {u.fu('length', opts.Dmin, { dp: 1, trim: true })} and {u.fu('length', opts.Dmax, { dp: 1, trim: true })} keeps every check under the target with these loads and materials.</p>
                    <ul className="plain-list">
                      <li>Raise the target toward 1.00, or allow the ratio to vary.</li>
                      <li>Use a stronger disc material or solid steel pins, or lower the loads on the arm page.</li>
                      <li>Increase the largest pin circle.</li>
                    </ul>
                    {res.warnings.map((w) => <p key={w} className="muted small">{u.text(w)}</p>)}
                  </EmptyState>
                </Card>
              )}
              {res.valid && res.best && (
                <>
                  <Hero d={res.best} target={res.target} elapsed={res.elapsedMs} evaluated={res.evaluated} joint={label}
                    onApply={() => apply(res.best as AdvisorDesign, 'recommended')} />
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
  return (
    <Card title="Searching…">
      <p className="card-sub">{p?.phase === 'verify' ? 'Re-checking the best designs at full resolution.' : 'Trying pin circle diameters from small to large.'}</p>
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

export function Hero({ d, target, elapsed, evaluated, joint, onApply }: {
  d: AdvisorDesign; target: number; elapsed: number; evaluated: number; joint: string; onApply: () => void;
}) {
  const { resolvedTheme, u } = useStore();
  const model = useMemo(() => createGearboxModel(d.inputs), [d.inputs]);
  const drawing = useMemo(() => model.drawingAt(0, 480), [model]);
  const r = d.result;
  const kind = verdictKind(r.verdict);
  const L = (mm: number, dp = 2) => u.fu('length', mm, { dp });
  const outerDesc = d.inputs.outerPin.construction === 'solid'
    ? `${L(d.outerPinOD, 1)} solid pin`
    : `${L(d.outerPinOD, 1)} bushing on ${d.outerBolt ?? 'bolt'} (${L(d.shankDia ?? 0, 1)} shank)`;
  const innerDesc = d.inputs.innerPin.construction === 'solid'
    ? `${L(d.innerPinOD, 1)} solid pin`
    : `${L(d.innerPinOD, 1)} ${d.innerThread ?? ''} standoff, ${L(d.innerPinBore ?? 0, 2)} bore`;
  return (
    <section className="card hero">
      <header className="card-head">
        <h3 className="card-title">Recommended design · {joint}</h3>
        <StatusChip kind={kind}>{STATUS_WORD[kind]} · MAX {util(d.maxUtilization)}</StatusChip>
      </header>
      <h2 className="hero-title">
        {L(d.housingOD, 1)} housing, {num(d.ratio, 0)}:1, {d.discs} disc{d.discs > 1 ? 's' : ''}
      </h2>
      <p className="hero-sub">Smallest housing where every check stays at or under {target.toFixed(2)}.</p>

      <div className="hero-grid">
        <div className="hero-fig">
          <DiscSvg drawing={drawing} peak={Math.max(r.loads.FRingPeak, 1)} theme={resolvedTheme} Rp={r.derived.Rp} rr={d.inputs.rr} size={220}
            label="Preview of the recommended disc at input angle zero" />
          <div className="hero-fig-cap">Preview at θ = 0°</div>
        </div>
        <DataTable
          columns={1}
          rows={[
            { label: 'Pin circle diameter, D', value: L(d.D, 1) },
            { label: 'Housing outside diameter', value: L(d.housingOD, 1), note: `wall ${L(d.inputs.wall, 1)}` },
            { label: 'Eccentricity, e', value: L(d.e, 3), note: `K1 ${fixed(d.K1, 3)}` },
            { label: 'Gear ratio', value: `${num(d.ratio, 0)}:1`, note: `Zp ${num(d.Zp, 0)}` },
            { label: 'Outer pins', value: outerDesc },
            { label: 'Inner pins', value: innerDesc, note: `${num(d.Zw, 0)} pins, Rw ${L(d.Rw, 1)}` },
            { label: 'Disc thickness, L', value: L(d.L, 2) },
            { label: 'Discs', value: String(d.discs), note: `${u.fu('mass', r.mass.perDisc_g, { dp: 0 })} each` },
            { label: 'Eccentric bearing', value: d.bearingName, note: `OD ${L(d.bearingOD, 0)}` },
            { label: 'Disc mass', value: u.fu('mass', d.massTotal_g, { dp: 0 }) },
            { label: 'Governing check', value: d.governingLabel, note: `utilization ${util(d.maxUtilization)}` },
          ]}
        />
      </div>

      <div className="hero-foot">
        <Button variant="primary" iconAfter="arrow" onClick={onApply}>Apply to Gearbox</Button>
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
                  <td className="num" data-label="L">{L(d.L, 2)}<Cu>{ul}</Cu></td>
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
