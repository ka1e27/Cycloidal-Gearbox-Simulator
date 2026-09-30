import { JOINT_IDS, JOINT_PRESET_SPECS } from '../../calc';
import type { Slot } from '../session';

/** J1 J2 J3 J4 Custom chips (radio group). */
export function JointChips({ value, onChange, label = 'Joint' }: { value: Slot; onChange: (s: Slot) => void; label?: string }) {
  const items: { slot: Slot; text: string; title: string }[] = [
    ...JOINT_IDS.map((j) => ({ slot: j as Slot, text: j, title: JOINT_PRESET_SPECS[j].label })),
    { slot: 'custom', text: 'Custom', title: 'Your own geometry and torques' },
  ];
  const onKey = (e: React.KeyboardEvent) => {
    const i = items.findIndex((x) => x.slot === value);
    let n = i;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') n = (i + 1) % items.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') n = (i - 1 + items.length) % items.length;
    else return;
    e.preventDefault();
    onChange(items[n].slot);
    const el = (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[n];
    el?.focus();
  };
  return (
    <div className="chips" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {items.map((it) => (
        <button
          key={it.slot}
          type="button"
          role="radio"
          aria-checked={it.slot === value}
          tabIndex={it.slot === value ? 0 : -1}
          title={it.title}
          className={`chip-btn${it.slot === value ? ' is-on' : ''}`}
          onClick={() => onChange(it.slot)}
        >
          {it.text}
        </button>
      ))}
    </div>
  );
}
