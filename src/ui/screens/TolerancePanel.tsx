// "Tolerances & backlash" inspector section (CLAUDE.md Addition 13): the machining process, clearances, plays and +-
// tolerances of one gearbox, and what follows from them: backlash at the output, binding, Monte Carlo load sharing (Kc)
// with the "use tolerance Kc" switch, torsional stiffness, slop at the tool tip and the sensitivity of each term.
// The Monte Carlo runs in the worker (src/ui/tolerance.tsx); this file only renders and edits.
import { useMemo, type ReactNode } from 'react';
import {
  ARCMIN_PER_RAD, DRILLED_HOLE_PLAY, INTEGRAL_UNUSED_TERMS, PROCESS_PRESETS, REAMED_HOLE_PLAY, armTipLevers, armTipSlop,
  BIND_TARGET_RANGE, effectiveSpec, fitTrialsFor, fittedClearances, matchProcess, processSpec, ringTolOf, shoulderBoltFor, toleranceOf,
  toleranceStacks, validateToleranceSpec, withTolerance,
  type Fix, type GearboxInputs, type GearboxResult, type ProcessId, type ToleranceSpec, type ToleranceTerm,
} from '../../calc';
import { NumberField } from '../components/NumberField';
import { Advanced, Button, DataTable, FieldRow, Notice, ProgressBar, Segmented, SelectField, Switch } from '../components/primitives';
import { InfoTip } from '../components/InfoTip';
import { HELP } from '../help';
import { DASH, fixed, num } from '../format';
import { useApplyFix, useFixes, fixResultText } from '../fixes';
import { CUSTOM, type Slot } from '../session';
import { useStore } from '../store';
import { useAllTolerance, useStatFit, useTolerance, type SlotTolerance } from '../tolerance';
import type { U } from '../units';
import '../../styles/tolerance.css';

const fin = (x: number | null | undefined): x is number => typeof x === 'number' && Number.isFinite(x);
/** arcmin text: 14.2′ (′ = arcminute, 1/60 of a degree) */
export const arcmin = (rad: number | null | undefined, dp = 1): string => (fin(rad) ? `${fixed(rad * ARCMIN_PER_RAD, dp)}′` : DASH);
/** arcmin with degrees for readers who think in degrees: 51.5′ (0.86°) */
export const arcminDeg = (rad: number | null | undefined, dp = 1): string =>
  (fin(rad) ? `${arcmin(rad, dp)} (${fixed((rad * 180) / Math.PI, (rad * 180) / Math.PI < 0.1 ? 3 : 2)}°)` : DASH);
const pct = (x: number) => `${Math.round(x * 100)}%`;
/** target percentage: 1%, 0.5%, 2.5% */
const pctT = (x: number) => `${parseFloat((x * 100).toFixed(2))}%`;
/** Same process values, hole play and Monte Carlo settings (the inputs of the clearance fit). */
function sameProcess(a: ToleranceSpec, b: ToleranceSpec): boolean {
  const keys = ['profileError', 'pinPosition', 'pinDiaTol', 'eccError', 'innerHolePosition', 'innerPinDiaTol', 'bushingPlay', 'holePlay', 'bearingClearance', 'mcTrials', 'seed', 'bindTarget'] as const;
  return keys.every((k) => Math.abs(a[k] - b[k]) < 1e-12);
}
/** 3 decimals without a "-0.000" */
const z3 = (x: number) => (Math.abs(x) < 5e-4 ? 0 : x).toFixed(3);

interface FieldDef { k: ToleranceTerm; label: string; symbol?: string; help: keyof typeof HELP; note?: string }

const CLEARANCES: FieldDef[] = [
  { k: 'profileClearance', label: 'Profile clearance', symbol: 'Δrp', help: 'tolProfileClearance', note: 'Same value the DXF disc is cut with' },
  { k: 'innerHoleClearance', label: 'Inner hole clearance', symbol: 'Δh', help: 'tolInnerHoleClearance', note: 'Diametral; the DXF inner holes use it' },
];
const PLAYS: FieldDef[] = [
  { k: 'bushingPlay', label: 'Bushing play', help: 'tolBushingPlay', note: 'Radial, bushing on its bolt' },
  { k: 'holePlay', label: 'Bolt hole play', help: 'tolHolePlay', note: 'Radial; the DXF pin hole clearance is twice this' },
  { k: 'bearingClearance', label: 'Bearing clearance', symbol: 'c_b', help: 'tolBearingClearance', note: 'Radial internal clearance of the eccentric bearing' },
];
const ERRORS: FieldDef[] = [
  { k: 'profileError', label: 'Profile error', symbol: '±', help: 'tolProfileError' },
  { k: 'pinPosition', label: 'Pin position', symbol: 'δQ', help: 'tolPinPosition', note: 'Radius of the true-position zone' },
  { k: 'pinDiaTol', label: 'Pin diameter', symbol: '±', help: 'tolPinDiaTol' },
  { k: 'eccError', label: 'Eccentricity error', symbol: '±δe', help: 'tolEccError' },
  { k: 'innerHolePosition', label: 'Inner hole position', help: 'tolInnerHolePosition', note: 'Radius of the true-position zone' },
  { k: 'innerPinDiaTol', label: 'Inner pin diameter', symbol: '±', help: 'tolInnerPinDiaTol' },
];

/** The section body: inputs of the slot's stored gearbox, results for its checked inputs. */
export function TolerancePanel({ slot, eff, result, index }: { slot: Slot; eff: GearboxInputs; result: GearboxResult; index: number }) {
  const tol = useTolerance(slot);
  return <ToleranceView slot={slot} eff={eff} result={result} index={index} tol={tol} />;
}

/** Pure view (tests render it with a given analysis). */
export function ToleranceView({ slot, eff, result, index, tol }: {
  slot: Slot; eff: GearboxInputs; result: GearboxResult; index: number; tol: SlotTolerance;
}) {
  const { state, updateGearbox, applyGearboxChange, u } = useStore();
  const spec = toleranceOf(eff);
  const errs = useMemo(() => validateToleranceSpec(spec), [spec]);
  // integral ring or shoulder bolt (no bushing play, the catalog shoulder band as the pin diameter tolerance)
  const ring = ringTolOf(eff);
  const integral = ring.integral;
  const shoulder = ring.shoulder;
  const specE = effectiveSpec(spec, ring);
  const statistical = spec.fitMode === 'statistical';
  // the statistical fit of the last analysis, when it was made for these process values (it does not depend on the clearances)
  const shownFit = tol.shown && tol.shown.valid && sameProcess(tol.shown.spec, specE) ? tol.shown.fit : null;
  const statFitJob = useStatFit(slot);
  // while a fit runs the clearances are the worst-case ones: compare the process values only
  const proc = matchProcess(spec, ring, statistical && !statFitJob.fitting ? shownFit?.statistical ?? null : null);
  const reamed = spec.holePlay <= REAMED_HOLE_PLAY + 1e-9;
  const set = (patch: Partial<ToleranceSpec>) => updateGearbox(slot, (g) => withTolerance(g, patch));
  const lever = slot !== CUSTOM && index >= 0 ? armTipLevers(state.arm)[index] ?? null : null;
  const fx = useFixes(slot);
  const applyFix = useApplyFix();
  const processFixes = (fx.report?.fixes ?? []).filter((f) => f.field === 'tolerance');
  const who = slot === CUSTOM ? 'Custom gearbox' : `J${index + 1}`;

  const sb = shoulder ? shoulderBoltFor(eff.rr) : null;
  const field = (d: FieldDef) => (shoulder && d.k === 'pinDiaTol'
    // the shoulder band is fixed by the catalog: shown, not edited
    ? <NumberField key={d.k} label="Shoulder diameter (half band)" symbol={d.symbol} quantity="length" value={specE.pinDiaTol}
      onChange={() => undefined} disabled step={0.001} help={HELP.shoulderBand}
      note={u.text(`Ground shoulder ${sb ? `${sb.label} (${(2 * eff.rr + sb.lower).toFixed(3)} to ${(2 * eff.rr + sb.upper).toFixed(3)} mm)` : `${(2 * eff.rr).toFixed(3)} mm (metric band assumed)`}: mean undersize ${(2 * shoulder.undersize).toFixed(4)} mm adds a ${shoulder.undersize.toFixed(4)} mm gap at every pin; ± ${(specE.pinDiaTol).toFixed(4)} mm on the diameter is random`)} />
    : <NumberField key={d.k} label={d.label} symbol={d.symbol} quantity="length" value={spec[d.k]}
      onChange={(v) => set({ [d.k]: v ?? 0 })} defaultValue={processSpec(proc ?? 'mill', { integral: ring, holePlay: spec.holePlay })[d.k]} step={0.005}
      help={HELP[d.help]} error={errs[d.k]} note={d.note} />
  );
  const shown = (list: FieldDef[]) => list.filter((d) => !(integral && INTEGRAL_UNUSED_TERMS.includes(d.k)) && !(shoulder && d.k === 'bushingPlay'));

  /**
   * Apply a preset spec: the worst-case fit right away; in statistical mode the worker's fit replaces the clearances when
   * it returns (the previous fitted values stay on show, marked "fitting…").
   */
  const applyPreset = (next: ToleranceSpec) => {
    updateGearbox(slot, (g) => ({ ...g, tolerance: next }));
    if (next.fitMode === 'statistical') statFitJob.request({ ...eff, tolerance: next }, next);
  };
  const pickProcess = (id: string) => {
    if (id === 'custom') return;
    // a reamed hole fit is kept
    applyPreset(processSpec(id as ProcessId, { integral: ring, holePlay: reamed && !integral ? spec.holePlay : undefined, keep: spec }));
  };
  /** Change a setting the fit depends on: a preset re-fits its clearances, custom clearances stay as typed. */
  const refit = (patch: Partial<ToleranceSpec>) => {
    if (proc) applyPreset(processSpec(proc, { integral: ring, holePlay: patch.holePlay ?? spec.holePlay, keep: { ...spec, ...patch } }));
    else set(patch);
  };
  const setReamed = (v: boolean) => refit({ holePlay: v ? REAMED_HOLE_PLAY : DRILLED_HOLE_PLAY });
  const st = toleranceStacks(spec, ring);
  const worstFit = fittedClearances(spec, ring);
  const statFit = shownFit && Number.isFinite(shownFit.statistical.profileClearance) ? shownFit.statistical : null;
  const fit = statistical ? statFit : worstFit;
  const mm3 = (x: number) => x.toFixed(3);
  const why = integral
    ? `profile error ${mm3(spec.profileError)} × 2 (disc and teeth) + eccentricity ${mm3(spec.eccError)}`
    : shoulder
    ? `profile error ${mm3(spec.profileError)} + pin position ${mm3(spec.pinPosition)} + hole play ${mm3(spec.holePlay)} + shoulder band ${mm3(specE.pinDiaTol / 2)} + eccentricity ${mm3(spec.eccError)} − mean shoulder undersize ${mm3(shoulder.undersize)}`
    : `profile error ${mm3(spec.profileError)} + pin position ${mm3(spec.pinPosition)} + hole play ${mm3(spec.holePlay)} + pin diameter ${mm3(spec.pinDiaTol / 2)} + eccentricity ${mm3(spec.eccError)}`;
  const fitNote = (
    <span className="tol-fit">
      {u.text(`Fitted clearances: profile worst case ${mm3(worstFit.profileClearance)} mm${statFit ? ` · ${pctT(spec.bindTarget)}: ${mm3(statFit.profileClearance)} mm` : ''}; inner holes worst case ${mm3(worstFit.innerHoleClearance)} mm${statFit ? ` · ${pctT(spec.bindTarget)}: ${mm3(statFit.innerHoleClearance)} mm` : ''}.`)}{' '}
      {u.text(`Worst case = the stack rounded up to 0.005 mm, so no build can bind: profile ${why} = ${mm3(st.profile)} mm; inner holes 2 × (hole position ${mm3(spec.innerHolePosition)} + pin diameter ${mm3(spec.innerPinDiaTol / 2)} + eccentricity ${mm3(spec.eccError)}).`)}
      {statistical && ` Statistical = the smallest value (0.005 mm steps) at which at most ${pctT(spec.bindTarget)} of ${statFit?.trials ?? fitTrialsFor(spec.bindTarget)} random builds bind${statFitJob.fitting ? ': fitting…' : statFit ? ` (fit ${Math.round(statFit.elapsedMs)} ms)` : ': computing…'}.`}
      {!proc && fit && (Math.abs(fit.profileClearance - spec.profileClearance) > 1e-9 || Math.abs(fit.innerHoleClearance - spec.innerHoleClearance) > 1e-9) && (
        <> <button type="button" className="linkish" onClick={() => set({ profileClearance: fit.profileClearance, innerHoleClearance: fit.innerHoleClearance })}>Use the fitted clearances</button></>
      )}
    </span>
  );

  return (
    <div className={`tol-body${tol.pending ? ' is-pending' : ''}`}>
      <SelectField label="Machining process" value={proc ?? 'custom'} onChange={pickProcess} help={HELP.tolProcess}
        options={[
          ...PROCESS_PRESETS.map((p) => ({ value: p.id, label: p.label, title: p.note })),
          ...(proc ? [] : [{ value: 'custom', label: 'Custom (edited values)' }]),
        ]}
        note={<>{proc ? PROCESS_PRESETS.find((p) => p.id === proc)?.note : 'Custom: a clearance or a tolerance was edited. Pick a process to start again from its typical values.'} {fitNote}</>} />
      <FieldRow label="Fit clearance for" help={HELP.tolFitMode} stacked>
        <Segmented<'worst' | 'statistical'> label="Fit clearance for" size="sm" fullWidth value={spec.fitMode}
          onChange={(m) => refit({ fitMode: m })}
          options={[
            { value: 'worst', label: 'Worst case (never binds)' },
            { value: 'statistical', label: `Statistical (≤ ${pctT(spec.bindTarget)} of builds bind)` },
          ]} />
      </FieldRow>
      {statistical && (
        <NumberField label="Accepted binding" unit="% of builds" value={Math.round(spec.bindTarget * 1e5) / 1e3}
          onChange={(v) => refit({ bindTarget: (v ?? 1) / 100 })} defaultValue={1} step={0.5} help={HELP.tolBindTarget}
          error={errs.bindTarget} note={`${BIND_TARGET_RANGE[0] * 100}% to ${BIND_TARGET_RANGE[1] * 100}%`} />
      )}
      {!integral && (
        <Switch checked={reamed} onChange={setReamed}
          label="Reamed / dowel-fit holes" description={reamed ? 'Hole play 0.005 mm; DXF pin holes + 0.01 mm' : 'Plain clearance holes'} help={HELP.tolReamed} />
      )}

      <ToleranceResults slot={slot} eff={eff} result={result} tol={tol} lever={lever} u={u}
        onUseKc={(v) => updateGearbox(slot, (g) => ({ ...g, useToleranceKc: v }))}
        onClearance={(patch, text) => applyGearboxChange(slot, (g) => withTolerance(g, patch), u.text(`${who}: ${text}`))}
        processFixes={processFixes} onFix={(f) => applyFix(slot, f)} />

      <h4 className="subgroup-h">Clearances (on purpose)</h4>
      {shown(CLEARANCES).map(field)}
      {shown(PLAYS).length > 0 && <h4 className="subgroup-h">Play (only adds room)</h4>}
      {shown(PLAYS).map(field)}
      <h4 className="subgroup-h">Machining errors (±, random)</h4>
      {shown(ERRORS).map((d) => (integral && d.k === 'profileError'
        ? field({ ...d, label: 'Profile error (disc and teeth)' })
        : field(d)))}
      <Advanced label="Monte Carlo">
        <NumberField label="Random builds" unit="builds" value={spec.mcTrials} onChange={(v) => set({ mcTrials: v ?? spec.mcTrials })}
          defaultValue={1000} step={100} help={HELP.tolTrials} error={errs.mcTrials} />
        <NumberField label="Seed" value={spec.seed} onChange={(v) => set({ seed: v ?? 0 })} defaultValue={1} step={1}
          help={HELP.tolSeed} error={errs.seed} />
      </Advanced>
    </div>
  );
}

function ToleranceResults({ slot, eff, result, tol, lever, u, onUseKc, onClearance, processFixes, onFix }: {
  slot: Slot; eff: GearboxInputs; result: GearboxResult; tol: SlotTolerance; lever: number | null; u: U;
  onUseKc: (v: boolean) => void; onClearance: (patch: Partial<ToleranceSpec>, text: string) => void;
  processFixes: Fix[]; onFix: (f: Fix) => void;
}) {
  const r = tol.shown;
  const useKc = eff.useToleranceKc === true;
  const kcNow = result.kc;
  const kcLine = !useKc
    ? `The checks use the typed Kc ${fixed(kcNow?.typedKc, 2)} and Kc life ${fixed(kcNow?.typedKcLife, 2)}.`
    : kcNow?.source === 'tolerance'
      ? `The checks use the tolerance Kc ${fixed(kcNow.Kc, 2)} and Kc life ${fixed(kcNow.KcLife, 2)} (p95), not the typed ${fixed(kcNow.typedKc, 2)} / ${fixed(kcNow.typedKcLife, 2)}.`
      : `The checks use the typed Kc ${fixed(kcNow?.typedKc, 2)} / ${fixed(kcNow?.typedKcLife, 2)} until the Monte Carlo has a value${r && r.valid && !r.statsShown ? ' (most builds bind: raise the clearance first)' : ''}.`;
  const kcSwitch = (
    <Switch checked={useKc} onChange={onUseKc} label="Use tolerance Kc in the checks" description={kcLine} help={HELP.tolUseKc} />
  );

  if (!r) {
    return (
      <div className="tol-results" role="status" aria-live="polite">
        {tol.progress != null ? <ProgressBar fraction={tol.progress} label="Tolerance Monte Carlo" /> : null}
        <p className="muted">{tol.pending || tol.progress != null ? 'Running the tolerance Monte Carlo…' : 'The tolerance analysis runs in the background.'}</p>
        {kcSwitch}
      </div>
    );
  }
  if (!r.valid) {
    return (
      <div className="tol-results">
        <Notice kind="error" title="The tolerance analysis cannot run">
          <ul className="plain-list">{r.errors.slice(0, 4).map((e) => <li key={e}>{u.text(e)}</li>)}</ul>
        </Notice>
        {kcSwitch}
      </div>
    );
  }
  const b = r.binding;
  const bl = r.backlash;
  const tip = (rad: number) => (lever != null && fin(rad) ? u.fu('length', rad * lever, { dp: u.prefs.length === 'in' ? 2 : 3 }) : null);
  const p95 = bl.mc.p95;
  const twist = r.stiffness.twistReq;
  const tipTotal = lever != null && fin(p95) ? (p95 + twist) * lever : null;
  const someBind = r.freeBuilds < r.trials;
  const manyBind = r.bindProb > 0.05;
  // the one-click clearances follow the fit mode (statistical: the Monte Carlo fit, worst: the stack)
  const stat = r.spec.fitMode === 'statistical' ? r.fit.statistical : null;
  const sugP = stat && fin(stat.profileClearance) ? stat.profileClearance : b.suggestedProfileClearance;
  const sugI = stat && fin(stat.innerHoleClearance) ? stat.innerHoleClearance : b.suggestedInnerHoleClearance;
  const why = stat ? `so at most ${pctT(r.spec.bindTarget)} of builds bind` : 'so the worst-case stack cannot bind';
  // the statistical share comes from the fit's own large sample (the analysis sample is too small for a 1% tail)
  const needP = b.binds && r.spec.profileClearance < sugP - 1e-9;
  const needI = b.innerBinds && r.spec.innerHoleClearance < sugI - 1e-9;
  const fixButtons = (
    <>
      {needP && (
        <Button size="sm" variant="primary" onClick={() => onClearance({ profileClearance: sugP }, `profile clearance → ${sugP.toFixed(3)} mm, ${why}.`)}>
          {u.text(`Profile clearance → ${sugP.toFixed(3)} mm`)}
        </Button>
      )}
      {needI && (
        <Button size="sm" variant={needP ? 'secondary' : 'primary'} onClick={() => onClearance({ innerHoleClearance: sugI }, `inner hole clearance → ${sugI.toFixed(3)} mm, ${why}.`)}>
          {u.text(`Inner hole clearance → ${sugI.toFixed(3)} mm`)}
        </Button>
      )}
    </>
  );
  const bwRow = (label: string, rad: number, note?: ReactNode) => ({
    label, value: <>{arcminDeg(rad)}{tip(rad) && <span className="tol-tip"> · {tip(rad)} at the tip</span>}</>, note,
  });

  return (
    <div className="tol-results" aria-live="polite">
      {tol.pending && <div className="tol-updating">{tol.progress != null ? <ProgressBar fraction={tol.progress} label="Tolerance Monte Carlo" /> : null}<span className="muted">Updating…</span></div>}

      {(b.binds || b.innerBinds) && stat && !needP && !needI ? (
        <Notice kind="info" title={`About ${pctT(Math.max(stat.ringProb, stat.innerProb))} of builds may bind at assembly`}>
          <p>{u.text(`Statistical fit (target ${pctT(r.spec.bindTarget)}): the worst-case stack (${b.requiredProfileClearance.toFixed(3)} mm at the pins, ${b.requiredInnerHoleClearance.toFixed(3)} mm in the inner holes) is not covered. Select parts or lap the disc on the builds that bind.`)}</p>
        </Notice>
      ) : (b.binds || b.innerBinds) ? (
        <Notice kind={manyBind ? 'error' : 'warning'}
          title={manyBind
            ? `${pct(r.bindProb)} of the random builds bind`
            : b.binds && b.innerBinds ? 'The disc and the inner pins can bind' : b.binds ? 'The disc can bind on the outer pins' : 'The inner pins can bind in their holes'}
          actions={fixButtons}>
          {b.binds && <p>{u.text(`Worst-case stack ${b.requiredProfileClearance.toFixed(3)} mm is more than the profile clearance ${r.spec.profileClearance.toFixed(3)} mm (minimum gap ${b.minGapWorst.toFixed(3)} mm). ${pct(b.interferenceProb)} of the random builds jam somewhere in a turn.`)}</p>}
          {b.innerBinds && <p>{u.text(`Inner holes: worst-case stack ${b.requiredInnerHoleClearance.toFixed(3)} mm (diametral) is more than the inner hole clearance ${r.spec.innerHoleClearance.toFixed(3)} mm. ${pct(b.innerInterferenceProb)} of the random builds do not fit.`)}</p>}
          {someBind && <p>The backlash and Kc statistics below use only the {r.freeBuilds} of {r.trials} builds that fit and turn.</p>}
        </Notice>
      ) : (
        <p className="tol-ok"><span className="st st-ok"><i className="st-sq" aria-hidden="true" />NO BINDING</span> {u.text(`Worst-case gap ${z3(b.minGapWorst)} mm at the pins, ${z3(b.innerMinGapWorst)} mm in the inner holes.`)}</p>
      )}

      <h4 className="subgroup-h tol-h">Backlash at the output <InfoTip help={HELP.tolBacklash} label="Backlash" /></h4>
      <p className="tol-explain">
        Backlash is the free play at the output: how far you can rock the output back and forth by hand while the motor
        holds still, before the gears push back. It is measured in <strong>arcminutes (′)</strong>: 1′ = 1/60 of a degree,
        so 60′ = 1°. One degree of play moves a point 1 m away by about 17.5 mm.
      </p>
      {!r.statsShown ? (
        <Notice kind="error" title="Most builds bind: raise the clearance" actions={fixButtons}>
          <p>Only {r.freeBuilds} of {r.trials} random builds fit and turn, too few for backlash and Kc statistics.</p>
        </Notice>
      ) : null}
      <DataTable columns={1} rows={[
        bwRow('Design (no errors)', bl.design.total,
          `Perfect parts: only the clearances you chose. Disc on the outer pins ${arcmin(bl.design.ring)} + output pins in their holes ${arcmin(bl.design.inner)}; ${eff.outerPin.construction === 'shoulderBolt' ? 'shoulders at their mean undersize' : r.integral ? 'no pins or plays' : 'bushing play at its average'}.`),
        ...(r.statsShown ? [
          bwRow('Typical build (p50)', bl.mc.p50, `Half of real builds have less play than this (from ${r.freeBuilds} simulated builds with random machining errors).`),
          bwRow('Most builds (p95)', bl.mc.p95, '95 of 100 builds have less play than this. Use this number to plan.'),
        ] : []),
        bwRow('Worst case', bl.worst.total, 'Every error and every play lined up the loose way at once: an upper bound that real builds almost never reach.'),
      ]} />
      {r.statsShown && bl.mc.p50 < bl.design.total && (
        <p className="tol-note muted">Random errors usually leave less play than the design: the tightest of the scattered pins stops the disc first.</p>
      )}

      <h4 className="subgroup-h">Load sharing (as built, before run-in)</h4>
      {r.statsShown && (
        <DataTable columns={1} rows={[
          { label: 'Kc strength (at T_des)', value: `${fixed(r.kc.strength.p50, 2)} p50 · ${fixed(r.kc.strength.p95, 2)} p95`, note: `typed ${fixed(r.kc.typedKc, 2)}; design gaps ${fixed(r.kc.designStrength, 2)}`, flag: fin(r.kc.strength.p95) && r.kc.strength.p95 > r.kc.typedKc ? 'marginal' : undefined },
          { label: 'Kc life (at T_req)', value: `${fixed(r.kc.life.p50, 2)} p50 · ${fixed(r.kc.life.p95, 2)} p95`, note: `typed ${fixed(r.kc.typedKcLife, 2)}; design gaps ${fixed(r.kc.designLife, 2)}`, flag: fin(r.kc.life.p95) && r.kc.life.p95 > r.kc.typedKcLife ? 'marginal' : undefined },
        ]} />
      )}
      <p className="tol-note muted">An upper bound for the parts as built, before run-in: only the outer pin contact and bending give way (the disc, housing and bearing are taken as rigid), and running in lowers it.</p>
      {kcSwitch}
      {processFixes.length > 0 && (
        <div className="fix-line">
          <span className="fix-line-h">Tighter process</span>
          {processFixes.map((f) => (
            <button key={f.short} type="button" className={`fix-btn${f.passesTarget ? ' is-pass' : ''}`} onClick={() => onFix(f)}>
              {u.text(f.short)} <span className="fix-btn-res">({fixResultText(f)})</span>
            </button>
          ))}
        </div>
      )}

      <h4 className="subgroup-h">Stiffness and tip</h4>
      <DataTable columns={1} rows={[
        { label: 'Torsional stiffness', value: `${u.fu('torque', r.stiffness.Kt_Nm_per_arcmin, { dp: 2 })} per arcmin`, note: `pin spring ${num(r.stiffness.life.k / 1000, 1)} kN/mm (contact ${num(r.stiffness.life.kc / 1000, 1)}${Number.isFinite(r.stiffness.life.kb) ? `, bending ${num(r.stiffness.life.kb / 1000, 1)}` : ', rigid teeth'})` },
        { label: 'Twist at T_req', value: arcminDeg(twist, 2), note: 'How far the output winds up elastically under the working torque, on top of the backlash.' },
        ...(lever != null ? [{
          label: 'Tool tip slop', value: tipTotal != null ? u.fu('length', tipTotal, { dp: u.prefs.length === 'in' ? 2 : 3 }) : DASH,
          note: u.text(`How far the tool tip can move from this joint's play alone: (p95 backlash + twist) × ${lever.toFixed(0)} mm from this joint to the tip, in the straight-out pose.`),
        }] : []),
      ]} />
      <p className="tol-note muted">Stiffness counts the outer pin contact and bending only; the inner pins, standoffs, bearing and housing make the real gearbox softer.</p>

      {r.sensitivity && (
        <Advanced label="What drives it (sensitivity)">
          <SensList title="Backlash (worst case, one term at a time)" items={r.sensitivity.backlash} fmt={(v) => arcmin(v)} />
          <SensList title="Kc spread (variance, one term at a time)" items={r.sensitivity.kc} />
        </Advanced>
      )}
      <span className="visually-hidden">{slot}</span>
    </div>
  );
}

function SensList({ title, items, fmt }: { title: string; items: { term: string; label: string; value: number; share: number }[]; fmt?: (v: number) => string }) {
  const list = items.filter((x) => x.share > 0.0005).sort((a, b) => b.share - a.share);
  return (
    <div className="tol-sens">
      <div className="tol-sens-h">{title}</div>
      {list.length === 0 ? <p className="muted">Nothing contributes.</p> : (
        <ul>
          {list.map((x) => (
            <li key={x.term}>
              <span className="tol-sens-l">{x.label}</span>
              <span className="tol-sens-bar" aria-hidden="true"><i style={{ width: `${Math.max(2, x.share * 100)}%` }} /></span>
              <span className="tol-sens-v">{pct(x.share)}{fmt ? ` · ${fmt(x.value)}` : ''}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Collapsed-section summary: "Backlash 14.2′ (p95) · Kc 1.60" or the binding / running state. */
export function ToleranceSummary({ slot }: { slot: Slot }) {
  const t = useTolerance(slot);
  const r = t.result;
  if (!r) return <>{t.progress != null ? `running ${Math.round(t.progress * 100)}%` : 'computing…'}</>;
  if (!r.valid) return <>check the tolerance inputs</>;
  if (!r.statsShown) return <>MOST BUILDS BIND ({pct(r.bindProb)}) · raise the clearance</>;
  const bind = r.binding.binds || r.binding.innerBinds ? `CAN BIND (${pct(r.bindProb)}) · ` : '';
  return <>{bind}Backlash {arcminDeg(r.backlash.mc.p95)} p95 · Kc {fixed(r.kc.strength.p95, 2)}</>;
}

// ---------------------------------------------------------------------------
// Arm item: tip slop of every joint
// ---------------------------------------------------------------------------

export function useArmSlop() {
  const { state } = useStore();
  const all = useAllTolerance();
  return useMemo(() => {
    const levers = armTipLevers(state.arm);
    const per = state.arm.joints.map((j) => {
      if (j.drive !== 'cycloidal') return null;
      const r = all[j.id];
      if (!r || !r.valid || !r.statsShown || !fin(r.backlash.mc.p95)) return null;
      return { backlash: r.backlash.mc.p95, twist: r.stiffness.twistReq };
    });
    return { levers, slop: armTipSlop(levers, per), all };
  }, [state.arm, all]);
}

export function ArmSlopCard() {
  const { state, u, openSection } = useStore();
  const { slop, all } = useArmSlop();
  const joints = state.arm.joints;
  return (
    <div className="tol-arm">
      <table className="rtable tol-arm-table">
        <thead>
          <tr><th scope="col">Joint</th><th scope="col">Lever</th><th scope="col">Backlash p95</th><th scope="col">Twist</th><th scope="col">Tip</th></tr>
        </thead>
        <tbody>
          {joints.map((j, i) => {
            const s = slop.joints[i];
            const r = j.drive === 'cycloidal' ? all[j.id] : null;
            const state2 = j.drive !== 'cycloidal' ? 'servo, not modelled'
              : !r ? 'computing…'
                : !r.valid ? 'input error'
                  : !r.statsShown ? 'most builds bind' : null;
            return (
              <tr key={j.id}>
                <td data-label="Joint">
                  {j.drive === 'cycloidal'
                    ? <button type="button" className="linkish strong" onClick={() => openSection('tolerance', j.id)}>J{i + 1}{j.name.trim() ? ` ${j.name.trim()}` : ''}</button>
                    : <>J{i + 1}{j.name.trim() ? ` ${j.name.trim()}` : ''}</>}
                </td>
                <td data-label="Lever">{u.fu('length', s.lever, { dp: 0 })}</td>
                {state2 ? <td colSpan={3} className="muted">{state2}</td> : (
                  <>
                    <td data-label="Backlash p95">{arcminDeg(s.backlash)}</td>
                    <td data-label="Twist">{arcmin(s.twist, 2)}</td>
                    <td data-label="Tip">{s.tip != null ? u.fu('length', s.tip, { dp: u.prefs.length === 'in' ? 2 : 3 }) : DASH}</td>
                  </>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
      <DataTable columns={1} rows={[
        { label: 'Arm total, worst case (sum)', value: slop.counted ? u.fu('length', slop.sum, { dp: u.prefs.length === 'in' ? 2 : 3 }) : DASH, note: `${slop.counted} gearbox joint${slop.counted === 1 ? '' : 's'} counted` },
        { label: 'Arm total, RSS', value: slop.counted ? u.fu('length', slop.rss, { dp: u.prefs.length === 'in' ? 2 : 3 }) : DASH, note: 'root-sum-square: the likely spread when the joints are independent' },
      ]} />
      <p className="tol-note muted">Each joint: (Monte Carlo p95 backlash + twist at T_req) × the lever from its axis to the tool tip in the worst-case (straight-out) pose. Servo joints are not modelled.</p>
    </div>
  );
}

export function ArmSlopSummary() {
  const { u } = useStore();
  const { slop } = useArmSlop();
  if (!slop.counted) return <>computing…</>;
  return <>tip {u.fu('length', slop.sum, { dp: 2 })} sum · {u.fu('length', slop.rss, { dp: 2 })} RSS</>;
}
