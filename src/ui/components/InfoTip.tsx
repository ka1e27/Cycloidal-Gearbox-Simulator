import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { HelpEntry } from '../help';

/**
 * "?" button with a popover. Opens on mouse hover, keyboard focus and click/tap (click pins it open).
 * Escape or an outside click closes it. The popover is positioned in the viewport and clamped so it
 * never causes horizontal scroll, even at 380 px.
 */
export function InfoTip({ help, label }: { help: HelpEntry; label: string }) {
  const id = useId();
  const btn = useRef<HTMLButtonElement>(null);
  const pop = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState(false);
  const [kbFocus, setKbFocus] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [pos, setPos] = useState<{ left: number; top: number; arrow: number; above: boolean } | null>(null);
  const open = hover || kbFocus || pinned;

  const place = useCallback(() => {
    const b = btn.current;
    const p = pop.current;
    if (!b || !p) return;
    const r = b.getBoundingClientRect();
    const w = p.offsetWidth;
    const h = p.offsetHeight;
    const vw = document.documentElement.clientWidth;
    const vh = window.innerHeight;
    const cx = r.left + r.width / 2;
    const left = Math.min(Math.max(8, cx - w / 2), Math.max(8, vw - w - 8));
    const below = r.bottom + 8 + h <= vh || r.top - 8 - h < 0;
    const top = below ? r.bottom + 8 : r.top - 8 - h;
    setPos({ left, top, arrow: Math.min(Math.max(12, cx - left), w - 12), above: !below });
  }, []);

  useLayoutEffect(() => {
    if (open) place();
    else setPos(null);
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onScroll = () => place();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setPinned(false);
        setHover(false);
        setKbFocus(false);
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (btn.current?.contains(t) || pop.current?.contains(t)) return;
      setPinned(false);
    };
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', onScroll);
    document.addEventListener('keydown', onKey);
    document.addEventListener('pointerdown', onDown);
    return () => {
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', onScroll);
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('pointerdown', onDown);
    };
  }, [open, place]);

  return (
    <>
      <button
        ref={btn}
        type="button"
        className="infotip-btn"
        aria-label={`About ${label}`}
        aria-expanded={open}
        aria-describedby={open ? id : undefined}
        onPointerEnter={(e) => { if (e.pointerType === 'mouse') setHover(true); }}
        onPointerLeave={(e) => { if (e.pointerType === 'mouse') setHover(false); }}
        onFocus={(e) => { if (e.currentTarget.matches(':focus-visible')) setKbFocus(true); }}
        onBlur={() => setKbFocus(false)}
        onClick={() => setPinned((v) => !v)}
      >
        ?
      </button>
      {open &&
        createPortal(
          <div
            ref={pop}
            id={id}
            role="tooltip"
            className={`infotip-pop${pos ? ' is-placed' : ''}`}
            style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, ['--arrow' as string]: `${pos?.arrow ?? 20}px` }}
            data-above={pos?.above ? 'true' : undefined}
          >
            <strong className="infotip-title">{help.title ?? label}</strong>
            <span>{help.what}</span>
            {help.typical && (
              <span className="infotip-typical">
                <em>Typical:</em> {help.typical}
              </span>
            )}
          </div>,
          document.body,
        )}
    </>
  );
}
