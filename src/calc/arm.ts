// Arm load model (CLAUDE.md Addition 1).
// Chain: base -> J1 (yaw) -> riser -> J2 (shoulder pitch) -> bar A -> J3 (elbow pitch) -> bar B ->
// J4 (forearm roll) -> bar C -> J5 (wrist pitch servo) -> bar D (tool) -> payload at the tool tip.
// Masses in grams and lengths in mm on input; torques in N*m, weights in N, inertia in kg*m^2 on output.

export const G = 9.81; // m/s^2

export type Five = [number, number, number, number, number];
export const ARM_JOINT_NAMES = ['J1', 'J2', 'J3', 'J4', 'J5'] as const;
export type ArmJointName = (typeof ARM_JOINT_NAMES)[number];
/** Bar order: riser (J1-J2), bar A (J2-J3), bar B (J3-J4), bar C (J4-J5), bar D (J5-tool tip) */
export const ARM_BAR_NAMES = ['Riser (J1-J2)', 'Bar A (J2-J3)', 'Bar B (J3-J4)', 'Bar C (J4-J5)', 'Bar D / tool (J5-tip)'] as const;

export interface ArmOverride {
  /** Manual T_req, N*m. null = use the model. */
  Treq: number | null;
  /** Manual T_des, N*m. null = max(SF*T_req, floor). */
  Tdes: number | null;
}

export interface ArmInputs {
  /** Lumped mass at each joint J1..J5 (motor + gearbox + housing), g */
  jointMass_g: Five;
  /** Bar masses [riser, A, B, C, D], g. Uniform rods, COM at the midpoint. */
  barMass_g: Five;
  /** Centre-to-centre length of each bar [riser, A, B, C, D], mm */
  barLength_mm: Five;
  /** Payload at the tool tip, g */
  payload_g: number;
  /** Max angular acceleration per joint J1..J5, rad/s^2 */
  alpha: Five;
  /** Service factor */
  SF: number;
  /** Minimum design torque, N*m */
  TdesFloor: number;
  override: [ArmOverride, ArmOverride, ArmOverride, ArmOverride, ArmOverride];
}

/**
 * Default arm. These masses and lengths are PLACEHOLDERS until CAD masses exist; they are chosen so
 * the model gives roughly T_req = 5.85 N*m at J2 and 2.25 N*m at J3 (the SPEC.md presets).
 */
export function defaultArmInputs(): ArmInputs {
  return {
    jointMass_g: [450, 700, 577, 180, 120],
    barMass_g: [80, 110, 90, 40, 70],
    barLength_mm: [100, 230, 200, 80, 110],
    payload_g: 250,
    alpha: [3, 3, 3, 3, 3],
    SF: 1.5,
    TdesFloor: 1.0,
    override: [
      { Treq: null, Tdes: null }, { Treq: null, Tdes: null }, { Treq: null, Tdes: null },
      { Treq: null, Tdes: null }, { Treq: null, Tdes: null },
    ],
  };
}

export interface ArmJointLoad {
  joint: ArmJointName;
  /** Gravity torque about the joint, N*m (0 for J1) */
  TstaticModel: number;
  /** Dynamic term alpha*I, N*m */
  TdynModel: number;
  /** Model T_req = static + dynamic, N*m */
  TreqModel: number;
  /** Inertia about the joint axis, kg*m^2 */
  inertia: number;
  /** T_req actually used (model or manual override), N*m */
  Treq: number;
  /** T_des actually used, N*m */
  Tdes: number;
  treqOverridden: boolean;
  tdesOverridden: boolean;
  /** Output-bearing radial load: weight of everything outboard of the joint, N */
  outboardWeight_N: number;
  /** Output-bearing overturning moment = gravity moment about the joint, N*m */
  overturningMoment_Nm: number;
}

export interface ArmResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  /** J1..J5. J5 is the servo: Treq is its required torque, Tdes = SF*Treq (no gearbox check). */
  joints: ArmJointLoad[];
  totalMass_g: number;
  /** Horizontal reach from the J2 axis to the tool tip, mm */
  reach_mm: number;
}

const fin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

export function validateArmInputs(a: ArmInputs): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  try {
    const arr = (v: unknown, name: string, min: number, strict: boolean) => {
      if (!Array.isArray(v) || v.length !== 5) { errors.push(`${name} needs 5 values`); return; }
      v.forEach((x, i) => {
        if (!fin(x)) errors.push(`${name} ${i + 1} is not a number`);
        else if (strict ? x <= min : x < min) errors.push(`${name} ${i + 1} must be ${strict ? '>' : '>='} ${min}`);
      });
    };
    arr(a.jointMass_g, 'Joint mass', 0, false);
    arr(a.barMass_g, 'Bar mass', 0, false);
    arr(a.barLength_mm, 'Bar length', 0, false);
    arr(a.alpha, 'Angular acceleration', 0, false);
    if (!fin(a.payload_g) || a.payload_g < 0) errors.push('Payload must be >= 0 g');
    if (!fin(a.SF) || a.SF <= 0) errors.push('Service factor must be > 0');
    if (!fin(a.TdesFloor) || a.TdesFloor < 0) errors.push('T_des floor must be >= 0 N*m');
    if (!Array.isArray(a.override) || a.override.length !== 5) errors.push('Overrides need 5 entries');
    else {
      a.override.forEach((o, i) => {
        for (const k of ['Treq', 'Tdes'] as const) {
          const v = o?.[k];
          if (v != null && (!fin(v) || v < 0)) errors.push(`Manual ${k === 'Treq' ? 'T_req' : 'T_des'} for J${i + 1} must be >= 0`);
        }
      });
    }
    if (!errors.length && a.SF < 1) warnings.push('Service factor below 1.');
  } catch (err) {
    errors.push(`Arm input could not be read: ${err instanceof Error ? err.message : String(err)}`);
  }
  return { errors, warnings };
}

interface Element {
  /** mass, kg */
  m: number;
  /** horizontal distance of the centre of mass from the J2 axis (arm straight out), m */
  x: number;
  /** rod length along the arm for its own inertia, m (0 = point mass) */
  len: number;
  kind: 'joint' | 'bar';
  /** joint index 0..4 for a lumped joint mass; for a bar, the joint it follows (riser follows J1) */
  idx: number;
}

function emptyJoint(name: ArmJointName): ArmJointLoad {
  return {
    joint: name, TstaticModel: 0, TdynModel: 0, TreqModel: 0, inertia: 0, Treq: 0, Tdes: 0,
    treqOverridden: false, tdesOverridden: false, outboardWeight_N: 0, overturningMoment_Nm: 0,
  };
}

/** Compute the torque each gearbox has to carry. Never throws. */
export function computeArm(a: ArmInputs): ArmResult {
  const v = validateArmInputs(a);
  if (v.errors.length) {
    return {
      valid: false, errors: v.errors, warnings: v.warnings,
      joints: ARM_JOINT_NAMES.map(emptyJoint), totalMass_g: NaN, reach_mm: NaN,
    };
  }
  const mJ = a.jointMass_g.map((x) => x / 1000);
  const mB = a.barMass_g.map((x) => x / 1000);
  const Lb = a.barLength_mm.map((x) => x / 1000);
  const mP = a.payload_g / 1000;

  // Positions along the straight-out arm, measured from the J2 axis (J1 is on the same vertical axis).
  const xJ = [0, 0, Lb[1], Lb[1] + Lb[2], Lb[1] + Lb[2] + Lb[3]];
  const xTip = xJ[4] + Lb[4];

  const els: Element[] = [];
  for (let k = 0; k < 5; k++) els.push({ m: mJ[k], x: xJ[k], len: 0, kind: 'joint', idx: k });
  // riser is vertical and on-axis: a point mass at x = 0 with no horizontal extent
  els.push({ m: mB[0], x: 0, len: 0, kind: 'bar', idx: 0 });
  for (let k = 1; k < 5; k++) els.push({ m: mB[k], x: xJ[k] + Lb[k] / 2, len: Lb[k], kind: 'bar', idx: k });
  els.push({ m: mP, x: xTip, len: 0, kind: 'bar', idx: 4 }); // payload, outboard of everything

  // Outboard of joint j: lumped joint masses of joints k > j, bars following joints k >= j, payload.
  const outboard = (e: Element, j: number) => (e.kind === 'joint' ? e.idx > j : e.idx >= j);

  const weightOut = (j: number) => G * els.filter((e) => outboard(e, j)).reduce((s, e) => s + e.m, 0);
  const momentAbout = (j: number) =>
    G * els.filter((e) => outboard(e, j)).reduce((s, e) => s + e.m * (e.x - xJ[j]), 0);
  const inertiaAbout = (j: number) =>
    els.filter((e) => outboard(e, j)).reduce((s, e) => {
      const d = e.x - xJ[j];
      return s + e.m * (d * d + (e.len * e.len) / 12);
    }, 0);

  // Roll / wrist: bar D horizontal and perpendicular to the axis, payload at its tip.
  const LD = Lb[4];
  const staticWrist = G * (mB[4] * LD / 2 + mP * LD);
  const inertiaWrist = mB[4] * LD * LD / 3 + mP * LD * LD;

  const joints: ArmJointLoad[] = ARM_JOINT_NAMES.map((name, j) => {
    const o = emptyJoint(name);
    o.outboardWeight_N = weightOut(j);
    if (j === 0) {
      o.TstaticModel = 0;
      o.inertia = inertiaAbout(0);
      o.overturningMoment_Nm = momentAbout(0);
    } else if (j === 1 || j === 2) {
      o.TstaticModel = momentAbout(j);
      o.inertia = inertiaAbout(j);
      o.overturningMoment_Nm = o.TstaticModel;
    } else {
      o.TstaticModel = staticWrist;
      o.inertia = inertiaWrist;
      o.overturningMoment_Nm = j === 3 ? staticWrist : 0;
    }
    o.TdynModel = a.alpha[j] * o.inertia;
    o.TreqModel = o.TstaticModel + o.TdynModel;
    const ov = a.override[j];
    o.treqOverridden = ov?.Treq != null;
    o.Treq = o.treqOverridden ? (ov!.Treq as number) : o.TreqModel;
    o.tdesOverridden = ov?.Tdes != null;
    const floor = j === 4 ? 0 : a.TdesFloor;
    o.Tdes = o.tdesOverridden ? (ov!.Tdes as number) : Math.max(a.SF * o.Treq, floor);
    return o;
  });

  const totalMass = a.jointMass_g.reduce((s, x) => s + x, 0) + a.barMass_g.reduce((s, x) => s + x, 0) + a.payload_g;
  return {
    valid: true, errors: [], warnings: v.warnings, joints,
    totalMass_g: totalMass, reach_mm: xTip * 1000,
  };
}

/**
 * Fill any missing or non-numeric field of a partial/imported arm object from the defaults, so a
 * hand-edited JSON never crashes the engine. Returns a complete ArmInputs. Never throws.
 */
export function normalizeArmInputs(partial: unknown): ArmInputs {
  const d = defaultArmInputs();
  if (!partial || typeof partial !== 'object') return d;
  const p = partial as Record<string, unknown>;
  const five = (v: unknown, base: Five): Five => {
    const out = [...base] as Five;
    if (Array.isArray(v)) {
      for (let i = 0; i < 5; i++) if (typeof v[i] === 'number' && Number.isFinite(v[i])) out[i] = v[i] as number;
    }
    return out;
  };
  const num = (v: unknown, base: number) => (typeof v === 'number' && Number.isFinite(v) ? v : base);
  const nullable = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const ov = Array.isArray(p.override) ? p.override : [];
  const override = d.override.map((base, i) => {
    const o = (ov[i] ?? {}) as Record<string, unknown>;
    return o && typeof o === 'object' ? { Treq: nullable(o.Treq), Tdes: nullable(o.Tdes) } : { ...base };
  }) as ArmInputs['override'];
  return {
    jointMass_g: five(p.jointMass_g, d.jointMass_g),
    barMass_g: five(p.barMass_g, d.barMass_g),
    barLength_mm: five(p.barLength_mm, d.barLength_mm),
    payload_g: num(p.payload_g, d.payload_g),
    alpha: five(p.alpha, d.alpha),
    SF: num(p.SF, d.SF),
    TdesFloor: num(p.TdesFloor, d.TdesFloor),
    override,
  };
}
