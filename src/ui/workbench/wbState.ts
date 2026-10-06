// Workbench layout state (CLAUDE.md Addition 10): what is selected, which stage tab shows, which inspector sections are
// open, the inspector width and the drawers. Display only: it is saved with the session but never exported.
// Pure TypeScript (no React), so it is easy to test.

import type { HelpEntry } from '../help';

/** The stage tabs, left to right. */
export type StageTab = '3d' | 'schematic' | 'disc' | 'summary';
export const STAGE_TABS: { id: StageTab; label: string }[] = [
  { id: '3d', label: '3D arm' },
  { id: 'schematic', label: 'Schematic' },
  { id: 'disc', label: 'Disc' },
  { id: 'summary', label: 'Summary' },
];

/** Inspector sections. The first ten are a joint's (or Custom's); the last three are the Arm item's. */
export type SectionId =
  | 'joint' | 'motor' | 'loads' | 'design' | 'checks' | 'tolerance' | 'disc' | 'solver' | 'advisor' | 'dxf'
  | 'armSettings' | 'armTorques' | 'armSlop';
export const SECTION_IDS: readonly SectionId[] = [
  'joint', 'motor', 'loads', 'design', 'checks', 'tolerance', 'disc', 'solver', 'advisor', 'dxf', 'armSettings', 'armTorques', 'armSlop',
];

export interface SectionMeta {
  id: SectionId;
  title: string;
  /** Chip text in the jump bar */
  chip: string;
  /** One sentence for the (i) */
  help: HelpEntry;
}

export const SECTION_META: Record<SectionId, SectionMeta> = {
  joint: { id: 'joint', title: 'Joint & link', chip: 'Joint', help: { what: 'The joint’s own mass, the link to the next joint, its acceleration, the pose angle and limits, and manual torque overrides.' } },
  motor: { id: 'motor', title: 'Motor & ratio', chip: 'Motor', help: { what: 'Enter the motor (or servo) ratings to get the gear ratio this joint needs and apply it to the gearbox in one click.' } },
  loads: { id: 'loads', title: 'Loads', chip: 'Loads', help: { what: 'The torque this joint must carry (from the arm model or typed by you) and the loads on its output bearing.' } },
  design: { id: 'design', title: 'Gearbox design', chip: 'Design', help: { what: 'Geometry, materials, bearing and load factors of this cycloidal gearbox; every check updates as you type.' } },
  checks: { id: 'checks', title: 'Checks', chip: 'Checks', help: { what: 'Every SPEC check with its value, limit and utilization, plus the key numbers of the current design.' } },
  tolerance: { id: 'tolerance', title: 'Tolerances & backlash', chip: 'Tolerances', help: { what: 'Enter your machining errors and clearances: the backlash (play) at the output, whether the disc can bind, how unevenly the pins share the load (Kc), the stiffness and the slop at the tool tip.' } },
  disc: { id: 'disc', title: 'Disc & charts', chip: 'Disc', help: { what: 'The disc at an input angle θ with the pin forces; open it in the stage for the full-size view and both charts.' } },
  solver: { id: 'solver', title: 'Min-size solver', chip: 'Solver', help: { what: 'Sweeps D and K1 for the smallest pin circle whose contact checks pass, keeping everything else as it is.' } },
  advisor: { id: 'advisor', title: 'Design Advisor', chip: 'Advisor', help: { what: 'Searches every free design variable for the smallest housing that keeps every check under the target, then lets you apply it.' } },
  dxf: { id: 'dxf', title: 'Export DXF', chip: 'DXF', help: { what: 'Download manufacturing DXFs of the disc, housing, output plate, cam and pins for the current design.' } },
  armSettings: { id: 'armSettings', title: 'Arm settings', chip: 'Settings', help: { what: 'Payload, service factor and the minimum design torque, which apply to every joint, plus the arm totals.' } },
  armTorques: { id: 'armTorques', title: 'Torque table', chip: 'Torques', help: { what: 'The worst-case torque and output-bearing loads of every joint side by side.' } },
  armSlop: { id: 'armSlop', title: 'Tip slop', chip: 'Tip slop', help: { what: 'How far the tool tip can move because of each gearbox’s backlash and twist under load, joint by joint and for the whole arm.' } },
};

/** Sections per kind of selection, top to bottom. */
export const CYCLOIDAL_SECTIONS: readonly SectionId[] = ['joint', 'motor', 'loads', 'design', 'checks', 'tolerance', 'disc', 'solver', 'advisor', 'dxf'];
export const SERVO_SECTIONS: readonly SectionId[] = ['joint', 'motor', 'loads'];
export const CUSTOM_SECTIONS: readonly SectionId[] = ['design', 'checks', 'tolerance', 'disc', 'solver', 'advisor', 'dxf'];
export const ARM_SECTIONS: readonly SectionId[] = ['armSettings', 'armTorques', 'armSlop'];

export type MobileTab = 'view' | 'details' | 'summary';

export interface WorkbenchState {
  /** 'arm', 'custom' or a joint id (any joint, servo included) */
  sel: string;
  stage: StageTab;
  /** Open sections; missing = closed */
  open: Partial<Record<SectionId, boolean>>;
  /** Inspector width, px */
  inspW: number;
  railCollapsed: boolean;
  /** Pose-loads drawer under the 3D view */
  drawer: boolean;
  /** Narrow screens: which bottom tab shows */
  mobile: MobileTab;
}

export const INSP_MIN = 340;
export const INSP_MAX = 720;
export const INSP_DEFAULT = 420;

export const defaultWorkbench = (): WorkbenchState => ({
  sel: 'J2',
  stage: '3d',
  open: { design: true, checks: true, armSettings: true, armTorques: true },
  inspW: INSP_DEFAULT,
  railCollapsed: false,
  drawer: false,
  mobile: 'view',
});

const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);
const isStage = (x: unknown): x is StageTab => x === '3d' || x === 'schematic' || x === 'disc' || x === 'summary';
const isSection = (x: unknown): x is SectionId => typeof x === 'string' && (SECTION_IDS as readonly string[]).includes(x);

/** Safe workbench state from anything. The selection is checked against the arm later (reconcileSession). */
export function normalizeWorkbench(raw: unknown, base: WorkbenchState = defaultWorkbench()): WorkbenchState {
  if (!isObj(raw)) return base;
  const out: WorkbenchState = { ...base, open: { ...base.open } };
  if (typeof raw.sel === 'string' && raw.sel.length > 0 && raw.sel.length <= 32) out.sel = raw.sel;
  if (isStage(raw.stage)) out.stage = raw.stage;
  if (isObj(raw.open)) {
    const open: Partial<Record<SectionId, boolean>> = {};
    for (const [k, v] of Object.entries(raw.open)) if (isSection(k) && typeof v === 'boolean') open[k] = v;
    out.open = open;
  }
  if (typeof raw.inspW === 'number' && Number.isFinite(raw.inspW)) out.inspW = Math.round(Math.min(INSP_MAX, Math.max(INSP_MIN, raw.inspW)));
  if (typeof raw.railCollapsed === 'boolean') out.railCollapsed = raw.railCollapsed;
  if (typeof raw.drawer === 'boolean') out.drawer = raw.drawer;
  if (raw.mobile === 'view' || raw.mobile === 'details' || raw.mobile === 'summary') out.mobile = raw.mobile;
  return out;
}

/**
 * Sessions saved before the workbench had a `step` (1 Arm & Loads, 2 Gearbox, 3 Design Advisor, 4 All Joints) and a
 * selected gearbox slot. Map them onto the place that now holds the same content.
 */
export function workbenchFromStep(step: unknown, selected: string): WorkbenchState {
  const w = defaultWorkbench();
  if (step === 1) return { ...w, sel: 'arm', stage: '3d' };
  if (step === 2) return { ...w, sel: selected };
  if (step === 3) return { ...w, sel: selected, open: { ...w.open, advisor: true } };
  if (step === 4) return { ...w, sel: selected, stage: 'summary', mobile: 'summary' };
  return { ...w, sel: selected };
}

// ---------------------------------------------------------------------------
// URL hash: #/arm, #/custom[/section], #/joint/<id>[/section], #/summary
// ---------------------------------------------------------------------------

export interface HashTarget { sel?: string; section?: SectionId; stage?: StageTab }

export function parseHash(hash: string): HashTarget | null {
  const h = hash.replace(/^#\/?/, '');
  if (!h) return null;
  const parts = h.split('/').map((p) => { try { return decodeURIComponent(p); } catch { return p; } });
  if (parts[0] === 'summary') return { stage: 'summary' };
  if (parts[0] === 'arm') return { sel: 'arm' };
  if (parts[0] === 'custom') return { sel: 'custom', section: isSection(parts[1]) ? parts[1] : undefined };
  if (parts[0] === 'joint' && parts[1] && parts[1].length <= 32) return { sel: parts[1], section: isSection(parts[2]) ? parts[2] : undefined };
  return null;
}

export function formatHash(sel: string, section?: SectionId | null): string {
  const base = sel === 'arm' ? '#/arm' : sel === 'custom' ? '#/custom' : `#/joint/${encodeURIComponent(sel)}`;
  return section && sel !== 'arm' ? `${base}/${section}` : base;
}
