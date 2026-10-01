import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { useStore } from '../store';
import type { Step } from '../session';
import { IMPERIAL, METRIC, QUANTITIES, UNIT_OPTIONS, systemOf, type Quantity } from '../units';

export const OPEN_ASSUMPTIONS_EVENT = 'cgd-open-assumptions';

const TABS: { step: Step; num: string; short: string; long: string }[] = [
  { step: 1, num: '01', short: 'Arm', long: 'Arm & Loads' },
  { step: 2, num: '02', short: 'Gearbox', long: 'Gearbox' },
  { step: 3, num: '03', short: 'Advisor', long: 'Design Advisor' },
  { step: 4, num: '04', short: 'Joints', long: 'All Joints' },
];

const QUANTITY_LABEL: Record<Quantity, string> = { length: 'Length', mass: 'Mass', force: 'Force', torque: 'Torque', stress: 'Stress' };

// ---------------------------------------------------------------------------
// Units: a mm | in switch plus a popover with one choice per quantity
// ---------------------------------------------------------------------------

function UnitsControl() {
  const { state, dispatch } = useStore();
  const sys = systemOf(state.units);
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const popId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      }
    };
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const set = (units: typeof METRIC) => dispatch({ type: 'units', units });
  const onSwitchKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      set(sys === 'imperial' ? METRIC : IMPERIAL);
    }
  };

  return (
    <div className="units" ref={wrap}>
      <div className="unitswitch" role="radiogroup" aria-label="Units" onKeyDown={onSwitchKey}>
        <button type="button" role="radio" aria-checked={sys === 'metric'} tabIndex={sys === 'imperial' ? -1 : 0}
          className={`unitswitch-btn${sys === 'metric' ? ' is-on' : ''}`} title="Metric: mm, g, N, N·m, MPa" onClick={() => set(METRIC)}>
          mm
        </button>
        <button type="button" role="radio" aria-checked={sys === 'imperial'} tabIndex={sys === 'imperial' ? 0 : -1}
          className={`unitswitch-btn${sys === 'imperial' ? ' is-on' : ''}`} title="Imperial: in, oz, lbf, lbf·in, ksi" onClick={() => set(IMPERIAL)}>
          in
        </button>
      </div>
      <button
        ref={trigger}
        type="button"
        className="tb-link units-trigger"
        aria-expanded={open}
        aria-controls={open ? popId : undefined}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <span className="units-trigger-text">Units{sys === 'custom' ? ' (custom)' : ''}</span>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div id={popId} className="popover units-pop" role="dialog" aria-label="Choose units">
          <p className="units-pop-note">Everything is stored in SI. Changing units only changes how numbers are shown and typed.</p>
          <div className="units-pop-grid">
            {QUANTITIES.map((q) => (
              <label key={q} className="units-pop-row">
                <span>{QUANTITY_LABEL[q]}</span>
                <span className="sf-box">
                  <select
                    className="sf-select"
                    value={state.units[q]}
                    onChange={(e) => set({ ...state.units, [q]: e.target.value } as typeof METRIC)}
                  >
                    {UNIT_OPTIONS[q].map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <Icon name="chevron" size={14} className="sf-chevron" />
                </span>
              </label>
            ))}
          </div>
          <div className="units-pop-actions">
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set(METRIC)}>All metric</button>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => set(IMPERIAL)}>All imperial</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Session menu
// ---------------------------------------------------------------------------

function MenuButton() {
  const { exportJson, importJson, resetAll, notify } = useStore();
  const [open, setOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const file = useRef<HTMLInputElement>(null);
  const dlg = useRef<HTMLDialogElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown);
    window.setTimeout(() => items.current[0]?.focus(), 0);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open]);

  useEffect(() => {
    const d = dlg.current;
    if (!d) return;
    if (confirm && !d.open) d.showModal();
    if (!confirm && d.open) d.close();
  }, [confirm]);

  const onMenuKey = (e: KeyboardEvent) => {
    const list = items.current.filter(Boolean) as HTMLButtonElement[];
    const i = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(i + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(i - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    try {
      if (f.size > 2_000_000) {
        notify('error', 'That file is too large to be a session export (over 2 MB).');
        return;
      }
      importJson(await f.text());
    } catch {
      notify('error', 'Could not read that file.');
    } finally {
      if (file.current) file.current.value = '';
    }
  };

  return (
    <div className="menu-wrap" ref={wrap}>
      <button
        ref={trigger}
        type="button"
        className="icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label="Session menu"
        title="Export, import or reset"
        onClick={() => setOpen((o) => !o)}
      >
        <Icon name="more" size={20} />
      </button>
      {open && (
        <div id={menuId} className="popover menu" role="menu" aria-label="Session" onKeyDown={onMenuKey}>
          <button ref={(el) => { items.current[0] = el; }} role="menuitem" type="button" className="menu-item"
            onClick={() => { setOpen(false); exportJson(); }}>
            <Icon name="download" size={15} /> Export JSON
          </button>
          <button ref={(el) => { items.current[1] = el; }} role="menuitem" type="button" className="menu-item"
            onClick={() => { setOpen(false); file.current?.click(); }}>
            <Icon name="upload" size={15} /> Import JSON
          </button>
          <button ref={(el) => { items.current[2] = el; }} role="menuitem" type="button" className="menu-item"
            onClick={() => { setOpen(false); window.dispatchEvent(new Event(OPEN_ASSUMPTIONS_EVENT)); }}>
            <span className="menu-spacer" /> Assumptions and limits
          </button>
          <div className="menu-sep" role="separator" />
          <button ref={(el) => { items.current[3] = el; }} role="menuitem" type="button" className="menu-item is-danger"
            onClick={() => { setOpen(false); setConfirm(true); }}>
            <Icon name="reset" size={15} /> Reset to defaults
          </button>
        </div>
      )}
      <input
        ref={file}
        type="file"
        accept="application/json,.json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => void onFile(e.target.files?.[0])}
      />
      <dialog
        ref={dlg}
        className="dialog"
        aria-labelledby={`${menuId}-t`}
        onClose={() => { setConfirm(false); trigger.current?.focus(); }}
        onClick={(e) => { if (e.target === dlg.current) setConfirm(false); }}
      >
        <div className="dialog-body">
          <h2 id={`${menuId}-t`} className="dialog-title">Reset to defaults?</h2>
          <p className="dialog-text">
            This restores the default arm, all four joint presets and the Custom slot, and clears your saved session.
            Export a JSON first if you want to keep your current values.
          </p>
          <div className="dialog-actions">
            <button type="button" className="btn btn-secondary btn-md" onClick={() => setConfirm(false)} autoFocus>Cancel</button>
            <button type="button" className="btn btn-danger btn-md" onClick={() => { setConfirm(false); resetAll(); }}>
              Reset everything
            </button>
          </div>
        </div>
      </dialog>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Title block + tabs
// ---------------------------------------------------------------------------

export function Header() {
  const { state, dispatch, setStep, resolvedTheme } = useStore();
  const dark = resolvedTheme === 'dark';
  return (
    <header className="app-header">
      <div className="titleblock">
        <div className="titleblock-inner">
          <div className="tb-left">
            <span className="tb-title">Cycloidal Gearbox Simulator</span>
            <span className="tb-sub">Pin-type cycloidal reducers for a robot arm of 1 to 8 joints</span>
          </div>
          <div className="tb-right">
            <UnitsControl />
            <button type="button" className="tb-link tb-assumptions" onClick={() => window.dispatchEvent(new Event(OPEN_ASSUMPTIONS_EVENT))}>
              Assumptions
            </button>
            <button
              type="button"
              className="icon-btn"
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              onClick={() => dispatch({ type: 'theme', theme: dark ? 'light' : 'dark' })}
            >
              <Icon name={dark ? 'sun' : 'moon'} size={18} />
            </button>
            <MenuButton />
          </div>
        </div>
      </div>
      <nav className="tabs" aria-label="Design steps">
        <div className="tabs-inner">
          {TABS.map((t) => (
            <button
              key={t.step}
              type="button"
              className={`tab${state.step === t.step ? ' is-current' : ''}`}
              aria-current={state.step === t.step ? 'step' : undefined}
              onClick={() => setStep(t.step)}
            >
              <span className="tab-num" aria-hidden="true">{t.num}</span>
              <span className="tab-short">{t.short}</span>
              <span className="tab-long">{t.long}</span>
            </button>
          ))}
        </div>
      </nav>
    </header>
  );
}
