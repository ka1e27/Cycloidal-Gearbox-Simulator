// Disc drawing and the two SPEC charts (they share one input angle θ), as the Disc stage and as a small preview in the
// inspector's "Disc & charts" section (CLAUDE.md Addition 10). Lazy chunk.
import { useMemo } from 'react';
import type { GearboxModel } from '../../calc';
import { Button, Card, DataTable } from '../components/primitives';
import { DASH, num } from '../format';
import { useStore } from '../store';
import { DiscSvg, ForceLegend } from '../viz/DiscFigure';
import { PinForceChart, SweepChart } from '../viz/Charts';
import { useDiscTheta } from './discTheta';

function useDiscAt(model: GearboxModel, deg: number, n = 600) {
  const theta = (deg * Math.PI) / 180;
  const drawing = useMemo(() => model.drawingAt(theta, n), [model, theta, n]);
  const pins = useMemo(() => model.pinsAt(theta), [model, theta]);
  const peak = Math.max(model.result.loads.FRingPeak, drawing?.maxForce ?? 0);
  return { drawing, pins, peak };
}

function ThetaControls({ id }: { id: string }) {
  const { deg, setDeg, playing, setPlaying } = useDiscTheta();
  return (
    <>
      <div className="slider-row">
        <Button variant="secondary" size="md" icon={playing ? 'pause' : 'play'} onClick={() => setPlaying((p) => !p)}
          aria-pressed={playing} aria-label={playing ? 'Pause animation' : 'Play animation'}>
          {playing ? 'Pause' : 'Play'}
        </Button>
        <div className="theta-read" aria-hidden="true">θ = {num(deg, 0)}°</div>
      </div>
      <label className="slider" htmlFor={id}>
        <span className="visually-hidden">Input angle theta in degrees</span>
        <input id={id} type="range" min={0} max={360} step={1} value={Math.round(deg)}
          onChange={(e) => { setPlaying(false); setDeg(Number(e.target.value) % 360); }}
          aria-valuetext={`${num(deg, 0)} degrees`} />
      </label>
    </>
  );
}

/** Disc at θ, the θ slider and Play, then the pin-force and sweep charts. `layout` 'stage' puts the charts beside the disc. */
export function DiscAndCharts({ model, layout = 'cards' }: { model: GearboxModel; layout?: 'cards' | 'stage' }) {
  const { resolvedTheme, u } = useStore();
  const { deg, setDeg, setPlaying } = useDiscTheta();
  const r = model.result;
  const { drawing, pins, peak } = useDiscAt(model, deg);
  const Rp = r.derived.Rp;
  const rr = model.inputs.rr;

  return (
    <div className={`disc-and-charts is-${layout}`}>
      <Card title="Disc at input angle θ" subtitle="Ring frame. The disc turns by −θ/Zc and sits off-centre by the eccentricity e." className="dac-disc">
        <div className="disc-layout">
          <div className="disc-fig">
            <DiscSvg drawing={drawing} peak={peak} theme={resolvedTheme} Rp={Rp} rr={rr} />
          </div>
          <div className="disc-side">
            <ThetaControls id={`theta-${layout}`} />
            <ForceLegend peak={peak} theme={resolvedTheme} />
            <DataTable
              columns={1}
              rows={[
                { label: 'Loaded outer pins', value: `${pins ? pins.filter((p) => p.loaded).length : DASH} of ${pins?.length ?? DASH}` },
                { label: 'Largest pin force now', value: drawing ? u.fu('force', drawing.maxForce, { dp: 0 }) : DASH },
                { label: 'Eccentricity e', value: u.fu('length', model.inputs.e, { dp: 3 }) },
              ]}
            />
          </div>
        </div>
      </Card>
      <div className="dac-charts">
        <Card title="Force on each outer pin" subtitle={`At θ = ${num(deg, 0)}°, design torque. Pins are numbered around the ring.`}>
          <PinForceChart pins={pins} peak={peak} theme={resolvedTheme} thetaDeg={deg} />
        </Card>
        <Card
          title="Peak ring contact pressure over one revolution"
          subtitle="Highest contact pressure over all pins against the input angle. Click or drag the chart to move θ."
        >
          <SweepChart sweep={r.sweep} thetaDeg={deg} onTheta={(d) => { setPlaying(false); setDeg(d); }} />
        </Card>
      </div>
    </div>
  );
}

/** Inspector preview: a small disc at the shared θ, the slider, and "Open in stage". */
export function DiscPreview({ model, onOpenStage }: { model: GearboxModel; onOpenStage: () => void }) {
  const { resolvedTheme, u } = useStore();
  const { deg } = useDiscTheta();
  const { drawing, pins, peak } = useDiscAt(model, deg, 360);
  if (!model.result.valid) return <p className="muted small">{DASH} fix the gearbox inputs to see the disc.</p>;
  return (
    <div className="disc-preview">
      <div className="disc-preview-fig">
        <DiscSvg drawing={drawing} peak={peak} theme={resolvedTheme} Rp={model.result.derived.Rp} rr={model.inputs.rr} size={200}
          label={`Disc at input angle ${Math.round(deg)} degrees`} />
      </div>
      <div className="disc-preview-side">
        <ThetaControls id="theta-insp" />
        <p className="small muted">
          {pins ? pins.filter((p) => p.loaded).length : DASH} of {pins?.length ?? DASH} pins loaded · largest {drawing ? u.fu('force', drawing.maxForce, { dp: 0 }) : DASH}
        </p>
        <Button size="sm" variant="primary" iconAfter="arrow" onClick={onOpenStage}>Open in stage</Button>
        <p className="small muted">The stage shows the disc large with the pin-force and contact-pressure charts.</p>
      </div>
    </div>
  );
}
