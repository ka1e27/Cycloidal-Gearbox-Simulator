import { useMemo } from 'react';
import {
  BEARINGS,
  BEARING_NOTE,
  DISC_STOCK_METAL,
  DISC_STOCK_POLYMER,
  INNER_PIN_OPTIONS,
  JOINT_IDS,
  JOINT_PRESET_SPECS,
  MATERIALS,
  OUTER_PIN_OPTIONS,
  SPEC_STEEL,
  SUPPLIER_DATA_NOTE,
  materialProps,
  validateGearboxInputs,
  type GearboxInputs,
  type GearboxResult,
  type MaterialProps,
} from '../../calc';
import { Button, Notice, Section, SelectField, Segmented, Switch } from '../components/primitives';
import { NumberField } from '../components/NumberField';
import { HELP } from '../help';
import { num, torque } from '../format';
import { presetFor, type Slot } from '../session';
import { useStore } from '../store';

// ---------------------------------------------------------------------------
// Material picker
// ---------------------------------------------------------------------------

const SPEC_STEEL_ID = 'spec-steel';

function matchesMaterial(a: MaterialProps, b: MaterialProps): boolean {
  return a.E === b.E && a.nu === b.nu && a.Sy === b.Sy && a.sigmaF === b.sigmaF && a.density === b.density && a.kind === b.kind;
}

function currentMaterialId(m: MaterialProps): string {
  if (matchesMaterial(m, SPEC_STEEL)) return SPEC_STEEL_ID;
  const hit = MATERIALS.find((x) => matchesMaterial(m, x));
  return hit ? hit.id : 'custom';
}

function MaterialPicker({
  label,
  value,
  onChange,
  reference,
  errors,
  errPrefix,
  full,
  help,
}: {
  label: string;
  value: MaterialProps;
  onChange: (m: MaterialProps) => void;
  reference: MaterialProps;
  errors: string[];
  errPrefix: string;
  /** Show Sy, sigma_f, density and kind too (disc and solid pins). Otherwise only E and nu (contact pair). */
  full: boolean;
  help?: (typeof HELP)[string];
}) {
  const id = currentMaterialId(value);
  const lib = MATERIALS.find((m) => m.id === id);
  const err = (key: string) => errors.find((e) => e.startsWith(`${errPrefix}: ${key}`)) ?? null;
  const set = (patch: Partial<MaterialProps>) => onChange({ ...value, ...patch });
  const options = [
    { value: SPEC_STEEL_ID, label: 'Steel, generic (E 200 GPa)' },
    ...MATERIALS.map((m) => ({ value: m.id as string, label: m.name })),
    { value: 'custom', label: 'Custom (edited values)', disabled: id !== 'custom' },
  ];
  const pick = (v: string) => {
    if (v === SPEC_STEEL_ID) onChange({ ...SPEC_STEEL });
    else if (v !== 'custom') onChange(materialProps(v as never));
  };
  return (
    <div className="matpick">
      <SelectField
        label={label}
        value={id}
        onChange={pick}
        options={options}
        help={help}
        note={lib ? lib.note : id === SPEC_STEEL_ID ? 'E 200 GPa, ν 0.30: the SPEC contact pair (E* = 57,259 MPa on 6061-T6).' : 'Edited values. Pick a material to reset them.'}
      />
      <div className="fields fields-tight">
        <NumberField label="E" labelText="Young's modulus" unit="MPa" value={value.E} onChange={(v) => set({ E: v ?? 0 })}
          defaultValue={reference.E} error={err('E ')} help={HELP.E} step={1000} />
        <NumberField label={'ν'} labelText="Poisson's ratio" value={value.nu} onChange={(v) => set({ nu: v ?? 0 })}
          defaultValue={reference.nu} error={err('Poisson')} help={HELP.nu} step={0.01} />
        {full && (
          <>
            <NumberField label="Sy" labelText="Yield strength" unit="MPa" value={value.Sy} onChange={(v) => set({ Sy: v ?? 0 })}
              defaultValue={reference.Sy} error={err('yield')} help={HELP.Sy} step={10} />
            <NumberField label={'σf (10⁷)'} labelText="Fatigue strength" unit="MPa" value={value.sigmaF} onChange={(v) => set({ sigmaF: v ?? 0 })}
              defaultValue={reference.sigmaF} error={err('fatigue')} help={HELP.sigmaF} step={5} />
            <NumberField label="Density" unit={'g/cm³'} value={value.density} onChange={(v) => set({ density: v ?? 0 })}
              defaultValue={reference.density} error={err('density')} help={HELP.density} step={0.1} />
            <div className="nf">
              <div className="nf-head"><span className="nf-label">Type</span></div>
              <Segmented
                size="sm"
                label={`${label} type`}
                value={value.kind}
                onChange={(k) => set({ kind: k })}
                options={[{ value: 'metal', label: 'Metal' }, { value: 'polymer', label: 'Polymer' }]}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

export function GearboxInputsPanel({ slot, eff, result }: { slot: Slot; eff: GearboxInputs; result: GearboxResult }) {
  const { state, arm, updateGearbox, dispatch, setStep, fromArm } = useStore();
  const g = state.gearboxes[slot];
  const ref = useMemo(() => presetFor(slot), [slot]);
  const set = (patch: Partial<GearboxInputs>) => updateGearbox(slot, (x) => ({ ...x, ...patch }));
  const v = useMemo(() => validateGearboxInputs(eff), [eff]);
  const pick = (list: string[], ...prefixes: string[]) => list.find((m) => prefixes.some((p) => m.startsWith(p))) ?? null;
  const E = (...p: string[]) => pick(v.errors, ...p);
  const W = (...p: string[]) => pick(v.warnings, ...p);
  const usedPrefixes = ['Zp ', 'Zw ', 'D ', 'e ', 'L ', 'rr ', 'rw ', 'Db ', 't_min ', 'discs ', 'gap ', 'wall ', 'Rw override', 'K1 ',
    'T_req ', 'T_des ', 'Kc ', 'Kc_life ', 'Input speed', 'Required life', 'Disc share', 'Bearing C', 'Disc material', 'Outer pin material',
    'Inner pin material', 'Bolt ', 'Standoff '];
  const orphan = v.errors.filter((m) => !usedPrefixes.some((p) => m.startsWith(p)));

  const arm_ = slot === 'custom' ? null : arm.joints[JOINT_IDS.indexOf(slot)];
  const fromArmNow = fromArm(slot);
  const toggle = slot === 'custom' ? null : state.useArmLoads[slot];

  // pin size pickers
  const outerMatch = OUTER_PIN_OPTIONS.find((o) => Math.abs(2 * g.rr - o.od) < 1e-9);
  const innerMatch = INNER_PIN_OPTIONS.find((o) => Math.abs(2 * g.rw - o.od) < 1e-9);
  const bearingMatch = BEARINGS.find((b) => b.name === g.bearing.name && b.C === g.bearing.C && b.C0 === g.bearing.C0);
  const stock = g.discMaterial.kind === 'polymer' ? DISC_STOCK_POLYMER : DISC_STOCK_METAL;
  const stockMatch = stock.find((s) => Math.abs(s - g.L) < 1e-9);

  const derived = result.derived;
  const k1Note = Number.isFinite(derived.K1)
    ? `K1 = ${num(derived.K1, 2)} (typical 0.40 to 0.85)${Number.isFinite(derived.Rw) ? `. Rw = ${num(derived.Rw, 1)} mm` : ''}`
    : undefined;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Inputs</h2>
        {slot === 'custom' ? (
          <SelectField
            className="sf-inline"
            label="Copy values from"
            value=""
            onChange={(val) => {
              if (val === 'defaults') updateGearbox('custom', () => structuredClone(presetFor('custom')));
              else if (val) updateGearbox('custom', () => structuredClone(presetFor(val as never)));
            }}
            options={[
              { value: '', label: 'Choose…' },
              ...JOINT_IDS.map((j) => ({ value: j as string, label: JOINT_PRESET_SPECS[j].label })),
              { value: 'defaults', label: 'SPEC defaults' },
            ]}
          />
        ) : (
          <Button size="sm" variant="ghost" icon="reset" onClick={() => updateGearbox(slot, () => structuredClone(ref))}
            disabled={JSON.stringify(g) === JSON.stringify(ref)} title={`Restore the ${JOINT_PRESET_SPECS[slot].label} preset`}>
            Reset to preset
          </Button>
        )}
      </div>

      {orphan.length > 0 && (
        <Notice kind="error" title="This geometry cannot be computed">
          {orphan[0]}. Adjust the highlighted fields.
        </Notice>
      )}

      <Section title="Geometry" summary={`${num(eff.D, 1)} mm, ${eff.discs} disc${eff.discs > 1 ? 's' : ''}`}>
        <div className="fields">
          <NumberField label="Zp outer pins" labelText="Zp" value={g.Zp} onChange={(x) => set({ Zp: x ?? 0 })}
            defaultValue={ref.Zp} error={E('Zp ')} help={HELP.Zp} step={1}
            note={Number.isInteger(g.Zp) && g.Zp >= 8 ? `Ratio ${g.Zp - 1}:1` : undefined} />
          <NumberField label="Zw inner pins" labelText="Zw" value={g.Zw} onChange={(x) => set({ Zw: x ?? 0 })}
            defaultValue={ref.Zw} error={E('Zw ')} help={HELP.Zw} step={1} />
          <NumberField label="D pin circle dia." labelText="D" unit="mm" value={g.D} onChange={(x) => set({ D: x ?? 0 })}
            defaultValue={ref.D} error={E('D ', 'Outer pin circle')} help={HELP.D} step={1} />
          <NumberField label="e eccentricity" labelText="e" unit="mm" value={g.e} onChange={(x) => set({ e: x ?? 0 })}
            defaultValue={ref.e} error={E('e ', 'K1 ')} warning={W('K1 ')} help={HELP.e} step={0.01} note={k1Note} />
          <NumberField label="L disc thickness" labelText="L" unit="mm" value={g.L} onChange={(x) => set({ L: x ?? 0 })}
            defaultValue={ref.L} error={E('L ')} help={HELP.L} step={0.5} />
          <SelectField
            label="Stock thickness"
            value={stockMatch != null ? String(stockMatch) : 'custom'}
            onChange={(val) => { if (val !== 'custom') set({ L: Number(val) }); }}
            options={[
              ...stock.map((s) => ({ value: String(s), label: `${s} mm` })),
              { value: 'custom', label: 'Custom', disabled: stockMatch != null },
            ]}
            note={g.discMaterial.kind === 'polymer' ? 'Printed thicknesses' : 'Plate stock: 1/8, 3/16, 1/4, 3/8, 1/2 in'}
          />
          <div className="nf">
            <div className="nf-head"><span className="nf-label" id="discs-label">Discs</span></div>
            <Segmented
              label="Number of discs"
              value={g.discs}
              onChange={(n) => set({ discs: n })}
              options={[{ value: 1, label: '1 disc' }, { value: 2, label: '2 discs' }]}
            />
            {E('discs ') && <div className="nf-msg is-error">{E('discs ')}</div>}
          </div>
          <NumberField label="rr outer pin radius" labelText="rr" unit="mm" value={g.rr} onChange={(x) => set({ rr: x ?? 0 })}
            defaultValue={ref.rr} error={E('rr ')} warning={W('Neighbouring')} help={HELP.rr} step={0.25} />
          <NumberField label="rw inner pin radius" labelText="rw" unit="mm" value={g.rw} onChange={(x) => set({ rw: x ?? 0 })}
            defaultValue={ref.rw} error={E('rw ')} help={HELP.rw} step={0.25} />
          <NumberField label="Db centre bore" labelText="Db" unit="mm" value={g.Db} onChange={(x) => set({ Db: x ?? 0 })}
            defaultValue={ref.Db} error={E('Db ')} help={HELP.Db} step={1} />
          <NumberField label="t_min ligament" labelText="t_min" unit="mm" value={g.tMin} onChange={(x) => set({ tMin: x ?? 0 })}
            defaultValue={ref.tMin} error={E('t_min ', 'Inner pin circle radius')} help={HELP.tMin} step={0.25} />
          <NumberField label="Axial gap" labelText="gap" unit="mm" value={g.gap} onChange={(x) => set({ gap: x ?? 0 })}
            defaultValue={ref.gap} error={E('gap ')} help={HELP.gap} step={0.1} />
          <NumberField label="Rw override" labelText="Rw override" unit="mm" value={g.RwOverride} nullable
            onChange={(x) => set({ RwOverride: x })} defaultValue={null} error={E('Rw override')}
            placeholder={Number.isFinite(derived.Rw) && !derived.RwIsOverride ? `auto ${num(derived.Rw, 1)}` : 'auto'}
            help={HELP.RwOverride} step={0.5} />
          <NumberField label="Housing wall" labelText="Housing wall" unit="mm" value={g.wall} onChange={(x) => set({ wall: x ?? 0 })}
            defaultValue={ref.wall} error={E('wall ')} help={HELP.wall} step={0.5} />
        </div>
      </Section>

      <Section title="Materials" summary={`${MATERIALS.find((m) => matchesMaterial(m, g.discMaterial))?.name ?? 'Custom disc'}`}>
        <p className="section-note">{SUPPLIER_DATA_NOTE}</p>
        <div className="subgroup">
          <h4 className="subgroup-h">Disc</h4>
          <MaterialPicker
            label="Disc material"
            value={g.discMaterial}
            onChange={(m) => set({ discMaterial: m })}
            reference={ref.discMaterial}
            errors={v.errors}
            errPrefix="Disc material"
            full
            help={HELP.discMaterial}
          />
        </div>

        <div className="subgroup">
          <h4 className="subgroup-h">Outer pins (ring)</h4>
          <div className="nf">
            <div className="nf-head"><span className="nf-label">Construction</span></div>
            <Segmented
              label="Outer pin construction"
              value={g.outerPin.construction}
              onChange={(c) => set({ outerPin: { ...g.outerPin, construction: c } })}
              options={[{ value: 'boltBushing', label: 'Steel bolt + bushing' }, { value: 'solid', label: 'Solid pin' }]}
            />
          </div>
          <SelectField
            label={g.outerPin.construction === 'solid' ? 'Pin size' : 'Bolt + bushing size'}
            value={outerMatch ? String(outerMatch.od) : 'custom'}
            onChange={(val) => {
              const o = OUTER_PIN_OPTIONS.find((x) => String(x.od) === val);
              if (o) set({ rr: o.od / 2, outerPin: { ...g.outerPin, shankDia: o.shank } });
            }}
            options={[
              ...OUTER_PIN_OPTIONS.map((o) => ({ value: String(o.od), label: g.outerPin.construction === 'solid' ? `${o.od} mm pin` : `${o.bolt} bolt, ${o.od} mm bushing` })),
              { value: 'custom', label: 'Custom (set rr by hand)', disabled: !!outerMatch },
            ]}
            note="Also sets rr = OD / 2."
          />
          {g.outerPin.construction === 'boltBushing' && (
            <div className="fields fields-tight">
              <NumberField label="Bolt shank dia." labelText="Bolt shank diameter" unit="mm" value={g.outerPin.shankDia}
                onChange={(x) => set({ outerPin: { ...g.outerPin, shankDia: x ?? 0 } })}
                defaultValue={ref.outerPin.shankDia} error={E('Bolt shank')} help={HELP.shankDia} step={0.5} />
              <NumberField label="Bolt yield" unit="MPa" value={g.outerPin.boltYield}
                onChange={(x) => set({ outerPin: { ...g.outerPin, boltYield: x ?? 0 } })}
                defaultValue={ref.outerPin.boltYield} error={E('Bolt yield')} help={HELP.boltYield} step={10} />
            </div>
          )}
          <MaterialPicker
            label={g.outerPin.construction === 'solid' ? 'Pin material' : 'Bushing material'}
            value={g.outerPin.material}
            onChange={(m) => set({ outerPin: { ...g.outerPin, material: m } })}
            reference={ref.outerPin.material}
            errors={v.errors}
            errPrefix="Outer pin material"
            full={g.outerPin.construction === 'solid'}
          />
        </div>

        <div className="subgroup">
          <h4 className="subgroup-h">Inner pins (output)</h4>
          <div className="nf">
            <div className="nf-head"><span className="nf-label">Construction</span></div>
            <Segmented
              label="Inner pin construction"
              value={g.innerPin.construction}
              onChange={(c) => set({ innerPin: { ...g.innerPin, construction: c } })}
              options={[{ value: 'standoff', label: 'Steel standoff' }, { value: 'solid', label: 'Solid pin' }]}
            />
          </div>
          <SelectField
            label={g.innerPin.construction === 'solid' ? 'Pin size' : 'Standoff size'}
            value={innerMatch ? String(innerMatch.od) : 'custom'}
            onChange={(val) => {
              const o = INNER_PIN_OPTIONS.find((x) => String(x.od) === val);
              if (o) set({ rw: o.od / 2, innerPin: { ...g.innerPin, od: o.od, bore: o.bore } });
            }}
            options={[
              ...INNER_PIN_OPTIONS.map((o) => ({ value: String(o.od), label: g.innerPin.construction === 'solid' ? `${o.od} mm pin` : `${o.thread} standoff, ${o.od} mm OD / ${o.bore} bore` })),
              { value: 'custom', label: 'Custom (set rw by hand)', disabled: !!innerMatch },
            ]}
            note="Also sets rw = OD / 2."
          />
          {g.innerPin.construction === 'standoff' && (
            <div className="fields fields-tight">
              <NumberField label="Standoff OD" unit="mm" value={g.innerPin.od}
                onChange={(x) => set({ innerPin: { ...g.innerPin, od: x ?? 0 } })}
                defaultValue={ref.innerPin.od} error={E('Standoff OD', 'Standoff bore must')} help={HELP.standoffOd} step={0.5} />
              <NumberField label="Standoff bore" unit="mm" value={g.innerPin.bore}
                onChange={(x) => set({ innerPin: { ...g.innerPin, bore: x ?? 0 } })}
                defaultValue={ref.innerPin.bore} error={E('Standoff bore')} help={HELP.standoffBore} step={0.1} />
              <NumberField label="Standoff yield" unit="MPa" value={g.innerPin.standoffYield}
                onChange={(x) => set({ innerPin: { ...g.innerPin, standoffYield: x ?? 0 } })}
                defaultValue={ref.innerPin.standoffYield} error={E('Standoff yield')} help={HELP.standoffYield} step={10} />
            </div>
          )}
          <MaterialPicker
            label={g.innerPin.construction === 'solid' ? 'Pin material' : 'Standoff material'}
            value={g.innerPin.material}
            onChange={(m) => set({ innerPin: { ...g.innerPin, material: m } })}
            reference={ref.innerPin.material}
            errors={v.errors}
            errPrefix="Inner pin material"
            full={g.innerPin.construction === 'solid'}
          />
        </div>
      </Section>

      <Section title="Loads and factors" summary={`T_req ${torque(eff.Treq)} / T_des ${torque(eff.Tdes)} N·m`}>
        {slot !== 'custom' && toggle !== null ? (
          <div className="subgroup">
            <Switch
              checked={toggle}
              onChange={(val) => dispatch({ type: 'useArm', joint: slot, value: val })}
              label="Loads from arm model"
              description={
                toggle
                  ? fromArmNow
                    ? 'T_req and T_des come from Step 1.'
                    : 'The arm model has an input error, so the typed torques are used for now.'
                  : 'Off: type T_req and T_des yourself.'
              }
            />
            {toggle && (
              <div className="inline-actions">
                <Button size="sm" variant="ghost" icon="arrow" onClick={() => setStep(1)}>Edit arm</Button>
              </div>
            )}
          </div>
        ) : (
          <p className="section-note">Custom uses the torques you type here.</p>
        )}
        <div className="fields">
          <NumberField label="T_req working torque" labelText="T_req" unit={'N·m'}
            value={fromArmNow ? eff.Treq : g.Treq} disabled={fromArmNow}
            onChange={(x) => set({ Treq: x ?? 0 })} defaultValue={fromArmNow ? undefined : ref.Treq}
            error={fromArmNow ? null : E('T_req ')} help={HELP.Treq} step={0.1}
            note={fromArmNow && arm_?.treqOverridden ? 'Manual override from Step 1' : undefined} />
          <NumberField label="T_des design torque" labelText="T_des" unit={'N·m'}
            value={fromArmNow ? eff.Tdes : g.Tdes} disabled={fromArmNow}
            onChange={(x) => set({ Tdes: x ?? 0 })} defaultValue={fromArmNow ? undefined : ref.Tdes}
            error={fromArmNow ? null : E('T_des ')} warning={fromArmNow ? null : W('T_des ')} help={HELP.Tdes} step={0.1}
            note={fromArmNow && arm_?.tdesOverridden ? 'Manual override from Step 1' : undefined} />
          <NumberField label="Kc (strength)" labelText="Kc" value={g.Kc} onChange={(x) => set({ Kc: x ?? 0 })}
            defaultValue={ref.Kc} error={E('Kc ')} warning={W('Kc below')} help={HELP.Kc} step={0.1} />
          <NumberField label="Kc life" labelText="Kc life" value={g.KcLife} onChange={(x) => set({ KcLife: x ?? 0 })}
            defaultValue={ref.KcLife} error={E('Kc_life ')} help={HELP.KcLife} step={0.1} />
          <NumberField label="Disc share" value={g.discShare} nullable onChange={(x) => set({ discShare: x })}
            defaultValue={null} error={E('Disc share')} placeholder={`auto ${num(derived.share, 2)}`} help={HELP.discShare} step={0.05} />
          <NumberField label="Input speed" unit="rpm" value={g.rpm} onChange={(x) => set({ rpm: x ?? 0 })}
            defaultValue={ref.rpm} error={E('Input speed')} help={HELP.rpm} step={10} />
          <NumberField label="Required bearing life" labelText="Required life" unit="h" value={g.reqLifeH}
            onChange={(x) => set({ reqLifeH: x ?? 0 })} defaultValue={ref.reqLifeH} error={E('Required life')} help={HELP.reqLifeH} step={100} />
        </div>

        <div className="subgroup">
          <h4 className="subgroup-h">Eccentric bearing</h4>
          <SelectField
            label="Bearing"
            value={bearingMatch ? bearingMatch.name : 'custom'}
            onChange={(val) => {
              const b = BEARINGS.find((x) => x.name === val);
              if (b) set({ bearing: { name: b.name, C: b.C, C0: b.C0 }, Db: b.OD });
            }}
            options={[
              ...BEARINGS.map((b) => ({ value: b.name, label: `${b.name}  (${b.bore}×${b.OD}×${b.width})` })),
              { value: 'custom', label: 'Custom ratings', disabled: !!bearingMatch },
            ]}
            note={BEARING_NOTE + ' Choosing one also sets the centre bore Db.'}
          />
          <div className="fields fields-tight">
            <NumberField label="C dynamic" unit="N" value={g.bearing.C}
              onChange={(x) => set({ bearing: { ...g.bearing, C: x ?? 0, name: g.bearing.name } })}
              defaultValue={ref.bearing.C} error={E('Bearing C ')} help={HELP.bearingC} step={10} />
            <NumberField label="C0 static" unit="N" value={g.bearing.C0}
              onChange={(x) => set({ bearing: { ...g.bearing, C0: x ?? 0 } })}
              defaultValue={ref.bearing.C0} error={E('Bearing C0')} help={HELP.bearingC0} step={10} />
          </div>
        </div>

        {arm_ && arm.valid && (
          <div className="subgroup">
            <h4 className="subgroup-h">Output bearing of this joint</h4>
            <p className="section-note">
              From the arm model, for sizing the joint{'’'}s own output bearing or housing: radial load {num(arm_.outboardWeight_N, 1)} N,
              overturning moment {torque(arm_.overturningMoment_Nm)} N{'·'}m.
            </p>
          </div>
        )}
      </Section>
    </div>
  );
}
