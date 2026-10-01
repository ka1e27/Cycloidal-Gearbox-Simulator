# Calc engine API (`src/calc/`)

Pure TypeScript, no React, no DOM. Everything is exported from `src/calc/index.ts`:

```ts
import { checkGearbox, createGearboxModel, computeArm, getCalcClient, PRESETS /* ... */ } from './calc';
```

**Units:** mm, N, N·m, MPa internally. Arm masses are **grams**, arm lengths **mm**. Angles: radians
for `theta` arguments, degrees where a field says `Deg`. Densities g/cm³. Masses of discs in g.

**Robustness contract:** no public function throws on the UI path. Bad input gives a result with
`valid: false` and `errors: string[]`. Soft problems go in `warnings: string[]`.
Results are plain data (structured-cloneable). Two fields can legitimately be `Infinity`:
`unit.rhoMinConvex` / cusp `value` (no convex lobe) and `loads.L10h` (zero bearing load).
`JSON.stringify` turns those into `null`, so persist **inputs**, not results. Show `—` for
non-finite numbers; valid results never contain `NaN`.

---

## 1. Gearbox inputs

```ts
interface GearboxInputs {
  Zp; Zw; D; e; L; rr; rw; Db; tMin; discs; gap;   // SPEC geometry (mm; Zp, Zw integers; discs 1|2)
  RwOverride: number | null;                        // null = pins as far out as t_min allows
  wall: number;                                     // housing wall for housingOD, default 4 mm
  discMaterial: MaterialProps;                      // {E, nu, Sy, sigmaF, density, kind}
  outerPin: { construction: 'boltBushing' | 'solid'; shankDia; boltYield; material: MaterialProps };
  innerPin: { construction: 'standoff' | 'solid'; od; bore; standoffYield; material: MaterialProps };
  Treq; Tdes; Kc; KcLife;                           // N·m, factors
  discShare: number | null;                         // null = 1.0 (1 disc) / 0.55 (2 discs)
  bearing: { name; C; C0 };                         // N
  rpm; reqLifeH;
}
```

* `defaultGearboxInputs()` – SPEC defaults (D 85, e 1.3, 6061-T6, M3 bolt + 5 mm bushing, M3 standoff, 61800).
* `PRESETS.J1 | J2 | J3 | J4` (`JointId`) and `presetInputs(id)`, `JOINT_PRESET_SPECS` (labels, notes), `JOINT_IDS`.
* `normalizeGearboxInputs(unknown)` – fills missing/garbage fields from the defaults. Use for localStorage/JSON import.
* `validateGearboxInputs(inputs) -> { errors, warnings }` – for inline field validation. Every number has an upper
  bound (`GEARBOX_MAX`: D 10000 mm, e/L/rr/rw/t_min/gap/wall/pin diameters 1000 mm, Db 10000 mm, torques 1e6 N·m, Kc 100,
  rpm 1e6, life 1e9 h, bearing ratings 1e9 N, E 1e7 MPa, strengths 1e6 MPa, density 100 g/cm³) with a message such as
  "D must be at most 10000 mm", so no Infinity or NaN can reach a result or a message. A result whose loads are
  not finite is returned as `valid: false`.

**Pin construction semantics.** `outerPin.material` is the *bushing* (E, ν for E\*) when
`boltBushing` (bending: `shankDia`, limit 0.4·`boltYield`); for `solid` it is the pin material
(bending d = 2·rr, limit min(0.4·Sy, σf); contact limits use the weaker of disc and pin).
`innerPin`: `standoff` bends with `od`/`bore`, limit 0.5·`standoffYield`; `solid` uses d = 2·rw and
min(0.5·Sy, σf). E\* is computed from the real disc/pin pair for ring and inner contact separately
(`derived.EstarRing`, `derived.EstarInner`). Note `rr`/`rw` are radii and are independent of
`shankDia`/`od`: when you change the pin option in the UI, set both (`rr = OD/2`).

## 2. Materials (`materials.ts`)

* `MATERIALS: Material[]` – six entries `{id, name, note, kind, E, nu, Sy, sigmaF, density}`
  (`steel-1018, steel-4140, al-6061, al-7075, petg, pla`). `getMaterial(id)`, `materialProps(id)` (editable copy).
* `SPEC_STEEL` – generic steel E 200 GPa, ν 0.30 used as the default bushing/standoff contact material
  (gives E\* = 57,259 MPa on 6061). Not in `MATERIALS`; offer it as the default for pin materials.
* `effectiveModulus(pin, disc)`, `SUPPLIER_DATA_NOTE`, `POLYMER_WARNING_LINES` (text for the polymer warning card).
* Bending helpers: `outerPinBendingLimit`, `innerPinBendingLimit`, `outerPinSectionModulus`, `innerPinSectionModulus`.

Catalogs (`catalog.ts`): `BEARINGS` (8 bearings, C/C0, OD, bore, width; flagged approximate via
`BEARING_NOTE`), `OUTER_PIN_OPTIONS` (od, bolt label, shank), `INNER_PIN_OPTIONS` (od, bore, thread),
`DISC_STOCK_METAL/POLYMER`, `ZP_OPTIONS`, `ZW_OPTIONS`.

## 3. The gearbox check

```ts
checkGearbox(inputs, opts?: { npf?: number; nth?: number }): GearboxResult   // SPEC resolution 6000 / 240
```

```ts
GearboxResult {
  valid; errors; warnings; polymerWarning: boolean;
  derived: { Zc, ratio, Rp, K1, dh, Rroot, Rw, RwIsOverride, ligBore, ligHoles, ligRoot,
             pinClearance, EstarRing, EstarInner, share, span, housingOD };
  unit:    { p0Ring, FRing, p0Inner, FInner, Fb, rhoMinConvex };     // T = 1 N·m, one disc, Kc = 1
  loads:   { p0RingStrength, p0RingLife, p0InnerStrength, p0InnerLife, FRingPeak, FInnerPeak,
             boltBendingFixed, boltBendingSimple, standoffBendingTie, standoffBendingCantilever,
             standoffArm, bearingPeak, bearingWorking, L10h };
  checks:  Check[];            // value, limit, unit, kind 'max'|'min', utilization, status, basis, info?
  verdict: 'pass' | 'marginal' | 'fail' | 'invalid';
  governing: Check | null;     // the worst check = governing failure mode
  maxUtilization; contactScore; cusp: boolean;
  mass: { netAreaMm2, perDisc_g, total_g };
  sweep: { thetaDeg[], p0Strength[], p0Life[], FPeak[], bearingLoad[], limitStrength, limitLife };
}
```

Check ids: `ringContactStrength, ringContactLife, innerContactStrength, innerContactLife, ligamentBore,
ligamentHoles, cusp, boltBending, standoffBending, bearingStatic, bearingLife`, plus `ligamentRoot`
only when `RwOverride` is set. `utilization` = value/limit (`max`) or limit/value (`min`), finite, capped
at 99. `status`: `ok` ≤ 0.85 (green), `marginal` ≤ 1.0 (amber), `fail` > 1.0 (red). Use an icon/text as
well as colour. `boltBending.info = {fixedFixed, simplySupported}`, `standoffBending.info = {tieRing, cantilever}`
(show the other value as info, SPEC asks for both). `derived.pinClearance` (< 1 mm also adds a warning) is
information, not a SPEC check. `sweep` is the "max ring p0 vs θ" chart (one point per input step, strength and
life curves plus the two limit lines) and also has bearing load vs θ.

```ts
const r = checkGearbox({ ...PRESETS.J3, Treq: 2.4, Tdes: 3.6 });
if (!r.valid) showErrors(r.errors);
else show(r.verdict, r.governing?.label, r.checks.map(c => [c.label, c.value, c.limit, c.utilization, c.status]));
```

### Per-θ data: `createGearboxModel`

```ts
const m = createGearboxModel(inputs, opts?);     // build once per input change (memoize)
m.result                                         // same GearboxResult
m.pinsAt(theta): DiscPin[] | null                // per-pin bar chart at input angle theta (rad)
m.drawingAt(theta, profilePoints = 720): DiscDrawing | null
m.profilePoints(n = 720): {x,y}[] | null         // disc frame, centred on the disc centre
```

`DiscPin = {index, x, y, r, loaded, forceUnit, force, p0Strength, p0Life}` – `force` is N at the design
load (Kc·T_des·share), `p0*` are MPa, unloaded pins have zeros. `DiscDrawing` is in the **ring frame** (y up
mathematically; flip y for SVG): `center` (= e·u), closed `profile` polyline (already rotated by −θ/Zc and
translated), `outerPins` (colour by `force / maxForce`), `innerHoles` (diameter `2r`, hole circles in the disc),
`innerPins`, `bore`, `maxForce`. Slider/animation cost is ~0.1 ms per frame, so call `drawingAt` directly.

## 4. Arm load model (`arm.ts`)

The arm is an ordered list of 1 to 8 joints (CLAUDE.md Addition 7). Masses are grams, lengths mm.

```ts
const arm = defaultArmInputs();            // 5 joints: yaw, pitch, pitch, roll (cycloidal) + wrist pitch (servo)
arm.joints[1].linkMass_g = 140;            // each joint carries the link that runs from it to the next joint
const a = computeArm(arm);                 // ArmResult, same order as arm.joints
a.joints[1]  // ArmJointLoad: TstaticModel, TdynModel, TreqModel, inertia, Treq, Tdes (after overrides), treqOverridden,
             // tdesOverridden, outboardWeight_N, bearingRadial_N, bearingAxial_N, bearingTiltMoment_Nm, tiltedYaw, note
a.totalMass_g, a.reach_mm, a.notes, a.valid/errors/warnings
```

```ts
type MotionType = 'yaw' | 'pitch' | 'roll';        // base yaw = vertical axis; pitch = axis perpendicular to the link; roll = axis along the link
type DriveType = 'cycloidal' | 'servo';            // cycloidal gets a gearbox check; a servo only gets the torque requirement
interface ArmJoint {
  id: string;            // stable ("J1".."J8"): keys the gearbox inputs, locks and toggles; never reused while a larger id exists
  name: string;          // free text shown as "J<position> <name>"; may be empty
  motion; drive;
  mass_g: number;        // lumped joint mass (motor + gearbox + housing)
  alpha: number;         // max angular acceleration, rad/s^2
  linkOffset_mm: number; // link load plane offset from the output bearing along the axis (pitch, tilted yaw)
  length_mm: number;     // centre-to-centre length of the link to the NEXT joint; for the last joint it is the tool, joint to tip
  linkMass_g: number;    // mass of that link (uniform rod); for the last joint the tool mass
  override: { Treq: number | null; Tdes: number | null };   // manual torques, null = model
}
interface ArmInputs { joints: ArmJoint[]; payload_g: number; SF: number; TdesFloor: number }
```

Helpers: `MIN_JOINTS`/`MAX_JOINTS` (1, 8), `MOTION_TYPES`, `DRIVE_TYPES`, `MOTION_LABEL`, `DRIVE_LABEL`, `makeJoint(existing, motion, drive?)`
(auto name = the type word, fresh id from `nextJointId`), `jointLabel(joint, index)` ("J3 elbow"), `firstPitchIndex`, `isTiltedYaw(joints, i)`,
`nextNonRoll(joints, i)`, `validateArmInputs(arm)`, `normalizeArmInputs(unknown)`.

**Old fixed format.** `LegacyArmInputs` (`jointMass_g[5]`, `barMass_g[5]`, `barLength_mm[5]`, `linkOffset_mm[2]`, `alpha[5]`, `override[5]`) is the format of
sessions and exports saved before Addition 7. `armFromLegacy(old)` converts it (joint `i` takes mass `i`, link `i` = bar `i`; the two link offsets go to
J2 and J3, the others keep 15 mm) and `normalizeArmInputs` does the same automatically when it sees the old keys, so old localStorage and JSON exports
load with identical results (`src/calc/__tests__/arm-regression.test.ts` compares 300 random old arms against a verbatim copy of the old engine, every output, to 1e-12).

**Ranges** (`ARM_LIMITS`): masses 0 to 1e6 g, lengths 0 to 1e5 mm, link offset 0 to 1e4 mm, alpha 0 to 1e4 rad/s^2, SF > 0 and at most 10 (below 1 is a warning),
torques 0 to 1e6 N*m, 1 to 8 joints, unique ids (`custom` is reserved), known motion and drive types. Anything else gives `valid: false` and a message
("Joint mass 3 must be at most 1000000 g", with the joint number being the position; link fields keep their old names "Bar mass N", "Bar length N").
Every output is also checked for finiteness. An invalid arm still returns one empty load per joint (5 default ones if the joint list itself is unusable).

**Worst-case rules** (the pose every number is computed for): links before the first pitch joint form a vertical column on the base axis (horizontal
lever 0); from the first pitch joint on every link is straight out horizontally. `x` below is the horizontal distance of an element's centre of mass from the joint axis.
Elements outboard of joint j: its own link, every later joint mass and link, the payload (the joint's own lumped mass is not included).

| Joint | Gravity torque `TstaticModel` | Inertia | Bearing |
|---|---|---|---|
| pitch | `g * sum(m x)` over outboard elements | `sum m (x^2 + L_h^2/12)` (`L_h` = horizontal rod length) | radial = outboard weight, tilt = radial x `linkOffset_mm`, axial 0 |
| yaw, no pitch upstream | 0 (vertical axis) | same sum, i.e. `I_z` with the arm straight out | axial = outboard weight, tilt = overturning moment `g * sum(m x)`, radial 0 |
| yaw after a pitch (`tiltedYaw`) | counted like a pitch (the axis can be tilted horizontal), with a `note` | same | axial as a yaw, plus the worst-case radial = outboard weight; tilt = max(overturning moment, radial x offset) |
| roll | let k be the next joint downstream that is not a roll. Elements up to and including joint k are on the axis (lever 0); everything beyond k is bent 90 degrees at k: `g * sum(m d)`, `d` = chain distance from k. No such k: 0, with a `note` | `sum m (d^2 + L^2/12)` over the elements beyond k (0 with no k) | radial = outboard weight, tilt = `g * sum(m s)` with `s` = axial distance along the roll axis from the roll bearing, the larger of straight out and bent at k (straight out always wins) |
| servo (any motion) | as its motion type | as its motion type | all 0; `Tdes = SF * Treq` with no floor |

`T_req = static + alpha * I`, `T_des = max(SF * T_req, TdesFloor)` for a cycloidal joint, manual overrides replace either. `reach_mm` = horizontal distance from the first
pitch joint to the tip (0 with no pitch joint). `notes` collects the per-joint modelling notes (tilted yaw, roll with nothing off its axis).

Default arm placeholders (g, mm): joint masses [450, 700, 577, 180, 120], link masses [80, 110, 90, 40, 70], link lengths [100 (base column), 230, 200, 80, 110 (tool)],
payload 250 g, alpha 3 rad/s^2, link offsets 15 mm. Gives T_req J1 0.70, **J2 5.87**, **J3 2.25**, J4 0.32, J5 0.32 N*m. (J1's SPEC estimate 1.3 N*m is not reachable
with a consistent arm: it equals J2's dynamic term.) The base column length only affects the drawing and the on-axis mass: a 0 mm column gives the same numbers.

Feed the gearbox: `{ ...gearboxInputs, Treq: a.joints[i].Treq, Tdes: a.joints[i].Tdes }` (see the summary helper).

**Gearboxes per joint.** `PRESETS`/`JOINT_PRESET_SPECS` stay keyed `J1..J4` (the SPEC joints). `closestPresetId(Treq)` returns the preset whose T_req is closest by ratio (J3 for a
missing or non-positive torque); the UI uses it to start a newly added cycloidal joint (see `reconcileSession` in `src/ui/session.ts`).

## 5. Minimum-size solver (`solver.ts`)

```ts
solveMinimumSize(inputs, opts?: SolverOptions, hooks?): SolverResult          // sync
solveMinimumSizeAsync(inputs, opts?, hooks?): Promise<SolverResult>            // yields; cancellable
applySolverSolution(inputs, D, e): GearboxInputs                               // "apply to inputs"
```

Sweeps D 30–120 (1 mm) × K1 0.40–0.85 (0.025), skips geometrically infeasible (Rw ≤ 0 or either ligament < t_min) and
cusp cases, score = max of the four contact utilizations, other parameters as given (an Rw override is ignored).
`SolverResult`: `minD`, `bestE`, `bestK1`, `bestScore` (null if none), `noSolution`, `floorD`/`floorK1` (geometric
floor regardless of load), `Dmax`, `rows[]` (per D), `grid {D[], K1[], score[][]}` (null = infeasible), `valid/errors/warnings`,
`cancelled`, `elapsedMs`. Screening runs at 1500/120 resolution; the accepted D is re-verified at 6000/240.
Typical time 0–150 ms.

```ts
const s = solveMinimumSize(PRESETS.J3);
if (s.noSolution) msg(`No solution up to ${s.Dmax} mm; geometric floor ${s.floorD} mm`);
else setInputs(applySolverSolution(PRESETS.J3, s.minD!, s.bestE!));
```

## 6. Design Advisor (`advisor.ts`)

```ts
adviseDesign(inputs, opts?: AdvisorOptions, hooks?): AdvisorResult
adviseDesignAsync(inputs, opts?, hooks?): Promise<AdvisorResult>
```

Options: `target` (default 0.85, clamped 0.7–1.0), `ratioVary` (Zp ∈ 12…26 even; default false = keep `inputs.Zp`),
`Dmin/Dmax` (30/150), `altWindowMm` (15), `discAltWindowMm` (40), `minPinClearance` (1 mm), resolutions
`npfCoarse/nthCoarse` (1500/120) and `npfFull/nthFull` (6000/240). Search space exactly as CLAUDE.md Addition 3
(D 1 mm steps, K1 0.40–0.85/0.025, pin and standoff catalogs, Zw 4–10, 1 or 2 discs, stock thicknesses by disc
`kind`, 8 bearings). The pin *construction* and materials come from `inputs`. A manual `discShare` is ignored
(1.0 / 0.55 used). Objective: smallest housing OD (`D + 2rr + 2wall`), then lower disc mass, fewer discs, lower max
utilization. Every check (incl. both ligaments, cusp, bearings) must be ≤ `target`. The pick and alternatives are
re-verified with `checkGearbox` at full resolution.

```ts
AdvisorResult { valid; cancelled; errors; warnings; target; best: AdvisorDesign | null;
  alternatives: { oneDisc, twoDisc, lightest, mostMargin }: (AdvisorDesign | null);
  evaluated; elapsedMs }
AdvisorDesign { slot, inputs: GearboxInputs /* apply this */, result: GearboxResult /* full-res */,
  Zp, ratio, D, housingOD, e, K1, outerPinOD, outerBolt, shankDia, innerPinOD, innerPinBore, innerThread,
  Zw, Rw, L, discs, bearingName, bearingOD, massTotal_g, maxUtilization, coarseMaxUtilization,
  governingLabel, sameAsBest }
```

"Apply to inputs" = use `design.inputs` (it is a complete `GearboxInputs`). `oneDisc`/`twoDisc` are the smallest
design with that disc count (searched up to `discAltWindowMm` beyond the best); `lightest` and `mostMargin` are chosen
within `altWindowMm` of the best housing OD. `best === null` means no design meets the target (see `warnings`).
Typical time 150–350 ms for fixed ratio, ~1–3 s with `ratioVary`. Progress `{phase:'search'|'verify', fraction (0..1,
monotonic), evaluated, bestHousingOD, D}`; `hooks = { onProgress?, shouldCancel? }`. Use the worker client below in the UI.

### Design variable locks (CLAUDE.md Addition 6)

```ts
adviseDesign(inputs, { locks: { D: 60.5, e: 1.1, L: 7.3, Zw: 8, discs: 2, Zp: 18,
  outerPin: { kind: 'catalog', index: 3 } | { kind: 'custom', od, shank },      // shank only matters for bolt + bushing
  innerPin: { kind: 'catalog', index: 2 } | { kind: 'custom', od, bore },       // bore only matters for standoffs
  bearing:  { kind: 'catalog', index: 5 } | { kind: 'custom', name?, bore?, OD, C, C0 },
  maxHousingOD: 90 } })                                                          // a constraint, not a variable
```

Every present field is fixed and comes back **exactly** as given (any D, e, L; catalog or custom pins and bearing); absent
fields are searched over the usual ranges with the same checks, objective and tie-breaks. `Zp` locked wins over `ratioVary`; with
neither, the ratio is the input's Zp (reported as locked). With `e` locked and `D` free the D grid is searched with that e
(K1 follows, only K1 < 1 is required). With all nine locked the advisor just evaluates that design with `checkGearbox`
(`best` if it meets the target, else it comes back as `closest`). `validateAdvisorLocks(inputs, locks)` returns messages
("Locked D must be > 0 mm"); invalid locks give `valid: false`. New options: `closest` and `hints` (both default true).

New result fields: `locked: AdvisorLockKey[]` (explicit locks plus the ratio when it was not allowed to vary),
`maxHousingOD`, and, only when `best` is null:

* `closest: AdvisorDesign | null` (`slot: 'closest'`): lowest maximum utilization within the locks, found by a branch-and-bound
  pass over the whole locked space (no target pruning; the 24 best coarse candidates with distinct ring geometry are re-checked
  at full resolution and the lowest full-resolution max utilization wins). `governingLabel` says what governs it. `null` when
  no geometrically valid design exists within the locks. A closest design that passes at full resolution (coarse false negative)
  is promoted to `best`.
* `relaxHints: RelaxHint[]` = `{ key, name, value, text, design }`: for every lock (and the housing limit) the advisor re-runs the
  search with **only that lock released** (other locks kept, the free variables re-optimized; best-only, half-resolution
  screening). A hint exists only if that run found a design that passes at full resolution; `design` is that design, so the text is
  a verified statement ("Unlock pin circle D: a 62 mm pin circle passes (housing 76 mm, max utilization 0.84)."). Locks whose release
  does not help produce no hint. The ratio re-run (8 values of Zp) is the expensive one: it runs last, and all re-runs share a
  deterministic work cap (150,000 ring evaluations, about 3 s); a re-run that cannot finish inside it is reported in `warnings`
  ("Too large to check quickly, so no hint was computed for: ...") rather than as "no hint".

`AdvisorProgress.phase` can also be `'closest'` or `'hints'`. Timings (this machine): any lock combination with a feasible
answer 1 to 400 ms (ratio free 1.5 s); infeasible with a few locks 20 to 400 ms; an unlocked, hopeless case (loads 66x too high)
about 4 s in total (2 s for the target and closest passes, about 2 s for the ratio hint).

## 7. All-joints summary (`summary.ts`)

```ts
summarizeAllJoints(arm: ArmInputs, gearboxes: Record<string /* joint id */, GearboxInputs>,
                   opts?: { useArmLoads?: boolean | Record<string, boolean | undefined>; resolution? }): AllJointsSummary
```

Returns `{ arm: ArmResult, rows: JointSummaryRow[], servos: ServoRow[], counts }`. `rows` has one entry per **cycloidal** joint in arm order (a servo joint
has no gearbox); `servos` one per servo joint. Each row: `joint` (the joint id), `index` (position), `name`, `motion`, `loadsFromArm`, `Treq`, `Tdes`,
`outboardWeight_N`, `bearingRadial_N`, `bearingAxial_N`, `bearingTiltMoment_Nm`, `inputs` (as checked, torques applied), `result` (full `GearboxResult`), `verdict`,
`governing` (label), `maxUtilization`, `discMass_g`, `geometry {Zp, ratio, D, e, K1, L, discs}`. A cycloidal joint missing from `gearboxes` is checked as its closest preset.
If the arm is invalid the typed torques are used. A `ServoRow` is `{joint, index, name, motion, drive, Treq, Tdes, Tstatic, Tdyn, outboardWeight_N}`.
`counts` covers the gearbox rows only. The "Design" button just opens the advisor with `rows[i].inputs`.

## 8. Worker client (`workerClient.ts`)

```ts
const client = getCalcClient();                     // shared singleton; or new CalcClient()
const job = client.advise(inputs, { target: 0.85 }, (p) => setProgress(p.fraction));
cancelButton.onclick = () => job.cancel();          // resolves immediately with cancelled: true
const res = await job.promise;                      // never rejects
if (res.cancelled) return;
if (!res.valid) showErrors(res.errors);
else if (res.best) showDesign(res.best);

const sJob = client.solve(inputs, {}, (p) => setProgress(p.fraction));
const s = await sJob.promise;
```

`CalcJob<R> = { id, promise, cancel() }`. A crashed worker resolves pending jobs with `valid: false` + an error message and is
recreated on the next call; `client.terminate()` stops everything. `client.usingWorker` is false when `Worker` is unavailable, in which
case jobs run on the main thread in cooperative slices (still cancellable, UI stays responsive). Several jobs can run at once.
The worker file is `src/calc/worker.ts` (`new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })`, handled by the
client; the UI never creates it). Protocol types are in `messages.ts`.

## 9. Notes for the UI engineer

* `checkGearbox` at full resolution takes ~3–6 ms, so run it synchronously on every input change. Only the solver/advisor need the worker.
* Sweep and drawing data come from the same model object: memoize `createGearboxModel(inputs)` on the inputs.
* Reference conformance: the kernel (`kernel.ts`) is a line-by-line port of `unit_case()` in `reference/cycloidal_disc_check.py`
  (same sampling, endpoint exclusion, profile index including the rounding of theta/Zc, `invR > 0` filter, Fb). Deliberate differences: contact limits are the SPEC formulas
  (1.67·Sy = 460.9, 0.577·σf/0.25 = 240.0, weaker of disc and pin part) instead of the script's rounded 460/240, and an undercut (path curvature > 1/rr) also sets the cusp flag.
  `npm run parity` checks all of this against the Python reference (see `scripts/parity/README.md`).
* Polymer warning card: show when `result.polymerWarning`, text from `POLYMER_WARNING_LINES`. It is not a failed check.

## 10. Session format 2 (`src/ui/session.ts`)

Export/localStorage store `arm` as the joint list and key everything per joint by the joint **id**:
`gearboxes` (cycloidal joints plus `custom`; a servo keeps a hidden entry so switching its drive back restores it), `useArmLoads`, `advisorLocks`, and `presetBase`
(for an added joint, which SPEC preset it started from, shown on the Gearbox page). `version` is 2 (`EXPORT_VERSION`). `normalizeSession` migrates format 1
(fixed five-joint arm, ids `J1..J5`, gearboxes/locks/toggles keyed `J1..J4`) without loss; unknown keys are dropped; `reconcileSession(session)` makes the per-joint
parts agree with the arm (new cycloidal joint: gearbox from `closestPresetId` of its arm-model T_req, toggle on, default locks; removed joint: all its state deleted;
`selected` falls back to the first gearbox joint, or `custom`). `armPose` (`'ready' | 'worst'`) is display-only drawing state and is not exported.

## 11. Motor torque and recommended ratio (`motor.ts`, CLAUDE.md Addition 8)

Pure functions, never throw. Torques N*m, motor speed rpm, joint speed deg/s (1 rpm = 6 deg/s). `ArmJoint.motor?: MotorSpec` is optional per-joint data and does **not**
enter `computeArm` (the arm result is identical with or without it).

```ts
interface MotorSpec {
  name?: string;
  Tpeak_Nm: number | null;           // max (peak) torque; null = not entered, no recommendation without it
  Tcont_Nm?: number | null;          // continuous torque, optional
  maxSpeed_rpm?: number | null;      // motor max speed, optional
  requiredSpeed_degps?: number | null; // speed the joint must reach, optional
  efficiency: number;                // gearbox efficiency eta, 0.1 to 1, default 0.85 (DEFAULT_MOTOR_EFFICIENCY); not used by a servo
}
```

Formulas (eta = efficiency, ratio = Zp - 1):

* `ratio_min = max( T_des / (eta * T_peak),  T_req / (eta * T_cont) when T_cont is given )`
* `ratio_max = max_speed_rpm * 6 / required_speed_deg_s` when both are given, else none
* recommended `Zp` = smallest integer with `Zp - 1 >= ratio_min` and `Zp - 1 <= ratio_max`, inside `zpRange` (default `RECOMMEND_ZP_RANGE` 8..60); a tiny load is lifted to Zp 8
* capacity at that ratio: `eta * T_peak * ratio` (peak), `eta * T_cont * ratio` (continuous); margin = capacity / T_des (peak) or / T_req (continuous)
* joint speed at full motor speed `max_speed_rpm * 6 / ratio`; motor speed needed `required_deg_s * ratio / 6`

```ts
recommendRatio(load: { Treq, Tdes }, motor, opts?: { zpRange?, advisorRange? }): MotorRecommendation
// status: 'ok' | 'warning' (Zp outside the advisor's 12..26, or ratio > 40:1 = SINGLE_STAGE_SENSIBLE_RATIO) | 'infeasible' | 'incomplete' | 'invalid'
// ratioMinPeak, ratioMinCont, ratioMin, minSetBy ('peak'|'continuous'), ratioMax, Zp, ratio, infeasibleBy ('speed'|'range'|null),
// inAdvisorRange, singleStageSensible, outputPeak_Nm, outputCont_Nm, marginPeak, marginCont, outputSpeed_degps/_rpm, motorSpeedNeeded_rpm,
// headline ("24:1 (Zp 25)" or the reason), reasons[] (plain language), errors[], warnings[]
checkMotor(load, motor, drive: 'cycloidal' | 'servo', Zp?): MotorCheck
// cycloidal: through ratio Zp - 1 at eta. servo: direct (ratio 1, eta 1), servo peak vs T_des and continuous vs T_req.
// status 'ok' | 'short' | 'incomplete' | 'invalid'; outputPeak_Nm, outputCont_Nm, peakUtil (T_des / capacity), contUtil, peakOk, contOk,
// outputSpeed_degps, speedOk, problems[], info[]
// overload (cycloidal only): { exceeds (eta*Tpeak*ratio > Tdes), stallOutput_Nm, factor, motorLimit_Nm = Tdes/(eta*ratio), limitFraction, message }.
// The overload warning never changes `status` and never changes a gearbox verdict.
motorZpSet(rec, advisorRange?): { zps, feasible, nearest, note }   // integer Zp of 12..26 the motor can drive; none -> the nearest Zp, feasible false
analyzeJointMotor(joint, load, Zp): JointMotorInfo | null          // { spec, recommendation (cycloidal only), check }; null without motor data
validateMotor(m) / normalizeMotor(raw) / hasMotorTorque(m) / ratioLabel(Zp) // "24:1 (Zp 25)"
```

`MOTOR_LIMITS`: torques > 0 and at most 1e4 N*m, speed at most 1e5 rpm and 1e6 deg/s, efficiency 0.1 to 1; continuous torque must not exceed peak. Messages are friendly
("Motor peak torque must be > 0 N·m"). Engine texts use `N·m`, so the UI's `u.text()` converts them to the chosen torque unit.

`summarizeAllJoints` rows and servo rows carry `motor: JointMotorInfo | null` (the check uses the gearbox's actual Zp and the torques that gearbox is checked with).

Design Advisor: `AdvisorOptions.zpSet?: number[]` restricts the searched Zp to those integers (8..200, sorted and de-duplicated; empty is ignored; `locks.Zp` wins). It is not a lock:
`locked` does not contain `'Zp'`, `AdvisorResult.zpSearched` echoes the set (else null), and the "Zp" relax hint (re-run with the ratio free) is offered when nothing passes. Typical time with
15 values (Zp 12..26) is 1.5 s; a hopeless infeasible case about 6 s.

UI state: `AdvisorLockState.ratioMotor: boolean | null` (null = automatic: "From motor" when the joint has usable motor data, else the old Locked / Free). `src/ui/motorUi.ts`
(`ratioPlanFor`, `patchMotor`, presets, chip texts) and `src/ui/advisorLocks.ts` (`ratioModeOf`, `toEngineLocks(state, g, motorZps)`) hold the pure helpers.
