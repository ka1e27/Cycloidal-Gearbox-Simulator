import { useMemo } from 'react';
import { createGearboxModel, JOINT_PRESET_SPECS, type AdvisorDesign } from '../../calc';
import { JointChips } from '../components/JointChips';
import { NumberField } from '../components/NumberField';
import { Button, Card, Cu, EmptyState, Notice, ProgressBar, ResponsiveTable, Section, Segmented, StatusChip, verdictKind } from '../components/primitives';
import { StepHint } from '../components/StepHint';
import { HELP } from '../help';
import { fixed, num, torque, util } from '../format';
import { presetFor } from '../session';
import { advisorKey, defaultAdvisorOptions, useEffectiveInputs, useStore } from '../store';
import { DiscSvg } from '../viz/DiscFigure';

export function AdvisorScreen() {
  const { state, select, dispatch, updateGearbox, runAdvisor, cancelAdvisor, advisorRun, setStep, notify, fromArm } = useStore();
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

  const apply = (d: AdvisorDesign, which: string) => {
    updateGearbox(slot, (g) => ({ ...d.inputs, Treq: g.Treq, Tdes: g.Tdes }));
    notify('success', `Applied the ${which} design to ${label}. Checking it on the Gearbox tab.`);
    setStep(2);
  };

  return (
    <div className="screen">
      <StepHint step={3} />
      <div className="screen-head">
        <div>
          <h1 className="screen-title">Design Advisor <span className="screen-title-sub">{label}</span></h1>
        </div>
        <JointChips value={slot} onChange={select} label="Joint to design" />
      </div>
      <div className="split split-advisor">
        <div className="col col-inputs">
          <div className="panel">
            <div className="panel-head"><h2 className="panel-title">Search settings</h2></div>

            <div className="loads-box">
              <div className="loads-row"><span>T_req</span><strong>{torque(eff.Treq)} N{'·'}m</strong></div>
              <div className="loads-row"><span>T_des</span><strong>{torque(eff.Tdes)} N{'·'}m</strong></div>
              <div className="loads-src">
                {slot === 'custom'
                  ? 'Typed on the Gearbox tab'
                  : fromArmNow ? 'From the arm model' : 'Typed on the Gearbox tab (arm toggle off)'}
                {' · '}
                <button type="button" className="linkish" onClick={() => setStep(slot === 'custom' || !fromArmNow ? 2 : 1)}>
                  change
                </button>
              </div>
            </div>

            <Section title="Target and ratio">
              <div className="nf">
                <div className="nf-head">
                  <label className="nf-label" htmlFor="adv-target">Target utilization</label>
                </div>
                <div className="target-row">
                  <input
                    id="adv-target"
                    type="range"
                    min={0.7}
                    max={1}
                    step={0.01}
                    value={opts.target}
                    onChange={(e) => set({ target: Number(e.target.value) })}
                    aria-valuetext={`${opts.target.toFixed(2)} of each limit`}
                  />
                  <output className="target-out" htmlFor="adv-target">{opts.target.toFixed(2)}</output>
                </div>
                <div className="nf-msg">{HELP.target.what} {HELP.target.typical}</div>
              </div>

              <div className="nf">
                <div className="nf-head"><span className="nf-label">Gear ratio</span></div>
                <Segmented
                  label="Gear ratio mode"
                  value={opts.ratioVary ? 'vary' : 'fixed'}
                  onChange={(v) => set({ ratioVary: v === 'vary' })}
                  options={[
                    { value: 'fixed', label: `Keep ${num(eff.Zp - 1, 0)}:1` },
                    { value: 'vary', label: 'Let ratio vary' },
                  ]}
                />
                <div className="nf-msg">
                  {opts.ratioVary
                    ? 'Tries Zp = 12, 14, …, 26 (ratios 11:1 to 25:1). Takes a few seconds.'
                    : `Uses your current Zp = ${num(eff.Zp, 0)}. Fastest.`}
                </div>
              </div>

              <NumberField label="Housing wall thickness" labelText="Wall thickness" unit="mm" value={state.gearboxes[slot].wall}
                onChange={(x) => updateGearbox(slot, (g) => ({ ...g, wall: x ?? 0 }))} defaultValue={ref.wall}
                help={HELP.advWall} step={0.5} />
            </Section>

            <Section title="Search limits" summary="advanced" defaultOpen={false}>
              <div className="fields">
                <NumberField label="D min" unit="mm" value={opts.Dmin} onChange={(x) => set({ Dmin: x ?? 0 })} defaultValue={dOpts.Dmin}
                  help={HELP.Dmin} step={1} error={dLo ? 'D min must be below D max' : null} />
                <NumberField label="D max" unit="mm" value={opts.Dmax} onChange={(x) => set({ Dmax: x ?? 0 })} defaultValue={dOpts.Dmax}
                  help={HELP.Dmax} step={1} />
                <NumberField label="Min pin clearance" unit="mm" value={opts.minPinClearance} onChange={(x) => set({ minPinClearance: x ?? 0 })}
                  defaultValue={dOpts.minPinClearance} help={HELP.minPinClearance} step={0.25} />
                <NumberField label="Alternatives window" unit="mm" value={opts.altWindowMm} onChange={(x) => set({ altWindowMm: x ?? 0 })}
                  defaultValue={dOpts.altWindowMm} help={HELP.altWindowMm} step={1} />
              </div>
            </Section>

            <div className="mat-summary">
              <div><span className="muted">Disc</span> {eff.discMaterial.kind === 'polymer' ? 'polymer' : 'metal'}, E {num(eff.discMaterial.E, 0)} MPa, Sy {num(eff.discMaterial.Sy, 0)} MPa</div>
              <div><span className="muted">Outer pins</span> {eff.outerPin.construction === 'solid' ? 'solid pins' : 'bolt + bushing'}</div>
              <div><span className="muted">Inner pins</span> {eff.innerPin.construction === 'solid' ? 'solid pins' : 'standoffs'}</div>
              <button type="button" className="linkish" onClick={() => setStep(2)}>Materials and pin type come from the Gearbox tab</button>
            </div>

            <div className="run-row">
              {running ? (
                <Button variant="secondary" size="md" icon="stop" onClick={cancelAdvisor}>Cancel</Button>
              ) : (
                <Button variant="primary" size="md" icon="sparkles" disabled={dLo} onClick={() => runAdvisor(slot)}>
                  {res ? 'Run again' : 'Run advisor'}
                </Button>
              )}
              {running && <span className="muted small">Searching in the background. The page stays responsive.</span>}
            </div>
          </div>
        </div>

        <div className="col col-results">
          {running && <RunningCard />}
          {!running && !res && (
            <Card>
              <EmptyState title="No design yet" icon="sparkles">
                <p>
                  Press <strong>Run advisor</strong>. It looks for the smallest housing that keeps every check at or under {opts.target.toFixed(2)},
                  then lists alternatives: best 1-disc, best 2-disc, lightest and most margin.
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
                  {res.errors[0] ?? 'Check the inputs.'} Fix it on the Gearbox tab and run again.
                </Notice>
              )}
              {res.valid && !res.best && (
                <Card>
                  <EmptyState title={`No design meets a target of ${res.target.toFixed(2)}`} icon="alert">
                    <p>Nothing between D = {num(opts.Dmin, 0)} and {num(opts.Dmax, 0)} mm keeps every check under the target with these loads and materials.</p>
                    <ul className="plain-list">
                      <li>Raise the target toward 1.00, or allow the ratio to vary.</li>
                      <li>Use a stronger disc material or solid steel pins, or lower the loads in Step 1.</li>
                      <li>Increase D max.</li>
                    </ul>
                    {res.warnings.map((w) => <p key={w} className="muted small">{w}</p>)}
                  </EmptyState>
                </Card>
              )}
              {res.valid && res.best && (
                <>
                  <Hero d={res.best} target={res.target} elapsed={res.elapsedMs} evaluated={res.evaluated} joint={label}
                    onApply={() => apply(res.best as AdvisorDesign, 'recommended')} />
                  <Alternatives res={res.alternatives} onApply={apply} />
                  {res.warnings.length > 0 && (
                    <ul className="plain-list warn-list">{res.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
                  )}
                </>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function RunningCard() {
  const { advisorRun } = useStore();
  const p = advisorRun.progress;
  return (
    <Card title="Searching…" subtitle={p?.phase === 'verify' ? 'Re-checking the best designs at full resolution' : 'Trying diameters from small to large'}>
      <ProgressBar fraction={p?.fraction ?? 0} label="Advisor progress" />
      <div className="run-stats" aria-live="polite">
        <span>{Math.round((p?.fraction ?? 0) * 100)}%</span>
        <span>{p ? `D = ${num(p.D, 0)} mm` : 'starting'}</span>
        <span>{p ? `${num(p.evaluated, 0)} designs checked` : ''}</span>
        <span>{p?.bestHousingOD != null ? `best housing so far ${num(p.bestHousingOD, 0)} mm` : 'no passing design yet'}</span>
      </div>
    </Card>
  );
}

function Hero({ d, target, elapsed, evaluated, joint, onApply }: {
  d: AdvisorDesign; target: number; elapsed: number; evaluated: number; joint: string; onApply: () => void;
}) {
  const { resolvedTheme } = useStore();
  const model = useMemo(() => createGearboxModel(d.inputs), [d.inputs]);
  const drawing = useMemo(() => model.drawingAt(0, 480), [model]);
  const r = d.result;
  const kind = verdictKind(r.verdict);
  const outerDesc = d.inputs.outerPin.construction === 'solid'
    ? `${num(d.outerPinOD, 1)} mm solid pin`
    : `${num(d.outerPinOD, 1)} mm bushing on ${d.outerBolt ?? 'bolt'} (${num(d.shankDia, 1)} mm shank)`;
  const innerDesc = d.inputs.innerPin.construction === 'solid'
    ? `${num(d.innerPinOD, 1)} mm solid pin`
    : `${num(d.innerPinOD, 1)} mm ${d.innerThread ?? ''} standoff, ${num(d.innerPinBore, 2)} mm bore`;
  return (
    <section className="hero card">
      <div className="hero-top">
        <div>
          <div className="hero-eyebrow"><Badge />Recommended design for {joint}</div>
          <h2 className="hero-title">
            {num(d.housingOD, 0)} mm housing, {num(d.ratio, 0)}:1, {d.discs} disc{d.discs > 1 ? 's' : ''}
          </h2>
          <p className="hero-sub">Smallest housing where every check stays at or under {target.toFixed(2)}.</p>
        </div>
        <StatusChip kind={kind}>
          {r.verdict === 'pass' ? 'PASS' : r.verdict === 'marginal' ? 'MARGINAL' : 'FAIL'} {'·'} max {util(d.maxUtilization)}
        </StatusChip>
      </div>

      <div className="hero-grid">
        <div className="hero-fig">
          <DiscSvg drawing={drawing} peak={Math.max(r.loads.FRingPeak, 1)} theme={resolvedTheme} Rp={r.derived.Rp} rr={d.inputs.rr} size={220}
            label="Preview of the recommended disc at input angle zero" />
          <div className="hero-fig-cap">Preview at {'θ'} = 0{'°'}</div>
        </div>
        <dl className="spec-grid">
          <Spec label="Outer pin circle D" value={`${num(d.D, 0)} mm`} />
          <Spec label="Housing OD" value={`${num(d.housingOD, 1)} mm`} note={`wall ${num(d.inputs.wall, 1)} mm`} />
          <Spec label="Eccentricity e" value={`${fixed(d.e, 3)} mm`} note={`K1 ${fixed(d.K1, 3)}`} />
          <Spec label="Ratio" value={`${num(d.ratio, 0)}:1`} note={`Zp ${num(d.Zp, 0)}`} />
          <Spec label="Outer pins" value={outerDesc} wide />
          <Spec label="Inner pins" value={innerDesc} wide />
          <Spec label="Inner pins Zw" value={`${num(d.Zw, 0)}`} note={`Rw ${fixed(d.Rw, 1)} mm`} />
          <Spec label="Disc thickness L" value={`${num(d.L, 2)} mm`} />
          <Spec label="Discs" value={`${d.discs}`} note={`${num(r.mass.perDisc_g, 0)} g each`} />
          <Spec label="Eccentric bearing" value={d.bearingName} note={`OD ${num(d.bearingOD, 0)} mm`} />
          <Spec label="Disc mass" value={`${num(d.massTotal_g, 0)} g`} />
          <Spec label="Governing check" value={d.governingLabel} note={`utilization ${util(d.maxUtilization)}`} wide />
        </dl>
      </div>

      <div className="hero-foot">
        <Button variant="primary" icon="arrow" onClick={onApply}>Apply to Gearbox</Button>
        <p className="hero-note">
          Verify bearing ratings on the datasheet: the C and C0 values here are approximate. Searched {num(evaluated, 0)} designs in {num(elapsed / 1000, 1)} s.
        </p>
      </div>
    </section>
  );
}

function Badge() {
  return <span className="hero-badge">Best</span>;
}

function Spec({ label, value, note, wide }: { label: string; value: string; note?: string; wide?: boolean }) {
  return (
    <div className={`spec${wide ? ' is-wide' : ''}`}>
      <dt>{label}</dt>
      <dd>{value}{note && <small>{note}</small>}</dd>
    </div>
  );
}

function Alternatives({ res, onApply }: {
  res: { oneDisc: AdvisorDesign | null; twoDisc: AdvisorDesign | null; lightest: AdvisorDesign | null; mostMargin: AdvisorDesign | null };
  onApply: (d: AdvisorDesign, which: string) => void;
}) {
  const rows: { key: string; label: string; d: AdvisorDesign | null }[] = [
    { key: 'one', label: 'Best 1-disc', d: res.oneDisc },
    { key: 'two', label: 'Best 2-disc', d: res.twoDisc },
    { key: 'light', label: 'Lightest', d: res.lightest },
    { key: 'margin', label: 'Most margin', d: res.mostMargin },
  ];
  const pin = (d: AdvisorDesign) => `${num(d.outerPinOD, 1)} / ${num(d.innerPinOD, 1)}`;
  return (
    <Card title="Alternatives" subtitle="Smallest with each disc count, then the lightest and the most margin within a few mm of the best housing.">
      <ResponsiveTable threshold={900} className="alt-table">
          <thead>
            <tr>
              <th scope="col">Option</th>
              <th scope="col" className="num">Housing OD<small>mm</small></th>
              <th scope="col" className="num">D<small>mm</small></th>
              <th scope="col" className="num">e<small>mm</small></th>
              <th scope="col" className="num">Pins out / in<small>mm OD</small></th>
              <th scope="col" className="num">L<small>mm</small></th>
              <th scope="col" className="num">Discs</th>
              <th scope="col">Bearing</th>
              <th scope="col" className="num">Mass<small>g</small></th>
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
                    <td className="num" data-label="Housing OD">{num(d.housingOD, 0)}<Cu>mm</Cu></td>
                    <td className="num" data-label="D">{num(d.D, 0)}<Cu>mm</Cu></td>
                    <td className="num" data-label="e">{fixed(d.e, 2)}<Cu>mm</Cu></td>
                    <td className="num" data-label="Pins out / in">{pin(d)}<Cu>mm OD</Cu></td>
                    <td className="num" data-label="L">{num(d.L, 2)}<Cu>mm</Cu></td>
                    <td className="num" data-label="Discs">{d.discs}</td>
                    <td data-label="Bearing">{d.bearingName}</td>
                    <td className="num" data-label="Mass">{num(d.massTotal_g, 0)}<Cu>g</Cu></td>
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
