// Right-hand inspector of the workbench (CLAUDE.md Addition 10): a sticky header for the selection (name, motion, drive,
// verdict badge and a chip bar that jumps to each section), then collapsible sections that show a one-line summary
// while closed. Several can be open; the open state is remembered per section.
import { createContext, Suspense, useContext, useEffect, useId, useMemo, useRef, type ReactNode } from 'react';
import { MOTION_LABEL, analyzeJointMotor, type ArmJoint, type DriveType, type Fix, type MotionType } from '../../calc';
import { FixBadge } from '../components/FixChips';
import { useFixes } from '../fixes';
import { motorChip } from '../motorUi';
import { ErrorBoundary } from '../components/ErrorBoundary';
import { Icon } from '../components/Icon';
import { InfoTip } from '../components/InfoTip';
import { Segmented, StatusChip, type StatusKind } from '../components/primitives';
import { HELP } from '../help';
import { util } from '../format';
import { plainName } from '../plain';
import { patchJoint, setMotion } from '../armEdit';
import { CUSTOM, type Slot } from '../session';
import { useStore } from '../store';
import { DRIVE_OPTIONS, MOTION_OPTIONS } from '../screens/ArmScreen';
import { useSlotModel, type SlotModel } from '../screens/GearboxScreen';
import { useDiscThetaOptional } from './discTheta';
import { LAZY_BODIES, sectionSummary, type SectionBodies, type SectionCtx } from './sections';
import { useJointStatuses } from './useStatuses';
import {
  ARM_SECTIONS, CUSTOM_SECTIONS, CYCLOIDAL_SECTIONS, SECTION_META, SERVO_SECTIONS, type SectionId,
} from './wbState';

const ForceOpen = createContext(false);
/** The last openSection request the inspector has scrolled to */
let handledJump = 0;

/** Event the rail fires to put the cursor in the inspector's name field ("Rename"). */
export const RENAME_EVENT = 'cgd-rename-joint';

/**
 * The inspector of the current selection. `sel` and `forceOpen` exist for rendering one selection with every section
 * open (tests, print); the app passes neither.
 */
export function Inspector({ bodies = LAZY_BODIES, sel: selProp, forceOpen = false }: { bodies?: SectionBodies; sel?: string; forceOpen?: boolean }) {
  const { state } = useStore();
  const sel = selProp ?? state.wb.sel;
  const index = state.arm.joints.findIndex((j) => j.id === sel);
  const joint = index >= 0 ? state.arm.joints[index] : null;
  let body: ReactNode;
  if (sel === 'arm' || (sel !== CUSTOM && !joint)) body = <ArmInspector bodies={bodies} />;
  else if (sel === CUSTOM) body = <GearInspector key="custom" slot={CUSTOM} joint={null} index={-1} bodies={bodies} />;
  else if (joint!.drive === 'servo') body = <ServoInspector key={`s-${sel}`} joint={joint!} index={index} bodies={bodies} />;
  else body = <GearInspector key={`g-${sel}`} slot={sel} joint={joint} index={index} bodies={bodies} />;
  return <ForceOpen.Provider value={forceOpen}><div className="insp-inner">{body}</div></ForceOpen.Provider>;
}

// ---------------------------------------------------------------------------
// Per kind of selection
// ---------------------------------------------------------------------------

function GearInspector({ slot, joint, index, bodies }: { slot: Slot; joint: ArmJoint | null; index: number; bodies: SectionBodies }) {
  const sm = useSlotModel(slot);
  const ctx: SectionCtx = { sel: slot, joint, index, slot, sm };
  const r = sm.model.result;
  const badge = r.verdict === 'invalid'
    ? { kind: 'fail' as StatusKind, word: 'INVALID', detail: 'fix the inputs' }
    : {
      kind: (r.verdict === 'pass' ? 'ok' : r.verdict === 'marginal' ? 'marginal' : 'fail') as StatusKind,
      word: r.verdict === 'pass' ? 'PASS' : r.verdict === 'marginal' ? 'MARGINAL' : 'FAIL',
      detail: `max ${util(r.maxUtilization)}${r.governing ? ` · ${plainName(r.governing)}` : ''}`,
    };
  const sections = joint ? CYCLOIDAL_SECTIONS : CUSTOM_SECTIONS;
  // a motor that cannot drive (or can overload) this gearbox is flagged next to the verdict; it never changes the verdict
  const chip = joint?.motor ? motorChip(analyzeJointMotor(joint, { Treq: sm.eff.Treq, Tdes: sm.eff.Tdes }, sm.eff.Zp)) : null;
  const motorFlag = chip && (chip.kind === 'fail' || chip.kind === 'marginal') ? chip : null;
  return (
    <InspectorFrame ctx={ctx} sections={sections} bodies={bodies}
      header={joint ? <JointHeaderRows joint={joint} index={index} /> : <PlainTitle title="Custom gearbox" sub="Your own geometry and torques, not tied to a joint" />}
      badge={<Badge kind={badge.kind} word={badge.word} detail={badge.detail} pending={sm.pending}
        extra={motorFlag ? <span className="insp-motorflag" title={motorFlag.title}><StatusChip kind={motorFlag.kind}>MOTOR {motorFlag.word}</StatusChip></span> : null} />} />
  );
}

function ServoInspector({ joint, index, bodies }: { joint: ArmJoint; index: number; bodies: SectionBodies }) {
  const statuses = useJointStatuses();
  const st = statuses[index];
  const ctx: SectionCtx = { sel: joint.id, joint, index, slot: null, sm: null };
  return (
    <InspectorFrame ctx={ctx} sections={SERVO_SECTIONS} bodies={bodies}
      header={<JointHeaderRows joint={joint} index={index} />}
      badge={st ? <Badge kind={st.kind} word={st.word} detail="direct-drive servo, no gearbox check" /> : null} />
  );
}

function ArmInspector({ bodies }: { bodies: SectionBodies }) {
  const { state } = useStore();
  const statuses = useJointStatuses();
  const n = state.arm.joints.length;
  const count = (k: StatusKind) => statuses.filter((s) => s.kind === k).length;
  const worst: StatusKind = count('fail') ? 'fail' : count('marginal') ? 'marginal' : count('ok') ? 'ok' : 'neutral';
  const ctx: SectionCtx = { sel: 'arm', joint: null, index: -1, slot: null, sm: null };
  return (
    <InspectorFrame ctx={ctx} sections={ARM_SECTIONS} bodies={bodies}
      header={<PlainTitle title="Arm" sub={`${n} joint${n === 1 ? '' : 's'}, base to tip. Settings here apply to every joint.`} />}
      badge={<Badge kind={worst} word={`${count('ok')} OK · ${count('marginal')} MARGINAL · ${count('fail')} FAIL`} detail="gearbox verdicts and servo checks" />} />
  );
}

// ---------------------------------------------------------------------------
// Frame: sticky header, chip bar, sections
// ---------------------------------------------------------------------------

function InspectorFrame({ ctx, sections, bodies, header, badge }: {
  ctx: SectionCtx; sections: readonly SectionId[]; bodies: SectionBodies; header: ReactNode; badge: ReactNode;
}) {
  const { state, arm, u, advisorRun, solverMemo, openSection, setSectionOpen, jump } = useStore();
  const forceOpen = useContext(ForceOpen);
  const theta = useDiscThetaOptional();
  const scrollRef = useRef<HTMLDivElement>(null);
  const uid = useId().replace(/:/g, '');
  const sumIn = { state, arm, u, advisorRun, solverMemo, discDeg: theta?.deg ?? 0 };
  // fix counts: Gearbox design holds every field a fix changes; Motor & ratio holds the recommended-ratio fix
  const fx = useFixes(ctx.slot);
  const fixList = fx.report?.fixes ?? [];
  const fixesIn = (id: SectionId): Fix[] => (id === 'design' ? fixList : id === 'motor' ? fixList.filter((f) => f.field === 'Zp') : []);

  // bring a requested section into view and focus its header (openSection from a chip, a link or another panel)
  // (module-level, so a request that also changed the selection is handled by the newly mounted inspector)
  useEffect(() => {
    if (!jump || jump.n <= handledJump) return;
    if (!sections.includes(jump.id)) return;
    const n = jump.n;
    const id = `${uid}-sec-${jump.id}`;
    const bring = (focus: boolean) => {
      const el = document.getElementById(id);
      if (!el) return;
      // scroll the inspector column itself (not the page) so the section starts just under the sticky header
      const sc = el.closest<HTMLElement>('.wb-insp, .wbn-details');
      if (sc) {
        const head = sc.querySelector<HTMLElement>('.insp-head');
        const top = el.getBoundingClientRect().top - sc.getBoundingClientRect().top + sc.scrollTop - (head?.offsetHeight ?? 0) - 6;
        sc.scrollTop = Math.max(0, top);
      }
      if (focus) el.querySelector<HTMLButtonElement>('.insp-sec-toggle')?.focus({ preventScroll: true });
    };
    // once the section has opened, and again after a lazy body has loaded above it
    const t1 = window.setTimeout(() => { handledJump = n; bring(true); }, 30);
    const t2 = window.setTimeout(() => bring(false), 350);
    return () => { window.clearTimeout(t1); window.clearTimeout(t2); };
  }, [jump, sections, uid]);

  return (
    <div className="insp-frame" ref={scrollRef}>
      <header className="insp-head">
        {header}
        <div className="insp-badge-row">{badge}</div>
        <nav className="insp-chips" aria-label="Jump to section">
          {sections.map((id) => (
            <button key={id} type="button" className={`insp-chip${state.wb.open[id] ? ' is-open' : ''}`}
              aria-controls={`${uid}-sec-${id}`} onClick={() => openSection(id)} title={`Open ${SECTION_META[id].title}`}>
              {SECTION_META[id].chip}
              {fixesIn(id).length > 0 && <FixBadge fixes={fixesIn(id)} compact />}
            </button>
          ))}
        </nav>
      </header>
      <div className="insp-sections">
        {sections.map((id) => (
          <InspectorSection key={id} id={id} domId={`${uid}-sec-${id}`} open={forceOpen || !!state.wb.open[id]} onToggle={(o) => setSectionOpen(id, o)}
            summary={sectionSummary(id, ctx, sumIn)} body={bodies[id]} ctx={ctx} fixes={fixesIn(id)} />
        ))}
      </div>
    </div>
  );
}

function InspectorSection({ id, domId, open, onToggle, summary, body: Body, ctx, fixes }: {
  id: SectionId; domId: string; open: boolean; onToggle: (open: boolean) => void; summary: ReactNode;
  body: SectionBodies[SectionId]; ctx: SectionCtx; fixes: Fix[];
}) {
  const meta = SECTION_META[id];
  const bodyId = `${domId}-body`;
  return (
    <section className={`insp-sec${open ? ' is-open' : ''}`} id={domId} aria-labelledby={`${domId}-h`} data-section={id}>
      <h3 className="insp-sec-h" id={`${domId}-h`}>
        <button type="button" className="insp-sec-toggle" aria-expanded={open} aria-controls={bodyId} onClick={() => onToggle(!open)}>
          <Icon name="chevron" size={14} className="insp-sec-chev" />
          <span className="insp-sec-title">{meta.title}</span>
          {fixes.length > 0 && <FixBadge fixes={fixes} invite={!open} />}
          {!open && summary != null && <span className="insp-sec-sum">{summary}</span>}
        </button>
        <InfoTip help={meta.help} label={meta.title} />
      </h3>
      {open && (
        <div className="insp-sec-body" id={bodyId}>
          <ErrorBoundary>
            <Suspense fallback={<SectionSkeleton />}>
              <Body {...ctx} />
            </Suspense>
          </ErrorBoundary>
        </div>
      )}
    </section>
  );
}

export function SectionSkeleton() {
  return (
    <div className="insp-skel" role="status" aria-live="polite">
      <span className="visually-hidden">Loading</span>
      <div className="skel skel-line" />
      <div className="skel skel-line is-short" />
      <div className="skel skel-block" />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header pieces
// ---------------------------------------------------------------------------

function PlainTitle({ title, sub }: { title: string; sub: string }) {
  return (
    <div className="insp-title-row">
      <h2 className="insp-title">{title}</h2>
      <p className="insp-sub">{sub}</p>
    </div>
  );
}

function JointHeaderRows({ joint: j, index: i }: { joint: ArmJoint; index: number }) {
  const { updateArm } = useStore();
  const nameRef = useRef<HTMLInputElement>(null);
  const label = `J${i + 1}`;
  useEffect(() => {
    const on = (e: Event) => {
      const id = (e as CustomEvent<string>).detail;
      if (id !== j.id) return;
      window.setTimeout(() => { nameRef.current?.focus(); nameRef.current?.select(); }, 40);
    };
    window.addEventListener(RENAME_EVENT, on);
    return () => window.removeEventListener(RENAME_EVENT, on);
  }, [j.id]);
  const motionOpts = useMemo(() => MOTION_OPTIONS, []);
  return (
    <>
      <div className="insp-title-row">
        <h2 className="insp-title">
          <span className="insp-jpos mono">{label}</span>
          <input ref={nameRef} id={`insp-name-${j.id}`} className="insp-name" type="text" value={j.name} maxLength={40} autoComplete="off" spellCheck={false}
            placeholder={MOTION_LABEL[j.motion].toLowerCase()} aria-label={`Name of ${label}`}
            onChange={(e) => updateArm((x) => patchJoint(x, j.id, { name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }} />
          <InfoTip help={HELP.jointName} label="Joint name" />
        </h2>
      </div>
      <div className="insp-ctl-row">
        <Segmented<MotionType> value={j.motion} onChange={(m) => updateArm((x) => setMotion(x, j.id, m))} label={`Motion type of ${label}`} size="sm" options={motionOpts}
          help={HELP.jointMotion} helpLabel="Motion type" />
        <Segmented<DriveType> value={j.drive} onChange={(d) => updateArm((x) => patchJoint(x, j.id, { drive: d }))} label={`Drive of ${label}`} size="sm" options={DRIVE_OPTIONS}
          help={HELP.jointDrive} helpLabel="Drive" />
      </div>
    </>
  );
}

function Badge({ kind, word, detail, pending, extra }: { kind: StatusKind; word: string; detail?: string; pending?: boolean; extra?: ReactNode }) {
  return (
    <div className={`insp-badge insp-badge-${kind}${pending ? ' is-pending' : ''}`} role="status" aria-live="polite">
      <StatusChip kind={kind}>{word}</StatusChip>
      {detail && <span className="insp-badge-detail">{detail}</span>}
      {extra}
    </div>
  );
}

export type { SlotModel };
