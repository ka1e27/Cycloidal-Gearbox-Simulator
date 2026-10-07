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
  innerPinSupport: 'ringClamped' | 'ringPinned' | 'cantilever';   // inner pin bending model, default 'ringClamped'
  discMaterial: MaterialProps;                      // {E, nu, Sy, sigmaF, density, kind}
  outerPin: { construction: 'boltBushing' | 'solid' | 'shoulderBolt' | 'standoff' | 'integral'; shankDia; boltYield; material: MaterialProps;
              housingMaterial?; rootClearance?; toolRadius?;      // integral ring only (section 2b)
              standoffId?; standoffMaterial?; pocketLocated? };  // outer standoff only (section 2d)
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
  A missing or unknown `innerPinSupport` (older sessions have none) becomes `'ringClamped'`. `checkGearbox` also treats
  a missing value as `'ringClamped'`; a present but unknown one is a validation error.
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

**Inner pin support (`innerPinSupport`).** The inner pins are always fixed (recessed and bolted) at the output face.
`'ringClamped'` (default, the arm's hardware): the far ends are bolted to one free-floating rigid tie ring, tip slope 0.
`'ringPinned'`: tied by the ring but free to rotate in it. `'cantilever'`: no tie ring, the SPEC cantilever
`F_in_pk·arm/Z`. `INNER_PIN_SUPPORTS` lists them, `INNER_PIN_SUPPORT_TEXT[model]` is the one-line description used
in the check basis, `innerPinSupportOf(inputs)` resolves a missing value to the default.

## 2. Materials (`materials.ts`)

* `MATERIALS: Material[]` – 15 entries `{id, name, note, kind, family, form, E, nu, Sy, sigmaF, density}`, ordered by family
  (`MATERIAL_FAMILIES`: Metals; Machined plastics; 3D-printed plastics):
  metals `steel-1018, steel-4140, al-6061, al-7075`; machined `hdpe, uhmw, pom, pa66`; printed `petg, pla, abs, asa, pc, pa12, pa6cf`.
  Every plastic is `kind: 'polymer'` (so the polymer warning card applies); machined vs printed is in the name and in `form`.
  `getMaterial(id)`, `materialProps(id)` (editable copy, includes `form`).

  | id | name | E MPa | ν | Sy MPa | σf 10⁷ MPa | ρ g/cm³ | form |
  |---|---|---|---|---|---|---|---|
  | hdpe | HDPE (machined) | 1000 | 0.46 | 25 | 8 | 0.95 | plate |
  | uhmw | UHMW-PE (machined) | 700 | 0.46 | 20 | 7 | 0.93 | plate |
  | pom | Acetal / POM / Delrin (machined) | 2900 | 0.35 | 65 | 30 | 1.41 | plate |
  | pa66 | Nylon PA66 (machined, moisture-conditioned) | 2000 | 0.39 | 55 | 20 | 1.14 | plate |
  | abs | ABS (3D printed) | 2000 | 0.35 | 35 | 10 | 1.04 | printed |
  | asa | ASA (3D printed) | 2000 | 0.35 | 38 | 11 | 1.07 | printed |
  | pc | Polycarbonate (3D printed) | 2300 | 0.37 | 55 | 15 | 1.20 | printed |
  | pa12 | Nylon PA12 (3D printed, SLS/MJF or FDM) | 1700 | 0.40 | 45 | 14 | 1.01 | printed |
  | pa6cf | Nylon PA6-CF (3D printed, carbon fiber) | 6000 | 0.35 | 70 | 20 | 1.15 | printed |

* **Stock form.** `MaterialProps.form?: 'plate' | 'printed'` picks the disc thickness list: `materialForm(m)` (missing or unknown
  = from `kind`: polymer → printed, metal → plate) and `discStockFor(m)` (`DISC_STOCK_PLATE` = 3.175…12.7 mm for metals and
  machined plastics, `DISC_STOCK_PRINTED` = 4…12 mm). The advisor, the fix engine and the stock-thickness picker all use it
  (never the name). `normalizeGearboxInputs` keeps a saved form and derives a missing one from the saved kind.
  `sameMaterialProps(a, b)` compares the numbers, kind and form (the pickers' "is this still the library entry" test).
* `SPEC_STEEL` – generic steel E 200 GPa, ν 0.30 used as the default bushing/standoff contact material
  (gives E\* = 57,259 MPa on 6061). Not in `MATERIALS`; offer it as the default for pin materials.
* `effectiveModulus(pin, disc)`, `SUPPLIER_DATA_NOTE`, `POLYMER_WARNING_LINES` (text for the polymer warning card).
* Bending helpers: `outerPinBendingLimit`, `innerPinBendingLimit`, `outerPinSectionModulus`, `innerPinSectionModulus`.

Catalogs (`catalog.ts`): `BEARINGS` (15 bearings `{name, series, bore, OD, width, C, C0}`, flagged approximate via
`BEARING_NOTE`; the original eight keep indices 0–7 because saved advisor locks store an index, the ultra-thin 67xx are appended:
6700 10×15×4 C 855 C0 435, 6701 12×18×4 925/530, 6702 15×21×4 940/585, 6703 17×23×4 1000/655, 6704 20×27×4 1040/730,
6705 25×32×4 1100/840, 6706 30×37×4 1120/900). `BEARING_SERIES` (`'67'` "Ultra-thin 67xx (4 mm wide)", `'618'` "Thin 618xx",
`'60'` "Standard 60xx") and `bearingsBySeries()` give the display grouping used by the bearing pickers, the advisor lock row
and nothing else (the advisor searches all 15; the DXF cam looks its bore up by name). `OUTER_PIN_OPTIONS` (od, bolt label, shank), `INNER_PIN_OPTIONS` (od, bore, thread),
`DISC_STOCK_METAL/POLYMER`, `ZP_OPTIONS`, `ZW_OPTIONS`.

## 2b. Integral (pinless) ring machined into the housing (`integral.ts`, CLAUDE.md Addition 12)

`outerPin.construction = 'integral'`: no pins, bolts or bushings. The teeth are half-round bumps of radius `rr` (any positive
value, no catalog) centred on the pin circle, cut into the housing. Extra fields (all optional; `integralSpecOf(outerPin)` fills
the defaults, and `defaultGearboxInputs()` / `normalizeGearboxInputs` carry them for every construction):
`housingMaterial` (default 6061-T6), `rootClearance` c (mm, default 0.3), `toolRadius` r_tool (mm, default 1.5).
`outerPin.material` is not used (and not validated) for an integral ring.

* **Geometry** (`derived.integral: IntegralDerived | null`): reach = max sampled actual-profile radius + e (never below the exact
  Rp + 2e − rr); `Rh` = reach + c; `toothHeight` = Rh − (Rp − rr); `baseChord` b = 2·Rh·sin φb with
  cos φb = (Rp² + Rh² − rr²)/(2·Rp·Rh); `pitchChord` = 2·Rh·sin(π/Zp); `toothLength` Lt = discs·L + (discs − 1)·gap;
  `housingOD` = 2·Rh + 2·wall. Validation errors (`integralGeometryErrors`): rr ≤ e + c/2 (teeth do not reach the wall), tooth
  bases overlap (φb ≥ π/Zp), or the tool fillet does not fit between two teeth (its root tangent angle α > π/Zp; the message gives
  `maxFittingToolRadius`). Field errors: "Housing material: …", "Root clearance must be >= 0 mm", "Tool radius must be > 0 mm".
* **Contact**: same Hertz sweep; `EstarRing` from the disc/housing pair; limits = `contactLimits(disc, housing)`
  (`ringContactMaterial(outerPin)`). A polymer housing sets `polymerWarning`.
* **Checks**: `boltBending` is absent (its loads read 0). In its place:
  * `toothRoot` "Ring tooth root (integral)": F = `loads.FRingPeak` (per disc) acting over one disc thickness L (each disc
    loads its own stretch of the tooth; `toothLength` Lt is reported for reference only), σb = 6·F·h/(L·b²) (h = tooth
    height, a conservative lever), τ = 1.5·F/(L·b), value = √(σb² + 3τ²) vs min(0.4·Sy, σf) of the housing. `loads.toothBending/toothShear/toothStress`;
    `info = {bending, shear, combined, baseChord, toothHeight, toothLength}`.
  * `toolFillet` "Tool fillet clearance", kind `min`, limit `FILLET_CLEARANCE_MIN` = 0.05 mm: the fillet is the tool circle
    tangent to the root circle (|F| = Rh − r_tool) and the tooth (|F − C| = rr + r_tool). The disc profile (128 points per lobe at
    npf 6000) is swept over the reference angles θ_t = 2πt/nth in the ring frame, folded into one half tooth sector, and the
    farthest point per angular bin is kept (`discEnvelope`; it sweeps only θ mod 2π/Zp and one mirror half, which is exact:
    `discEnvelopeReference` is the brute-force version). Value = smallest signed distance to the fillet arcs (negative = the fillet
    cuts into the disc path). `info = {toolRadius, maxToolRadius}`; `derived.integral.maxToolRadius` is the largest tool radius
    whose clearance is ≥ 0.05 mm (bisection to 0.001 mm, also capped by the gap fit).
* **Model**: `model.ringProfile(tol)` (closed CCW polyline: per tooth the − fillet, the tooth arc through Rp − rr, the + fillet and
  the root arc) and `drawingAt(θ).ring = { profile, Rh }`; `ringProfile(Zp, Rp, rr, Rh, rt, tol)` is the same as a pure function.
* **Advisor**: `rr` is searched over `INTEGRAL_RR_OPTIONS` (1.5 to 6 mm, 0.25 steps); a lock is `{kind: 'custom', od: 2·rr}`
  (a catalog index means that catalog OD). Housing OD = 2·Rh + 2·wall, so it depends on e; groups are ordered by the e at K1 = 0.40
  (a lower bound) and every candidate uses its own OD. The coarse search checks the tooth root, and the fillet clearance
  (`filletClearanceCached`, nth 120, 64 points per lobe) only for candidates that pass everything else. About 1 to 2 s.
* **Fixes**: tooth radius both ways (0.25 mm grid, field `rr`); a stronger housing (`outerPin.housingMaterial`) when a ring contact
  or the tooth root governs; a smaller tool (`outerPin.toolRadius`: the standard `END_MILL_RADII` below the current one plus the
  largest that fits) when the tool fillet check fails. Bolt grade and bushing material fixes are not offered.
* **DXF**: the housing part becomes "Ring housing (integral teeth)", make 1: the tooth profile as one closed polyline, the outline
  circle (housing OD) and `housingHoleCount` (default 6) holes of `housingHoleDia` (default 3.4 mm) on the mid-wall circle
  (Rh + OD/2)/2; notes give thickness = Lt + 2·gap. `info.ringRoot`, `info.ringPointCount`. The pin sheet lists only the inner pins.
* Check time: about 5 ms (vs 1.5 ms for pins).

## 2c. Shoulder bolt outer pins (`'shoulderBolt'`)

A ground shoulder screw is the pin; no bushing, the disc slides on the shoulder. `outerPin.material`, `shankDia` and `boltYield` are
not used: the pin is always `SHOULDER_BOLT_STEEL` (class 12.9: E 205000, ν 0.29, Sy 1080, σf 450, metal; `outerPinMaterial(p)`).
* **Checks**: as a solid pin of d = 2·rr: `boltBending` is labelled "Shoulder bolt bending", limit min(0.4·Sy, σf) = 432 MPa, same span.
  Ring E\* uses the bolt steel (`ringContactMaterial`), contact limits the weaker of disc and bolt. A rr that is not a catalog shoulder
  gives a warning. The SPEC solver now also uses `ringContactMaterial` (unchanged for bolt + bushing and solid pins).
* **Catalog** `SHOULDER_BOLT_OPTIONS` (append-only; `id, system 'metric'|'inch', dia, label, thread, tapDrill, upper, lower` in mm):
  metric 4/M3, 5/M4, 6/M5, 8/M6, 10/M8 at −0.013/−0.038; inch 1/8" #4-40, 3/16" #8-32, 1/4" #10-24, 5/16" 1/4-20, 3/8" 5/16-18 at
  −0.0005/−0.002 in. `shoulderBoltFor(rr)`, `shoulderBoltsOf(system)`, `shoulderBandOf(rr)` → `{meanUndersize, halfBand}` (diametral;
  metric band for a non-catalog rr). The checks use the nominal diameter.
* **Tolerances**: `ringTolOf(inputs)` → `RingTol {integral, shoulder: {pinDiaTol, undersize} | null}`; every function that took
  `integral: boolean` (`toleranceStacks`, `fittedClearances`, `processSpec` opts, `defaultToleranceSpec`, `matchProcess`) also takes a
  `RingTol`. For a shoulder bolt `effectiveSpec(spec, ring)` sets bushingPlay 0 and pinDiaTol = the half band (the stored spec keeps
  its values); every outer gap gets the deterministic + meanUndersize/2; the profile stack subtracts it. Default/preset hole play:
  reamed (0.005). `ToleranceResult.spec` is the effective spec. Sensitivity: no bushing play term; the pin diameter term carries the
  undersize.
* **Advisor**: `AdvisorOptions.shoulderSystem` ('metric' default | 'inch' | 'both'); a catalog `outerPin` lock indexes
  `SHOULDER_BOLT_OPTIONS`; `AdvisorDesign.outerBolt` = the thread.
* **Fixes**: the next larger shoulders of the same system (`rr` up); no bolt grade or material fix.
* **DXF**: housing "make 2": the shoulder plate (left, holes 2·rr + pin hole clearance = 2·holePlay, 0.01 reamed) and the far plate
  (right, tap-drill holes) side by side; notes "Far plate: tap for <thread>; set plate spacing with the housing ring, not the shoulder
  length". The pins sheet lists the shoulder bolts.

## 2d. Round standoff outer pins (`'standoff'`)

A plain round female-female standoff is the pin (no bushing, the disc slides on the OD); a screw goes into each end. `outerPin.material`,
`shankDia` and `boltYield` are not used. Optional fields (older sessions have none; `outerStandoffSpecOf(p)` fills the defaults,
`normalizeGearboxInputs` keeps valid values and drops garbage): `standoffId` (an `OUTER_STANDOFF_OPTIONS` id; it tells two threads of
one OD apart), `standoffMaterial: 'stainless' | 'aluminum' | 'brass'` (default stainless), `pocketLocated` (default true).
* **Materials** (`standoffMaterialProps(id)`, `STANDOFF_MATERIAL_LABEL`): stainless 303/304 E 193000, ν 0.29, Sy 215, σf 240, ρ 8.0
  (`STANDOFF_STAINLESS`); aluminum = library 6061-T6; brass C360 E 97000, ν 0.31, Sy 310, σf 140, ρ 8.5 (`STANDOFF_BRASS`).
  `outerPinMaterial(p)` returns it, so ring E\* and the contact limits (weaker of disc and standoff) use it. Annealed stainless (Sy 215)
  is weaker than 6061-T6, so on an aluminum disc the standoff sets the ring contact limits.
* **Checks**: `boltBending` is labelled "Outer standoff bending": the same simply-supported value with the hollow section
  Z = π(OD⁴ − bore⁴)/(32·OD) (`outerPinSectionModulus`; OD = 2·rr, bore = the catalog tap drill, or 0.5·OD for a non-catalog OD, which
  warns), limit min(0.4·Sy, σf) of the standoff material (stainless 86, aluminum 104, brass 124 MPa). The load-sharing pin spring uses the
  hollow I (`outerPinSecondMoment`). Galling: `standoffGalls(inputs)` (aluminum standoffs on an aluminum-like disc: metal, E 60 to 80 GPa)
  adds the warning `STANDOFF_GALLING_WARNING`; an unknown `standoffMaterial` is an input error.
* **Catalog** `OUTER_STANDOFF_OPTIONS` (append-only; `id, system, od, label, thread, bore, clearanceHole`): metric 4.5/M2.5, 5/M3, 6/M4,
  8/M5 (bores as `INNER_PIN_OPTIONS`); inch 3/16" #4-40, 1/4" #6-32, 1/4" #8-32, 5/16" #10-32 (number tap drills). `outerStandoffFor(rr, id?)`,
  `outerStandoffsOf(system)`, `outerStandoffBore(rr, id?)`.
* **Tolerances**: `RingTol.standoff = {pocketLocated}`. `effectiveSpec` sets bushingPlay 0 only (the pin diameter tolerance stays
  editable). Presets / defaults: pinDiaTol `STANDOFF_DIA_TOL` = 0.05 (± on the diameter), hole play `standoffHolePlay(pocketLocated)` = 0.02
  (`STANDOFF_POCKET_HOLE_PLAY`) or 0.1. `withStandoffPockets(g, located, fit?)` flips the switch and moves the hole play (a matched preset is
  re-fitted; with `fit` also statistically). The sensitivity has no bushing play term. The sliding-contact η note is the shoulder bolt's.
* **Advisor**: standoff sizes of `AdvisorOptions.shoulderSystem` (the UI passes the length unit's system); the material stays as chosen;
  a catalog lock indexes `OUTER_STANDOFF_OPTIONS`; `AdvisorDesign.outerBolt` = the thread, `inputs.outerPin.standoffId` is set.
* **Fixes**: the next larger standoffs of the same system (field `rr`, the patch also sets `standoffId`); a stronger standoff material when
  bending governs (field `outerPin.standoffMaterial`, never aluminum on an aluminum disc); "Locate the standoffs in pockets" (field
  `tolerance`, label "Standoff location") with the tolerance Kc. No bushing material, bolt grade or reamed-hole fix.
* **DXF**: housing make 2 (plates alike). In pockets: `Zp` pocket circles of OD + pin hole clearance (2·holePlay = 0.04) with the screw
  clearance hole in each centre; the pocket depth is a note, `ExportOptions.standoffPocketDepth` (null = 1.5 mm, 1/16" in an inch file).
  Otherwise clearance holes only. Notes: "Standoff length sets plate spacing (±0.1 mm typical); check the axial gaps or set spacing with the
  housing ring", "Round standoffs only, not hex". The pins sheet lists the standoffs (hollow section).

## 3. The gearbox check

```ts
checkGearbox(inputs, opts?: { npf?: number; nth?: number }): GearboxResult   // SPEC resolution 6000 / 240
```

```ts
GearboxResult {
  valid; errors; warnings; polymerWarning: boolean;
  derived: { Zc, ratio, Rp, K1, dh, Rroot, Rw, RwIsOverride, ligBore, ligHoles, ligRoot,
             pinClearance, EstarRing, EstarInner, share, span, housingOD };
  unit:    { p0Ring, FRing, p0Inner, FInner, Fb, rhoMinConvex,       // T = 1 N·m, one disc, Kc = 1
             MRingClamped, MRingPinned };                             // tied-pin peak moment, N·mm
  loads:   { p0RingStrength, p0RingLife, p0InnerStrength, p0InnerLife, FRingPeak, FInnerPeak,
             boltBendingFixed, boltBendingSimple, standoffBendingTie, standoffBendingCantilever,
             standoffArm, standoffBendingRingClamped, standoffBendingRingPinned, standoffBending,
             bearingPeak, bearingWorking, L10h };
  checks:  Check[];            // value, limit, unit, kind 'max'|'min', utilization, status, basis, info?
  innerPinSupport;             // the model the standoffBending check used
  verdict: 'pass' | 'marginal' | 'fail' | 'invalid';
  governing: Check | null;     // the worst check = governing failure mode
  maxUtilization; contactScore; cusp: boolean;
  mass: { netAreaMm2, perDisc_g, total_g };
  sweep: { thetaDeg[], p0Strength[], p0Life[], FPeak[], bearingLoad[], limitStrength, limitLife };
}
```

Check ids: `ringContactStrength, ringContactLife, innerContactStrength, innerContactLife, ligamentBore,
ligamentHoles, cusp, boltBending, standoffBending, bearingStatic, bearingLife` (an integral ring has `toothRoot, toolFillet` in
place of `boltBending`), plus `ligamentRoot`
only when `RwOverride` is set. `utilization` = value/limit (`max`) or limit/value (`min`), finite, capped
at 99. `status`: `ok` ≤ 0.85 (green), `marginal` ≤ 1.0 (amber), `fail` > 1.0 (red). Use an icon/text as
well as colour. `boltBending.info = {fixedFixed, simplySupported}`. `standoffBending.info = {ringClamped, ringPinned,
cantilever, specTieRing}` (MPa); the check value is `loads.standoffBending`, the one of the first three that
`innerPinSupport` selects, and its `basis` names the model (e.g. "Recessed standoffs + bolted tie ring: fixed at the
output face, tips tied by a floating ring. Peak bending vs 0.5 x standoff yield").

Inner pin bending, tied model (`kernel.ts`: `standoffRingSweep`, cached `standoffRingUnit`, general
`ringStandoffMoment`): pins are Euler-Bernoulli beams fixed at x = 0 (output face); H = discs·L + (discs+1)·gap;
disc k loads every pin at a_k = gap + k(L+gap) + L/2 with the reference sine-law force P_j = F_j·u at the sweep angles
θ_i = 2πi/nth (a second disc is 180° out of phase: −P_j on the same pins). The floating ring takes no net force and no
net moment about the axis: Ft_j = −Σ_k c_k (P_j − P̄ − m ẑ×r_j), m = Σ(r_j×P_j)_z/(Zw Rw²); bolted ring
c = a²(3H−2a)/H³ with tip couple C_j = −Σ P_j a²/(2H) − Ft_j H/2; pinned c = a²(3H−a)/(2H³), C_j = 0;
M_j(x) = Ft_j(H−x) + C_j + Σ_{a_k>x} P_j(a_k−x), max at x ∈ {0, a_k, H}. `unit.MRing*` is the max over θ, pins and
sections per N·m on one disc (Kc = 1); stress = M·Kc·T_des·share/Z. It scales exactly as 1/Rw, so the cache sweeps
once at Rw = 1 per (Zw, Zp, nth, discs, L, gap). The SPEC heuristic `standoffBendingTie` = cantilever/2 and
`standoffBendingCantilever` keep their SPEC values (57 / 113 MPa for J2) but the heuristic is no longer a check.
Derivation and FEM validation: `scripts/parity/standoff/README.md`. `derived.pinClearance` (< 1 mm also adds a warning) is
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
`form`, 15 bearings). The pin *construction* and materials come from `inputs`. A manual `discShare` is ignored
(1.0 / 0.55 used). Objective: smallest housing OD (`D + 2rr + 2wall`), then lower disc mass, fewer discs, lower max
utilization. Every check (incl. both ligaments, cusp, bearings) must be ≤ `target`. The pick and alternatives are
re-verified with `checkGearbox` at full resolution. The inner pin bending check uses `inputs.innerPinSupport`; in the
coarse search the tied-ring moment is swept once per (Zp, discs, L, Zw) at Rw = 1 and nthCoarse and rescaled by 1/Rw.

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

## 6b. Fix suggestions (`fixes.ts`, "how to fix it")

```ts
suggestFixes(inputs, opts?: FixOptions, hooks?): FixReport            // sync, never throws
suggestFixesAsync(inputs, opts?, hooks?): Promise<FixReport>          // yields between variables; cancellable
applyFix(inputs, fix) = { ...inputs, ...fix.patch }
motorUtilization(inputs, motor, Zp): number | null                   // max(T_des / peak capacity, T_req / continuous); speed short = 1.0001
getCalcClient().fixes(inputs, opts, onProgress): CalcJob<FixReport>   // worker message type 'fixes'
```

`FixOptions`: `target` (0.85, clamped 0.5–1.0), `motor` (a cycloidal joint's `MotorSpec`: adds the motor check and the ratio fix),
`Dmax` (150), `npfCoarse/nthCoarse` (1500/120), `npfFull/nthFull` (6000/240).

For a design with any check (motor included) above the target it tries ONE variable at a time, everything else unchanged, and
finds the smallest change that brings every check to ≤ target. Searches run at the coarse resolution; every reported fix is
re-checked at full resolution and grid searches are walked at full resolution so the reported value passes and the next value
toward the current one fails. When no value of a variable reaches the target it reports the smallest change that gets every
check under 1.0, else the smallest one with 75 % of the best improvement ("helps").

| Variable (`field`) | Search |
|---|---|
| `D` up | 0.5 mm grid on (D, min(2D, Dmax)] (2D when D ≥ Dmax), scan then bisection; e scales with D to keep the current K1 (clamped 0.40–0.85, e = K1·(D/2)/Zp rounded to 0.0001 mm), so the patch sets D and e |
| `e` both ways | 0.01 mm grid inside K1 0.40–0.85, K1 scan at 0.025 each way, bisection next to the first pass; the better direction is reported |
| `L` up | stock list of the disc's form above L (`to` = next stock size that passes) plus `exactMin` on a 0.05 mm grid |
| `discs` | 1 → 2 |
| `rr` / `rw` up | outer / inner catalog sizes above the current one; patch sets rr + bolt shank / rw + standoff OD and bore |
| `Zw` | 4–10, nearest first (up before down); invalid geometry is skipped |
| `bearing` | all 15 catalog bearings (smallest bore change first); patch sets `bearing` and `Db` |
| `discMaterial` | library materials with Sy and σf ≥ current and one of them higher; lightest passing first |
| `innerPinSupport` | cantilever → pinned tie ring → bolted tie ring |
| `outerPin.boltYield`, `outerPin.material`, `innerPin.material` | only when the governing check is a pin bending or pin contact check: bolt class 10.9 / 12.9; steel bushing / pin materials (plastics too for a plastic disc); a standoff of 1018 / 4140 sets its material and yield |
| `Zp` | never as a gearbox fix. With a motor whose check is above the target: the recommended ratio (`recommendRatio`), or the smallest higher Zp inside the motor's speed limit that gets the motor under the target; e rescaled to keep K1 (`rescaleEForZp`, now in `motor.ts`) |

`Fix = { field, label, direction ('up'|'down'|'change'), from, to (display text, mm / N / MPa), fromValue, toValue, short ("▲ D → 92 mm"),
newMaxUtil, governing, governingId, passesTarget, passesLimit, patch (coupled fields included, never torques), sideEffects
("housing OD 98 → 106 mm", "+42 g disc mass", "K1 0.68 → 0.80", "disc stack 7.35 → 14.2 mm wide"), improves (failing checks it lowers),
checkUtils, exactMin? (L), cost }`. Ranking: fixes that pass the target first, by cost = relative change + housing OD and stack width
added (fractions) + half the disc mass added (fraction); then the ones that only help, lowest result first.
`FixReport = { valid, cancelled, errors, target, needed, maxUtil, governing, governingId, motorUtil, fixes, byCheck, evaluated, elapsedMs }`;
`byCheck` has one entry per check above the target: `{ id, label, utilization, status, fields (every field that lowered it, even
partly), fixes (indices into fixes, best first) }`. A PASS design returns `needed: false` and no fixes. Typical time 10–50 ms
(about 100 coarse and 10–30 full checks).

J2 SPEC case (D 85, e 1.3, 1 disc, 5.85 / 8.8 N·m, max 1.362 on ring contact life): no single change reaches 0.85. L → 12.7 mm gives
0.963, D → 143 mm with e → 2.187 mm (K1 0.55 kept) 0.998, 7075-T6 1.007 (ring contact strength then governs), 2 discs 1.010;
e → 1.6 mm 1.282, M5 / 8 mm outer pins 1.195. J2 preset (e 1.6, 2 discs): D → 100.5 mm, e → 1.892 mm (K1 0.68) passes at 0.850.

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
* Fix highlights: `src/ui/fixes.tsx` (`FixesProvider` inside the store) runs `client.fixes` for every gearbox slot with a check
  above 0.85 (debounced 300 ms, one job at a time, the selected slot first, stale jobs cancelled); `useFixes(slot)` returns the
  report for the slot's current inputs. Gearbox design highlights every field in a fix (accent border + chip, Advanced headers and
  section titles get a badge), the Checks rows get a "How to fix" line, the verdict's TO FIX text lists the real top fixes, the
  inspector chip bar and section headers show a count, and the rail marks an amber / red joint with "FIX" when a single change
  passes. Applying goes through the store's `applyGearboxChange` (one-step Undo in the toast).

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

## 12. Pose explorer (`src/calc/pose.ts`, CLAUDE.md Addition 9)

Forward kinematics and the static gravity load at any joint angles, for the Pose Explorer card. **Display only**: the gearbox checks, advisor,
motor and DXF code keep using the worst case from `computeArm`. Pure, never throws, every output finite. Angles are degrees, positions mm, torques N*m (SI inside: g -> kg, mm -> m, g = 9.81).

**Frames.** World z is up and joint 0 is at the origin. At q = 0 the arm is in the Addition 7 worst-case pose: links before the first pitch joint point +z (a column on
the base axis), and from the first pitch joint on every link points +x. With no pitch joint, every link points up. Joint axes at q = 0 (`zeroPoseFrames`), right-handed, +q turns about them:

* pitch: **-y** (horizontal, perpendicular to the link). This sign is a deliberate choice: **+q lifts the link** (counter-clockwise in the side view, seen from -y), so the Ready pose reads J2 = +90.
* yaw: +z (for a yaw after a pitch, the axis perpendicular to both its link and the pitch axis).
* roll: along its own link at q = 0 (+z in the column, +x after the first pitch).

Product of exponentials with Rodrigues matrices (`rodrigues(k, theta)`): `R_i = R_{i-1} * Rot(a0_i, q_i)`, world axis `a_i = R_{i-1} a0_i`, `p_{i+1} = p_i + R_i (L_i d0_i)`.
A joint's rotation acts on everything outboard. Masses: joint i's lumped mass at p_i, link i's mass at its midpoint, the payload at the tip. A joint's own mass does not
load itself (lever 0) but loads every joint inboard, as in `arm.ts`.

**Torque.** `tau_i = a_i . sum_{j outboard of i} (r_j - p_i) x (m_j g z)`: the holding torque the joint must supply, positive in its +q direction. Numerically it equals
the gravity moment `a' . sum (r - p) x (-m g z)` about a' = -a_i (+y for pitch), so a pitch joint at q = 0 reads **+T_static**.
**Bending:** at a cut on link i (fraction t = 0, 0.5, 1), the moment of everything outboard of the cut. The cut rod's outboard part (1 - t) is a point mass at that part's centre.
The bending is the component perpendicular to the link, and the torsion (the component along it) is reported at the root.

```ts
computePose(arm: ArmInputs, anglesDeg: readonly number[], result?: ArmResult): PoseResult
// missing / non-finite angles read 0; non-finite or negative masses and lengths read 0; `result` defaults to computeArm(arm)
interface PoseResult {
  joints: PoseJoint[];   // { index, id, motion, drive, angleDeg, pos_mm: Vec3, axis: Vec3 (unit, world), tau_Nm (signed), absTau_Nm,
                         //   Tstatic_Nm (computeArm TstaticModel), Tdes_Nm (overrides included), util: |tau|/T_des | null, status: 'ok'|'marginal'|'fail'|'none' }
  links: PoseLink[];     // { index, from_mm, to_mm, dir (unit, defined for zero length), length_mm, Mroot_Nm, Mmid_Nm, Mend_Nm, torsionRoot_Nm }
  masses: PoseMass[];    // chain order joint 0, link 0, ..., payload: { kind: 'joint'|'link'|'payload', index (-1 payload), mass_g, pos_mm, weight_N }
  tip_mm: Vec3; reach_mm (horizontal distance from the base axis); height_mm (above joint 0);
  maxUtil: number | null; worstJoint: number (-1 if none);
  Mmax_Nm (largest bending at this pose); Mref_Nm (largest bending at q = 0, an upper bound at every pose); armValid: boolean;
}
```

`util` is null (status `'none'`) when the arm is invalid, or when T_des is 0 and the torque is not; 0 when both are 0. Status uses the check thresholds: <= 0.85 (`GREEN_LIMIT`) ok, <= 1.0 marginal, > 1.0 fail.

**Presets** (`posePreset(joints, name)`; pitch joints get the listed angles in order, everything else 0):
`straight` all 0 (the worst case); `ready` +90, -90 (upper arm up, forearm out: the drawing's ready pose); `folded` +80, -145, +65; `reachUp` +90 (all up).
`randomPose(joints, rnd?)`: yaws +-150, the first pitch 0..120, other pitches +-120, rolls +-180, whole degrees. Helpers: `wrapDeg(x)` to (-180, 180] (NaN -> 0) and `lerpAngle(a, b, t)` (shortest way).

**Invariants** (tested in `src/calc/__tests__/pose.test.ts`):

* at q = 0, tau of every pitch joint equals `computeArm` T_static (to 1e-9);
* a yaw with no pitch upstream (vertical axis) reads exactly 0 at every pose;
* at every pose, `|tau_i| <= T_static,i + 1e-9` for every joint type (property test: 30 random 1..8-joint arms x 2000 random poses), and `Mmax_Nm <= Mref_Nm`.
  The reason: |a x d| <= |d| <= the chain distance, which is the worst-case lever. For a roll, masses up to the next non-roll joint stay on its axis;
* hand cases: a 2-pitch arm at 0/45/90 deg; the default arm in its Ready pose (J2 = J3 = 0.20915 g, J5 = 0.03135 g, tip (390, 0, 230)); a roll with J4 = 90 and J5 = 90 gives the roll worst case;
* no NaN for any input, including zero-length links and invalid arms.

UI: `src/ui/viz/view3d.ts` (orthographic camera, az = el = 0 is the side view from -y; projection, cylinder and arc helpers, drag math) and `src/ui/viz/PoseExplorer.tsx`.
Session: `Session.poseView: { angles (deg, keyed by joint id; missing = ready pose), az, el, weights }`, normalized by `normalizePoseView`. It is display-only and not exported,
and import and reset keep the current one.

**Joint limits** (display only). `ArmJoint.limits?: { min, max }` is in degrees, with -180 <= min < max <= 180, and absent means ±180. It is stored with the arm, so it persists
and is exported, but `computeArm` ignores it: the checks keep the worst case. The helpers are
`validateJointLimits(min, max) -> string | null` and `normalizeJointLimits(raw)` (a bad pair or the full range gives undefined; `normalizeArmInputs` uses it),
plus `jointLimits(j)`, `hasLimits(j)`, `clampAngle(j, deg)` (a limited joint clamps, a full-range joint wraps) and
`clampPose(joints, angles) -> { angles, clamped: indices }`. `randomPose` always lands inside the limits.

## 13. Machining tolerances, backlash and load sharing (`tolerance.ts`, `toleranceKc.ts`, CLAUDE.md Addition 13)

Inputs: `GearboxInputs.tolerance?: ToleranceSpec` (all mm: `profileClearance`, `innerHoleClearance` (diametral), `bushingPlay`,
`holePlay` (radial), `bearingClearance`, `profileError` (±), `pinPosition` (true-position radius), `pinDiaTol` (±), `eccError` (±),
`innerHolePosition`, `innerPinDiaTol` (±), plus `mcTrials` (400) and `seed` (1)) and `useToleranceKc?: boolean`. A missing spec is
`defaultToleranceSpec(integral)` = the CNC mill preset with fitted clearances (0.155 / 0.070 mm with plain clearance holes; an integral
ring 0.050 / 0.070). The bushing play is a one-sided gap; the hole play is a two-sided position error (a clamped bolt anywhere in its
hole), added to the true-position vector. `normalizeGearboxInputs` keeps a present spec (normalized
with `normalizeToleranceSpec`) and the switch, and leaves a missing spec missing. `toleranceOf(inputs)` is the spec in effect;
`validateToleranceSpec(spec)` gives per-field messages (0..5 mm, trials 20..5000). The main checks never read the spec.

Presets: `PROCESS_PRESETS` (`waterjet`, `laser`, `router`, `mill`, `edm`, `fdm`, `sls`; the table of the brief), `PRESET_COMMON`,
`processSpec(id, { integral?, holePlay?, keep? })` (clearances fitted: `fittedClearances(spec, integral)` = `toleranceStacks` rounded up to
0.005 mm, profile stack dp + dQ + holePlay + pinDiaTol/2 + de (integral 2 dp + de), inner 2 (dh_pos + tol/2 + de)), `matchProcess(spec,
integral?)` (process fields and the fitted clearances for the spec's hole play; an edited clearance = custom),
`tighterProcesses(spec)` (nearest first, by `processLooseness`). `REAMED_HOLE_PLAY` 0.005, `DRILLED_HOLE_PLAY` 0.1.

**DXF (one source of truth).** `buildParts` takes the profile clearance from `tolerance.profileClearance`, the plate pin-hole and bushing
bore clearance from `2 * tolerance.holePlay`, and the Zw disc holes from `dh + tolerance.innerHoleClearance` (`dxfClearancesOf`).
`ExportOptions.profileClearance` / `pinHoleClearance` are ignored (kept for stored options); `discHoleClearance` now widens the centre
bore only. The UI moves old stored DXF values into gearboxes without a spec once (`migrateDxfTolerance` in `src/ui/session.ts`).

```ts
analyzeTolerance(inputs, opts?: ToleranceOptions, hooks?): ToleranceResult        // sync, never throws (20-90 ms at 400 trials)
analyzeToleranceAsync(inputs, opts?, hooks?): Promise<ToleranceResult>
getCalcClient().tolerance(inputs, opts, onProgress): CalcJob<ToleranceResult>      // worker message type 'tolerance'
```

`ToleranceOptions`: `trials`, `seed` (default: the spec's), `nBacklash` (24 per pitch), `nKc` (8), `sensitivity` (true),
`sensitivityTrials` (100). `ToleranceResult`: `valid`, `cancelled`, `errors`, `warnings`, `spec`, `integral`, `trials`, `seed`,
`freeBuilds` (builds that fit and turn at every sample; the statistics use only these), `bindProb`, `statsShown` (at least min(50, trials)
free builds, else the statistics are NaN), `backlash { design (no errors, bushing play/2, hole play 0), worst (full play, every term
widening each pin: an upper bound of every build, so p50 <= p95 <= worst): {total, ring, inner, arcmin}, mc, mcArcmin: {p50, p95, mean} }`
(rad; design <= p50 is not guaranteed, random errors usually take play away), `binding { minGapWorst, requiredProfileClearance, suggestedProfileClearance,
binds, interferenceProb, innerMinGapWorst, requiredInnerHoleClearance, suggestedInnerHoleClearance, innerBinds, innerInterferenceProb }`,
`kc { designStrength, designLife, strength, life: {p50, p95, mean}, typedKc, typedKcLife }`, `stiffness { strength, life: PinStiffness,
Funit, kappaA, sumArm2, share, Kt_Nm_per_rad, Kt_Nm_per_arcmin, twistReq, twistReq_arcmin }`, `sensitivity { backlash, kc:
{term, label, value, share}[] } | null`.

The model (gaps, the exact 2D free-rotation test, inner holes, worst case, binding stack, load sharing, Hertz + bending spring,
stiffness, sensitivity) is written out at the top of `tolerance.ts`. Building blocks, all exported and pure:
`toleranceGeometryAt`, `feasibleTranslation`, `freeRotation`, `innerFreeRotation`, `loadShare`, `hertzLineApproach`, `pinStiffness`,
`governingContact`, `makeRng`, `quantile`, `armTipLevers(arm)` (mm per joint, worst-case pose), `armTipSlop(levers, perJoint)`.

**Tolerance Kc in the checks** (as built, before run-in, an upper bound: only the outer pins give way). With `useToleranceKc` on, `checkGearbox` / `createGearboxModel` use the cached p95 strength / life Kc
(`setToleranceKc(inputs, {Kc, KcLife})`, keyed by `toleranceKey(inputs)` = every input except Kc, Kc_life and the switch), or an
explicit `opts.toleranceKc`; until a value is cached the typed ones are used. `GearboxResult.kc = { source: 'typed' | 'tolerance' |
'pending', Kc, KcLife, typedKc, typedKcLife }` says which. `resolveKc`, `withResolvedKc`, `kcTag` (cache-key suffix for UI memos).
The fix engine and the advisor hold the resolved factors fixed during their searches (the worker client sends the main thread's cached
value as `FixOptions.toleranceKc` / `AdvisorOptions.toleranceKc`); advisor designs come back with the typed factors and the switch.
With the switch on, `suggestFixes` adds field `'tolerance'` ("Process → CNC mill"): the tighter presets, nearest first, each with its
own Monte Carlo Kc (`processTrials`, default 200), keeping the user's hole play.

**Statistical clearance fit.** `ToleranceSpec.fitMode: 'worst' | 'statistical'` (default and old specs: 'worst') and `bindTarget`
(0.001..0.2, default 0.01). `statisticalFitFor(inputs, spec, { trials? })` returns the smallest profile / inner hole clearances on the
0.005 mm grid whose Monte Carlo binding probability (ring / inner holes separately) is <= bindTarget, never above the worst-case fit. It
uses its own sample, independent of `mcTrials`: n = `fitTrialsFor(target)` = clamp(ceil(50 / target), 2000, 25000) binding-only builds
(5000 for 1%). The builds are drawn as the analysis draws them (same seed and order of draws, so the first mcTrials builds are the
analysis's own builds; a clearance only adds to every gap): deterministic and monotone in the target. Per build the smallest clearance
that fits at every theta sample is found (inner holes exact; ring bisected to 1e-5 mm with `feasibleTranslation`, skipping theta samples
that cannot raise it), and the fitted value is the smallest grid point at most floor(target x n) builds exceed. The result carries the
probabilities at the fitted value and one grid step below (`ringProb`, `innerProb`, `ringProbBelow`, `innerProbBelow`). Results are
cached by `statFitKey` (geometry, process values, hole play, target, n, seed). About 0.25-1 s on this machine for 5000 builds.
`fitClearances(inputs, spec)` applies the spec's mode. The analysis runs the statistical fit only in statistical mode
(`ToleranceResult.fit = { worst, statistical }`, NaN otherwise). Worker message `statFit` / `client.statFit(inputs, spec)`. In the UI the
fit never runs on the main thread: a preset, mode, target or hole-fit change applies the worst-case fit at once and the provider
(`useStatFit`) replaces the clearances when the worker's fit returns (unless the process values or the clearances changed meanwhile).
`mcTrials` defaults to 1000 (a stored 400, the old default, is read as 1000).
