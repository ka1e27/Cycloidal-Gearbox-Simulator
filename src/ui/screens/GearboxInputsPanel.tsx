import { useMemo, type ReactNode } from 'react';
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
import { Advanced, Button, FieldRow, Notice, Section, SelectField, Segmented, Switch } from '../components/primitives';
import { NumberField } from '../components/NumberField';
import { HELP } from '../help';
import { CUSTOM, armToggle, gearboxOf, presetFor, presetIdFor, type Slot } from '../session';
import { useStore } from '../store';
import { inchFraction, type U } from '../units';

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

/** "5 mm" in metric, "5 mm (0.197 in)" when lengths are shown in inches. */
function odLabel(u: U, mm: number): string {
  const metric = `${mm} mm`;
  return u.prefs.length === 'mm' ? metric : `${metric} (${u.fu('length', mm)})`;
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
  extra,
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
  /** Extra advanced rows shown above the property rows */
  extra?: ReactNode;
}) {
  const { u } = useStore();
  const id = currentMaterialId(value);
  const lib = MATERIALS.find((m) => m.id === id);
  const err = (key: string) => errors.find((e) => e.startsWith(`${errPrefix}: ${key}`)) ?? null;
  const set = (patch: Partial<MaterialProps>) => onChange({ ...value, ...patch });
  const options = [
    { value: SPEC_STEEL_ID, label: u.text('Steel, generic (E 200 GPa)') },
    ...MATERIALS.map((m) => ({ value: m.id as string, label: m.name })),
    { value: 'custom', label: 'Custom (edited values)', disabled: id !== 'custom' },
  ];
  const pick = (v: string) => {
    if (v === SPEC_STEEL_ID) onChange({ ...SPEC_STEEL });
    else if (v !== 'custom') onChange(materialProps(v as never));
  };
  return (
    <>
      <SelectField
        label={label}
        value={id}
        onChange={pick}
        options={options}
        help={help}
        note={lib ? lib.note : id === SPEC_STEEL_ID ? 'E 200 GPa, ν 0.30: the SPEC contact pair (E* = 57,259 MPa on 6061-T6).' : 'Edited values. Pick a material to reset them.'}
      />
      <Advanced label={`Advanced: ${full ? 'strength and stiffness' : 'contact stiffness'}`}>
        {extra}
        <NumberField label="Young's modulus" symbol="E" quantity="stress" value={value.E} onChange={(v) => set({ E: v ?? 0 })}
          defaultValue={reference.E} error={err('E ')} help={HELP.E} step={1000} />
        <NumberField label="Poisson's ratio" symbol={'ν'} value={value.nu} onChange={(v) => set({ nu: v ?? 0 })}
          defaultValue={reference.nu} error={err('Poisson')} help={HELP.nu} step={0.01} />
        {full && (
          <>
            <NumberField label="Yield strength" symbol="Sy" quantity="stress" value={value.Sy} onChange={(v) => set({ Sy: v ?? 0 })}
              defaultValue={reference.Sy} error={err('yield')} help={HELP.Sy} step={10} />
            <NumberField label="Fatigue strength, 10⁷ cycles" symbol={'σf'} quantity="stress" value={value.sigmaF}
              onChange={(v) => set({ sigmaF: v ?? 0 })} defaultValue={reference.sigmaF} error={err('fatigue')} help={HELP.sigmaF} step={5} />
            <NumberField label="Density" unit={'g/cm³'} value={value.density} onChange={(v) => set({ density: v ?? 0 })}
              defaultValue={reference.density} error={err('density')} help={HELP.density} step={0.1} />
            <FieldRow label="Material type">
              <Segmented
                size="sm"
                label={`${label} type`}
                value={value.kind}
                onChange={(k) => set({ kind: k })}
                options={[{ value: 'metal', label: 'Metal' }, { value: 'polymer', label: 'Polymer' }]}
              />
            </FieldRow>
          </>
        )}
      </Advanced>
    </>
  );
}

// ---------------------------------------------------------------------------
// Main panel
// ---------------------------------------------------------------------------

/**
 * The gearbox inputs of a slot. `part` splits it for the workbench inspector: 'loads' is the "Loads from arm model"
 * switch with T_req / T_des (the joint's Loads section), 'design' is everything else (Gearbox design); Custom has no
 * Loads section, so its typed torques stay in 'design'. 'all' (default) is the whole panel.
 */
export function GearboxInputsPanel({ slot, eff, result, part = 'all' }: { slot: Slot; eff: GearboxInputs; result: GearboxResult; part?: 'all' | 'loads' | 'design' }) {
  const { state, arm, updateGearbox, dispatch, openSection, fromArm, u } = useStore();
  const g = gearboxOf(state, slot);
  const ref = useMemo(() => presetFor(slot, state.presetBase), [slot, state.presetBase]);
  const startedFrom = slot !== CUSTOM && !(JOINT_IDS as readonly string[]).includes(slot) && state.presetBase[slot] ? presetIdFor(slot, state.presetBase) : null;
  const set = (patch: Partial<GearboxInputs>) => updateGearbox(slot, (x) => ({ ...x, ...patch }));
  const v = useMemo(() => validateGearboxInputs(eff), [eff]);
  const pick = (list: string[], ...prefixes: string[]) => list.find((m) => prefixes.some((p) => m.startsWith(p))) ?? null;
  const E = (...p: string[]) => pick(v.errors, ...p);
  const W = (...p: string[]) => pick(v.warnings, ...p);
  const usedPrefixes = ['Zp ', 'Zw ', 'D ', 'e ', 'L ', 'rr ', 'rw ', 'Db ', 't_min ', 'discs ', 'gap ', 'wall ', 'Rw override', 'K1 ',
    'T_req ', 'T_des ', 'Kc ', 'Kc_life ', 'Input speed', 'Required life', 'Disc share', 'Bearing C', 'Disc material', 'Outer pin material',
    'Inner pin material', 'Bolt ', 'Standoff '];
  const orphan = v.errors.filter((m) => !usedPrefixes.some((p) => m.startsWith(p)));

  const arm_ = slot === CUSTOM ? null : arm.joints.find((x) => x.joint === slot) ?? null;
  const fromArmNow = fromArm(slot);
  const toggle = slot === CUSTOM ? null : armToggle(state, slot);

  const outerMatch = OUTER_PIN_OPTIONS.find((o) => Math.abs(2 * g.rr - o.od) < 1e-9);
  const innerMatch = INNER_PIN_OPTIONS.find((o) => Math.abs(2 * g.rw - o.od) < 1e-9);
  const bearingMatch = BEARINGS.find((b) => b.name === g.bearing.name && b.C === g.bearing.C && b.C0 === g.bearing.C0);
  const stock = g.discMaterial.kind === 'polymer' ? DISC_STOCK_POLYMER : DISC_STOCK_METAL;
  const stockMatch = stock.find((s) => Math.abs(s - g.L) < 1e-9);
  const imperial = u.prefs.length === 'in';
  const stockLabel = (s: number) => (imperial && g.discMaterial.kind !== 'polymer' ? `${inchFraction(s)} plate` : u.fu('length', s, { dp: 3, trim: true }));

  const derived = result.derived;
  const k1Note = Number.isFinite(derived.K1)
    ? `K1 = ${derived.K1.toFixed(2)} (usual range 0.40 to 0.85)${Number.isFinite(derived.Rw) ? `. Inner pin circle radius ${u.fu('length', derived.Rw, { dp: 1 })}` : ''}`
    : undefined;

  const torqueFixed = (x: number) => u.f('torque', x, { fixed: true });

  const loadSwitch = slot !== 'custom' && toggle !== null ? (
    <div className="switch-block">
      <Switch
        checked={toggle}
        onChange={(val) => dispatch({ type: 'useArm', joint: slot, value: val })}
        label="Loads from arm model"
        description={
          toggle
            ? fromArmNow
              ? 'T_req and T_des come from the arm model (masses, lengths and α of the joints).'
              : 'The arm model has an input error, so the typed torques are used for now.'
            : 'Off: type T_req and T_des yourself.'
        }
      />
      {toggle && <button type="button" className="linkish" onClick={() => openSection('joint', slot)}>Edit the joint and link</button>}
    </div>
  ) : (
    <p className="section-note">Custom uses the torques you type here.</p>
  );
  const torqueFields = (
    <>
      <NumberField label="Working torque" symbol="T_req" quantity="torque"
        value={fromArmNow ? eff.Treq : g.Treq} disabled={fromArmNow}
        onChange={(x) => set({ Treq: x ?? 0 })} defaultValue={fromArmNow ? undefined : ref.Treq}
        error={fromArmNow ? null : E('T_req ')} help={HELP.Treq} step={0.1}
        note={fromArmNow && arm_?.treqOverridden ? 'Manual override in Joint & link' : undefined} />
      <NumberField label="Design torque" symbol="T_des" quantity="torque"
        value={fromArmNow ? eff.Tdes : g.Tdes} disabled={fromArmNow}
        onChange={(x) => set({ Tdes: x ?? 0 })} defaultValue={fromArmNow ? undefined : ref.Tdes}
        error={fromArmNow ? null : E('T_des ')} warning={fromArmNow ? null : W('T_des ')} help={HELP.Tdes} step={0.1}
        note={fromArmNow && arm_?.tdesOverridden ? 'Manual override in Joint & link' : undefined} />
    </>
  );

  if (part === 'loads') {
    return (
      <div className="gb-loads">
        {loadSwitch}
        {torqueFields}
      </div>
    );
  }
  // in the inspector a joint's torques sit in its Loads section; Custom keeps them here
  const withTorques = part === 'all' || slot === CUSTOM;

  return (
    <div className="panel">
      <div className="panel-head">
        <h2 className="panel-title">Inputs</h2>
        {slot === 'custom' ? (
          <SelectField
            inline
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
          <Button size="sm" variant="ghost" onClick={() => updateGearbox(slot, () => structuredClone(ref))}
            disabled={JSON.stringify(g) === JSON.stringify(ref)} title={`Restore the ${JOINT_PRESET_SPECS[presetIdFor(slot, state.presetBase)].label} preset`}>
            Reset to preset
          </Button>
        )}
      </div>

      {startedFrom && (
        <Notice kind="info" title="Started from a preset">
          This joint was added after the SPEC joints, so its gearbox started from the {JOINT_PRESET_SPECS[startedFrom].label} preset, the one whose
          working torque is closest to this joint{'’'}s torque. Change anything below, or use Reset to preset to return to it.
        </Notice>
      )}

      {orphan.length > 0 && (
        <Notice kind="error" title="This geometry cannot be computed">
          {u.text(orphan[0])}. Adjust the highlighted fields.
        </Notice>
      )}

      <Section title="Geometry" summary={`${u.fu('length', eff.D, { dp: 1, trim: true })} · ${eff.discs} disc${eff.discs > 1 ? 's' : ''}`}>
        <NumberField label="Outer pins (count)" symbol="Zp" value={g.Zp} onChange={(x) => set({ Zp: x ?? 0 })}
          defaultValue={ref.Zp} error={E('Zp ')} help={HELP.Zp} step={1}
          note={Number.isInteger(g.Zp) && g.Zp >= 8 ? `Ratio ${g.Zp - 1}:1` : undefined} />
        <NumberField label="Inner pins (count)" symbol="Zw" value={g.Zw} onChange={(x) => set({ Zw: x ?? 0 })}
          defaultValue={ref.Zw} error={E('Zw ')} help={HELP.Zw} step={1} />
        <NumberField label="Pin circle diameter" symbol="D" quantity="length" value={g.D} onChange={(x) => set({ D: x ?? 0 })}
          defaultValue={ref.D} error={E('D ', 'Outer pin circle')} help={HELP.D} step={1} />
        <NumberField label="Eccentricity" symbol="e" quantity="length" value={g.e} onChange={(x) => set({ e: x ?? 0 })}
          defaultValue={ref.e} error={E('e ', 'K1 ')} warning={W('K1 ')} help={HELP.e} step={0.01} note={k1Note} />
        <NumberField label="Disc thickness" symbol="L" quantity="length" value={g.L} onChange={(x) => set({ L: x ?? 0 })}
          defaultValue={ref.L} error={E('L ')} help={HELP.L} step={0.5} />
        <SelectField
          inline
          label="Stock thickness"
          value={stockMatch != null ? String(stockMatch) : 'custom'}
          onChange={(val) => { if (val !== 'custom') set({ L: Number(val) }); }}
          options={[
            ...stock.map((s) => ({ value: String(s), label: stockLabel(s) })),
            { value: 'custom', label: 'Custom', disabled: stockMatch != null },
          ]}
        />
        <FieldRow label="Discs" help={HELP.discs} message={E('discs ') ?? undefined} messageKind={E('discs ') ? 'error' : undefined}>
          <Segmented label="Number of discs" value={g.discs} onChange={(n) => set({ discs: n })}
            options={[{ value: 1, label: '1' }, { value: 2, label: '2' }]} />
        </FieldRow>
        <Advanced>
          <NumberField label="Outer pin radius" symbol="rr" quantity="length" value={g.rr} onChange={(x) => set({ rr: x ?? 0 })}
            defaultValue={ref.rr} error={E('rr ')} warning={W('Neighbouring')} help={HELP.rr} step={0.25} />
          <NumberField label="Inner pin radius" symbol="rw" quantity="length" value={g.rw} onChange={(x) => set({ rw: x ?? 0 })}
            defaultValue={ref.rw} error={E('rw ')} help={HELP.rw} step={0.25} />
          <NumberField label="Centre bore" symbol="Db" quantity="length" value={g.Db} onChange={(x) => set({ Db: x ?? 0 })}
            defaultValue={ref.Db} error={E('Db ')} help={HELP.Db} step={1} />
          <NumberField label="Minimum ligament" symbol="t_min" quantity="length" value={g.tMin} onChange={(x) => set({ tMin: x ?? 0 })}
            defaultValue={ref.tMin} error={E('t_min ', 'Inner pin circle radius')} help={HELP.tMin} step={0.25} />
          <NumberField label="Axial gap" symbol="gap" quantity="length" value={g.gap} onChange={(x) => set({ gap: x ?? 0 })}
            defaultValue={ref.gap} error={E('gap ')} help={HELP.gap} step={0.1} />
          <NumberField label="Inner pin circle radius, override" symbol="Rw" quantity="length" value={g.RwOverride} nullable
            onChange={(x) => set({ RwOverride: x })} defaultValue={null} error={E('Rw override')}
            placeholder={Number.isFinite(derived.Rw) && !derived.RwIsOverride ? `auto ${u.f('length', derived.Rw, { dp: 1 })}` : 'auto'}
            help={HELP.RwOverride} step={0.5} />
          <NumberField label="Housing wall" quantity="length" value={g.wall} onChange={(x) => set({ wall: x ?? 0 })}
            defaultValue={ref.wall} error={E('wall ')} help={HELP.wall} step={0.5} />
        </Advanced>
      </Section>

      <Section title="Materials" summary={MATERIALS.find((m) => matchesMaterial(m, g.discMaterial))?.name ?? 'Custom disc'}>
        <p className="section-note">{SUPPLIER_DATA_NOTE}</p>
        <h4 className="subgroup-h">Disc</h4>
        <MaterialPicker label="Disc material" value={g.discMaterial} onChange={(m) => set({ discMaterial: m })}
          reference={ref.discMaterial} errors={v.errors} errPrefix="Disc material" full help={HELP.discMaterial} />

        <h4 className="subgroup-h">Outer pins (ring)</h4>
        <FieldRow label="Construction" stacked>
          <Segmented label="Outer pin construction" value={g.outerPin.construction} fullWidth
            onChange={(c) => set({ outerPin: { ...g.outerPin, construction: c } })}
            options={[{ value: 'boltBushing', label: 'Steel bolt + bushing' }, { value: 'solid', label: 'Solid pin' }]} />
        </FieldRow>
        <SelectField
          label={g.outerPin.construction === 'solid' ? 'Pin size' : 'Bolt and bushing size'}
          value={outerMatch ? String(outerMatch.od) : 'custom'}
          onChange={(val) => {
            const o = OUTER_PIN_OPTIONS.find((x) => String(x.od) === val);
            if (o) set({ rr: o.od / 2, outerPin: { ...g.outerPin, shankDia: o.shank } });
          }}
          options={[
            ...OUTER_PIN_OPTIONS.map((o) => ({
              value: String(o.od),
              label: g.outerPin.construction === 'solid' ? `${odLabel(u, o.od)} pin` : `${o.bolt} bolt, ${odLabel(u, o.od)} bushing`,
            })),
            { value: 'custom', label: 'Custom (set the radius under Geometry, Advanced)', disabled: !!outerMatch },
          ]}
        />
        <MaterialPicker
          label={g.outerPin.construction === 'solid' ? 'Pin material' : 'Bushing material'}
          value={g.outerPin.material}
          onChange={(m) => set({ outerPin: { ...g.outerPin, material: m } })}
          reference={ref.outerPin.material}
          errors={v.errors}
          errPrefix="Outer pin material"
          full={g.outerPin.construction === 'solid'}
          extra={g.outerPin.construction === 'boltBushing' ? (
            <>
              <NumberField label="Bolt shank diameter" quantity="length" value={g.outerPin.shankDia}
                onChange={(x) => set({ outerPin: { ...g.outerPin, shankDia: x ?? 0 } })}
                defaultValue={ref.outerPin.shankDia} error={E('Bolt shank')} help={HELP.shankDia} step={0.5} />
              <NumberField label="Bolt yield strength" quantity="stress" value={g.outerPin.boltYield}
                onChange={(x) => set({ outerPin: { ...g.outerPin, boltYield: x ?? 0 } })}
                defaultValue={ref.outerPin.boltYield} error={E('Bolt yield')} help={HELP.boltYield} step={10} />
            </>
          ) : undefined}
        />

        <h4 className="subgroup-h">Inner pins (output)</h4>
        <FieldRow label="Construction" stacked>
          <Segmented label="Inner pin construction" value={g.innerPin.construction} fullWidth
            onChange={(c) => set({ innerPin: { ...g.innerPin, construction: c } })}
            options={[{ value: 'standoff', label: 'Steel standoff' }, { value: 'solid', label: 'Solid pin' }]} />
        </FieldRow>
        <SelectField
          label={g.innerPin.construction === 'solid' ? 'Pin size' : 'Standoff size'}
          value={innerMatch ? String(innerMatch.od) : 'custom'}
          onChange={(val) => {
            const o = INNER_PIN_OPTIONS.find((x) => String(x.od) === val);
            if (o) set({ rw: o.od / 2, innerPin: { ...g.innerPin, od: o.od, bore: o.bore } });
          }}
          options={[
            ...INNER_PIN_OPTIONS.map((o) => ({
              value: String(o.od),
              label: g.innerPin.construction === 'solid' ? `${odLabel(u, o.od)} pin` : `${o.thread} standoff, ${odLabel(u, o.od)} OD`,
            })),
            { value: 'custom', label: 'Custom (set the radius under Geometry, Advanced)', disabled: !!innerMatch },
          ]}
        />
        <MaterialPicker
          label={g.innerPin.construction === 'solid' ? 'Pin material' : 'Standoff material'}
          value={g.innerPin.material}
          onChange={(m) => set({ innerPin: { ...g.innerPin, material: m } })}
          reference={ref.innerPin.material}
          errors={v.errors}
          errPrefix="Inner pin material"
          full={g.innerPin.construction === 'solid'}
          extra={g.innerPin.construction === 'standoff' ? (
            <>
              <NumberField label="Standoff outside diameter" quantity="length" value={g.innerPin.od}
                onChange={(x) => set({ innerPin: { ...g.innerPin, od: x ?? 0 } })}
                defaultValue={ref.innerPin.od} error={E('Standoff OD', 'Standoff bore must')} help={HELP.standoffOd} step={0.5} />
              <NumberField label="Standoff bore" quantity="length" value={g.innerPin.bore}
                onChange={(x) => set({ innerPin: { ...g.innerPin, bore: x ?? 0 } })}
                defaultValue={ref.innerPin.bore} error={E('Standoff bore')} help={HELP.standoffBore} step={0.1} />
              <NumberField label="Standoff yield strength" quantity="stress" value={g.innerPin.standoffYield}
                onChange={(x) => set({ innerPin: { ...g.innerPin, standoffYield: x ?? 0 } })}
                defaultValue={ref.innerPin.standoffYield} error={E('Standoff yield')} help={HELP.standoffYield} step={10} />
            </>
          ) : undefined}
        />
      </Section>

      <Section title={withTorques ? 'Loads and bearing' : 'Bearing and load factors'}
        summary={withTorques ? `T_req ${torqueFixed(eff.Treq)} · T_des ${torqueFixed(eff.Tdes)} ${u.sym('torque')}` : g.bearing.name}>
        {withTorques && loadSwitch}
        {withTorques && torqueFields}
        {!withTorques && (
          <p className="section-note">
            Checked for T_req {u.fu('torque', eff.Treq, { fixed: true })} and T_des {u.fu('torque', eff.Tdes, { fixed: true })}{' '}
            <button type="button" className="linkish" onClick={() => openSection('loads', slot)}>(Loads section)</button>.
          </p>
        )}
        <SelectField
          label="Eccentric bearing"
          value={bearingMatch ? bearingMatch.name : 'custom'}
          onChange={(val) => {
            const b = BEARINGS.find((x) => x.name === val);
            if (b) set({ bearing: { name: b.name, C: b.C, C0: b.C0 }, Db: b.OD });
          }}
          options={[
            ...BEARINGS.map((b) => ({
              value: b.name,
              label: u.prefs.length === 'mm'
                ? `${b.name}  (${b.bore}×${b.OD}×${b.width} mm)`
                : `${b.name}  (${b.bore}×${b.OD}×${b.width} mm, OD ${u.fu('length', b.OD)})`,
            })),
            { value: 'custom', label: 'Custom ratings', disabled: !!bearingMatch },
          ]}
          note={`${BEARING_NOTE} Choosing one also sets the centre bore.`}
        />
        <Advanced>
          <NumberField label="Load concentration, strength" symbol="Kc" value={g.Kc} onChange={(x) => set({ Kc: x ?? 0 })}
            defaultValue={ref.Kc} error={E('Kc ')} warning={W('Kc below')} help={HELP.Kc} step={0.1} />
          <NumberField label="Load concentration, life" symbol="Kc_life" value={g.KcLife} onChange={(x) => set({ KcLife: x ?? 0 })}
            defaultValue={ref.KcLife} error={E('Kc_life ')} help={HELP.KcLife} step={0.1} />
          <NumberField label="Disc share of torque" value={g.discShare} nullable onChange={(x) => set({ discShare: x })}
            defaultValue={null} error={E('Disc share')} placeholder={`auto ${derived.share.toFixed(2)}`} help={HELP.discShare} step={0.05} />
          <NumberField label="Input speed" unit="rpm" value={g.rpm} onChange={(x) => set({ rpm: x ?? 0 })}
            defaultValue={ref.rpm} error={E('Input speed')} help={HELP.rpm} step={10} />
          <NumberField label="Required bearing life" unit="h" value={g.reqLifeH} onChange={(x) => set({ reqLifeH: x ?? 0 })}
            defaultValue={ref.reqLifeH} error={E('Required life')} help={HELP.reqLifeH} step={100} />
          <NumberField label="Bearing dynamic rating" symbol="C" quantity="force" value={g.bearing.C}
            onChange={(x) => set({ bearing: { ...g.bearing, C: x ?? 0 } })}
            defaultValue={ref.bearing.C} error={E('Bearing C ')} help={HELP.bearingC} step={10} />
          <NumberField label="Bearing static rating" symbol="C0" quantity="force" value={g.bearing.C0}
            onChange={(x) => set({ bearing: { ...g.bearing, C0: x ?? 0 } })}
            defaultValue={ref.bearing.C0} error={E('Bearing C0')} help={HELP.bearingC0} step={10} />
        </Advanced>
        {part === 'all' && arm_ && arm.valid && (
          <p className="section-note">
            Output bearing of this joint, from the arm model: {arm_.motion === 'yaw'
              ? `axial thrust ${u.fu('force', arm_.bearingAxial_N, { fixed: true })}${arm_.tiltedYaw ? `, radial load ${u.fu('force', arm_.bearingRadial_N, { fixed: true })}` : ''}, overturning moment`
              : `radial load ${u.fu('force', arm_.bearingRadial_N, { fixed: true })}, tilting moment`} {u.fu('torque', arm_.bearingTiltMoment_Nm, { fixed: true })}.
          </p>
        )}
      </Section>
    </div>
  );
}
