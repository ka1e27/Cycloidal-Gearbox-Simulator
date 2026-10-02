// One joint's pose angle slider plus a compact "Limits" disclosure (min / max angle, degrees). Used in the selected
// joint's "Joint & link" section and in the 3D stage's "All angles" popover (CLAUDE.md Additions 9 and 10).
import { useEffect, useState } from 'react';
import { MOTION_LABEL, hasLimits, jointLimits, validateJointLimits, type ArmJoint } from '../../calc';
import { Button } from '../components/primitives';

const fmtDeg = (x: number) => `${Math.round(x * 10) / 10}°`;

export function JointSlider({ joint: j, index: i, uid, angle, atStop, onAngle, onLimits, label }: {
  joint: ArmJoint; index: number; uid: string; angle: number; atStop: 'min' | 'max' | null;
  onAngle: (deg: number) => void; onLimits: (l: { min: number; max: number } | undefined) => void;
  /** Replaces the "J2 shoulder · Pitch" label (e.g. "Pose angle" in the inspector) */
  label?: string;
}) {
  const id = `${uid}-q-${j.id}`;
  const L = jointLimits(j);
  const limited = hasLimits(j);
  const deg = Math.round(angle);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ min: String(L.min), max: String(L.max) });
  useEffect(() => { setDraft({ min: String(L.min), max: String(L.max) }); }, [L.min, L.max]);
  const nmin = draft.min.trim() === '' ? NaN : Number(draft.min);
  const nmax = draft.max.trim() === '' ? NaN : Number(draft.max);
  const err = validateJointLimits(nmin, nmax);
  const commit = (mn: string, mx: string) => {
    setDraft({ min: mn, max: mx });
    const a = mn.trim() === '' ? NaN : Number(mn);
    const b = mx.trim() === '' ? NaN : Number(mx);
    if (validateJointLimits(a, b) === null) onLimits(a === -180 && b === 180 ? undefined : { min: a, max: b });
  };
  const pid = `${id}-lim`;
  return (
    <div className={`pz-slider${atStop ? ' is-stop' : ''}`}>
      <label htmlFor={id} className="pz-slider-label">
        {label ? <span className="strong">{label}</span> : (
          <>
            <span className="mono strong">J{i + 1}</span>{' '}
            <span className="pz-slider-name">{j.name.trim() || MOTION_LABEL[j.motion].toLowerCase()}</span>
            <small className="muted"> · {MOTION_LABEL[j.motion]}{j.drive === 'servo' ? ' · servo' : ''}</small>
          </>
        )}
      </label>
      <output htmlFor={id} className="pz-slider-val mono">{deg}°{atStop && <span className="pz-stoptag"> limit</span>}</output>
      <input id={id} type="range" min={Math.ceil(L.min)} max={Math.floor(L.max)} step={1} value={Math.min(Math.floor(L.max), Math.max(Math.ceil(L.min), deg))}
        aria-valuetext={`${deg} degrees${limited ? `, limits ${L.min} to ${L.max}` : ''}`}
        onChange={(e) => onAngle(Number(e.target.value))} />
      <button type="button" className="pz-limbtn" aria-expanded={open} aria-controls={pid} onClick={() => setOpen((o) => !o)}>
        Limits <span className="mono">{limited ? `${fmtDeg(L.min)} … ${fmtDeg(L.max)}` : '±180°'}</span>
      </button>
      {open && (
        <div className="pz-limits" id={pid}>
          <label className="pz-limfield">
            <span>Min</span>
            <input className="nf-input" type="number" inputMode="decimal" step={1} min={-180} max={180} value={draft.min}
              aria-invalid={!!err} aria-label={`Minimum angle of J${i + 1}, degrees`} onChange={(e) => commit(e.target.value, draft.max)} />
            <span className="nf-unit">°</span>
          </label>
          <label className="pz-limfield">
            <span>Max</span>
            <input className="nf-input" type="number" inputMode="decimal" step={1} min={-180} max={180} value={draft.max}
              aria-invalid={!!err} aria-label={`Maximum angle of J${i + 1}, degrees`} onChange={(e) => commit(draft.min, e.target.value)} />
            <span className="nf-unit">°</span>
          </label>
          <Button size="sm" variant="ghost" disabled={!limited && !err} onClick={() => commit('-180', '180')}>Clear</Button>
          {err && <p className="pz-limerr small" role="alert">{err}</p>}
        </div>
      )}
    </div>
  );
}
