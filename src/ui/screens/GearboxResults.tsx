import { useEffect, useMemo, useState } from 'react';
import { POLYMER_WARNING_LINES, type Check, type GearboxModel, type GearboxResult } from '../../calc';
import { Icon } from '../components/Icon';
import { Card, Notice, StatusChip, Tile, UtilBar, Button, verdictKind, type StatusKind } from '../components/primitives';
import { checkLimit, checkValue, hours, num, util, DASH } from '../format';
import { PLAIN, verdictHeadline } from '../plain';
import { DiscSvg, ForceLegend } from '../viz/DiscFigure';
import { PinForceChart, SweepChart } from '../viz/Charts';
import { useStore } from '../store';

// ---------------------------------------------------------------------------
// Verdict banner
// ---------------------------------------------------------------------------

export function VerdictBanner({ r }: { r: GearboxResult }) {
  const kind: StatusKind = verdictKind(r.verdict);
  const head = verdictHeadline(r);
  return (
    <div className={`verdict verdict-${kind}`} role="status" aria-live="polite">
      <div className="verdict-badge">
        <Icon name={kind === 'ok' ? 'check-circle' : kind === 'marginal' ? 'alert' : kind === 'fail' ? 'x-circle' : 'info'} size={30} />
        <span className="verdict-word">{head.title}</span>
      </div>
      <div className="verdict-body">
        <p className="verdict-text">{head.text}</p>
        {r.governing && r.verdict !== 'pass' && (
          <p className="verdict-fix">{PLAIN[r.governing.id].fix}</p>
        )}
      </div>
      {r.governing && (
        <div className="verdict-util" aria-label="Maximum utilization">
          <span className="verdict-util-num">{util(r.maxUtilization)}</span>
          <span className="verdict-util-label">max utilization</span>
        </div>
      )}
    </div>
  );
}

export function InvalidCard({ r }: { r: GearboxResult }) {
  return (
    <Notice kind="error" title="These inputs cannot be computed yet">
      <ul className="plain-list">
        {r.errors.slice(0, 5).map((e) => <li key={e}>{e}</li>)}
      </ul>
      <p>Change the highlighted fields on the left. Usually that means a larger D, a smaller e, or smaller pins. Nothing is lost: your other values are kept.</p>
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Key-number tiles
// ---------------------------------------------------------------------------

export function KeyTiles({ r, discs }: { r: GearboxResult; discs: number }) {
  const d = r.derived;
  const k1Ok = d.K1 >= 0.4 && d.K1 <= 0.85;
  return (
    <div className="tiles">
      <Tile label="Ratio" value={`${num(d.ratio, 0)}:1`} sub={`Zp = ${num(d.ratio + 1, 0)}, Zc = ${num(d.Zc, 0)}`} />
      <Tile label="K1" value={num(d.K1, 3)} kind={k1Ok ? undefined : 'marginal'} sub={k1Ok ? 'in the usual 0.40 to 0.85' : 'outside 0.40 to 0.85'} />
      <Tile label="Rw (inner pin circle)" value={num(d.Rw, 1)} unit="mm" sub={d.RwIsOverride ? 'overridden' : 'automatic'} />
      <Tile label="Peak ring pin force" value={num(r.loads.FRingPeak, 0)} unit="N" sub="at T_des" />
      <Tile label="Peak inner pin force" value={num(r.loads.FInnerPeak, 0)} unit="N" sub="at T_des" />
      <Tile label="Peak bearing load" value={num(r.loads.bearingPeak, 0)} unit="N" sub={`static rating ${'≤'} C0`} />
      <Tile label="Bearing life L10h" value={hours(r.loads.L10h)} sub={`at ${num(r.loads.bearingWorking, 0)} N working load`} />
      <Tile label="Disc mass" value={num(r.mass.total_g, 0)} unit="g" sub={discs > 1 ? `${discs} discs, ${num(r.mass.perDisc_g, 0)} g each` : '1 disc'} />
      <Tile label="Housing OD" value={num(d.housingOD, 1)} unit="mm" sub={'D + 2·rr + 2·wall'} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Polymer warning
// ---------------------------------------------------------------------------

export function PolymerCard() {
  return (
    <Notice kind="warning" title="Polymer part: read this before trusting the numbers">
      <ul className="plain-list">
        {POLYMER_WARNING_LINES.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <p>This is a warning, not a failed check.</p>
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Check cards
// ---------------------------------------------------------------------------

const STATUS_TEXT: Record<Check['status'], string> = { ok: 'OK', marginal: 'Marginal', fail: 'Over limit' };

function CheckCard({ c, governing }: { c: Check; governing: boolean }) {
  const kind = c.status as StatusKind;
  const value =
    c.id === 'cusp' && !Number.isFinite(c.value)
      ? { main: DASH, note: 'no convex lobe to measure' }
      : { main: checkValue(c.id, c.value, c.unit), note: '' };
  return (
    <div className={`check check-${kind}${governing ? ' is-governing' : ''}`}>
      <div className="check-top">
        <h4 className="check-name">{c.label}</h4>
        <StatusChip kind={kind} size="sm">{STATUS_TEXT[c.status]}</StatusChip>
      </div>
      <div className="check-values">
        <span className="check-value">{value.main}</span>
        <span className="check-limit">{checkLimit(c.id, c.limit, c.unit, c.kind)}</span>
      </div>
      <UtilBar value={c.utilization} kind={kind} label={`Utilization ${util(c.utilization)}`} />
      <div className="check-foot">
        <span className="check-util">utilization <strong>{util(c.utilization)}</strong></span>
        {governing && <span className="check-gov">governing</span>}
      </div>
      <p className="check-basis">{value.note || c.basis}</p>
      {c.info && c.id === 'boltBending' && (
        <p className="check-info">Fixed-fixed {num(c.info.fixedFixed, 0)} MPa, simply supported {num(c.info.simplySupported, 0)} MPa (used).</p>
      )}
      {c.info && c.id === 'standoffBending' && (
        <p className="check-info">Tie ring {num(c.info.tieRing, 0)} MPa (used), cantilever {num(c.info.cantilever, 0)} MPa.</p>
      )}
    </div>
  );
}

export function CheckCards({ r }: { r: GearboxResult }) {
  return (
    <Card title="Checks" subtitle={'Green up to 0.85, amber up to 1.00, red above. Bars end at 1.2; ticks mark 0.85 and 1.00.'}>
      <div className="checks">
        {r.checks.map((c) => (
          <CheckCard key={c.id} c={c} governing={r.governing?.id === c.id} />
        ))}
      </div>
      {r.warnings.length > 0 && (
        <ul className="plain-list warn-list">
          {r.warnings.map((w) => <li key={w}><Icon name="alert" size={14} /> {w}</li>)}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Disc drawing + charts (share one input angle)
// ---------------------------------------------------------------------------

export function DiscAndCharts({ model }: { model: GearboxModel }) {
  const { resolvedTheme } = useStore();
  const r = model.result;
  const [deg, setDeg] = useState(0);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const tick = (t: number) => {
      const dt = Math.min(0.1, (t - last) / 1000);
      last = t;
      setDeg((d) => (d + dt * 60) % 360);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const theta = (deg * Math.PI) / 180;
  const drawing = useMemo(() => model.drawingAt(theta, 600), [model, theta]);
  const pins = useMemo(() => model.pinsAt(theta), [model, theta]);
  const peak = Math.max(r.loads.FRingPeak, drawing?.maxForce ?? 0);
  const Rp = r.derived.Rp;
  const rr = model.inputs.rr;

  return (
    <>
      <Card
        title="Disc at input angle θ"
        subtitle="Ring frame. The disc rotates by −θ/Zc and sits eccentrically by e."
      >
        <div className="disc-layout">
          <div className="disc-fig">
            <DiscSvg drawing={drawing} peak={peak} theme={resolvedTheme} Rp={Rp} rr={rr} />
          </div>
          <div className="disc-side">
            <div className="slider-row">
              <Button
                variant="secondary"
                size="md"
                icon={playing ? 'pause' : 'play'}
                onClick={() => setPlaying((p) => !p)}
                aria-pressed={playing}
                aria-label={playing ? 'Pause animation' : 'Play animation'}
              >
                {playing ? 'Pause' : 'Play'}
              </Button>
              <div className="theta-read" aria-hidden="true">{'θ'} = {num(deg, 0)}{'°'}</div>
            </div>
            <label className="slider">
              <span className="visually-hidden">Input angle theta in degrees</span>
              <input
                type="range"
                min={0}
                max={360}
                step={1}
                value={Math.round(deg)}
                onChange={(e) => { setPlaying(false); setDeg(Number(e.target.value) % 360); }}
                aria-valuetext={`${num(deg, 0)} degrees`}
              />
            </label>
            <ForceLegend peak={peak} theme={resolvedTheme} />
            <dl className="mini-stats">
              <div><dt>Loaded outer pins</dt><dd>{pins ? pins.filter((p) => p.loaded).length : DASH} of {pins?.length ?? DASH}</dd></div>
              <div><dt>Largest pin force now</dt><dd>{drawing ? `${num(drawing.maxForce, 0)} N` : DASH}</dd></div>
              <div><dt>Eccentric e</dt><dd>{num(model.inputs.e, 2)} mm</dd></div>
            </dl>
          </div>
        </div>
      </Card>

      <Card title="Force on each outer pin" subtitle={`At θ = ${num(deg, 0)}°, design torque`}>
        <PinForceChart pins={pins} peak={peak} theme={resolvedTheme} thetaDeg={deg} />
      </Card>

      <Card
        title="Peak ring contact pressure over one revolution"
        subtitle="Max p0 over all pins against the input angle. Click or drag on the chart to move θ."
      >
        <SweepChart sweep={r.sweep} thetaDeg={deg} onTheta={(d) => { setPlaying(false); setDeg(d); }} />
      </Card>
    </>
  );
}
