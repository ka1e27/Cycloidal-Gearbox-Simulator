import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { HelpEntry } from '../help';
import { useU } from '../store';
import { inputText, niceStep, type Quantity } from '../units';
import { FieldRow } from './primitives';

function showNum(v: number): string {
  return String(parseFloat(v.toPrecision(12)));
}

/** Text typed into a number box. null = empty, undefined = not a number. Exported for tests. */
export function parseNumberText(text: string): number | null | undefined {
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
  /** Plain-language name */
  label: string;
  /** Short symbol shown in mono next to the name, e.g. "D" */
  symbol?: string;
  /** Stored value, always SI (mm, g, N, N*m, MPa) when `quantity` is set */
  value: number | null;
  /** Receives the SI value converted from exactly what was typed */
  onChange: (v: number | null) => void;
  /** Converted quantity: the box shows and accepts the chosen display unit */
  quantity?: Quantity;
  /** Fixed unit suffix for values that are never converted (rpm, h, rad/s², ...) */
  unit?: string;
  help?: HelpEntry;
  /** Default (SI) for the "modified" marker; pass undefined to hide it */
  defaultValue?: number | null;
  error?: string | null;
  warning?: string | null;
  /** Arrow-key step, in SI units of the quantity */
  step?: number;
  /** Empty field means null (automatic). Otherwise an empty field is an error and is not committed. */
  nullable?: boolean;
  placeholder?: string;
  disabled?: boolean;
  note?: ReactNode;
  className?: string;
}

/**
 * Datasheet row: name and symbol on the left, number box with unit on the right.
 * Keeps a text draft so partial input like "1." never fights the user, commits live while the text is a
 * valid number, and converts display units <-> SI only at this boundary.
 */
export function NumberField(p: NumberFieldProps) {
  const id = useId();
  const msgId = `${id}-msg`;
  const u = useU();
  const q = p.quantity;
  const { value, onChange, nullable } = p;
  const toText = (v: number | null) => (v == null || !Number.isFinite(v) ? '' : q ? inputText(q, v, u.prefs) : showNum(v));
  const toSI = (n: number) => (q ? u.fromDisplay(q, n) : n);

  const [draft, setDraft] = useState(toText(value));
  const [localErr, setLocalErr] = useState<string | null>(null);
  const focused = useRef(false);

  useEffect(() => {
    if (!focused.current) {
      setDraft(toText(value));
      return;
    }
    const parsed = parseNumberText(draft);
    if (parsed !== undefined && (parsed === null ? value !== null : toSI(parsed) !== value)) setDraft(toText(value));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, u]);

  const commit = (text: string) => {
    setDraft(text);
    const parsed = parseNumberText(text);
    if (parsed === undefined || (parsed === null && !nullable)) {
      setLocalErr('Enter a number');
      return;
    }
    setLocalErr(null);
    const si = parsed === null ? null : toSI(parsed);
    if (si !== value) onChange(si);
  };

  const step = q ? niceStep(q, p.step ?? 1, u.prefs) : p.step ?? 1;
  const nudge = (dir: 1 | -1, mult: number) => {
    const cur = parseNumberText(draft);
    const base = typeof cur === 'number' ? cur : value != null ? (q ? u.toDisplay(q, value) : value) : 0;
    const dp = decimalsOf(step) + (mult < 1 ? 1 : 0);
    const next = Number((base + dir * step * mult).toFixed(Math.min(dp, 10)));
    commit(showNum(next));
  };

  const same = (a: number | null | undefined, b: number | null) =>
    a === b || (a != null && b != null && Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a)));
  const modified = p.defaultValue !== undefined && !same(p.defaultValue, value);

  const err = localErr ?? (p.error ? u.text(p.error) : null);
  const warn = !err && p.warning ? u.text(p.warning) : null;
  const suffix = q ? u.sym(q) : p.unit;
  const defText = p.defaultValue == null ? 'empty' : `${toText(p.defaultValue)}${suffix ? ' ' + suffix : ''}`;

  const dot = modified ? (
    <button
      type="button"
      className="nf-dot"
      title={`Changed from default (${defText}). Click to restore.`}
      aria-label={`${p.label} differs from its default. Restore default.`}
      onClick={() => { setLocalErr(null); onChange(p.defaultValue ?? null); }}
    />
  ) : null;

  return (
    <FieldRow
      label={p.label}
      symbol={p.symbol}
      help={p.help}
      htmlFor={id}
      modifiedDot={dot}
      message={err ?? warn ?? p.note}
      messageKind={err ? 'error' : warn ? 'warning' : 'note'}
      messageId={msgId}
      className={`nf${p.disabled ? ' is-disabled' : ''}${p.className ? ` ${p.className}` : ''}`}
    >
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
          aria-describedby={err || warn || p.note ? msgId : undefined}
          onFocus={() => { focused.current = true; }}
          onBlur={() => { focused.current = false; setLocalErr(null); setDraft(toText(value)); }}
          onChange={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (p.disabled) return;
            if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
              e.preventDefault();
              nudge(e.key === 'ArrowUp' ? 1 : -1, e.shiftKey ? 10 : e.altKey ? 0.1 : 1);
            }
          }}
        />
        {suffix && <span className="nf-unit" aria-hidden="true">{suffix}</span>}
      </div>
    </FieldRow>
  );
}
