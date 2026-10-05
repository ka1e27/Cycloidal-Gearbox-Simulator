# Cycloidal Gearbox Designer — CLAUDE.md

A static website (Vite + React + TypeScript, Vitest, no backend) that sizes and checks pin-type
cycloidal gearboxes for a 5-DOF robot arm (J1–J4 cycloidal, J5 direct-drive servo).

**The base spec is `docs/SPEC.md`. Read all of it. Everything in it stays mandatory**, including
the exact calculation, the pass/fail table, the validation numbers (±2%) and the solver
expectations. This file adds requirements on top. Where the two conflict, this file wins.

Note: SPEC.md mentions a reference `cycloidal_disc_check.py`. It is **not available**. Implement
from the formulas in SPEC.md. The validation tables in SPEC.md are the ground truth, and the
Vitest suite must hit them.

## Rules for engineers
- Units: mm, N, N·m, MPa internally. Arm masses are entered in **grams**, arm lengths in **mm**.
  Label every input and output with units.
- All math lives in `src/calc/` (pure TS, no React, no DOM). UI lives in `src/ui/` (or
  `src/components/`). Heavy sweeps run in a Web Worker (`new Worker(new URL(...), {type:'module'})`).
- `vite.config.ts` uses `base: './'` so the build works from any static host or subfolder.
- `npm test` (Vitest) and `npm run build` (tsc + vite) must both pass with zero errors.
- Do not `git commit` or push. The lead reviews first.
- Do not add a backend, analytics, or external network calls. Fonts may come from Google Fonts,
  or use a system font stack.

## Addition 1 — Arm load model (joint masses, bar masses, center-to-center lengths)
The user enters the arm, and the app derives the torque each gearbox must carry, instead of
guessing T_req/T_des.

Kinematic chain (arm fully extended horizontally is the worst gravity pose):
`base → J1 (yaw, vertical axis) → J2 (shoulder pitch) → bar A → J3 (elbow pitch) → bar B →
J4 (forearm roll, axis along the forearm) → bar C → J5 (wrist pitch, servo) → bar D (tool/gripper) → payload at tool tip`

Inputs (all editable, sensible defaults, grams and mm):
- Mass of each joint J1–J5 (motor + gearbox + housing, lumped at the joint center).
- Mass of each bar between joints: J1→J2 (vertical riser), J2→J3 (bar A), J3→J4 (bar B),
  J4→J5 (bar C), J5→tool tip (bar D, the gripper/tool). Bars are uniform rods, COM at midpoint.
- Center-to-center length of each of those five segments (mm).
- Payload mass at the tool tip (g).
- Per-joint max angular acceleration α (rad/s², default 3) for the dynamic term.
- Service factor SF (default 1.5), so T_des = max(SF·T_req, T_des_floor). T_des_floor default
  1.0 N·m (matches the J4 preset in SPEC.md); editable.
- Optional per-joint "manual override" of T_req/T_des.

Torque model (g = 9.81 m/s²; convert g→kg, mm→m):
- J2 and J3 (pitch): T_static = g·Σ mᵢ·xᵢ over everything outboard of the joint, xᵢ = horizontal
  distance from the joint axis with the arm straight out. A joint's own lumped mass has zero arm
  at its own joint but loads every joint inboard of it. T_dyn = α·I, with I = Σ (point masses
  m·x², rods m·(L²/12 + x_c²)). T_req = T_static + T_dyn.
- J4 (roll): worst case is J5 bent 90° so bar D is horizontal and perpendicular to the roll
  axis: T_static = g·(m_barD·L_D/2 + m_payload·L_D). Dynamic term uses the inertia of bar D +
  payload about the roll axis. J5's lumped mass sits on the roll axis (no arm).
- J1 (yaw): no gravity torque. T_req = α·I_z with the arm fully extended horizontally
  (distances measured from the J1 axis; the riser J1→J2 is vertical and on-axis).
- J5 (servo): report T_static + T_dyn about J5 for servo sizing only (no gearbox check).
- Also report, per gearbox joint, the **output-bearing loads** as info. The gravity torque
  about the axis goes through the gearbox, so it is NOT a bearing moment.
  - J1 (vertical axis): axial thrust = outboard weight; tilting moment = g·Σm·(horizontal reach).
  - J2/J3 (horizontal axis): radial = outboard weight; tilting moment = radial × link offset
    from the output bearing along the axis (per-joint input, default 15 mm).
  - J4 (roll): radial = outboard weight; tilting moment = g·Σm·(axial distance from the J4
    bearing along the roll axis), worst of tool straight-out vs bent 90°.
- Pick default masses/lengths that give roughly the SPEC.md preset torques (J2 ≈ 5.85 N·m,
  J3 ≈ 2.25 N·m T_req), and state the defaults are placeholders until CAD masses exist.
- The gearbox tab gets a "Loads from arm model" toggle (default on) that feeds T_req/T_des of
  the selected joint. Turning it off lets the user type torques directly (SPEC.md behavior).
- Unit tests: hand-computed cases for each joint torque.

## Addition 2 — Materials: steel, aluminum, PETG, PLA
Material library in `src/calc/materials.ts`, one entry per material with E (MPa), ν, Sy (MPa),
σf at 10⁷ (MPa), density (g/cm³), a short note, and a `kind: 'metal' | 'polymer'`:
- Steel — mild (1018): E 200000, ν 0.29, Sy 370, σf ~190, ρ 7.87
- Steel — alloy (4140 Q&T): E 205000, ν 0.29, Sy 655, σf ~380, ρ 7.85
- Aluminum 6061-T6: E 69000, ν 0.33, Sy 276, σf 104 (SPEC default), ρ 2.70
- Aluminum 7075-T6: E 71700, ν 0.33, Sy 503, σf ~160, ρ 2.81
- PETG (3D printed, 100% infill): E ~2000, ν 0.38, Sy ~40, σf ~12, ρ 1.27
- PLA (3D printed, 100% infill): E ~3300, ν 0.36, Sy ~50, σf ~15, ρ 1.24
Values are approximate. Show a "check your supplier data" note and keep all fields editable.

Selections (each a dropdown that fills editable fields):
- **Disc material** (any of the above).
- **Outer pin**: construction = "Steel bolt + bushing" (SPEC default: shank dia, bolt yield
  640 MPa) or "Solid pin" of a chosen material (bending uses d = 2·rr and that material's
  strength). Contact E/ν = bushing/pin material.
- **Inner pin**: construction = "Steel standoff" (SPEC default OD/bore, yield 300) or "Solid pin"
  of a chosen material (d = 2·rw, solid section).
- E* is computed from the actual disc/pin pair (SPEC formula), so steel-on-PLA works.
- Bending limits: keep SPEC factors for steel bolt/standoff. For a solid pin use
  min(0.4·Sy, σf) (outer) and min(0.5·Sy, σf) (inner).
- For polymer discs or pins, show a visible warning card: creep under sustained load,
  heat/friction softening (PLA Tg ≈ 60 °C), print-orientation anisotropy, and that the Hertz
  limits are a rough screen for polymers. It is a warning, not a failed check.
- Show estimated disc mass (profile area minus bore and holes × L × density × discs).

## Addition 3 — Design Advisor ("ideal outputs")
A panel that, for the selected joint's loads and materials, recommends a complete gearbox:
outer pin circle D, recommended **housing outer diameter** (D + 2·rr + 2·wall, wall input
default 4 mm), eccentricity e (and K1), outer pin diameter, inner pin diameter, Zw, inner pin
circle radius Rw, disc thickness L, number of discs, eccentric bearing, ratio, plus the
utilization of every check and the governing mode.

Search space (keep the ratio fixed to the current Zp by default, with an option "let ratio vary"
over Zp ∈ {12,14,16,18,20,22,24,26}):
- D 30–150 mm, 1 mm steps. K1 0.40–0.85, 0.025 steps.
- Outer pin options (pin OD → bolt shank for the bolt+bushing construction): 3→M2 (2.0),
  4→M2.5 (2.5), 5→M3 (3.0), 6→M4 (4.0), 8→M5 (5.0), 10→M6 (6.0). For solid pins, just the OD.
- Inner pin options (round standoffs OD/bore): 4.5/2.05 (M2.5), 5/2.46 (M3), 7/3.24 (M4),
  8/4.13 (M5), 10/4.9 (M6). For solid pins, just the OD.
- Zw 4–10. Discs 1 and 2.
- Disc thickness L: metal stock {3.175, 4.76, 6.35, 9.525, 12.7}; polymer {4, 5, 6, 8, 10, 12}.
- Eccentric bearing table (approximate C / C0, flagged "verify on datasheet"):
  61800 10×19×5 C 1380 C0 585; 61801 12×21×5 C 1430 C0 670; 61802 15×24×5 C 1560 C0 800;
  61803 17×26×5 C 1680 C0 930; 61804 20×32×7 C 2700 C0 1500; 6000 10×26×8 C 4550 C0 1960;
  6001 12×28×8 C 5100 C0 2360; 6002 15×32×9 C 5600 C0 2850. Db = bearing OD.
- Constraint: every check (SPEC.md pass/fail table + ligament between holes + cusp + bearing
  static + bearing life) has utilization ≤ target (default 0.85, i.e. green; user-adjustable
  0.7–1.0).
- Objective: smallest housing OD first; tie-break by lower disc mass, then fewer discs, then
  lower max utilization.
- Output: the recommended design card, an "Apply to inputs" button, and a short table of
  alternatives (best 1-disc, best 2-disc, lightest, most margin).
- Performance: run in the worker with a progress bar and cancel. Exploit scaling:
  p0 ∝ √(E*/L), forces are independent of L and E*, so compute ring-contact unit values once
  per (Zp, D, e, rr) at E* = 1, L = 1 and rescale. Search D ascending and stop once the best
  housing OD is found. A coarse resolution (e.g. npf 1500, nth 90) is fine for the search; the
  final pick and alternatives must be re-verified at full SPEC resolution. Target < 5 s.
- The SPEC.md minimum-size solver (D × K1 only, current other params) stays too, unchanged,
  and must meet the SPEC.md solver expectations.

## Addition 4 — All-joints summary
One table with J1–J4 as rows: loads from the arm model, current geometry, verdict, governing
mode, max utilization, disc mass, and a "Design" button that opens the advisor for that joint.
J5 row shows the servo torque requirement only.

## Addition 5 — DXF export (overrides SPEC.md "out of scope")
Export manufacturing DXFs for the current gearbox: cycloidal disc (profile + center bore + inner
pin holes), ring-pin housing plate, output/tie plate, eccentric cam, and pin/bushing/standoff
sections. Per-part files plus one "all parts" sheet (one layer per part). Pure writer in
`src/export/` (no dependency), ASCII DXF R12 by default for CAM compatibility, units mm or inch,
closed outlines, and user-set manufacturing allowances (hole clearances, profile offset). The
disc profile is the SPEC "actual profile" from the engine.

## Addition 6 — Design Advisor locks
Every design variable in the advisor (ratio/Zp, D, e, outer pin size, inner pin size, Zw, L, discs,
bearing) can be locked to a user value or left free. The advisor optimizes only the free ones
under the same constraints and objective. If the locks make the target unreachable, it shows
the closest design (lowest max utilization), what governs it, and which locks to relax.

## Addition 7 — Configurable arm (DOF, joint motion types)
The arm is an ordered list of 1–8 joints instead of a fixed J1–J5. Each joint has a name, a
**motion type** (base yaw = rotation about a vertical axis; pitch = axis perpendicular to the
link; roll = axis along the link), a **drive** (cycloidal gearbox, which gets a gearbox check,
or direct-drive servo, which gets only a torque requirement), a mass, α, and the link to the next
joint (length, mass). A payload sits at the tip. Worst-case rules, generalizing Addition 1:
- Pitch (and a yaw whose axis can be tilted horizontal by an upstream pitch): T_static =
  g·Σ m·r with everything outboard straight out horizontally; I = Σ m r² (+ rods L²/12).
- Base yaw whose axis stays vertical (no pitch joint upstream): gravity torque 0, I_z with the arm
  straight out from the axis.
- Roll: masses between the roll joint and the next downstream non-roll joint k are on the axis.
  Masses beyond k have lever = distance from k (bent 90° at k). With no such k, gravity torque is 0.
- Bearing loads per type follow the Addition 1 rules (yaw: axial + overturning; pitch: radial +
  offset tilt; roll: radial + axial-distance tilt).
- The default 5-joint arm [yaw, pitch, pitch, roll, pitch-servo] must reproduce today's numbers
  exactly.
Diagram: the default view is a "ready pose": the shoulder sits on the yaw base, the link after the
first pitch joint points up (elbow above shoulder), and later links point out horizontally. A
toggle shows the worst-case straight-out pose used for the torques.

## Addition 8 — Motor torque and recommended gear ratio
Each joint can carry motor data:
- inputs: max (peak) torque; optional continuous torque, max speed and required joint speed;
  gearbox efficiency η (default 0.85)
- ratio_min = max(T_des / (η·T_peak), T_req / (η·T_cont))
- ratio_max = motor speed / required joint speed (when given)
- cycloidal ratios are Zp − 1 (integer); the recommended Zp is the smallest valid one ≥ ratio_min + 1
  that respects ratio_max and the advisor's Zp range
- if T_peak·ratio·η exceeds the gearbox design torque, warn that the motor can overload the gearbox
  (set a current limit), but don't fail the gearbox check
- servo joints: check the servo's own torque against T_req/T_des
The advisor can restrict the ratio to the motor-feasible range ("ratio from motor").

## Addition 9 — Interactive Pose Explorer
A card at the end of Arm & Loads with a movable 3D arm (orthographic SVG, orbitable camera,
side view by default). Each joint has an angle, set by a slider or by dragging in the view.
Live static gravity load at the current pose:
- torque about each joint axis: τ_i = â_i · Σ_outboard (r_j − p_i) × (m_j·g), with rods as
  their centre of mass
- bending moment along each link
Colors:
- joints by |τ_i| / T_des,i (≤0.85 green, ≤1.0 amber, >1.0 red, matching the check colors)
- links by bending moment on a sequential ramp
- weight arrows at the masses
Required invariants:
- at every pose, |τ_i| ≤ the worst-case T_static,i from the arm model (+1e-9)
- the worst-case pose of Addition 7 reproduces T_static for pitch joints
- a base yaw with a vertical axis always reads 0
Display only: the gearbox checks keep using the worst case.

## Addition 10 — Workbench layout (replaces the 01–04 step pages)
The user disliked scrolling down to find things. The app becomes a one-screen workbench, like a
CAD tool:
- **Header:** title, mm|in, Units, Assumptions, theme, session menu.
- **Left rail, "Joints":** an Arm item, then one row per joint (J#, name, motion symbol, drive
  tag, status dot from the gearbox verdict / servo check / motor chip). Rows can be selected,
  renamed, reordered and removed. "+ Add joint", Summary, and a Custom gearbox item.
- **Centre stage:** a big view with stage tabs 3D arm | Schematic | Disc | Summary. 3D is the
  Pose Explorer; clicking a joint in it selects that joint. The pose presets and the
  pose-loads readout are a collapsible overlay or drawer.
- **Right inspector** for the selection: a header with the name, motion, drive and a sticky
  verdict badge. Below it, collapsible sections, each showing a one-line summary while closed:
  Joint & link | Motor & ratio | Loads | Gearbox design | Checks | Disc & charts | Min-size
  solver | Design Advisor | Export DXF. Servo joints show only the first three. The Arm item
  shows arm settings, totals and the all-joint torque table. A chip bar at the top of the
  inspector jumps to and opens any section.
- **Scrolling:** on desktop (≥ 1100 px) nothing scrolls at page level; each column scrolls
  internally. On narrow screens the layout becomes a joint selector plus bottom tabs (View |
  Details | Summary).
- Nothing is removed; every existing feature has an obvious home.

## Addition 11 — Inner standoff support model (overrides the SPEC "tie ring ≈ cantilever/2")
The user's standoffs are recessed and bolted into the output face and bolted to a common
free-floating tie ring on the far side. The inner pin bending check uses a statically
indeterminate model (`innerPinSupport`):
- each pin is fixed at the output face
- the tips are tied by a rigid floating ring (ΣF = 0, Σr×F = 0)
- the tips have zero slope when the ring is bolted ('ringClamped', the default), or free slope ('ringPinned')
- both discs load the pins at their mid-planes, in opposite directions
The derivation and an exact-constraint FEM check are in `scripts/parity/standoff/`. The SPEC
heuristic (σ_cant/2) and the cantilever stress stay in the results for reference/parity only.

## Addition 12 — Integral (pinless) ring, machined into the housing
A third outer-pin construction, 'integral': no pins, bolts or bushings. The ring teeth are
half-round bumps of radius rr centred on the pin circle (radius Rp), machined into the housing
from a chosen **housing material**. The disc slides on the teeth (no rolling bushing).
- **Housing inner wall (root circle):** radius R_h = Rp + 2e − rr + c_root (clearance, default 0.3 mm)
  clears the disc's farthest reach in the ring frame. Tooth height = R_h − (Rp − rr).
- **Ring contact checks:** the same Hertz model, with E* from the disc/housing pair; the limits use
  the weaker of disc and housing.
- **The outer bolt bending check is replaced by a tooth-root check:** the per-disc peak ring force
  acts over one disc thickness L (each disc loads its own stretch of the tooth). Bending and shear are
  checked at the tooth base (chord where the tooth circle meets the root circle) against the
  housing material (fatigue: min(0.4·Sy, σf)).
- **Machining:** an end-mill radius r_tool (default 1.5 mm) leaves a fillet where each tooth meets
  the root circle. The fillet must not intrude into the disc's swept envelope in the ring
  frame. Check the clearance by sweeping the disc profile; fail it if intruding.
- **Housing OD** = 2·R_h + 2·wall.
- **Efficiency:** sliding contact, so suggest η ≈ 0.75–0.8 (a note; the motor η stays the
  user's).
- **DXF:** the housing becomes a ring plate with the internal tooth profile (with tool fillets)
  as a closed polyline, the outline, and optional mounting holes.

## UI / UX — "very nice and very user friendly"
- Clean engineering-tool look: light and dark themes (follow the OS, plus a toggle), one accent
  color, generous spacing, clear typographic hierarchy, cards, no clutter. Responsive down to
  ~380 px wide with no horizontal scroll.
- Top-level navigation (tabs or a stepper): **1 Arm & Loads → 2 Gearbox → 3 Design Advisor →
  4 All Joints**, plus the always-available collapsed **Assumptions** panel.
- Arm & Loads: a live SVG side-view schematic of the arm (joints as circles, bars as links,
  lengths dimensioned, masses labeled, payload at the tip) that updates as the user types, next
  to the grouped inputs. Show the resulting torque per joint right there.
- Gearbox: joint chips (J1–J4) + Custom; grouped inputs (Geometry, Materials, Loads); verdict
  banner with governing mode; check cards with value, limit and a colored utilization bar
  (≤0.85 green, ≤1.0 amber, >1.0 red); key-number tiles; the disc SVG with the θ slider and a
  play/animate button; the two charts from SPEC.md.
- Every input: unit suffix, a hover/tap "?" tooltip saying what it is and what a typical value
  is, and inline validation (e.g. Zp ≥ 8) that never crashes the app. Non-finite results show
  "—" with a reason, not NaN.
- Save/restore the whole session in localStorage (wrapped in try/catch), plus "Export JSON" /
  "Import JSON" and "Reset to defaults".
- Accessible: labels bound to inputs, keyboard usable, contrast ≥ 4.5:1, status is never
  color-only (icon or text too).
