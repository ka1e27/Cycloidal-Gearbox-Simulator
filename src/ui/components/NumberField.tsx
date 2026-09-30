import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { HelpEntry } from '../help';
import { InfoTip } from './InfoTip';

function show(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return '';
  return String(parseFloat(v.toPrecision(12)));
}

function parse(text: string): number | null | undefined {
  // null = empty, undefined = not a number
  const t = text.trim().replace(',', '.');
  if (t === '') return null;
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return undefined;
  const n = Number(t);
  return Number.isFinite(n) ? n : undefined;
}

function decimalsOf(step: number): number {
  const s = String(step);
  const i = s.indexOf('.');
  return i < 0 ? 0 : s.length - i - 1;
}

export interface NumberFieldProps {
  label: ReactNode;
  /** Plain-text label for aria, e.g. when `label` is JSX */
  labelText?: string;
  value: number | null;
  onChange: (v: number | null) => void;
  unit?: string;
  help?: HelpEntry;
  /** Value to compare with for the "modified from default" dot (null = default is empty) */
  defaultValue?: number | null;
  /** Shows the dot only when this is provided; clicking it resets to the default. */
  error?: string | null;
  warning?: string | null;
  step?: number;
  /** Empty field means null (automatic). Otherwise an empty field is an error and is not committed. */
  nullable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  /** Small note under the field */
  note?: ReactNode;
  className?: string;
}

/**
 * Labelled numeric input with unit suffix, "?" tooltip, inline validation and a "modified" dot.
 * Keeps a text draft so partial input like "1." or "-" never fights the user; commits live while the
 * text is a valid number.
 */
export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const errId = `${id}-msg`;
  const { value, onChange, nullable } = p;
  const [draft, setDraft] = useState(show(value));
  const [localErr, setLocalErr] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(show(value));
      return;
    }
    const parsed = parse(draft);
    if (parsed !== undefined && parsed !== value) setDraft(show(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (text: string) => {
    setDraft(text);
    const parsed = parse(text);
    if (parsed === undefined) {
      setLocalErr('Enter a number');
      return;
    }
    if (parsed === null && !nullable) {
      setLocalErr('Enter a number');
      return;
    }
    setLocalErr(null);
    if (parsed !== value) onChange(parsed);
  };

  const step = p.step ?? 1;
  const nudge = (dir: 1 | -1, mult: number) => {
    const cur = parse(draft);
    const base = typeof cur === 'number' ? cur : (value ?? 0);
    const dp = Math.max(decimalsOf(step), 0) + (mult < 1 ? 1 : 0);
    const next = Number((base + dir * step * mult).toFixed(Math.min(dp, 10)));
    commit(show(next));
  };

  const modified =
    p.defaultValue !== undefined &&
    !(p.defaultValue === value || (p.defaultValue != null && value != null && Math.abs(p.defaultValue - value) < 1e-9));

  const err = localErr ?? p.error ?? null;
  const warn = !err ? p.warning ?? null : null;
  const labelText = p.labelText ?? (typeof p.label === 'string' ? p.label : 'field');

  return (
    <div className={`nf${err ? ' has-error' : warn ? ' has-warning' : ''}${p.disabled ? ' is-disabled' : ''}${p.className ? ` ${p.className}` : ''}`}>
      <div className="nf-head">
        <label htmlFor={id} className="nf-label">{p.label}</label>
        {modified && (
          <button
            type="button"
            className="nf-dot"
            title={`Modified from default (${p.defaultValue == null ? 'empty' : show(p.defaultValue)}${p.unit ? ' ' + p.unit : ''}). Click to reset.`}
            aria-label={`${labelText} differs from its default. Reset to default.`}
            onClick={() => { setLocalErr(null); onChange(p.defaultValue ?? null); }}
          />
        )}
        {p.help && <InfoTip help={p.help} label={labelText} />}
      </div>
      <div className="nf-box">
        <input
          id={id}
          className="nf-input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={draft}
          disabled={p.disabled}
          placeholder={p.placeholder}
          aria-invalid={err ? true : undefined}
          aria-describedby={err || warn || p.note ? errId : undefined}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; setLocalErr(null); setDraft(show(value)); }}
          onChange={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (p.disabled) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
            }
          }}
        />
        {p.unit && <span className="nf-unit" aria-hidden="true">{p.unit}</span>}
      </div>
      {(err || warn || p.note) && (
        <div id={errId} className={`nf-msg${err ? ' is-error' : warn ? ' is-warning' : ''}`} role={err ? 'alert' : undefined}>
          {err ?? warn ?? p.note}
        </div>
      )}
    </div>
  );
}
