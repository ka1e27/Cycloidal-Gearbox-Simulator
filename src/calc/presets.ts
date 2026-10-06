// Default inputs and the SPEC.md joint presets.

import { DEFAULT_ROOT_CLEARANCE, DEFAULT_TOOL_RADIUS, defaultHousingMaterial } from './integral';
import { materialForm, materialProps, SPEC_STEEL, type MaterialProps } from './materials';
import { DEFAULT_INNER_PIN_SUPPORT, INNER_PIN_SUPPORTS } from './types';
import { normalizeToleranceSpec } from './tolerance';
import type { GearboxInputs, InnerPinSupport } from './types';

export type JointId = 'J1' | 'J2' | 'J3' | 'J4';
export const JOINT_IDS: readonly JointId[] = ['J1', 'J2', 'J3', 'J4'];

/** SPEC.md defaults (unit-case geometry, 6061-T6 disc, M3 bolt + 5 mm bushing, M3 standoff, 61800). */
export function defaultGearboxInputs(): GearboxInputs {
  return {
    Zp: 18,
    Zw: 6,
    D: 85,
    e: 1.3,
    L: 6.35,
    rr: 2.5,
    rw: 2.5,
    Db: 19,
    tMin: 2.0,
    discs: 1,
    gap: 0.5,
    RwOverride: null,
    wall: 4,
    innerPinSupport: DEFAULT_INNER_PIN_SUPPORT,
    discMaterial: materialProps('al-6061'),
    outerPin: {
      construction: 'boltBushing',
      shankDia: 3.0,
      boltYield: 640,
      material: { ...SPEC_STEEL },
      // integral ring only (Addition 12): unused by bolt + bushing and solid pins
      housingMaterial: defaultHousingMaterial(),
      rootClearance: DEFAULT_ROOT_CLEARANCE,
      toolRadius: DEFAULT_TOOL_RADIUS,
    },
    innerPin: {
      construction: 'standoff',
      od: 5.0,
      bore: 2.46,
      standoffYield: 300,
      material: { ...SPEC_STEEL },
    },
    Treq: 5.85,
    Tdes: 8.8,
    Kc: 2.0,
    KcLife: 1.3,
    discShare: null,
    bearing: { name: '61800', C: 1380, C0: 585 },
    rpm: 300,
    reqLifeH: 2000,
  };
}

export interface JointPresetSpec {
  label: string;
  D: number;
  e: number;
  Treq: number;
  Tdes: number;
  discs: number;
  note: string;
}

export const JOINT_PRESET_SPECS: Record<JointId, JointPresetSpec> = {
  J2: { label: 'J2 shoulder pitch', D: 85, e: 1.6, Treq: 5.85, Tdes: 8.8, discs: 2, note: '' },
  J3: { label: 'J3 elbow pitch', D: 70, e: 1.07, Treq: 2.25, Tdes: 3.4, discs: 1, note: '' },
  J1: { label: 'J1 base yaw', D: 60, e: 0.92, Treq: 1.3, Tdes: 2.0, discs: 1, note: 'T_req is an estimate' },
  J4: { label: 'J4 forearm roll', D: 60, e: 0.92, Treq: 0.3, Tdes: 1.0, discs: 1, note: 'T_req is an estimate' },
};

export function presetInputs(id: JointId): GearboxInputs {
  const p = JOINT_PRESET_SPECS[id];
  return { ...defaultGearboxInputs(), D: p.D, e: p.e, Treq: p.Treq, Tdes: p.Tdes, discs: p.discs };
}

export const PRESETS: Record<JointId, GearboxInputs> = {
  J1: presetInputs('J1'),
  J2: presetInputs('J2'),
  J3: presetInputs('J3'),
  J4: presetInputs('J4'),
};

/** The preset a joint with no preset of its own starts from when the torque is unknown or unusable. */
export const FALLBACK_PRESET: JointId = 'J3';

/**
 * The SPEC.md preset whose working torque T_req is closest (as a ratio) to the given torque. Used to give a newly
 * added cycloidal joint a sensible starting gearbox. Falls back to the J3 preset for a missing or non-positive torque.
 */
export function closestPresetId(Treq: number | null | undefined): JointId {
  if (typeof Treq !== 'number' || !Number.isFinite(Treq) || Treq <= 0) return FALLBACK_PRESET;
  let best: JointId = FALLBACK_PRESET;
  let bestD = Infinity;
  for (const id of JOINT_IDS) {
    const d = Math.abs(Math.log(Treq / JOINT_PRESET_SPECS[id].Treq));
    if (d < bestD - 1e-12) { bestD = d; best = id; }
  }
  return best;
}

/**
 * Fill any missing or non-numeric field of a partial/imported object from the defaults,
 * so that a hand-edited JSON never crashes the engine. Returns a complete GearboxInputs.
 */
export function normalizeGearboxInputs(partial: unknown): GearboxInputs {
  const d = defaultGearboxInputs();
  if (!partial || typeof partial !== 'object') return d;
  const p = partial as Record<string, unknown>;
  const merge = <T extends object>(base: T, over: unknown): T => {
    const out = { ...base } as Record<string, unknown>;
    if (over && typeof over === 'object') {
      for (const [k, v] of Object.entries(over as Record<string, unknown>)) {
        if (!(k in out)) continue;
        const b = out[k];
        if (b !== null && typeof b === 'object') out[k] = merge(b as object, v);
        else if (typeof b === 'number') out[k] = typeof v === 'number' ? v : b;
        else if (typeof b === 'string') out[k] = typeof v === 'string' ? v : b;
        else out[k] = v === null || typeof v === 'number' ? v : b; // nullable numeric (RwOverride, discShare)
      }
    }
    return out as T;
  };
  const out = merge(d, p);
  // an unknown or missing support model (older sessions have none) is the bolted tie ring
  if (!INNER_PIN_SUPPORTS.includes(out.innerPinSupport as InnerPinSupport)) out.innerPinSupport = DEFAULT_INNER_PIN_SUPPORT;
  // stock form: older sessions have none, so it follows the saved kind (a missing value must not inherit the default's)
  const rawMat = (x: unknown): Record<string, unknown> | null => (x && typeof x === 'object' ? x as Record<string, unknown> : null);
  const fixForm = (m: MaterialProps, raw: Record<string, unknown> | null) => {
    const f = raw?.form;
    m.form = f === 'plate' || f === 'printed' ? f : materialForm({ kind: m.kind });
  };
  fixForm(out.discMaterial, rawMat(p.discMaterial));
  fixForm(out.outerPin.material, rawMat(rawMat(p.outerPin)?.material));
  if (out.outerPin.housingMaterial) fixForm(out.outerPin.housingMaterial, rawMat(rawMat(p.outerPin)?.housingMaterial));
  fixForm(out.innerPin.material, rawMat(rawMat(p.innerPin)?.material));
  // machining tolerances (Addition 13): optional; a missing spec stays missing (= the default spec, profile clearance 0)
  if (p.tolerance !== undefined && p.tolerance !== null) out.tolerance = normalizeToleranceSpec(p.tolerance);
  if (typeof p.useToleranceKc === 'boolean') out.useToleranceKc = p.useToleranceKc;
  return out;
}
