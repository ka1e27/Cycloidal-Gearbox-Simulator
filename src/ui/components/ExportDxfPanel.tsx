import { useEffect, useMemo, useState } from 'react';
import type { GearboxInputs, GearboxModel } from '../../calc';
import { downloadTextFile } from '../../export/download';
import {
  DEFAULT_EXPORT_OPTIONS,
  buildDxf,
  buildParts,
  normalizeExportOptions,
  validateExportOptions,
  type ExportOptions,
  type ExportTarget,
  type PartDrawing,
} from '../../export/parts';
import { DXF_HELP } from '../help';
import { useStore } from '../store';
import { NumberField } from './NumberField';
import { Advanced, Button, Card, FieldRow, Notice, Segmented } from './primitives';
import { InfoTip } from './InfoTip';
import '../../styles/export.css';

const STORAGE_KEY = 'cycloid-calc-dxf-options-v1';

/** Allowances survive a reload (units do not: they follow the app's length unit). */
function loadOptions(): ExportOptions {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeExportOptions(JSON.parse(raw));
  } catch {
    /* private window, blocked storage or bad JSON: use the defaults */
  }
  return { ...DEFAULT_EXPORT_OPTIONS };
}

function saveOptions(o: ExportOptions): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(o));
  } catch {
    /* ignore */
  }
}

const PART_BLURB: Record<string, string> = {
  disc: 'Profile, centre bore and inner pin holes',
  housing: 'Outline and outer pin holes',
  outputPlate: 'Outline and inner pin holes',
  cam: 'Shaft hole and offset bearing circle',
  pins: 'Bushing, bolt and standoff sections',
};

/**
 * "Export DXF" card for one gearbox: per-part downloads, an all-parts sheet and the manufacturing allowances.
 * Takes the gearbox inputs as a prop so the Gearbox page and the Design Advisor can both use it.
 *
 * - `label` appears in file names and on the drawing notes (e.g. "J3"); it defaults to "custom".
 * - `model` is optional: pass an already-built `createGearboxModel(inputs)` to skip rebuilding it.
 */
export function ExportDxfPanel({
  inputs,
  label = 'custom',
  model,
  title = 'Export DXF',
}: {
  inputs: GearboxInputs;
  label?: string;
  model?: GearboxModel;
  title?: string;
}) {
  const { u, notify } = useStore();
  const appUnit = u.prefs.length;
  const [opts, setOpts] = useState<ExportOptions>(() => ({ ...loadOptions(), units: appUnit }));

  // follow the app's length unit when it changes
  useEffect(() => {
    setOpts((o) => (o.units === appUnit ? o : { ...o, units: appUnit }));
  }, [appUnit]);

  const patch = (p: Partial<ExportOptions>) =>
    setOpts((o) => {
      const n = { ...o, ...p };
      saveOptions(n);
      return n;
    });

  const fieldErrors = useMemo(() => validateExportOptions(opts), [opts]);
  const hasFieldErrors = Object.keys(fieldErrors).length > 0;
  // fall back to defaults for the geometry while a typed allowance is invalid, so the card never goes blank
  const usable = hasFieldErrors ? { ...DEFAULT_EXPORT_OPTIONS, units: opts.units } : opts;
  const res = useMemo(() => buildParts(inputs, usable, label, model), [inputs, usable, label, model]);

  const download = (target: ExportTarget) => {
    if (!res.ok || hasFieldErrors) return;
    try {
      const built = buildDxf(res, target, usable);
      downloadTextFile(built.filename, built.text);
      notify('success', `Saved ${built.filename}`);
    } catch (err) {
      notify('error', `Could not write the DXF: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const modified = JSON.stringify({ ...opts, units: 0 }) !== JSON.stringify({ ...DEFAULT_EXPORT_OPTIONS, units: 0 });
  const info = res.info;
  const disabled = !res.ok || hasFieldErrors;
  const byId = (id: string): PartDrawing | undefined => res.parts.find((p) => p.id === id);

  return (
    <Card
      title={title}
      id="export-dxf"
      className="dxf-card"
      subtitle="Manufacturing files for waterjet, laser or CNC, as ASCII DXF R12: closed polylines and true circles, one layer per part. Labels sit on a NOTES layer you can switch off."
    >
      <div className="dxf-units">
        <span className="dxf-units-label">
          Units
          <InfoTip help={DXF_HELP.units} label="DXF units" />
        </span>
        <Segmented
          label="DXF units"
          size="sm"
          value={opts.units}
          onChange={(v) => patch({ units: v })}
          options={[{ value: 'mm', label: 'mm' }, { value: 'in', label: 'inches' }]}
        />
      </div>

      {!res.ok && (
        <Notice kind="error" title="Nothing to export yet">
          <ul className="plain-list">
            {res.errors.slice(0, 4).map((e) => <li key={e}>{u.text(e)}</li>)}
          </ul>
        </Notice>
      )}
      {hasFieldErrors && res.ok && (
        <Notice kind="warning" title="Fix the manufacturing allowances first">
          <ul className="plain-list">
            {Object.values(fieldErrors).slice(0, 4).map((e) => <li key={e}>{e}</li>)}
          </ul>
        </Notice>
      )}

      <ul className="dxf-parts" aria-label="Parts to export">
        {(['disc', 'housing', 'outputPlate', 'cam', 'pins'] as const).map((id) => {
          const p = byId(id);
          return (
            <li key={id} className="dxf-part">
              <div className="dxf-part-text">
                <strong className="dxf-part-name">{p?.title ?? id}</strong>
                <span className="dxf-part-sub">
                  {PART_BLURB[id]}
                  {p && <span className="dxf-qty"> · make {p.id === 'pins' ? `${inputs.Zp} + ${inputs.Zp} + ${inputs.Zw}` : p.quantity}</span>}
                </span>
              </div>
              <Button
                variant="secondary"
                size="sm"
                icon="download"
                disabled={disabled}
                onClick={() => download(id)}
                aria-label={`Download ${p?.title ?? id} as DXF`}
              >
                DXF
              </Button>
            </li>
          );
        })}
        <li className="dxf-part dxf-part-all">
          <div className="dxf-part-text">
            <strong className="dxf-part-name">All parts (one DXF)</strong>
            <span className="dxf-part-sub">Every part laid out without overlap, one layer each</span>
          </div>
          <Button variant="primary" size="sm" icon="download" disabled={disabled} onClick={() => download('all')}>
            All parts
          </Button>
        </li>
      </ul>

      {res.ok && info && (
        <p className="dxf-facts">
          Disc outline: {info.pointCount} points ({info.pointsPerLobe} per lobe), chord error {u.fu('length', info.chordError, { dp: 3 })}, offset {u.fu('length', info.profileOffset, { dp: 3 })} from the pin-centre path.
        </p>
      )}

      {res.warnings.length > 0 && (
        <Notice kind="warning" title={res.warnings.length === 1 ? 'Check this before cutting' : 'Check these before cutting'}>
          <ul className="plain-list">
            {res.warnings.map((w) => <li key={w}>{u.text(w)}</li>)}
          </ul>
        </Notice>
      )}

      <Advanced label={`Manufacturing allowances${modified ? ' (changed)' : ''}`}>
        <NumberField
          label="Profile clearance"
          symbol="c"
          quantity="length"
          value={opts.profileClearance}
          onChange={(v) => patch({ profileClearance: v ?? 0 })}
          defaultValue={DEFAULT_EXPORT_OPTIONS.profileClearance}
          step={0.01}
          help={DXF_HELP.profileClearance}
          error={fieldErrors.profileClearance}
          note="Positive shrinks the disc (offset = rr + c)"
        />
        <FieldRow label="Outline resolution" help={DXF_HELP.resolution} stacked>
          <Segmented
            label="Outline resolution mode"
            size="sm"
            fullWidth
            value={opts.pointsPerLobe == null ? 'chord' : 'points'}
            onChange={(v) => patch({ pointsPerLobe: v === 'points' ? (info?.pointsPerLobe ?? 120) : null })}
            options={[{ value: 'points', label: 'Points per lobe' }, { value: 'chord', label: 'Max chord error' }]}
          />
        </FieldRow>
        {opts.pointsPerLobe != null ? (
          <NumberField
            label="Points per lobe"
            unit="pts"
            help={DXF_HELP.resolution}
            value={opts.pointsPerLobe}
            onChange={(v) => patch({ pointsPerLobe: v ?? 120 })}
            defaultValue={DEFAULT_EXPORT_OPTIONS.pointsPerLobe}
            step={10}
            error={fieldErrors.pointsPerLobe}
          />
        ) : (
          <NumberField
            label="Max chord error"
            quantity="length"
            help={DXF_HELP.resolution}
            value={opts.maxChordError}
            onChange={(v) => patch({ maxChordError: v ?? DEFAULT_EXPORT_OPTIONS.maxChordError })}
            defaultValue={DEFAULT_EXPORT_OPTIONS.maxChordError}
            step={0.001}
            error={fieldErrors.maxChordError}
          />
        )}
        <NumberField
          label="Disc bore and hole clearance"
          quantity="length"
          value={opts.discHoleClearance}
          onChange={(v) => patch({ discHoleClearance: v ?? 0 })}
          defaultValue={DEFAULT_EXPORT_OPTIONS.discHoleClearance}
          step={0.01}
          help={DXF_HELP.discHoleClearance}
          error={fieldErrors.discHoleClearance}
        />
        <NumberField
          label="Pin hole clearance"
          quantity="length"
          value={opts.pinHoleClearance}
          onChange={(v) => patch({ pinHoleClearance: v ?? 0 })}
          defaultValue={DEFAULT_EXPORT_OPTIONS.pinHoleClearance}
          step={0.05}
          help={DXF_HELP.pinHoleClearance}
          error={fieldErrors.pinHoleClearance}
        />
        <NumberField
          label="Cam shaft diameter"
          quantity="length"
          value={opts.shaftDia}
          onChange={(v) => patch({ shaftDia: v ?? DEFAULT_EXPORT_OPTIONS.shaftDia })}
          defaultValue={DEFAULT_EXPORT_OPTIONS.shaftDia}
          step={0.5}
          help={DXF_HELP.shaftDia}
          error={fieldErrors.shaftDia}
        />
        <NumberField
          label="Bearing inner diameter"
          quantity="length"
          nullable
          value={opts.bearingBore}
          onChange={(v) => patch({ bearingBore: v })}
          defaultValue={null}
          step={0.5}
          placeholder="from catalog"
          help={DXF_HELP.bearingBore}
          error={fieldErrors.bearingBore}
        />
        <NumberField
          label="Output plate outline diameter"
          quantity="length"
          nullable
          value={opts.plateOutlineDia}
          onChange={(v) => patch({ plateOutlineDia: v })}
          defaultValue={null}
          step={1}
          placeholder="auto"
          help={DXF_HELP.plateOutline}
          error={fieldErrors.plateOutlineDia}
        />
        <div className="dxf-toggle">
          <label className="dxf-check">
            <input type="checkbox" checked={opts.housingCentreHole} onChange={(e) => patch({ housingCentreHole: e.target.checked })} />
            <span>Centre hole in housing plate</span>
          </label>
          <InfoTip help={DXF_HELP.housingCentre} label="housing centre hole" />
        </div>
        {opts.housingCentreHole && (
          <NumberField
            label="Housing centre hole diameter"
            quantity="length"
            help={DXF_HELP.housingCentre}
            value={opts.housingCentreDia}
            onChange={(v) => patch({ housingCentreDia: v ?? DEFAULT_EXPORT_OPTIONS.housingCentreDia })}
            defaultValue={DEFAULT_EXPORT_OPTIONS.housingCentreDia}
            step={1}
            error={fieldErrors.housingCentreDia}
          />
        )}
        <div className="dxf-toggle">
          <label className="dxf-check">
            <input type="checkbox" checked={opts.outputCentreHole} onChange={(e) => patch({ outputCentreHole: e.target.checked })} />
            <span>Centre hole in output / tie plate</span>
          </label>
          <InfoTip help={DXF_HELP.outputCentre} label="output plate centre hole" />
        </div>
        {opts.outputCentreHole && (
          <NumberField
            label="Output plate centre hole diameter"
            quantity="length"
            help={DXF_HELP.outputCentre}
            value={opts.outputCentreDia}
            onChange={(v) => patch({ outputCentreDia: v ?? DEFAULT_EXPORT_OPTIONS.outputCentreDia })}
            defaultValue={DEFAULT_EXPORT_OPTIONS.outputCentreDia}
            step={1}
            error={fieldErrors.outputCentreDia}
          />
        )}
        {modified && (
          <div className="dxf-reset">
            <Button variant="ghost" size="sm" icon="reset" onClick={() => patch({ ...DEFAULT_EXPORT_OPTIONS, units: opts.units })}>
              Reset allowances
            </Button>
          </div>
        )}
      </Advanced>
    </Card>
  );
}
