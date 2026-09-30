import { useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import type { HelpEntry } from '../help';
import { Icon, type IconName } from './Icon';
export { Icon };
import { InfoTip } from './InfoTip';
import { useWidth } from '../viz/useWidth';

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: IconName;
}) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size}${className ? ` ${className}` : ''}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 15 : 17} />}
      {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Card
// ---------------------------------------------------------------------------

export function Card({
  title,
  subtitle,
  actions,
  children,
  className,
  id,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`} id={id}>
      {(title || actions) && (
        <header className="card-head">
          <div className="card-titles">
            {title && <h3 className="card-title">{title}</h3>}
            {subtitle && <p className="card-sub">{subtitle}</p>}
          </div>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Collapsible input section
// ---------------------------------------------------------------------------

export function Section({
  title,
  summary,
  defaultOpen = true,
  children,
  help,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  help?: HelpEntry;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`section${open ? ' is-open' : ''}`}>
      <h3 className="section-h">
        <button
          type="button"
          className="section-toggle"
          aria-expanded={open}
          aria-controls={id}
          onClick={() => setOpen((o) => !o)}
        >
          <Icon name="chevron" size={16} className="section-chevron" />
          <span className="section-title">{title}</span>
          {summary && <span className="section-summary">{summary}</span>}
        </button>
        {help && <InfoTip help={help} label={title} />}
      </h3>
      <div className="section-body" id={id} inert={!open}>
        <div className="section-inner">{children}</div>
      </div>
    </section>
  );
}

// ---------------------------------------------------------------------------
// Status chip and utilization bar
// ---------------------------------------------------------------------------

export type StatusKind = 'ok' | 'marginal' | 'fail' | 'neutral';

export const STATUS_ICON: Record<StatusKind, IconName> = {
  ok: 'check-circle',
  marginal: 'alert',
  fail: 'x-circle',
  neutral: 'info',
};

export function verdictKind(v: string): StatusKind {
  return v === 'pass' || v === 'ok' ? 'ok' : v === 'marginal' ? 'marginal' : v === 'fail' ? 'fail' : 'neutral';
}

export function StatusChip({ kind, children, size = 'md' }: { kind: StatusKind; children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span className={`chip chip-${kind} chip-${size}`}>
      <Icon name={STATUS_ICON[kind]} size={size === 'sm' ? 13 : 15} />
      {children}
    </span>
  );
}

/** Utilization bar, scale 0..1.2 with ticks at 0.85 and 1.0. */
export function UtilBar({ value, kind, label }: { value: number; kind: StatusKind; label: string }) {
  const max = 1.2;
  const pct = Math.max(0, Math.min(1, value / max)) * 100;
  return (
    <div className="utilbar" role="img" aria-label={label}>
      <div className={`utilbar-fill fill-${kind}`} style={{ width: `${pct}%` }} />
      <span className="utilbar-tick" style={{ left: `${(0.85 / max) * 100}%` }} />
      <span className="utilbar-tick is-limit" style={{ left: `${(1 / max) * 100}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Segmented control (radio group)
// ---------------------------------------------------------------------------

export function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  label,
  size = 'md',
  fullWidth,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const onKey = (e: KeyboardEvent) => {
    let n = idx;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (idx + 1) % options.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (idx - 1 + options.length) % options.length;
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = options.length - 1;
    else return;
    e.preventDefault();
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div className={`seg seg-${size}${fullWidth ? ' seg-full' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          title={o.title}
          className={`seg-btn${o.value === value ? ' is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Select, switch
// ---------------------------------------------------------------------------

export function SelectField({
  label,
  value,
  onChange,
  options,
  help,
  note,
  className,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string; disabled?: boolean }[];
  help?: HelpEntry;
  note?: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <div className={`sf${className ? ` ${className}` : ''}`}>
      <div className="nf-head">
        <label htmlFor={id} className="nf-label">{label}</label>
        {help && <InfoTip help={help} label={label} />}
      </div>
      <div className="sf-box">
        <select id={id} className="sf-select" value={value} onChange={(e) => onChange(e.target.value)}>
          {options.map((o) => (
            <option key={o.value} value={o.value} disabled={o.disabled}>{o.label}</option>
          ))}
        </select>
        <Icon name="chevron" size={16} className="sf-chevron" />
      </div>
      {note && <div className="nf-msg">{note}</div>}
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  label,
  description,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <button
        id={id}
        type="button"
        role="switch"
        aria-checked={checked}
        className={`switch${checked ? ' is-on' : ''}`}
        onClick={() => onChange(!checked)}
      >
        <span className="switch-knob" />
      </button>
      <label htmlFor={id} className="switch-text">
        <span className="switch-label">{label}</span>
        {description && <span className="switch-desc">{description}</span>}
      </label>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notices, tiles, hint banner
// ---------------------------------------------------------------------------

export function Notice({
  kind = 'info',
  title,
  children,
  actions,
}: {
  kind?: 'info' | 'warning' | 'error' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const icon: IconName = kind === 'error' ? 'x-circle' : kind === 'warning' ? 'alert' : kind === 'success' ? 'check-circle' : 'info';
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <Icon name={icon} size={18} className="notice-icon" />
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div className="notice-text">{children}</div>}
        {actions && <div className="notice-actions">{actions}</div>}
      </div>
    </div>
  );
}

export function Tile({
  label,
  value,
  unit,
  sub,
  kind,
  help,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  sub?: ReactNode;
  kind?: StatusKind;
  help?: HelpEntry;
}) {
  return (
    <div className={`tile${kind ? ` tile-${kind}` : ''}`}>
      <div className="tile-label">
        {label}
        {help && <InfoTip help={help} label={label} />}
      </div>
      <div className="tile-value">
        <span className="tile-num">{value}</span>
        {unit && <span className="tile-unit">{unit}</span>}
      </div>
      {sub && <div className="tile-sub">{sub}</div>}
    </div>
  );
}

export function HintBanner({ text, onDismiss }: { text: string; onDismiss: () => void }) {
  return (
    <div className="hintbar" role="note">
      <Icon name="sparkles" size={16} className="hintbar-icon" />
      <span className="hintbar-text">{text}</span>
      <button type="button" className="hintbar-x" onClick={onDismiss} aria-label="Dismiss this tip">
        <Icon name="x" size={15} />
      </button>
    </div>
  );
}

export function EmptyState({ title, children, icon = 'info' }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
      <Icon name={icon} size={26} className="empty-icon" />
      <strong className="empty-title">{title}</strong>
      {children && <div className="empty-text">{children}</div>}
    </div>
  );
}

export function ProgressBar({ fraction, label }: { fraction: number; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
  return (
    <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={label}>
      <div className="progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Table that turns into stacked cards when its container is narrower than `threshold` px
// ---------------------------------------------------------------------------

export function ResponsiveTable({ threshold, className, children }: { threshold: number; className?: string; children: ReactNode }) {
  const [ref, w] = useWidth<HTMLDivElement>(1000);
  return (
    <div className="table-wrap" ref={ref}>
      <table className={`rtable${w < threshold ? ' is-cards' : ''}${className ? ` ${className}` : ''}`}>{children}</table>
    </div>
  );
}

/** Unit text that only shows when a table is stacked into cards (the column headers carry units otherwise). */
export function Cu({ children }: { children: ReactNode }) {
  return <span className="cu">{' '}{children}</span>;
}
