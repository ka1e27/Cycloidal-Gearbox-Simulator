// Left rail "Joints" of the workbench (CLAUDE.md Addition 10): the Arm item, one row per joint with its motion symbol,
// drive tag and status dot, row actions (rename, move, remove), "+ Add joint", then Summary and Custom gearbox.
// On narrow screens the same list becomes a strip of chips under the header (JointStrip).
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { DRIVE_LABEL, MIN_JOINTS, MOTION_LABEL, jointLabel, type ArmJoint } from '../../calc';
import { Icon } from '../components/Icon';
import { moveJoint, removeJoint } from '../armEdit';
import { CUSTOM } from '../session';
import { useStore } from '../store';
import { AddJoint } from '../screens/ArmScreen';
import { MotionIcon } from '../viz/armSymbols';
import { RENAME_EVENT } from './Inspector';
import type { JointStatus } from './status';
import { useJointStatuses } from './useStatuses';

const STATUS_WORD_LOWER: Record<string, string> = { ok: 'ok', marginal: 'marginal', fail: 'fail', neutral: 'no check' };

function Dot({ st }: { st: JointStatus | undefined }) {
  return <span className={`rail-dot dot-${st?.kind ?? 'neutral'}`} aria-hidden="true" />;
}

export function Rail() {
  const { state, selectItem, setStage, patchWb, updateArm } = useStore();
  const statuses = useJointStatuses();
  const joints = state.arm.joints;
  const sel = state.wb.sel;
  const collapsed = state.wb.railCollapsed;
  const listRef = useRef<HTMLUListElement>(null);
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ArmJoint | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  // keep keyboard focus on a row that moved (reordering re-renders the list)
  useEffect(() => {
    if (!focusId) return;
    const el = listRef.current?.querySelector<HTMLButtonElement>(`[data-row="${focusId}"]`);
    el?.focus();
    setFocusId(null);
  }, [focusId, joints]);

  const rowIds = ['arm', ...joints.map((j) => j.id)];
  const onRowKey = (id: string) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const i = rowIds.indexOf(id);
    const j = joints.find((x) => x.id === id);
    if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && j) {
      // Alt + arrow: move the joint toward the base / tip
      e.preventDefault();
      updateArm((x) => moveJoint(x, id, e.key === 'ArrowUp' ? -1 : 1));
      setFocusId(id);
      return;
    }
    let n = -1;
    if (e.key === 'ArrowDown') n = Math.min(rowIds.length - 1, i + 1);
    else if (e.key === 'ArrowUp') n = Math.max(0, i - 1);
    else if (e.key === 'Home') n = 0;
    else if (e.key === 'End') n = rowIds.length - 1;
    else if (e.key === 'F2' && j) { e.preventDefault(); rename(j); return; }
    else if (e.key === 'Delete' && j && joints.length > MIN_JOINTS) { e.preventDefault(); setConfirm(j); return; }
    if (n < 0) return;
    e.preventDefault();
    selectItem(rowIds[n]);
    setFocusId(rowIds[n]);
  };

  const rename = (j: ArmJoint) => {
    setMenuFor(null);
    selectItem(j.id);
    patchWb({ mobile: 'details' });
    window.setTimeout(() => window.dispatchEvent(new CustomEvent(RENAME_EVENT, { detail: j.id })), 0);
  };

  const doRemove = (j: ArmJoint) => {
    const i = joints.findIndex((x) => x.id === j.id);
    // select a neighbour first so the inspector does not jump to the Arm item
    const next = joints[i + 1] ?? joints[i - 1];
    if (sel === j.id && next) selectItem(next.id);
    updateArm((x) => removeJoint(x, j.id));
    setConfirm(null);
  };

  return (
    <nav className={`rail${collapsed ? ' is-collapsed' : ''}`} aria-label="Joints">
      <div className="rail-head">
        <h2 className="rail-title">Joints</h2>
        <button type="button" className="icon-btn rail-collapse" aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand the joint list' : 'Collapse the joint list'} title={collapsed ? 'Expand' : 'Collapse'}
          onClick={() => patchWb({ railCollapsed: !collapsed })}>
          <Icon name="chevron" size={14} className={collapsed ? 'rot-90n' : 'rot-90'} />
        </button>
      </div>
      <ul className="rail-list" ref={listRef}>
        <li className={`rail-row rail-row-arm${sel === 'arm' ? ' is-sel' : ''}`}>
          <button type="button" className="rail-main" data-row="arm" aria-current={sel === 'arm' ? 'true' : undefined}
            tabIndex={sel === 'arm' || !rowIds.includes(sel) ? 0 : -1} onKeyDown={onRowKey('arm')} onClick={() => selectItem('arm')}
            title="Arm: payload, service factor, totals and the torque table" aria-label="Arm settings and torque table">
            <span className="rail-pos mono" aria-hidden="true">ARM</span>
            {!collapsed && <span className="rail-name">Arm <span className="muted">· {joints.length} DOF</span></span>}
          </button>
        </li>
        {joints.map((j, i) => {
          const st = statuses[i];
          const isSel = sel === j.id;
          const name = j.name.trim() || MOTION_LABEL[j.motion].toLowerCase();
          const tip = st ? st.text : jointLabel(j, i);
          return (
            <li key={j.id} className={`rail-row${isSel ? ' is-sel' : ''}`}>
              <button type="button" className="rail-main" data-row={j.id} aria-current={isSel ? 'true' : undefined} tabIndex={isSel ? 0 : -1}
                onKeyDown={onRowKey(j.id)} onClick={() => selectItem(j.id)} title={`${tip}. Alt+↑/↓ moves it, F2 renames.`}
                aria-label={`J${i + 1} ${name}, ${MOTION_LABEL[j.motion]}, ${DRIVE_LABEL[j.drive]}, status ${st ? `${st.word.toLowerCase()}` : STATUS_WORD_LOWER.neutral}`}>
                <span className="rail-pos mono">J{i + 1}</span>
                <MotionIcon motion={j.motion} size={18} />
                {!collapsed && <span className="rail-name">{name}</span>}
                {!collapsed && <span className={`rail-tag${j.drive === 'servo' ? ' is-servo' : ''}`}>{j.drive === 'servo' ? 'servo' : 'gear'}</span>}
                <Dot st={st} />
              </button>
              {!collapsed && (
                <RowMenu index={i} n={joints.length} open={menuFor === j.id} setOpen={(o) => setMenuFor(o ? j.id : null)}
                  onRename={() => rename(j)}
                  onMove={(d) => { setMenuFor(null); updateArm((x) => moveJoint(x, j.id, d)); setFocusId(j.id); }}
                  onRemove={() => { setMenuFor(null); setConfirm(j); }} />
              )}
            </li>
          );
        })}
      </ul>
      {!collapsed && (
        <div className="rail-add">
          <AddJoint compact onAdded={(id) => selectItem(id)} />
        </div>
      )}
      <ul className="rail-list rail-extra">
        <li className={`rail-row${state.wb.stage === 'summary' ? ' is-stage' : ''}`}>
          <button type="button" className="rail-main" onClick={() => { setStage('summary'); patchWb({ mobile: 'summary' }); }}
            aria-pressed={state.wb.stage === 'summary'} title="Every joint side by side in the stage" aria-label="Summary of all joints">
            <span className="rail-pos mono" aria-hidden="true">Σ</span>
            {!collapsed && <span className="rail-name">Summary</span>}
          </button>
        </li>
        <li className={`rail-row${sel === CUSTOM ? ' is-sel' : ''}`}>
          <button type="button" className="rail-main" aria-current={sel === CUSTOM ? 'true' : undefined} onClick={() => selectItem(CUSTOM)}
            title="A standalone gearbox with your own geometry and torques" aria-label="Custom gearbox">
            <span className="rail-pos mono" aria-hidden="true">C</span>
            {!collapsed && <span className="rail-name">Custom gearbox</span>}
          </button>
        </li>
      </ul>
      {confirm && <RemoveDialog joint={confirm} index={joints.findIndex((x) => x.id === confirm.id)} onCancel={() => setConfirm(null)} onConfirm={() => doRemove(confirm)} />}
    </nav>
  );
}

function RowMenu({ index: i, n, open, setOpen, onRename, onMove, onRemove }: {
  index: number; n: number; open: boolean; setOpen: (o: boolean) => void;
  onRename: () => void; onMove: (d: -1 | 1) => void; onRemove: () => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const items = useRef<(HTMLButtonElement | null)[]>([]);
  const menuId = useId();
  const label = `J${i + 1}`;
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => { if (!wrap.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('pointerdown', onDown);
    window.setTimeout(() => items.current.find((x) => x && !x.disabled)?.focus(), 0);
    return () => document.removeEventListener('pointerdown', onDown);
  }, [open, setOpen]);
  const onKey = (e: KeyboardEvent) => {
    const list = items.current.filter((x): x is HTMLButtonElement => !!x && !x.disabled);
    const k = list.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === 'ArrowDown') { e.preventDefault(); list[(k + 1) % list.length]?.focus(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); list[(k - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === 'Escape') { e.preventDefault(); setOpen(false); trigger.current?.focus(); }
    else if (e.key === 'Tab') setOpen(false);
  };
  return (
    <div className="rail-menu-wrap" ref={wrap}>
      <button ref={trigger} type="button" className="rail-more" aria-haspopup="menu" aria-expanded={open} aria-controls={open ? menuId : undefined}
        aria-label={`Actions for ${label}`} title="Rename, move or remove" onClick={() => setOpen(!open)}>
        <Icon name="more" size={16} />
      </button>
      {open && (
        <div id={menuId} className="popover menu rail-menu" role="menu" aria-label={`Actions for ${label}`} onKeyDown={onKey}>
          <button ref={(el) => { items.current[0] = el; }} role="menuitem" type="button" className="menu-item" onClick={onRename}>Rename</button>
          <button ref={(el) => { items.current[1] = el; }} role="menuitem" type="button" className="menu-item" disabled={i === 0} onClick={() => onMove(-1)}>Move toward the base</button>
          <button ref={(el) => { items.current[2] = el; }} role="menuitem" type="button" className="menu-item" disabled={i === n - 1} onClick={() => onMove(1)}>Move toward the tip</button>
          <div className="menu-sep" role="separator" />
          <button ref={(el) => { items.current[3] = el; }} role="menuitem" type="button" className="menu-item is-danger" disabled={n <= MIN_JOINTS} onClick={onRemove}
            title={n <= MIN_JOINTS ? 'An arm needs at least one joint' : undefined}>
            Remove {label}…
          </button>
          <p className="rail-menu-hint small muted">Keys: Alt+↑/↓ move, F2 rename, Delete remove</p>
        </div>
      )}
    </div>
  );
}

function RemoveDialog({ joint: j, index: i, onCancel, onConfirm }: { joint: ArmJoint; index: number; onCancel: () => void; onConfirm: () => void }) {
  const dlg = useRef<HTMLDialogElement>(null);
  const id = useId();
  const label = jointLabel(j, i);
  useEffect(() => {
    const d = dlg.current;
    if (d && !d.open) {
      try { d.showModal(); } catch { d.setAttribute('open', ''); }
    }
  }, []);
  return (
    <dialog ref={dlg} className="dialog" aria-labelledby={`${id}-t`} onClose={onCancel} onClick={(e) => { if (e.target === dlg.current) onCancel(); }}>
      <div className="dialog-body">
        <h2 id={`${id}-t`} className="dialog-title">Remove {label}?</h2>
        <p className="dialog-text">
          {j.drive === 'cycloidal' && 'Its gearbox inputs and Design Advisor settings are deleted too. '}
          The link after it goes with it, so the previous joint then connects to the next one. Export a JSON first if you may want it back.
        </p>
        <div className="dialog-actions">
          <button type="button" className="btn btn-secondary btn-md" onClick={onCancel} autoFocus>Keep it</button>
          <button type="button" className="btn btn-danger btn-md" onClick={onConfirm}>Remove J{i + 1}</button>
        </div>
      </div>
    </dialog>
  );
}

/** Narrow screens: the joints as a strip of chips under the header (Arm, J1..Jn with status dots, Custom). */
export function JointStrip() {
  const { state, selectItem, openSection } = useStore();
  const statuses = useJointStatuses();
  const sel = state.wb.sel;
  const joints = state.arm.joints;
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.is-sel');
    try { el?.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch { /* old browsers */ }
  }, [sel]);
  const chip = (id: string, text: string, aria: string, st?: JointStatus, extra?: React.ReactNode) => (
    <button key={id} type="button" className={`strip-chip${sel === id ? ' is-sel' : ''}`} aria-current={sel === id ? 'true' : undefined}
      onClick={() => selectItem(id)} aria-label={aria} title={st?.text ?? aria}>
      {extra}
      <span className="mono">{text}</span>
      {st && <Dot st={st} />}
    </button>
  );
  return (
    <div className="joint-strip" ref={ref} role="group" aria-label="Select a joint">
      {chip('arm', 'Arm', 'Arm settings and torque table')}
      {joints.map((j, i) => chip(j.id, `J${i + 1}`, `J${i + 1} ${j.name.trim() || MOTION_LABEL[j.motion].toLowerCase()}, ${statuses[i]?.word.toLowerCase() ?? ''}`,
        statuses[i], <MotionIcon motion={j.motion} size={14} />))}
      {chip(CUSTOM, 'Custom', 'Custom gearbox')}
      <button type="button" className="strip-chip strip-add" onClick={() => openSection('armSettings', 'arm')} aria-label="Add a joint (opens the Arm item)">+ Joint</button>
    </div>
  );
}
