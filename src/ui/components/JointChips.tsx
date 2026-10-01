import { useMemo } from 'react';
import { jointLabel } from '../../calc';
import { CUSTOM, gearboxJoints, type Slot } from '../session';
import { MotionIcon } from '../viz/armSymbols';
import { useStore } from '../store';

/** One chip per cycloidal joint of the arm (servo joints have no gearbox), then Custom. Radio group. */
export function JointChips({ value, onChange, label = 'Joint' }: { value: Slot; onChange: (s: Slot) => void; label?: string }) {
  const { state } = useStore();
  const arm = state.arm;
  const items = useMemo(() => {
    const list: { slot: Slot; text: string; sub: string; title: string; motion: 'yaw' | 'pitch' | 'roll' | null }[] = gearboxJoints(arm).map((j) => {
      const i = arm.joints.findIndex((x) => x.id === j.id);
      return { slot: j.id, text: `J${i + 1}`, sub: j.name.trim(), title: jointLabel(j, i), motion: j.motion };
    });
    list.push({ slot: CUSTOM, text: 'Custom', sub: '', title: 'Your own geometry and torques', motion: null });
    return list;
  }, [arm]);
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
  const sel = items.findIndex((x) => x.slot === value);
  return (
    <div className="chips" role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {items.map((it, k) => (
        <button
          key={it.slot}
          type="button"
          role="radio"
          aria-checked={it.slot === value}
          tabIndex={it.slot === value || (sel < 0 && k === 0) ? 0 : -1}
          title={it.title}
          aria-label={it.title}
          className={`chip-btn${it.slot === value ? ' is-on' : ''}`}
          onClick={() => onChange(it.slot)}
        >
          {it.motion && <MotionIcon motion={it.motion} size={16} />}
          <span className="chip-text">{it.text}</span>
          {it.sub && <span className="chip-sub">{it.sub}</span>}
        </button>
      ))}
    </div>
  );
}
