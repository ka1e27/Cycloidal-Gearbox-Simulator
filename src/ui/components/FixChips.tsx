// Buttons that apply a fix from the fix engine: the field chip of Gearbox design ("▲ 92 mm fixes it"), the "How to fix"
// line of a check row, and the small count badges. The side effects show on hover and keyboard focus; a click applies
// the fix as one undoable step.
import { useId, useState } from 'react';
import type { Fix, FixCheckEntry, FixReport } from '../../calc';
import { fixCountText, fixResultText } from '../fixes';
import { useStore } from '../store';
import type { U } from '../units';

const ARROW: Record<Fix['direction'], string> = { up: '▲', down: '▼', change: '→' };

/** Target value of a fix in the display units: "92 mm" / "3.62 in", "2", "Aluminum 7075-T6". */
export function fixToText(f: Fix, u: U): string {
  if (f.toValue != null && (f.field === 'D' || f.field === 'e' || f.field === 'L')) {
    return u.fu('length', f.toValue, { dp: f.field === 'D' ? 1 : 3, trim: true });
  }
  if (f.field === 'discs') return `${f.toValue} discs`;
  if (f.field === 'Zp') return f.to;
  return u.text(f.to);
}

/** What a fix does and costs, in one or two plain sentences. */
function costText(fix: Fix, u: U): string {
  const res = fix.passesTarget
    ? `Every check passes (max ${fix.newMaxUtil.toFixed(2)}).`
    : `Max utilization ${fix.newMaxUtil.toFixed(2)}${fix.passesLimit ? ' (under 1.00, not green)' : ''}; ${fix.governing.toLowerCase()} still governs.`;
  const cost = fix.sideEffects.length ? `It costs: ${fix.sideEffects.map((l) => u.text(l)).join('; ')}.` : 'Nothing else changes.';
  const exact = fix.exactMin != null && fix.field === 'L' ? ` Exact minimum ${u.fu('length', fix.exactMin, { dp: 2, trim: true })}.` : '';
  return `${fix.label} ${u.text(fix.from)} → ${u.text(fix.to)}. ${res} ${cost}${exact}`;
}

/**
 * Chip next to a field in Gearbox design: "▲ 92 mm fixes it" / "▲ 12.7 mm helps (0.96)". What it costs shows under it on
 * hover and keyboard focus (in the flow, so a scrolling column never clips it); a click applies it.
 */
export function FixChip({ fix, onApply }: { fix: Fix; onApply: (f: Fix) => void }) {
  const { u } = useStore();
  const id = useId();
  const word = fix.passesTarget ? 'fixes it' : `helps (${fixResultText(fix)})`;
  return (
    <span className="fix-chip-wrap">
      <button type="button" className={`fix-chip${fix.passesTarget ? ' is-pass' : ''}`} aria-describedby={id} onClick={() => onApply(fix)}
        aria-label={`Apply: ${fix.label} to ${fixToText(fix, u)}, ${fix.passesTarget ? 'fixes every check' : `max utilization ${fixResultText(fix)}`}`}>
        <span className="fix-chip-mark" aria-hidden="true">{fix.passesTarget ? 'FIX' : 'HELPS'}</span>
        <span>{ARROW[fix.direction]} {fixToText(fix, u)} {word}</span>
      </button>
      <span className="fix-cost" id={id}>{costText(fix, u)} Click to apply; you can undo it.</span>
    </span>
  );
}

/** "How to fix" line under a check row: the top 3 fixes that lower this check, with what the hovered / focused one costs. */
export function FixLine({ entry, report, onApply, max = 3 }: { entry: FixCheckEntry; report: FixReport; onApply: (f: Fix) => void; max?: number }) {
  const { u } = useStore();
  const [active, setActive] = useState<number | null>(null);
  const id = useId();
  const items = entry.fixes.slice(0, max).map((i) => report.fixes[i]).filter(Boolean);
  if (!items.length) {
    return <div className="fix-line"><span className="fix-line-h">How to fix</span> <span className="muted">No single change helps here. Try the Design Advisor.</span></div>;
  }
  const shown = active != null ? items[active] : null;
  return (
    <div className="fix-line" onMouseLeave={() => setActive(null)}>
      <span className="fix-line-h">How to fix</span>
      {items.map((f, i) => (
        <button key={`${f.field}-${f.to}`} type="button" className={`fix-btn${f.passesTarget ? ' is-pass' : ''}`} aria-describedby={`${id}-${i}`}
          onMouseEnter={() => setActive(i)} onFocus={() => setActive(i)} onBlur={() => setActive(null)} onClick={() => onApply(f)}>
          {u.text(f.short)} <span className="fix-btn-res">({fixResultText(f)})</span>
          <span className="visually-hidden" id={`${id}-${i}`}>{costText(f, u)}</span>
        </button>
      ))}
      {shown && <span className="fix-line-cost" aria-hidden="true">{costText(shown, u)} Click to apply; you can undo it.</span>}
    </div>
  );
}

/** Small count badge: "4 fixes". `invite`: the section is closed, so it says to open it. */
export function FixBadge({ fixes, invite, compact }: { fixes: Fix[]; invite?: boolean; compact?: boolean }) {
  const text = fixCountText(fixes);
  if (!text) return null;
  const pass = fixes.some((f) => f.passesTarget);
  return (
    <span className={`fix-badge${pass ? ' is-pass' : ''}${compact ? ' is-compact' : ''}`}
      title={invite ? 'Open this section: the fields that can fix the design are highlighted' : 'Fields that can fix the design are highlighted'}>
      {compact ? (pass ? fixes.filter((f) => f.passesTarget).length : fixes.length) : text}{invite && !compact ? ' · open' : ''}
    </span>
  );
}
