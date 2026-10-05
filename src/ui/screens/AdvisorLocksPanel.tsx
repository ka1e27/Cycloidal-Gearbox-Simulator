// "Design variables" table of the Design Advisor (CLAUDE.md Addition 6): each variable is locked to a value or free.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import {
  BEARINGS,
  INNER_PIN_OPTIONS,
  OUTER_PIN_OPTIONS,
  type AdvisorDesign,
  type BearingLock,
  type GearboxInputs,
  type InnerPinLock,
  type OuterPinLock,
  bearingsBySeries,
  discStockFor,
} from '../../calc';
import { LOCK_HELP } from '../help';
import {
  LOCK_VAR_KEYS,
  defaultLockState,
  lockAllToInputs,
  lockRowError,
  lockRowWarning,
  lockedCount,
  ratioModeOf,
  resolveLockValues,
  unlockAll,
  type AdvisorLockState,
  type AdvisorLockValues,
  type LockVarKey,
  type RatioMode,
  type ResolvedLockValues,
} from '../advisorLocks';
import { InfoTip } from '../components/InfoTip';
import type { RatioPlan } from '../motorUi';
import { parseNumberText } from '../components/NumberField';
import { Button, Icon, Segmented } from '../components/primitives';
import { fixed, num, thickness } from '../format';
import type { Slot } from '../session';
import { useStore } from '../store';
import { inchFraction, inputText, niceStep, type Quantity } from '../units';
import '../../styles/advisor-locks.css';

// ---------------------------------------------------------------------------
// Small controls
// ---------------------------------------------------------------------------

function LockToggle({ locked, name, onToggle, onLabel = 'Locked', offLabel = 'Free' }: {
  locked: boolean; name: string; onToggle: () => void; onLabel?: string; offLabel?: string;
}) {
  return (
    <button type="button" className={`lock-btn${locked ? ' is-locked' : ''}`} aria-pressed={locked} aria-label={`Lock ${name}`} onClick={onToggle}>
      <Icon name={locked ? 'lock' : 'unlock'} size={15} />
      <span className="lock-btn-text">{locked ? onLabel : offLabel}</span>
    </button>
  );
}

/** Number box without a row label (the table row provides the name). Empty means "use the Gearbox value" when `nullable`. */
function BareNumber({ label, value, onChange, quantity, unit, step = 1, nullable, invalid, placeholder, describedBy }: {
  label: string; value: number | null; onChange: (v: number | null) => void; quantity?: Quantity; unit?: string;
  step?: number; nullable?: boolean; invalid?: boolean; placeholder?: string; describedBy?: string;
}) {
  const id = useId();
  const { u } = useStore();
  const toText = (v: number | null) => (v == null || !Number.isFinite(v) ? '' : quantity ? inputText(quantity, v, u.prefs) : String(parseFloat(v.toPrecision(12))));
  const toSI = (n: number) => (quantity ? u.fromDisplay(quantity, n) : n);
  const [draft, setDraft] = useState(toText(value));
  const [bad, setBad] = useState(false);
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) { setDraft(toText(value)); return; }
    const parsed = parseNumberText(draft);
    if (parsed !== undefined && (parsed === null ? value !== null : toSI(parsed) !== value)) setDraft(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, u]);
  const commit = (text: string) => {
    setDraft(text);
    const parsed = parseNumberText(text);
    if (parsed === undefined || (parsed === null && !nullable)) { setBad(true); return; }
    setBad(false);
    const si = parsed === null ? null : toSI(parsed);
    if (si !== value) onChange(si);
  };
  const stp = quantity ? niceStep(quantity, step, u.prefs) : step;
  const nudge = (dir: 1 | -1, mult: number) => {
    const cur = parseNumberText(draft);
    const base = typeof cur === 'number' ? cur : value != null ? (quantity ? u.toDisplay(quantity, value) : value) : 0;
    const dp = (String(stp).split('.')[1] ?? '').length + (mult < 1 ? 1 : 0);
    commit(String(Number((base + dir * stp * mult).toFixed(Math.min(dp, 10)))));
  };
  const suffix = quantity ? u.sym(quantity) : unit;
  return (
    <div className="nf-box lv-num">
      <input
        id={id} className="nf-input" type="text" inputMode="decimal" autoComplete="off" spellCheck={false}
        aria-label={label} value={draft} placeholder={placeholder}
        aria-invalid={invalid || bad ? true : undefined} aria-describedby={describedBy}
        onFocus={() => { focused.current = true; }}
        onBlur={() => { focused.current = false; setBad(false); setDraft(toText(value)); }}
        onChange={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowUp' || e.key === 'ArrowDown') { e.preventDefault(); nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1); }
        }}
      />
      {suffix && <span className="nf-unit" aria-hidden="true">{suffix}</span>}
    </div>
  );
}

function SelectBox({ label, value, onChange, options, describedBy }: {
  label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string; group?: string }[]; describedBy?: string;
}) {
  // consecutive options with the same group become one optgroup
  const groups: { group: string | null; items: typeof options }[] = [];
  for (const o of options) {
    const last = groups[groups.length - 1];
    if (last && last.group === (o.group ?? null)) last.items.push(o);
    else groups.push({ group: o.group ?? null, items: [o] });
  }
  const opt = (o: { value: string; label: string }) => <option key={o.value} value={o.value}>{o.label}</option>;
  return (
    <div className="sf-box lv-sel">
      <select className="sf-select" aria-label={label} value={value} aria-describedby={describedBy} onChange={(e) => onChange(e.target.value)}>
        {groups.map((g, i) => (g.group == null ? g.items.map(opt) : <optgroup key={`g${i}`} label={g.group}>{g.items.map(opt)}</optgroup>))}
      </select>
      <Icon name="chevron" size={14} className="sf-chevron" />
    </div>
  );
}

function Mini({ label, children }: { label: string; children: ReactNode }) {
  return <label className="lv-mini"><span className="lv-mini-l">{label}</span>{children}</label>;
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

/** Locked / Free / From motor for the ratio row. Shown instead of the plain lock button once the joint has a usable motor. */
function RatioModeToggle({ mode, onMode }: { mode: RatioMode; onMode: (m: RatioMode) => void }) {
  const opts: { v: RatioMode; label: string; title: string }[] = [
    { v: 'locked', label: 'Locked', title: 'Keep the Zp value you enter' },
    { v: 'free', label: 'Free', title: 'The advisor tries Zp 12, 14, …, 26' },
    { v: 'motor', label: 'From motor', title: 'Search only the Zp the motor can drive' },
  ];
  return (
    <div className="seg seg-sm rm-seg" role="radiogroup" aria-label="Gear ratio mode">
      {opts.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={mode === o.v} title={o.title}
          className={`seg-btn${mode === o.v ? ' is-on' : ''}`} onClick={() => onMode(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function AdvisorLocksPanel({ slot, eff, chosen, running, canRun, onRun, onCancel, hasResult, plan: planIn, zpSearched = null }: {
  slot: Slot;
  /** Gearbox inputs the advisor will use (the "current values") */
  eff: GearboxInputs;
  /** Design to read the optimized values from (null before a run or when the result is stale) */
  chosen: AdvisorDesign | null;
  running: boolean;
  canRun: boolean;
  hasResult: boolean;
  onRun: () => void;
  onCancel: () => void;
  /** Ratio mode and the motor-feasible Zp set (Addition 8). Omitted: no motor, the mode follows the Zp lock. */
  plan?: RatioPlan;
  /** The Zp set the shown result searched in "from motor" mode, or null */
  zpSearched?: number[] | null;
}) {
  const { state, updateLocks, u } = useStore();
  const ls = state.advisorLocks[slot] ?? defaultLockState();
  const plan: RatioPlan = planIn ?? { mode: ratioModeOf(ls, false), rec: null, usable: false, zps: [], feasible: false, nearest: null, note: '' };
  const r = resolveLockValues(ls, eff);
  const bolt = eff.outerPin.construction === 'boltBushing';
  const standoff = eff.innerPin.construction === 'standoff';
  const stock = discStockFor(eff.discMaterial);
  const L = (mm: number, dp = 2) => u.fu('length', mm, { dp });

  const mode = plan.mode;
  const setMode = (m: RatioMode) => updateLocks(slot, (s) => {
    if (m === 'motor') return { ...s, ratioMotor: true };
    const values = m === 'locked' ? { ...s.values, Zp: resolveLockValues(s, eff).Zp } : s.values;
    return { ...s, ratioMotor: false, on: { ...s.on, Zp: m === 'locked' }, values };
  });
  const patchValues = (p: Partial<AdvisorLockValues>) => updateLocks(slot, (s) => ({ ...s, values: { ...s.values, ...p } }));
  const toggle = (k: LockVarKey) => updateLocks(slot, (s) => {
    const turningOn = !s.on[k];
    const res = resolveLockValues(s, eff);
    // locking freezes the number you see, so later edits on the Gearbox page do not silently move it
    const values = turningOn ? { ...s.values, [k]: res[k] } : s.values;
    return { ...s, on: { ...s.on, [k]: turningOn }, values };
  });
  const toggleLimit = () => updateLocks(slot, (s) => ({ ...s, limitOn: !s.limitOn }));

  const err = (k: LockVarKey | 'maxHousingOD') => lockRowError(k, ls, eff, mode);
  const warn = (k: LockVarKey) => lockRowWarning(k, ls, eff);

  // ---- descriptions of the catalog entries ----
  const outerLabel = (i: number) => {
    const o = OUTER_PIN_OPTIONS[i];
    return bolt ? `${o.bolt} · ${L(o.od, 1)} bushing, ${L(o.shank, 1)} shank` : `${L(o.od, 1)} solid pin`;
  };
  const innerLabel = (i: number) => {
    const o = INNER_PIN_OPTIONS[i];
    return standoff ? `${o.thread} · ${L(o.od, 1)} standoff, ${L(o.bore, 2)} bore` : `${L(o.od, 1)} solid pin`;
  };
  const bearingLabel = (i: number) => {
    const b = BEARINGS[i];
    return `${b.name} · ${L(b.bore, 0)} × ${L(b.OD, 0)} × ${L(b.width, 0)}`;
  };

  const outerSel = r.outerPin.kind === 'catalog' ? String(r.outerPin.index) : 'custom';
  const innerSel = r.innerPin.kind === 'catalog' ? String(r.innerPin.index) : 'custom';
  const bearingSel = r.bearing.kind === 'catalog' ? String(r.bearing.index) : 'custom';

  const setOuter = (v: string) => {
    if (v === 'custom') {
      const base = r.outerPin.kind === 'catalog' ? OUTER_PIN_OPTIONS[r.outerPin.index] : null;
      patchValues({ outerPin: { kind: 'custom', od: base ? base.od : (r.outerPin as { od: number }).od, shank: base ? base.shank : (r.outerPin as { shank: number }).shank } });
    } else patchValues({ outerPin: { kind: 'catalog', index: Number(v) } });
  };
  const setInner = (v: string) => {
    if (v === 'custom') {
      const base = r.innerPin.kind === 'catalog' ? INNER_PIN_OPTIONS[r.innerPin.index] : null;
      patchValues({ innerPin: { kind: 'custom', od: base ? base.od : (r.innerPin as { od: number }).od, bore: base ? base.bore : (r.innerPin as { bore: number }).bore } });
    } else patchValues({ innerPin: { kind: 'catalog', index: Number(v) } });
  };
  const setBearing = (v: string) => {
    if (v === 'custom') {
      if (r.bearing.kind === 'catalog') {
        const b = BEARINGS[r.bearing.index];
        patchValues({ bearing: { kind: 'custom', name: b.name, bore: b.bore, OD: b.OD, C: b.C, C0: b.C0 } });
      }
    } else patchValues({ bearing: { kind: 'catalog', index: Number(v) } });
  };
  const co = r.outerPin.kind === 'custom' ? r.outerPin : null;
  const ci = r.innerPin.kind === 'custom' ? r.innerPin : null;
  const cb = r.bearing.kind === 'custom' ? r.bearing : null;
  const patchOuter = (p: Partial<Extract<OuterPinLock, { kind: 'custom' }>>) => co && patchValues({ outerPin: { ...co, ...p } });
  const patchInner = (p: Partial<Extract<InnerPinLock, { kind: 'custom' }>>) => ci && patchValues({ innerPin: { ...ci, ...p } });
  const patchBearing = (p: Partial<Extract<BearingLock, { kind: 'custom' }>>) => cb && patchValues({ bearing: { ...cb, ...p } });

  // ---- what the advisor chose for a free variable ----
  const c = chosen;
  const outerChosen = c && (eff.outerPin.construction === 'solid'
    ? `${L(c.outerPinOD, 1)} solid pin`
    : `${c.outerBolt ?? 'bolt'} · ${L(c.outerPinOD, 1)} bushing, ${L(c.shankDia ?? 0, 1)} shank`);
  const innerChosen = c && (eff.innerPin.construction === 'solid'
    ? `${L(c.innerPinOD, 1)} solid pin`
    : `${c.innerThread ?? ''} · ${L(c.innerPinOD, 1)} standoff, ${L(c.innerPinBore ?? 0, 2)} bore`);
  const chosenText: Record<LockVarKey, string | null> = {
    Zp: c ? `${num(c.ratio, 0)}:1 (Zp ${num(c.Zp, 0)})` : null,
    D: c ? L(c.D, 1) : null,
    e: c ? `${L(c.e, 3)} (K1 ${fixed(c.K1, 3)})` : null,
    outerPin: outerChosen || null,
    innerPin: innerChosen || null,
    Zw: c ? `${num(c.Zw, 0)} pins` : null,
    L: c ? thickness(u, c.L) : null,
    discs: c ? `${c.discs} disc${c.discs > 1 ? 's' : ''}` : null,
    bearing: c ? c.bearingName : null,
  };

  // ---- rows ----
  const rows: { k: LockVarKey; name: string; sym: string; control: ReactNode }[] = [
    {
      k: 'Zp', name: 'Gear ratio', sym: 'Zp',
      control: (
        <div className="lv-inline">
          <BareNumber label="Zp, number of outer pins" value={r.Zp} step={1} placeholder={String(eff.Zp)} nullable
            onChange={(v) => patchValues({ Zp: v })} invalid={!!err('Zp')} describedBy="lv-msg-Zp" />
          <span className="lv-readout">= {Number.isFinite(r.Zp) ? num(r.Zp - 1, 0) : '—'}:1</span>
        </div>
      ),
    },
    {
      k: 'D', name: 'Pin circle diameter', sym: 'D',
      control: <BareNumber label="Pin circle diameter D" quantity="length" value={r.D} step={1} nullable placeholder={u.f('length', eff.D, { dp: 1, trim: true })}
        onChange={(v) => patchValues({ D: v })} invalid={!!err('D')} describedBy="lv-msg-D" />,
    },
    {
      k: 'e', name: 'Eccentricity', sym: 'e',
      control: <BareNumber label="Eccentricity e" quantity="length" value={r.e} step={0.05} nullable placeholder={u.f('length', eff.e, { dp: 3, trim: true })}
        onChange={(v) => patchValues({ e: v })} invalid={!!err('e')} describedBy="lv-msg-e" />,
    },
    {
      k: 'outerPin', name: 'Outer pin size', sym: 'rr',
      control: (
        <div className="lv-stack">
          <SelectBox label="Outer pin size" value={outerSel} onChange={setOuter} describedBy="lv-msg-outerPin"
            options={[...OUTER_PIN_OPTIONS.map((_, i) => ({ value: String(i), label: outerLabel(i) })), { value: 'custom', label: 'Custom…' }]} />
          {co && (
            <div className="lv-minis">
              <Mini label={bolt ? 'Bushing OD' : 'Pin OD'}>
                <BareNumber label="Custom outer pin OD" quantity="length" value={co.od} step={0.5} onChange={(v) => patchOuter({ od: v ?? 0 })} invalid={!!err('outerPin')} />
              </Mini>
              {bolt && (
                <Mini label="Bolt shank">
                  <BareNumber label="Custom bolt shank diameter" quantity="length" value={co.shank} step={0.5} onChange={(v) => patchOuter({ shank: v ?? 0 })} invalid={!!err('outerPin')} />
                </Mini>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      k: 'innerPin', name: 'Inner pin size', sym: 'rw',
      control: (
        <div className="lv-stack">
          <SelectBox label="Inner pin size" value={innerSel} onChange={setInner} describedBy="lv-msg-innerPin"
            options={[...INNER_PIN_OPTIONS.map((_, i) => ({ value: String(i), label: innerLabel(i) })), { value: 'custom', label: 'Custom…' }]} />
          {ci && (
            <div className="lv-minis">
              <Mini label={standoff ? 'Standoff OD' : 'Pin OD'}>
                <BareNumber label="Custom inner pin OD" quantity="length" value={ci.od} step={0.5} onChange={(v) => patchInner({ od: v ?? 0 })} invalid={!!err('innerPin')} />
              </Mini>
              {standoff && (
                <Mini label="Bore">
                  <BareNumber label="Custom standoff bore" quantity="length" value={ci.bore} step={0.25} onChange={(v) => patchInner({ bore: v ?? 0 })} invalid={!!err('innerPin')} />
                </Mini>
              )}
            </div>
          )}
        </div>
      ),
    },
    {
      k: 'Zw', name: 'Inner pin count', sym: 'Zw',
      control: <BareNumber label="Zw, number of inner pins" value={r.Zw} step={1} nullable placeholder={String(eff.Zw)}
        onChange={(v) => patchValues({ Zw: v })} invalid={!!err('Zw')} describedBy="lv-msg-Zw" />,
    },
    {
      k: 'L', name: 'Disc thickness', sym: 'L',
      control: (
        <div className="lv-stack">
          <BareNumber label="Disc thickness L" quantity="length" value={r.L} step={0.5} nullable placeholder={thickness(u, eff.L, false)}
            onChange={(v) => patchValues({ L: v })} invalid={!!err('L')} describedBy="lv-msg-L" />
          <SelectBox label="Fill with a stock plate thickness" value="" onChange={(v) => v && patchValues({ L: Number(v) })}
            options={[{ value: '', label: 'Stock sizes…' }, ...stock.map((t) => ({
              value: String(t), label: u.prefs.length === 'in' ? `${inchFraction(t)} (${thickness(u, t)})` : thickness(u, t),
            }))]} />
        </div>
      ),
    },
    {
      k: 'discs', name: 'Number of discs', sym: '',
      control: (
        <Segmented<number> label="Number of discs" value={r.discs} size="sm"
          onChange={(v) => patchValues({ discs: v === 2 ? 2 : 1 })}
          options={[{ value: 1, label: '1 disc' }, { value: 2, label: '2 discs' }]} />
      ),
    },
    {
      k: 'bearing', name: 'Eccentric bearing', sym: 'Db',
      control: (
        <div className="lv-stack">
          <SelectBox label="Eccentric bearing" value={bearingSel} onChange={setBearing} describedBy="lv-msg-bearing"
            options={[
              ...bearingsBySeries().flatMap((g) => g.indices.map((i) => ({ value: String(i), label: bearingLabel(i), group: g.label }))),
              { value: 'custom', label: 'Custom…' },
            ]} />
          {cb && (
            <div className="lv-minis lv-minis-5">
              <Mini label="Name">
                <input className="lv-text" type="text" aria-label="Custom bearing name" maxLength={24} value={cb.name ?? ''} onChange={(e) => patchBearing({ name: e.target.value })} />
              </Mini>
              <Mini label="ID">
                <BareNumber label="Custom bearing ID" quantity="length" value={cb.bore ?? null} nullable step={1} onChange={(v) => patchBearing({ bore: v ?? undefined })} invalid={!!err('bearing')} />
              </Mini>
              <Mini label="OD">
                <BareNumber label="Custom bearing OD" quantity="length" value={cb.OD} step={1} onChange={(v) => patchBearing({ OD: v ?? 0 })} invalid={!!err('bearing')} />
              </Mini>
              <Mini label="C (dynamic)">
                <BareNumber label="Custom bearing dynamic rating C" quantity="force" value={cb.C} step={100} onChange={(v) => patchBearing({ C: v ?? 0 })} invalid={!!err('bearing')} />
              </Mini>
              <Mini label="C0 (static)">
                <BareNumber label="Custom bearing static rating C0" quantity="force" value={cb.C0} step={100} onChange={(v) => patchBearing({ C0: v ?? 0 })} invalid={!!err('bearing')} />
              </Mini>
            </div>
          )}
        </div>
      ),
    },
  ];

  const nLocked = lockedCount(ls, mode);
  const anyError = LOCK_VAR_KEYS.some((k) => err(k)) || !!err('maxHousingOD');

  return (
    <section className="card lv-card" aria-labelledby="lv-title">
      <header className="card-head">
        <h3 className="card-title" id="lv-title">Design variables</h3>
        <span className="lv-count" aria-live="polite">{nLocked} of {LOCK_VAR_KEYS.length} locked</span>
      </header>
      <p className="card-sub">
        Lock a variable to your own value; the advisor then optimizes only the free ones, with the same checks and the same goal (smallest housing).
        A free variable shows the advisor’s choice after a run.
      </p>

      <div className="lv-table" role="list">
        {rows.map(({ k, name, sym, control }) => {
          const isRatio = k === 'Zp';
          const locked = isRatio ? mode === 'locked' : ls.on[k];
          const e = err(k);
          const w = locked && !e ? warn(k) : null;
          const ch = chosenText[k];
          return (
            <div key={k} role="listitem" className={`lv-row${locked ? ' is-locked' : ''}${e ? ' has-error' : ''}${isRatio ? ' has-ratio-mode' : ''}`}>
              <div className="lv-name">
                <span className="lv-name-text">{name}</span>
                {sym && <span className="row-sym" aria-hidden="true">{sym}</span>}
                <InfoTip help={LOCK_HELP[k]} label={name} />
              </div>
              <div className="lv-value">
                {locked ? control : (
                  <div className="lv-free" data-testid={`free-${k}`}>
                    {ch ? <><span className="lv-free-val">{ch}</span><span className="lv-free-tag">{isRatio && mode === 'motor' ? 'from motor' : 'advisor’s choice'}</span></> : <span className="lv-auto">auto</span>}
                    {isRatio && mode === 'motor' && plan.feasible && plan.zps.length > 0 && !ch && (
                      <span className="rm-set">Zp {plan.zps.length > 1 ? `${plan.zps[0]} to ${plan.zps[plan.zps.length - 1]}` : plan.zps[0]}</span>
                    )}
                  </div>
                )}
              </div>
              <div className="lv-toggle">
                {isRatio && plan.usable
                  ? <RatioModeToggle mode={mode} onMode={setMode} />
                  : <LockToggle locked={locked} name={name} onToggle={() => toggle(k)} />}
              </div>
              {isRatio && mode === 'motor' && (
                <div className={`rm-note lv-msg${plan.feasible ? '' : ' is-bad'}`} data-testid="ratio-motor-note">
                  {plan.rec && plan.rec.reasons[0] && <>{u.text(plan.rec.reasons[0])}{' '}</>}
                  {u.text(plan.note)}
                  {plan.feasible
                    ? (c && zpSearched ? ` The smallest housing among them uses ${num(c.ratio, 0)}:1 (Zp ${num(c.Zp, 0)}).` : ' The advisor picks the smallest housing among them.')
                    : ` The advisor searches Zp ${plan.zps[0]} instead.`}
                </div>
              )}
              {(e || w) && (
                <div id={`lv-msg-${k}`} className={`row-msg lv-msg${e ? ' is-error' : ' is-warning'}`} role={e ? 'alert' : undefined}>{u.text(e ?? w ?? '')}</div>
              )}
            </div>
          );
        })}

        <div role="listitem" className={`lv-row lv-row-limit${ls.limitOn ? ' is-locked' : ''}${err('maxHousingOD') ? ' has-error' : ''}`}>
          <div className="lv-name">
            <span className="lv-name-text">Maximum housing OD</span>
            <span className="lv-opt">optional limit</span>
            <InfoTip help={LOCK_HELP.maxHousingOD} label="Maximum housing OD" />
          </div>
          <div className="lv-value">
            {ls.limitOn
              ? <BareNumber label="Maximum housing outside diameter" quantity="length" value={ls.values.maxHousingOD} step={5}
                onChange={(v) => patchValues({ maxHousingOD: v ?? 0 })} invalid={!!err('maxHousingOD')} describedBy="lv-msg-limit" />
              : <div className="lv-free"><span className="lv-auto">no limit</span></div>}
          </div>
          <div className="lv-toggle"><LockToggle locked={ls.limitOn} name="maximum housing OD" onToggle={toggleLimit} onLabel="Limit on" offLabel="No limit" /></div>
          {err('maxHousingOD') && <div id="lv-msg-limit" className="row-msg lv-msg is-error" role="alert">{u.text(err('maxHousingOD') as string)}</div>}
        </div>
      </div>

      <div className="lv-foot">
        {running
          ? <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          : <Button variant="primary" disabled={!canRun || anyError} onClick={onRun}>{hasResult ? 'Run again' : 'Run advisor'}</Button>}
        <Button variant="secondary" size="sm" icon="lock" onClick={() => updateLocks(slot, (s: AdvisorLockState) => lockAllToInputs(s, eff))}>
          Lock all to current Gearbox values
        </Button>
        <Button variant="secondary" size="sm" icon="unlock" onClick={() => updateLocks(slot, unlockAll)}>Unlock all</Button>
      </div>
      {anyError && <p className="lv-foot-note">Fix the highlighted locked values to run the advisor.</p>}
    </section>
  );
}

export type { ResolvedLockValues };
