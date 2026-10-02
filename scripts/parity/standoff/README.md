# Inner standoffs tied by a floating ring: derivation and validation

The user's hardware: every inner (output) standoff is **recessed and bolted into the output face**, and on the far side
every standoff is **bolted to one common free-floating tie ring**. The SPEC estimate "tie ring = cantilever ÷ 2" is
replaced by this beam model. The engine implements it in `src/calc/kernel.ts` (`standoffRingSweep`,
`standoffRingUnit`, `ringStandoffMoment`). The inner pin bending check uses it through the gearbox input
`innerPinSupport` (`'ringClamped'` by default, `'ringPinned'` or `'cantilever'`).

## Model

* Each of the Zw pins is an Euler-Bernoulli beam (same EI for all), **fixed at x = 0** (the output face).
  H = discs·L + (discs+1)·gap is where the tie ring sits.
* Disc k (k = 0 first, 1 second) loads every pin at a_k = gap + k(L+gap) + L/2.
* Pin forces at input angle θ (reference sweep θ_i = 2πi/240): the reference sine law of `unit_case()`,
  F_j = 1000·|tq_j| / Σ tq² over the loaded pins (tq_j < 0), acting along u = (cos θ, sin θ), at
  r_j = Rw (cos χ_j, sin χ_j), χ_j = 2πj/Zw − θ/Zc. A second disc is 180° out of phase: −P_j on the same pins.
* The tie ring is rigid and floating: in the plane it can translate (2 DOF) and rotate about the axis (1 DOF), so
  the tip forces it applies carry **no net force and no net moment about the axis**. The tips either cannot tilt
  (`ringClamped`, ring bolted to every pin) or can (`ringPinned`).

## Closed form (superposition per load)

For one load P at a on a beam fixed at 0, the tip force that would hold the tip still is c·P with

* clamped tip (slope 0): c = a²(3H − 2a)/H³
* pinned tip (slope free): c = a²(3H − a)/(2H³)

The ring removes the rigid-body part of those tip forces (it moves with them instead of resisting them), leaving

    Ft_j = − Σ_k c_k (P_kj − P̄_k − m_k ẑ×r_j),   P̄_k = mean_j P_kj,   m_k = Σ_j (r_j × P_kj)_z / (Zw·Rw²)

(ẑ×r = (−r_y, r_x)). The tip couple is C_j = −Σ_k P_kj a_k²/(2H) − Ft_j·H/2 for the clamped tip and 0 for the pinned
tip. The bending moment along pin j is

    M_j(x) = Ft_j (H − x) + C_j + Σ_{a_k > x} P_kj (a_k − x)

which is piecewise linear in x, so its largest magnitude is at x ∈ {0, a_k, H}. `M_ring_unit` is the maximum of |M_j|
over θ, j and those sections, in N·mm per N·m on one disc share (s = 1, Kc = 1). The check stress is
M_ring_unit · Kc · T_des · s / Z (Z of the standoff or solid pin, as before). Because every force goes as 1/Rw at
fixed lever arms, M_ring_unit = M̂(Zw, Zp, nth, discs, L, gap)/Rw exactly, which the engine caches and the advisor's
coarse search uses.

Sanity limits: equal parallel loads on every pin leave Ft = 0, so the bolted ring gives the textbook fixed-guided
value max(P·a − P·a²/(2H), P·a²/(2H)) and the pinned ring gives the cantilever P·a.

## Validation

| Script | What it does | Result |
|---|---|---|
| `standoff_ring.py` | Lead's first check: closed form vs a penalty-constraint stiffness model; prints cantilever, SPEC ÷2 and ring values for the joints. | agreement within the penalty error |
| `standoff_fem2.py` | Lead's exact-constraint FEM (Lagrange multipliers, nodes at the loads), clamped tip, 5 geometries × 24 angles. | max relative difference 4.2e-10 |
| `standoff_ref.py` | Reference values for the engine tests (240-step sweep, both tips), with FEM spot checks of the clamped tip. | table below |
| `standoff_fem_both.py` | Same FEM with the tip-slope constraint optional, against the vectorized closed form in `../spec_checks.py`, both tips, 6 geometries (Zw 3 to 10, 1 and 2 discs, gap 0 to 1) × 12 angles. | clamped 4.2e-10, pinned 9.8e-10 |

Reference values (Zw 6, L 6.35, gap 0.5, ratio 17; N·mm per N·m, one disc share):

| Case | Rw | clamped | pinned | SPEC cantilever unit (F_in_unit·arm) |
|---|---|---|---|---|
| J2 85 / e1.3, 1 disc | 32.9 | 40.336879 | 55.075355 | 74.468085 |
| J2 85 / e1.6, 2 discs | 32.3 | 51.031442 | 93.531433 | 217.234262 |
| J3 70 / e1.07, 1 disc | 25.86 | 51.317994 | 70.068800 | 94.740913 |
| J1 60 / e0.92, 1 disc | 21.16 | 62.716604 | 85.632286 | 115.784499 |

For the SPEC J2 case (Kc 2, T_des 8.8 N·m, M3 standoff Z = 11.55 mm³) this gives 61 MPa bolted, 84 MPa pinned and
113 MPa cantilever, against the old heuristic 57 MPa. One disc: the bolted ring is 0.54 × the cantilever (the heuristic
assumed 0.5). Two discs: the opposite loads of the two discs largely cancel through the ring, 0.23 × the cantilever.

## Where it is tested

* `src/calc/__tests__/standoff-ring.test.ts`: the table above to 1e-6, clamped ≤ pinned ≤ cantilever unit at every θ
  for 300 random geometries, fast sweep = general closed form at every θ, exact 1/Rw scaling, the fixed-guided
  textbook cases, the check wiring, normalization of old sessions.
* `../spec_checks.py` (`standoff_ring_unit`) is an independent numpy implementation; `../generate_fixture.py` writes
  its unit moments (`u.Mc`, `u.Mp`) and the resulting check into `fixture.json` for every case, and cross-checks it
  against the lead's closed form from `standoff_ring.py` on every 12th case. `parity.test.ts` compares the engine with
  both at 1e-6.

Run (numpy only): `<venv>/Scripts/python scripts/parity/standoff/standoff_ref.py` (~5 s),
`standoff_fem2.py` and `standoff_fem_both.py` (~40 s each).

## Not modeled

Ring and output-plate compliance (both taken as rigid), bolt-joint slip or preload, the threaded bore at the recess,
contact between the pins and the disc holes along their length (each disc is a point load at its mid-thickness),
and load sharing other than the rigid-body sine law (Kc scales it).
