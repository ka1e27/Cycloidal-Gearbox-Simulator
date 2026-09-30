# Cycloidal Disc Force & Failure Calculator — CLAUDE.md

## Purpose
A static website that calculates contact forces and stresses in a pin-type cycloidal gearbox (aluminum disc, steel pins) and reports, per failure mode, whether a design will break. It supports a 5-DOF robotic arm portfolio project (joints J1–J4 use cycloidal gearboxes; J5 is a direct-drive servo).

The reference implementation is `cycloidal_disc_check.py` (Python, provided alongside this file). **The website's calc engine must reproduce its numbers** (see Validation). Put it in the repo at `reference/cycloidal_disc_check.py` and don't modify it.

## Tech (recommended, not mandatory)
- Vite + React + TypeScript, deployed as a static site (e.g. GitHub Pages). No backend.
- Put all math in a pure, UI-free module (`src/calc/`) with Vitest unit tests against the validation cases below.
- Charts in plain SVG or a light chart library. Run the size sweep in a Web Worker so the UI stays responsive.
- Units everywhere: **mm, N, N·m, MPa**. Label every input and output with units.

## Gearbox architecture being modeled
- Fixed ring of **Zp outer pins** on a pin circle of diameter D (radius Rp = D/2). Each outer pin is an M3 bolt spanning two aluminum housing plates, with a free-spinning 5mm OD bushing on the unthreaded 3.0mm shank.
- Disc(s) with **Zc = Zp − 1 lobes**, driven by an eccentric of eccentricity e. Ratio = Zc:1 (default 17:1).
- **Zw inner (output) pins**: round steel M3 standoffs (5mm OD, ~2.46mm thread bore). They pass through holes of diameter (pin OD + 2e) in the disc. Pin ends are tied together by a free-floating tie ring on the far side.
- Disc material: 6061-T6 aluminum, default 6.35mm (0.25in) thick, waterjet cut.
- One or two discs. Two discs are 180° out of phase; each carries ~55% of the torque.
- Eccentric bearing default: 61800 (10×19×5), so the disc center bore is 19mm.

## Inputs (with defaults)
Geometry:
| Name | Default | Notes |
|---|---|---|
| Zp (outer pins) | 18 | integer ≥ 8 |
| Zw (inner pins) | 6 | integer ≥ 3 |
| D (outer pin circle dia) | 85 | mm |
| e (eccentricity) | 1.3 | mm; also show K1 = e·Zp/Rp (typical 0.4–0.85) |
| L (disc thickness = contact length) | 6.35 | mm |
| rr (outer pin radius) | 2.5 | mm |
| rw (inner pin radius) | 2.5 | mm |
| Db (disc center bore = eccentric bearing OD) | 19 | mm |
| t_min (min ligament) | 2.0 | mm |
| discs | 1 | 1 or 2 |
| gap (axial clearance per interface) | 0.5 | mm |
| bolt shank dia | 3.0 | mm |
| standoff OD / bore | 5.0 / 2.46 | mm |

Materials:
| Name | Default |
|---|---|
| Disc E, ν | 69,000 MPa, 0.33 (6061-T6) |
| Disc yield Sy | 276 MPa |
| Disc fatigue strength σf at 10⁷ cycles | 104 MPa (approx.) |
| Pin E, ν | 200,000 MPa, 0.30 (steel) |
| Outer bolt yield | 640 MPa (class 8.8) |
| Standoff yield | 300 MPa (low-carbon steel; assumption) |

Provide a material dropdown (6061-T6, 7075-T6, steel) that fills these fields. All values stay editable.

Loads and factors:
| Name | Default | Notes |
|---|---|---|
| T_req (required/working output torque) | per preset | N·m |
| T_des (design torque) | per preset | N·m (≈1.5 × T_req) |
| Kc (load concentration, strength case) | 2.0 | waterjet tolerance ≫ elastic deflection, so few pins share load |
| Kc_life (after run-in) | 1.3 | |
| disc share | 1.0 for 1 disc, 0.55 for 2 | |
| Bearing C (dynamic), C0 (static) | 1380 N, 585 N | 61800 approx.; user should check datasheet |
| Input speed | 300 rpm | for bearing life |
| Required bearing life | 2000 h | |

Joint presets (fill the inputs):
| Preset | D | e | T_req | T_des | discs |
|---|---|---|---|---|---|
| J2 shoulder | 85 | 1.6 | 5.85 | 8.8 | 2 |
| J3 elbow | 70 | 1.07 | 2.25 | 3.4 | 1 |
| J1 base yaw | 60 | 0.92 | 1.3 (estimate) | 2.0 | 1 |
| J4 forearm roll | 60 | 0.92 | 0.3 (estimate) | 1.0 | 1 |

## Calculation (must match the reference exactly)
All "unit" quantities are computed at **T = 1 N·m on one disc, Kc = 1**, then scaled. Forces scale linearly with torque. Hertz contact pressure scales with √(force).

### Constants and derived geometry
- E* = 1 / ((1−ν_pin²)/E_pin + (1−ν_disc²)/E_disc)  (≈ 57,259 MPa for steel on 6061)
- Zc = Zp − 1, Rp = D/2
- dh (inner hole dia) = 2·rw + 2·e
- R_root = Rp − e − rr
- Rw (inner pin circle radius) = R_root − dh/2 − t_min  (pins pushed as far out as the ligament allows; also let the user override Rw)
- Ligament to bore = Rw − dh/2 − Db/2
- Ligament between holes = 2·Rw·sin(π/Zw) − dh

### Disc profile and curvature
Parameter p ∈ [0, 2π), sampled at npf = 6000 points (endpoint excluded). Pin-center path in the disc frame:
- X = Rp·cos p − e·cos(Zp·p), Y = Rp·sin p − e·sin(Zp·p)
- dX = −Rp·sin p + e·Zp·sin(Zp·p), dY = Rp·cos p − e·Zp·cos(Zp·p)
- ddX = −Rp·cos p + e·Zp²·cos(Zp·p), ddY = −Rp·sin p + e·Zp²·sin(Zp·p)
- κt = (dX·ddY − dY·ddX) / (dX² + dY²)^(3/2)
- Actual profile curvature radius: ρa = 1/κt − rr, and κa = 1/ρa (positive = convex lobe, negative = concave root)
- Actual profile points (for drawing): outward normal (nx, ny) = (dY, −dX)/|d|, and profile = (X − rr·nx, Y − rr·ny)
- **Cusp/undercut flag** if any 0 < ρa < 0.3 mm

### Ring-pin forces and contact stress (sweep input angle)
Pins at angles aᵢ = 2πi/Zp, centers Qᵢ = Rp·(cos aᵢ, sin aᵢ). Sweep input angle θ over [0, 2π) with nth = 240 steps (endpoint excluded). For each θ:
- u = (cos θ, sin θ); disc center C = e·u; pitch point P = e·Zp·u
- nᵢ = (P − Qᵢ)/|P − Qᵢ| (unit force direction on the disc)
- rᵢ = Qᵢ + rr·nᵢ − C
- armᵢ = rᵢx·nᵢy − rᵢy·nᵢx
- Loaded pins: armᵢ > 0
- Fᵢ = 1000·armᵢ / Σ(arm_loaded²)   [N per N·m]; 0 for unloaded pins
- Profile index for pin i: j = floor(((aᵢ + θ/Zc) mod 2π) / 2π · npf) mod npf
- 1/R* = 1/rr + κa[j]. If 1/R* > 0: p0ᵢ = √(Fᵢ·E*·(1/R*) / (π·L))
- Track p0_ring_unit = max p0ᵢ and F_ring_unit = max Fᵢ over all θ and loaded pins

### Inner pins
- Closed-form peak force (sine law): F_in_unit = 4000 / (Zw·Rw)   [N per N·m]
- Concave contact: 1/R* = 1/rw − 1/(dh/2)
- p0_in_unit = √(F_in_unit·E*·(1/R*) / (π·L))
- For the bearing load (inside the θ loop): output pin angles χk = 2πk/Zw − θ/Zc. Torque arm per unit force: tqk = Rw·(cos χk·(−uy) − sin χk·(−ux)). Loaded: tqk < 0. Fk = 1000·|tqk| / Σ(tq_loaded²). Each force acts on the disc along −u.

### Eccentric bearing load
Inside the θ loop: Fb(θ) = |Σ Fᵢ·nᵢ + (Σ Fk)·(−u)|. Fb_unit = max over θ.

### Scaling to real loads (s = disc share)
- Ring contact, strength: p0_ring_unit·√(Kc·T_des·s)
- Ring contact, life: p0_ring_unit·√(Kc_life·T_req·s)
- Inner hole contact, strength / life: same with p0_in_unit
- Peak ring pin force = F_ring_unit·Kc·T_des·s; peak inner pin force = F_in_unit·Kc·T_des·s
- Outer bolt bending: span = discs·L + (discs+1)·gap. Z = π·d³/32 with d = shank dia. σ from Fpk·span/8 / Z (fixed-fixed) to Fpk·span/4 / Z (simply supported). Show the range.
- Inner standoff bending: arm = gap + (discs−1)·(L + gap) + L/2. Z = π·(OD⁴ − ID⁴)/(32·OD). σ_cantilever = F_in_pk·arm/Z; σ with tie ring ≈ σ_cantilever/2. Show both.
- Bearing: peak load = Fb_unit·T_des·s; working load = Fb_unit·T_req·s; L10h = (C / working load)³ · 10⁶ / (60 · rpm)

## Pass/fail criteria
Show each check with its utilization (value / limit) and green/amber/red status (≤ 0.85 green, 0.85–1.0 amber, > 1.0 red). **Overall verdict = worst check. Name the governing failure mode.**
| Check | Limit (default derivation) |
|---|---|
| Ring contact, strength | 1.67·Sy (≈ 460 MPa): line-contact yield onset |
| Ring contact, life | 0.577·σf / 0.25 (≈ 240 MPa): subsurface orthogonal shear (0.25·p0) vs. shear fatigue |
| Inner hole contact, strength / life | same limits |
| Ligament to bore, between holes | ≥ t_min |
| Cusp/undercut | none |
| Outer bolt bending | ≤ 0.4·bolt yield (fatigue, ~250 MPa for 8.8), using the simply-supported value |
| Inner standoff bending | ≤ 0.5·standoff yield, using the tie-ring value (show the cantilever value as info) |
| Bearing static | peak load ≤ C0 |
| Bearing life | L10h ≥ required hours |

The reference script's PASS only covers the contact, ligament-to-bore, and cusp checks. The bolt, standoff, between-holes ligament, and bearing checks are additions, so implement them as listed here.

## UI requirements
1. **Input panel**: preset dropdown (J1–J4, Custom), grouped inputs (Geometry, Materials, Loads), live recompute on change.
2. **Results panel**: verdict banner, governing mode, per-check cards with value, limit, and utilization bar. Key forces: peak ring pin force, peak inner pin force, peak bearing load, K1, Rw.
3. **Disc drawing (SVG)** with an input-angle slider θ. Draw in the ring frame: disc profile transformed by rotation −θ/Zc then translation C = e·u; outer pins at Qᵢ; inner holes at C + Rw·(cos, sin)(2πk/Zw − θ/Zc); inner pins at Rw·(cos, sin)(2πk/Zw − θ/Zc); center bore. Color loaded pins by force magnitude.
4. **Charts**: (a) per-pin force bar chart at the current θ; (b) max ring contact p0 vs θ over one full input revolution, with the strength and life limit lines.
5. **Minimum-size solver**: for the current loads and materials, sweep D from 30 to 120mm (1mm steps) and K1 from 0.40 to 0.85 (0.025 steps, e = K1·Rp/Zp). Skip geometrically infeasible or cusp cases. Score = max utilization of the contact checks. Report the smallest D with score ≤ 1, its best e, and the geometric floor (smallest feasible D regardless of load). Offer "apply to inputs".
6. **Compare mode** (nice to have): two configurations side by side.
7. An **Assumptions** panel listing the limitations below, always visible (collapsed by default).

## Validation cases (tests must match within ±2%)
Unit case, D = 85, e = 1.3, defaults otherwise: p0_ring_unit = 118.56, F_ring_unit = 10.04 N, p0_in_unit = 89.21, F_in_unit = 20.26 N, min convex ρa = 6.678 mm, Fb_unit ≈ 54.0 N.

Full cases (Kc = 2, Kc_life = 1.3, 61800 bearing, 300 rpm):
| Case | Ring strength / life | Inner strength / life | Peak ring / inner pin force | Bolt bending | Standoff (tie / cant.) | Bearing peak, L10h | Rw |
|---|---|---|---|---|---|---|---|
| J2 85, e1.3, 1 disc, T 5.85/8.8 | 497 / 327 (FAIL) | 374 / 246 | 177 / 357 N | 61–122 | 57 / 113 | 475 N, ~4,632 h | 32.9 |
| J2 85, e1.6, 2 discs | 347 / 228 | 299 / 197 | 79 / 200 N | 53–106 | 91 / 182 | 229 N, ~41,245 h | 32.3 |
| J3 70, e1.07, 1 disc, T 2.25/3.4 | 352 / 231 | 246 / 161 | 83 / 175 N | 29–57 | 28 / 56 | 227 N, ~42,797 h | 25.9 |
| J1 60, e0.92, 1 disc, T 1.3/2.0 | 302 / 196 | 197 / 128 | 57 / 126 N | 20–39 | 20 / 40 | 159 N, ~131,975 h | 21.2 |
| J4 60, e0.92, 1 disc, T 0.3/1.0 | 214 / 94 | 140 / 62 | 28 / 63 N | 10–20 | 10 / 20 | 80 N, very high | 21.2 |

Solver expectations (Db = 19, t_min = 2; ±1mm on D): geometric floor ≈ 45mm (≈ 51mm with Db = 24). J3 1 disc ≈ 63mm (e ≈ 1.22). J3 2 discs ≈ 47mm. J1 ≈ 47mm. J4 ≈ 45mm. J2 2 discs ≈ 79mm (e ≈ 1.65). J2 single disc: no solution ≤ 120mm.

## Assumptions and limitations (show in UI)
- Rigid-body, zero-clearance force distribution scaled by Kc. Real load sharing depends on manufacturing tolerance and run-in.
- Kc = 2 and the aluminum contact-fatigue limit are engineering judgment. Contact-fatigue data for 6061 is sparse, so treat results near the life limit as marginal.
- Two-disc share of 0.55 is a standard approximation.
- Hard anodizing improves wear, not subsurface fatigue. It isn't modeled.
- Bushing-on-bolt friction, pin rotation, disc tilt, thermal effects, and dynamic impact aren't modeled. The TMC2209 current limit should cap motor torque near T_des.
- J1/J4 torques are estimates until link masses come from CAD.
- Contact length assumes the full disc thickness bears on each pin.

## Out of scope
Profile/DXF export, backlash/transmission-error prediction, and the arm's kinematics. These may come later.
