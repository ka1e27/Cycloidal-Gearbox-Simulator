import { useEffect, useMemo, useRef, useState } from 'react';
import { applySolverSolution, getCalcClient, type CalcJob, type GearboxInputs, type SolverResult } from '../../calc';
import { Button, Card, Notice, ProgressBar, StatusChip } from '../components/primitives';
import { fixed } from '../format';
import { useStore } from '../store';
import type { Slot } from '../session';
import { useWidth } from '../viz/useWidth';
import { solverKey } from '../workbench/solverKey';

export { solverKey };


export function Heat({ res, curD, curK1 }: { res: SolverResult; curD: number; curK1: number }) {
  const { u } = useStore();
  const [ref, W] = useWidth<HTMLDivElement>(520);
  const { D, K1, score } = res.grid;
  if (!D.length || !K1.length) return null;
  const m = { l: 40, r: 8, t: 8, b: 30 };
  const iw = W - m.l - m.r;
  const cw = iw / D.length;
  const rows = K1.length;
  const ch = Math.max(8, Math.min(14, 200 / rows));
  const ih = ch * rows;
  const H = ih + m.t + m.b;
  // Axis ticks in the display unit: the smallest tidy step that gives at most 6 ticks (the swept range
  // shrinks to a few tens of mm when a solution is found early, so a fixed 20 mm / 1 in step could leave one tick).
  const lo = u.toDisplay('length', D[0]);
  const hi = u.toDisplay('length', D[D.length - 1]);
  const count = (s: number) => Math.floor(hi / s + 1e-9) - Math.ceil(lo / s - 1e-9) + 1;
  const step = [0.1, 0.2, 0.25, 0.5, 1, 2, 5, 10, 20, 25, 50, 100].find((s) => count(s) <= 6) ?? 100;
  const dTicks: { mm: number; label: string }[] = [];
  for (let k = Math.ceil(lo / step - 1e-9); k * step <= hi + 1e-9; k++) {
    const v = k * step;
    dTicks.push({ mm: u.fromDisplay('length', v), label: String(parseFloat(v.toFixed(2))) });
  }
  const cls = (s: number | null) => (s == null ? 'hm-none' : s <= 0.85 ? 'hm-ok' : s <= 1 ? 'hm-marginal' : 'hm-fail');
  const x = (d: number) => m.l + ((d - D[0]) / (D[D.length - 1] - D[0] || 1)) * (iw - cw) + cw / 2;
  const y = (k: number) => m.t + ih - ((k - K1[0]) / (K1[K1.length - 1] - K1[0] || 1)) * (ih - ch) - ch / 2;
  return (
    <div ref={ref} className="chart">
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img"
        aria-label="Map of contact utilization over pin circle diameter and K1. Green cells pass with margin, amber are marginal, red fail, grey are geometrically impossible.">
        {score.map((row, i) =>
          row.map((s, j) => (
            <rect key={`${i}-${j}`} className={cls(s)} x={m.l + i * cw} y={m.t + ih - (j + 1) * ch} width={Math.ceil(cw) + 0.5} height={ch + 0.5}>
              <title>{`D ${u.fu('length', D[i], { dp: 0 })}, K1 ${K1[j].toFixed(3)}: ${s == null ? 'not feasible' : `score ${s.toFixed(2)}`}`}</title>
            </rect>
          )),
        )}
        {dTicks.map((t) => (
          <text key={t.label} className="ch-axis" x={x(t.mm)} y={H - 14} textAnchor="middle">{t.label}</text>
        ))}
        <text className="ch-axis" x={m.l + iw / 2} y={H - 1} textAnchor="middle">D, {u.sym('length')}</text>
        {[0.4, 0.6, 0.85].map((k) => (
          <text key={k} className="ch-axis" x={m.l - 5} y={y(k) + 4} textAnchor="end">{k.toFixed(2)}</text>
        ))}
        {curD >= D[0] && curD <= D[D.length - 1] && curK1 >= K1[0] - 0.05 && curK1 <= K1[K1.length - 1] + 0.05 && (
          <circle className="hm-cur" cx={x(curD)} cy={y(Math.min(K1[K1.length - 1], Math.max(K1[0], curK1)))} r={5} />
        )}
        {res.minD != null && res.bestK1 != null && (
          <path className="hm-best" d={`M${x(res.minD)} ${y(res.bestK1) - 7} l6 6 l-6 6 l-6 -6 z`} />
        )}
      </svg>
      <div className="ch-legend">
        <span><i className="hm-swatch hm-ok" /> {'≤'} 0.85</span>
        <span><i className="hm-swatch hm-marginal" /> {'≤'} 1.00</span>
        <span><i className="hm-swatch hm-fail" /> over</span>
        <span><i className="hm-swatch hm-none" /> not feasible</span>
        <span><i className="hm-mark" /> current</span>
        <span><i className="hm-mark is-best" /> smallest passing</span>
      </div>
    </div>
  );
}

export function SolverPanel({ slot, eff, K1 }: { slot: Slot; eff: GearboxInputs; K1: number }) {
  const { updateGearbox, notify, u, solverMemo, rememberSolver } = useStore();
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  // the last result of this slot lives in the store, so it survives collapsing the section or switching joints
  const memo = solverMemo[slot] ?? null;
  const res = memo?.res ?? null;
  const key = memo?.key ?? '';
  const job = useRef<CalcJob<SolverResult> | null>(null);

  useEffect(() => () => { job.current?.cancel(); }, []);

  const run = () => {
    job.current?.cancel();
    setRunning(true);
    setProgress(0);
    const k = solverKey(eff);
    const j = getCalcClient().solve(eff, {}, (p) => { if (job.current === j) setProgress(p.fraction); });
    job.current = j;
    void j.promise.then((r) => {
      if (job.current !== j) return;
      job.current = null;
      setRunning(false);
      if (r.cancelled) return;
      rememberSolver(slot, r, k);
    });
  };
  const cancel = () => {
    job.current?.cancel();
    job.current = null;
    setRunning(false);
  };

  const stale = res != null && key !== solverKey(eff);
  const canApply = res && !res.noSolution && res.minD != null && res.bestE != null && res.valid;
  const housing = useMemo(() => (res?.minD != null ? res.minD + 2 * eff.rr + 2 * eff.wall : null), [res, eff.rr, eff.wall]);

  return (
    <Card
      title="Minimum-size solver"
      subtitle={u.text('Sweeps D from 30 to 120 mm and K1 from 0.40 to 0.85 for your current loads and materials, and finds the smallest D whose contact checks all pass (score ≤ 1).')}
      actions={
        running ? (
          <Button variant="secondary" size="sm" onClick={cancel}>Cancel</Button>
        ) : (
          <Button variant="primary" size="sm" onClick={run}>{res ? 'Run again' : 'Find minimum size'}</Button>
        )
      }
    >
      {running && <ProgressBar fraction={progress} label="Solver progress" />}
      {!res && !running && (
        <p className="muted">
          Press <strong>Find minimum size</strong>. It takes well under a second and never changes your inputs until you press Apply.
        </p>
      )}
      {res && !res.valid && (
        <Notice kind="error" title="The solver could not run">
          {u.text(res.errors[0] ?? 'Check the inputs on the left.')}
        </Notice>
      )}
      {res && res.valid && (
        <div className={`solver-out${stale ? ' is-stale' : ''}`}>
          {stale && <Notice kind="info" title="Inputs changed since this run">Press Run again to refresh the result.</Notice>}
          {res.noSolution ? (
            <Notice kind="warning" title={`No solution up to D = ${u.fu('length', res.Dmax, { dp: 0 })}`}>
              {res.floorD != null
                ? `The smallest geometrically possible D is ${u.fu('length', res.floorD, { dp: 0 })}, but the contact stress is too high at every size. `
                : 'No geometrically possible size was found with these pins and bore. '}
              Try two discs, a thicker disc, a stronger disc material, larger pins, or lower loads.
            </Notice>
          ) : (
            <div className="solver-hero">
              <div>
                <div className="solver-big">D = {u.f('length', res.minD, { dp: 0 })} <span>{u.sym('length')}</span></div>
                <div className="solver-sub">
                  e = {u.fu('length', res.bestE, { dp: 3 })} {'·'} K1 = {fixed(res.bestK1, 3)} {'·'} housing OD {u.fu('length', housing, { dp: 1, trim: true })}
                </div>
              </div>
              <div className="solver-side">
                <StatusChip kind={(res.bestScore ?? 2) <= 0.85 ? 'ok' : (res.bestScore ?? 2) <= 1 ? 'marginal' : 'fail'} size="sm">
                  contact score {fixed(res.bestScore, 2)}
                </StatusChip>
                <span className="muted small">geometric floor {res.floorD != null ? u.fu('length', res.floorD, { dp: 0 }) : '—'}</span>
              </div>
            </div>
          )}
          {canApply && (
            <div className="solver-actions">
              <Button
                variant="primary"
                onClick={() => {
                  updateGearbox(slot, (g) => applySolverSolution(g, res.minD as number, res.bestE as number));
                  notify('success', `Applied D = ${u.fu('length', res.minD, { dp: 0 })}, e = ${u.fu('length', res.bestE, { dp: 3 })} to ${slot === 'custom' ? 'Custom' : slot}.`);
                }}
              >
                Apply to inputs
              </Button>
              <span className="muted small">Sets D and e only. Other inputs stay as they are.</span>
            </div>
          )}
          <Heat res={res} curD={eff.D} curK1={K1} />
          <p className="muted small">Score is the highest of the four contact-stress utilizations; bending and bearing checks are not part of this sweep.</p>
        </div>
      )}
    </Card>
  );
}
