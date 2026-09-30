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
* `validateGearboxInputs(inputs) -> { errors, warnings }` – for inline field validation.

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

```ts
const arm = defaultArmInputs();          // placeholders; masses g, lengths mm, alpha rad/s², SF 1.5, floor 1.0 N·m
arm.barMass_g[1] = 140;                  // arrays are [J1..J5] or [riser, barA, barB, barC, barD]
const a = computeArm(arm);               // ArmResult
a.joints[1]  // ArmJointLoad: TstaticModel, TdynModel, TreqModel, inertia, Treq, Tdes (after overrides),
             // treqOverridden, tdesOverridden, outboardWeight_N, overturningMoment_Nm
a.totalMass_g, a.reach_mm, a.valid/errors/warnings
```

`ArmInputs`: `jointMass_g[5]`, `barMass_g[5]`, `barLength_mm[5]`, `payload_g`, `alpha[5]`, `SF`, `TdesFloor`,
`override[5] = {Treq|null, Tdes|null}`. `joints[0..4]` = J1..J5; J5 is the servo (`Treq` = torque to deliver,
`Tdes = SF·Treq`, no floor, no gearbox check). `validateArmInputs(arm)` for inline validation.

Model (arm straight out): J2/J3 static = g·Σm·x outboard; J4 static = g(m_D·L_D/2 + m_payload·L_D); J1 static = 0,
yaw T = α·I with the same inertia as J2. `outboardWeight_N` = weight outboard of the joint (excludes the joint's
own lumped mass). `overturningMoment_Nm` = the gravity moment: J2/J3 static torque, J1 the arm moment Σm·x·g on
the yaw bearing, J4 the roll gravity torque (= its static torque), J5 0.

**Defaults (placeholders until CAD):** joint masses [450, 700, 577, 180, 120] g, bar masses [80, 110, 90, 40, 70] g,
bar lengths [100, 230, 200, 80, 110] mm, payload 250 g, α 3 rad/s². Gives T_req J1 0.70, **J2 5.87**, **J3 2.25**,
J4 0.32, J5 0.32 N·m. (J1's SPEC estimate 1.3 N·m is not reachable with a consistent arm: it equals J2's dynamic term.)

Feed the gearbox: `{ ...gearboxInputs, Treq: a.joints[i].Treq, Tdes: a.joints[i].Tdes }` (see the summary helper).

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

## 7. All-joints summary (`summary.ts`)

```ts
summarizeAllJoints(arm: ArmInputs, gearboxes: Record<'J1'|'J2'|'J3'|'J4', GearboxInputs>,
                   opts?: { useArmLoads?: boolean | Partial<Record<JointId, boolean>>; resolution? }): AllJointsSummary
```

Returns `{ arm: ArmResult, rows: JointSummaryRow[4], servo: ServoRow, counts }`. Each row: `joint`, `loadsFromArm`, `Treq`, `Tdes`,
`outboardWeight_N`, `overturningMoment_Nm`, `inputs` (as checked, torques applied), `result` (full `GearboxResult`), `verdict`,
`governing` (label), `maxUtilization`, `discMass_g`, `geometry {Zp, ratio, D, e, K1, L, discs}`. If the arm is invalid the typed
torques are used. `servo` = `{Treq, Tdes, Tstatic, Tdyn, outboardWeight_N}` for J5. The "Design" button just opens the advisor
with `rows[i].inputs`.

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
  (same sampling, endpoint exclusion, profile index, `invR > 0` filter, Fb). Two deliberate differences: contact limits are the SPEC formulas
  (1.67·Sy = 460.9, 0.577·σf/0.25 = 240.0) instead of the script's rounded 460/240, and an undercut (path curvature > 1/rr) also sets the cusp flag.
* Polymer warning card: show when `result.polymerWarning`, text from `POLYMER_WARNING_LINES`. It is not a failed check.
