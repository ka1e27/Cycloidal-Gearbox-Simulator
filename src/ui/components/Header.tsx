import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Icon } from './Icon';
import { useStore } from '../store';
import type { Step } from '../session';

export const OPEN_ASSUMPTIONS_EVENT = 'cgd-open-assumptions';

const STEPS: { step: Step; short: string; long: string }[] = [
  { step: 1, short: 'Arm', long: 'Arm & Loads' },
  { step: 2, short: 'Gearbox', long: 'Gearbox' },
  { step: 3, short: 'Advisor', long: 'Design Advisor' },
  { step: 4, short: 'Joints', long: 'All Joints' },
];

function logoPath(): string {
  // a 9-lobed cycloidal rosette, radius ~9 in a 24 box
  const pts: string[] = [];
  const n = 240;
  for (let i = 0; i < n; i++) {
    const t = (i / n) * Math.PI * 2;
    const r = 8.6 + 1.5 * Math.cos(9 * t);
    pts.push(`${(12 + r * Math.cos(t)).toFixed(2)} ${(12 + r * Math.sin(t)).toFixed(2)}`);
  }
  return `M${pts.join('L')}Z`;
}

function Brand() {
  const d = useMemo(logoPath, []);
  return (
    <div className="brand">
      <svg className="brand-logo" width="28" height="28" viewBox="0 0 24 24" aria-hidden="true" focusable="false">
        <path d={d} fill="var(--accent-soft)" stroke="var(--accent)" strokeWidth="1.3" strokeLinejoin="round" />
        <circle cx="12" cy="12" r="2.6" fill="var(--accent)" />
      </svg>
      <span className="brand-name">Cycloidal Gearbox Designer</span>
    </div>
  );
}

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
        <div id={menuId} className="menu" role="menu" aria-label="Session" onKeyDown={onMenuKey}>
          <button ref={(el) => { items.current[0] = el; }} role="menuitem" type="button" className="menu-item"
            onClick={() => { setOpen(false); exportJson(); }}>
            <Icon name="download" size={16} /> Export JSON
          </button>
          <button ref={(el) => { items.current[1] = el; }} role="menuitem" type="button" className="menu-item"
            onClick={() => { setOpen(false); file.current?.click(); }}>
            <Icon name="upload" size={16} /> Import JSON
          </button>
          <div className="menu-sep" role="separator" />
          <button ref={(el) => { items.current[2] = el; }} role="menuitem" type="button" className="menu-item is-danger"
            onClick={() => { setOpen(false); setConfirm(true); }}>
            <Icon name="reset" size={16} /> Reset to defaults
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

export function Header() {
  const { state, dispatch, setStep, resolvedTheme } = useStore();
  const dark = resolvedTheme === 'dark';
  return (
    <header className="app-header">
      <div className="app-header-inner">
        <Brand />
        <nav className="steps" aria-label="Design steps">
          {STEPS.map((s) => (
            <button
              key={s.step}
              type="button"
              className={`step${state.step === s.step ? ' is-current' : ''}`}
              aria-current={state.step === s.step ? 'step' : undefined}
              onClick={() => setStep(s.step)}
            >
              <span className="step-num" aria-hidden="true">{s.step}</span>
              <span className="step-label">
                <span className="step-short">{s.short}</span>
                <span className="step-long">{s.long}</span>
              </span>
            </button>
          ))}
        </nav>
        <div className="header-tools">
          <button
            type="button"
            className="icon-btn"
            title="Assumptions and limitations"
            aria-label="Open assumptions and limitations"
            onClick={() => window.dispatchEvent(new Event(OPEN_ASSUMPTIONS_EVENT))}
          >
            <Icon name="book" size={19} />
          </button>
          <button
            type="button"
            className="icon-btn"
            aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            onClick={() => dispatch({ type: 'theme', theme: dark ? 'light' : 'dark' })}
          >
            <Icon name={dark ? 'sun' : 'moon'} size={19} />
          </button>
          <MenuButton />
        </div>
      </div>
    </header>
  );
}
