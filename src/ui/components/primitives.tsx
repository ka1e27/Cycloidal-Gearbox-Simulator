import { useId, useRef, useState, type ButtonHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import type { HelpEntry } from '../help';
import { useU } from '../store';
import { useWidth } from '../viz/useWidth';
import { Icon, type IconName } from './Icon';
import { InfoTip } from './InfoTip';

export { Icon };

// ---------------------------------------------------------------------------
// Button
// ---------------------------------------------------------------------------

export function Button({
  variant = 'secondary',
  size = 'md',
  icon,
  iconAfter,
  className,
  children,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  icon?: IconName;
  iconAfter?: IconName;
}) {
  return (
    <button type="button" className={`btn btn-${variant} btn-${size}${className ? ` ${className}` : ''}`} {...rest}>
      {icon && <Icon name={icon} size={size === 'sm' ? 14 : 16} />}
      {children}
      {iconAfter && <Icon name={iconAfter} size={size === 'sm' ? 14 : 16} />}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

/** A ruled block: mono caption, hairline, content. */
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
          <h3 className="card-title">{title}</h3>
          {actions && <div className="card-actions">{actions}</div>}
        </header>
      )}
      {subtitle && <p className="card-sub">{subtitle}</p>}
      {children}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Collapsible input sections
// ---------------------------------------------------------------------------

export function Section({
  title,
  summary,
  defaultOpen = true,
  children,
  help,
  badge,
}: {
  title: string;
  summary?: ReactNode;
  defaultOpen?: boolean;
  children: ReactNode;
  help?: HelpEntry;
  /** Small marker next to the title (e.g. the fix count), shown open or closed */
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <section className={`section${open ? ' is-open' : ''}`}>
      <h3 className="section-h">
        <button type="button" className="section-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <span className="section-title">{title}</span>
          {badge}
          {summary && <span className="section-summary">{summary}</span>}
          <Icon name="chevron" size={14} className="section-chevron" />
        </button>
        {help && <InfoTip help={help} label={title} />}
      </h3>
      <div className="section-body" id={id} inert={!open}>
        <div className="section-inner">{children}</div>
      </div>
    </section>
  );
}

/** Secondary, collapsed-by-default group inside a section. */
export function Advanced({ children, label = 'Advanced', defaultOpen = false, badge }: {
  children: ReactNode; label?: string; defaultOpen?: boolean;
  /** Marker on the header (e.g. "fix inside"), so a collapsed group still shows what it holds */
  badge?: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const id = useId();
  return (
    <div className={`adv${open ? ' is-open' : ''}`}>
      <button type="button" className="adv-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
        <Icon name="chevron" size={12} className="adv-chevron" />
        {label}
        {badge}
      </button>
      <div className="adv-body" id={id} inert={!open}>
        <div className="adv-inner">{children}</div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Form-sheet row: name + symbol on the left, control on the right
// ---------------------------------------------------------------------------

export function FieldRow({
  label,
  symbol,
  help,
  htmlFor,
  children,
  message,
  messageKind,
  messageId,
  stacked,
  modifiedDot,
  className,
  addon,
}: {
  label: ReactNode;
  symbol?: string;
  help?: HelpEntry;
  htmlFor?: string;
  children: ReactNode;
  message?: ReactNode;
  messageKind?: 'error' | 'warning' | 'note';
  messageId?: string;
  stacked?: boolean;
  modifiedDot?: ReactNode;
  className?: string;
  /** Extra line under the control (e.g. a "fixes it" chip) */
  addon?: ReactNode;
}) {
  const u = useU();
  const labelText = typeof label === 'string' ? label : 'field';
  return (
    <div className={`row${stacked ? ' row-stacked' : ''}${messageKind === 'error' ? ' has-error' : messageKind === 'warning' ? ' has-warning' : ''}${className ? ` ${className}` : ''}`}>
      <div className="row-label">
        {htmlFor ? <label htmlFor={htmlFor} className="row-name">{label}</label> : <span className="row-name">{label}</span>}
        {symbol && <span className="row-sym" aria-hidden="true">{symbol}</span>}
        {modifiedDot}
        {help && <InfoTip help={help} label={labelText} />}
      </div>
      <div className="row-control">{children}</div>
      {message && (
        <div id={messageId} className={`row-msg${messageKind === 'error' ? ' is-error' : messageKind === 'warning' ? ' is-warning' : ''}`} role={messageKind === 'error' ? 'alert' : undefined}>
          {typeof message === 'string' ? u.text(message) : message}
        </div>
      )}
      {addon && <div className="row-addon">{addon}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Status marker (square + uppercase mono word) and utilization bar
// ---------------------------------------------------------------------------

export type StatusKind = 'ok' | 'marginal' | 'fail' | 'neutral';

export function verdictKind(v: string): StatusKind {
  return v === 'pass' || v === 'ok' ? 'ok' : v === 'marginal' ? 'marginal' : v === 'fail' ? 'fail' : 'neutral';
}

export const STATUS_WORD: Record<StatusKind, string> = { ok: 'PASS', marginal: 'MARGINAL', fail: 'FAIL', neutral: 'N/A' };

export function StatusChip({ kind, children }: { kind: StatusKind; children: ReactNode; size?: 'sm' | 'md' }) {
  return (
    <span className={`st st-${kind}`}>
      <i className="st-sq" aria-hidden="true" />
      {children}
    </span>
  );
}

/** Utilization bar: scale 0..1.2 with ticks at 0.85 and 1.0. */
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
  help,
  helpLabel,
}: {
  value: T;
  options: { value: T; label: ReactNode; title?: string }[];
  onChange: (v: T) => void;
  label: string;
  size?: 'sm' | 'md';
  fullWidth?: boolean;
  /** Info tip shown right after the group (for a segmented control that is not inside a FieldRow) */
  help?: HelpEntry;
  /** Name in the tip's title and its "About …" label; defaults to `label` */
  helpLabel?: string;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const matched = options.findIndex((o) => o.value === value);
  const idx = Math.max(0, matched);
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
  const group = (
    <div className={`seg seg-${size}${fullWidth ? ' seg-full' : ''}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {options.map((o, i) => (
        <button
          key={String(o.value)}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={i === idx ? 0 : -1}
          title={o.title}
          className={`seg-btn${o.value === value ? ' is-on' : ''}`}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
  if (!help) return group;
  return (
    <span className={`seg-tip${fullWidth ? ' seg-tip-full' : ''}`}>
      {group}
      <InfoTip help={help} label={helpLabel ?? label} />
    </span>
  );
}

// ---------------------------------------------------------------------------
// Select, switch
// ---------------------------------------------------------------------------

export function SelectField({
  label,
  symbol,
  value,
  onChange,
  options,
  help,
  note,
  inline,
  className,
  addon,
}: {
  label: string;
  symbol?: string;
  value: string;
  onChange: (v: string) => void;
  /** `title`: optional one-line hover text for the option. `group`: consecutive options with the same group form an optgroup. */
  options: { value: string; label: string; disabled?: boolean; title?: string; group?: string }[];
  addon?: ReactNode;
  help?: HelpEntry;
  note?: ReactNode;
  /** Label on the left, select on the right (short lists). Default is stacked: label above a full-width select. */
  inline?: boolean;
  className?: string;
}) {
  const id = useId();
  return (
    <FieldRow label={label} symbol={symbol} help={help} htmlFor={id} stacked={!inline} message={note} className={className} addon={addon}>
      <div className="sf-box">
        <select id={id} className="sf-select" value={value} onChange={(e) => onChange(e.target.value)}>
          {groupOptions(options).map((g, gi) => (g.group == null
            ? g.items.map((o) => <option key={o.value} value={o.value} disabled={o.disabled} title={o.title}>{o.label}</option>)
            : (
              <optgroup key={`g${gi}`} label={g.group}>
                {g.items.map((o) => <option key={o.value} value={o.value} disabled={o.disabled} title={o.title}>{o.label}</option>)}
              </optgroup>
            )))}
        </select>
        <Icon name="chevron" size={14} className="sf-chevron" />
      </div>
    </FieldRow>
  );
}

type SelOpt = { value: string; label: string; disabled?: boolean; title?: string; group?: string };
/** Consecutive options with the same `group` become one optgroup; options without a group stay loose. */
function groupOptions(options: SelOpt[]): { group: string | null; items: SelOpt[] }[] {
  const out: { group: string | null; items: SelOpt[] }[] = [];
  for (const o of options) {
    const g = o.group ?? null;
    const last = out[out.length - 1];
    if (last && last.group === g) last.items.push(o);
    else out.push({ group: g, items: [o] });
  }
  return out;
}

export function Switch({
  checked,
  onChange,
  label,
  description,
  help,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  description?: ReactNode;
  help?: HelpEntry;
}) {
  const id = useId();
  return (
    <div className="switch-row">
      <button id={id} type="button" role="switch" aria-checked={checked} className={`switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
        <span className="switch-knob" />
      </button>
      <label htmlFor={id} className="switch-text">
        <span className="switch-label">{label}</span>
        {description && <span className="switch-desc">{description}</span>}
      </label>
      {help && <InfoTip help={help} label={label} />}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Notices, data tables, empty states
// ---------------------------------------------------------------------------

const NOTICE_WORD = { info: 'NOTE', warning: 'WARNING', error: 'ERROR', success: 'DONE' } as const;

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
  return (
    <div className={`notice notice-${kind}`} role={kind === 'error' ? 'alert' : undefined}>
      <span className="notice-tag">{NOTICE_WORD[kind]}</span>
      <div className="notice-body">
        {title && <strong className="notice-title">{title}</strong>}
        {children && <div className="notice-text">{children}</div>}
        {actions && <div className="notice-actions">{actions}</div>}
      </div>
    </div>
  );
}

/** Two-column spec table: label | value unit. */
export function DataTable({ rows, columns = 2 }: { rows: { label: string; value: ReactNode; note?: ReactNode; flag?: StatusKind }[]; columns?: 1 | 2 }) {
  return (
    <dl className={`dtable dtable-${columns}`}>
      {rows.map((r) => (
        <div className="dtable-row" key={r.label}>
          <dt>{r.label}</dt>
          <dd>
            <span className={r.flag && r.flag !== 'ok' && r.flag !== 'neutral' ? `flag-${r.flag}` : undefined}>{r.value}</span>
            {r.note && <small>{r.note}</small>}
          </dd>
        </div>
      ))}
    </dl>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode; icon?: IconName }) {
  return (
    <div className="empty">
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
// Table that turns into stacked rows when its container is narrower than `threshold` px
// ---------------------------------------------------------------------------

export function ResponsiveTable({ threshold, className, children }: { threshold: number; className?: string; children: ReactNode }) {
  const [ref, w] = useWidth<HTMLDivElement>(1000);
  return (
    <div className="table-wrap" ref={ref}>
      <table className={`rtable${w < threshold ? ' is-cards' : ''}${className ? ` ${className}` : ''}`}>{children}</table>
    </div>
  );
}

/** Unit text that only shows when a table is stacked (the column headers carry units otherwise). */
export function Cu({ children }: { children: ReactNode }) {
  return <span className="cu">{' '}{children}</span>;
}
