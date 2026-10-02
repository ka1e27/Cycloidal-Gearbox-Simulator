// The one-screen workbench (CLAUDE.md Addition 10): left rail "Joints", centre stage, right inspector. Desktop (>= 1100 px):
// a 100dvh grid where each column scrolls on its own. Narrow: a joint strip under the header and bottom tabs
// View | Details | Summary.
import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent as RPointerEvent } from 'react';
import { useStore } from '../store';
import { DiscThetaProvider } from './discTheta';
import { Inspector } from './Inspector';
import { PoseLiveProvider } from './poseLive';
import { JointStrip, Rail } from './Rail';
import { prefetchWorkbench, Stage } from './Stage';
import { selectionLabel } from './sections';
import { formatHash, INSP_MAX, INSP_MIN, parseHash, type MobileTab } from './wbState';

const WIDE = '(min-width: 1100px)';

function useWide(): boolean {
  const get = () => {
    try { return window.matchMedia(WIDE).matches; } catch { return true; }
  };
  const [wide, setWide] = useState(get);
  useEffect(() => {
    let mq: MediaQueryList;
    try { mq = window.matchMedia(WIDE); } catch { return; }
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    // some environments resize without a media-query change event: check on resize too
    window.addEventListener('resize', on);
    return () => { mq.removeEventListener('change', on); window.removeEventListener('resize', on); };
  }, []);
  return wide;
}

/** Keep `#/joint/J2`-style hashes in step with the selection, so browser Back moves between selections. */
function useHashSync() {
  const { state, selectItem, setStage, openSection } = useStore();
  const sel = state.wb.sel;
  const applying = useRef(false);
  // initial load and Back / Forward: the hash wins
  useEffect(() => {
    const apply = () => {
      const t = parseHash(window.location.hash);
      if (!t) return;
      applying.current = true;
      if (t.stage) setStage(t.stage);
      if (t.sel) {
        if (t.section) openSection(t.section, t.sel);
        else selectItem(t.sel);
      }
      window.setTimeout(() => { applying.current = false; }, 0);
    };
    apply();
    window.addEventListener('popstate', apply);
    return () => window.removeEventListener('popstate', apply);
  }, [selectItem, setStage, openSection]);
  // selection changed in the app: push a history entry (replace the first one)
  const first = useRef(true);
  useEffect(() => {
    const h = formatHash(sel);
    try {
      const cur = parseHash(window.location.hash);
      if (first.current) {
        first.current = false;
        // a hash that names a selection is being applied by the effect above; otherwise record the current one
        if (!cur || !cur.sel) window.history.replaceState(null, '', h);
        return;
      }
      if (applying.current || (cur && cur.sel === sel)) return;
      window.history.pushState(null, '', h);
    } catch { /* sandboxed: no history */ }
  }, [sel]);
}

export function Workbench() {
  const { state, patchWb, dispatch } = useStore();
  const wide = useWide();
  useHashSync();
  const wb = state.wb;

  // prefetch the lazy views once the first screen is up
  useEffect(() => {
    const w = window as Window & { requestIdleCallback?: (cb: () => void) => number };
    const t = w.requestIdleCallback ? w.requestIdleCallback(prefetchWorkbench) : window.setTimeout(prefetchWorkbench, 1500);
    return () => { if (!w.requestIdleCallback) window.clearTimeout(t); };
  }, []);

  // the first-visit hint goes away once the user picks something
  const firstSel = useRef(wb.sel);
  useEffect(() => {
    if (wb.sel !== firstSel.current && !state.hintsSeen.workbench) dispatch({ type: 'hint', key: 'workbench' });
  }, [wb.sel, state.hintsSeen.workbench, dispatch]);

  const announce = `Selected ${selectionLabel(state, wb.sel)}`;

  return (
    <PoseLiveProvider>
      <DiscThetaProvider>
        <div className="visually-hidden" aria-live="polite">{announce}</div>
        {wide ? (
          <div className={`wb${wb.railCollapsed ? ' rail-collapsed' : ''}`} style={{ ['--insp-w' as string]: `${wb.inspW}px` }}>
            <div className="wb-rail"><Rail /></div>
            <main id="main" className="wb-stage" tabIndex={-1}><Stage /></main>
            <ResizeHandle />
            <aside className="wb-insp" aria-label="Inspector"><Inspector /></aside>
          </div>
        ) : (
          <div className="wbn">
            <JointStrip />
            <main id="main" className="wbn-main" tabIndex={-1}>
              {wb.mobile === 'view' && <div className="wbn-view"><Stage /></div>}
              {wb.mobile === 'details' && <div className="wbn-details"><Inspector /></div>}
              {wb.mobile === 'summary' && <div className="wbn-summary"><SummaryOnly /></div>}
            </main>
            <BottomTabs value={wb.mobile} onChange={(m) => patchWb(m === 'summary' ? { mobile: m, stage: 'summary' } : m === 'view' && wb.stage === 'summary' ? { mobile: m, stage: '3d' } : { mobile: m })} />
          </div>
        )}
      </DiscThetaProvider>
    </PoseLiveProvider>
  );
}

/** Narrow screens: the Summary tab shows the stage's Summary view on its own. */
function SummaryOnly() {
  return <Stage showTabs={false} />;
}

function BottomTabs({ value, onChange }: { value: MobileTab; onChange: (m: MobileTab) => void }) {
  const tabs: { id: MobileTab; label: string }[] = [
    { id: 'view', label: 'View' }, { id: 'details', label: 'Details' }, { id: 'summary', label: 'Summary' },
  ];
  const onKey = (e: KeyboardEvent) => {
    const i = tabs.findIndex((t) => t.id === value);
    let n = -1;
    if (e.key === 'ArrowRight') n = (i + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') n = (i - 1 + tabs.length) % tabs.length;
    if (n < 0) return;
    e.preventDefault();
    onChange(tabs[n].id);
    (e.currentTarget as HTMLElement).querySelectorAll<HTMLButtonElement>('button')[n]?.focus();
  };
  return (
    <nav className="wbn-tabs" role="tablist" aria-label="Workbench panes" onKeyDown={onKey}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={value === t.id} tabIndex={value === t.id ? 0 : -1}
          className={`wbn-tab${value === t.id ? ' is-on' : ''}`} onClick={() => onChange(t.id)}>
          {t.label}
        </button>
      ))}
    </nav>
  );
}

/** Drag handle between the stage and the inspector; arrow keys resize too. The width is saved with the session. */
function ResizeHandle() {
  const { state, patchWb } = useStore();
  const [live, setLive] = useState<number | null>(null);
  const start = useRef<{ x: number; w: number } | null>(null);
  const w = live ?? state.wb.inspW;
  const clamp = (v: number) => Math.round(Math.min(INSP_MAX, Math.max(INSP_MIN, v)));
  const set = (v: number) => {
    const c = clamp(v);
    setLive(c);
    document.documentElement.style.setProperty('--insp-live', `${c}px`);
  };
  useEffect(() => {
    if (live == null) document.documentElement.style.removeProperty('--insp-live');
  }, [live]);
  const onDown = (e: RPointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    start.current = { x: e.clientX, w };
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* ignore */ }
  };
  const onMove = (e: RPointerEvent<HTMLDivElement>) => {
    if (!start.current) return;
    set(start.current.w + (start.current.x - e.clientX));
  };
  const onUp = () => {
    if (!start.current) return;
    start.current = null;
    if (live != null) patchWb({ inspW: live });
    setLive(null);
  };
  const onKey = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 40 : 10;
    let v: number | null = null;
    if (e.key === 'ArrowLeft') v = w + step;
    else if (e.key === 'ArrowRight') v = w - step;
    else if (e.key === 'Home') v = INSP_MAX;
    else if (e.key === 'End') v = INSP_MIN;
    if (v == null) return;
    e.preventDefault();
    patchWb({ inspW: clamp(v) });
  };
  return (
    <div className={`wb-resize${live != null ? ' is-dragging' : ''}`} role="separator" aria-orientation="vertical" aria-label="Resize the inspector"
      aria-valuemin={INSP_MIN} aria-valuemax={INSP_MAX} aria-valuenow={w} tabIndex={0} title="Drag to resize the inspector (arrow keys too); double-click resets"
      onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onKeyDown={onKey}
      onDoubleClick={() => patchWb({ inspW: 420 })} />
  );
}
