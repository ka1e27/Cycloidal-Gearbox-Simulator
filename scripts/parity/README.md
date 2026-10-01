# Parity harness: TypeScript engine vs the Python reference

Proves that `src/calc/` reproduces `reference/cycloidal_disc_check.py` (never edited) and the extra
checks in `docs/SPEC.md`.

| File | Role |
|---|---|
| `generate_fixture.py` | Seeded (20260930) case generator. Imports the reference module, sets its module globals (`Zp, Zw, L, rr, rw, Db, t_min, Kc, Kc_life, C_ECC, RPM_IN, Estar`) per case, calls `unit_case()` and `check()`, and writes `fixture.json`. |
| `spec_checks.py` | Independent implementation of the SPEC formulas the script lacks (ligament between holes, bolt/standoff limits, bearing static + life, disc mass, utilization, status thresholds, verdict). Written from SPEC.md only; takes the unit numbers from the reference `unit_case()`. |
| `solver_bruteforce.py` | Brute-forces the SPEC minimum-size solver with the reference `unit_case()` at full resolution on every (D, K1) point and writes `solver_fixture.json`. |
| `fixture.json`, `solver_fixture.json` | Committed outputs (about 480 KB and 3 KB). The TS test only reads these, so it needs no Python. |
| `../../src/calc/__tests__/parity.test.ts` | Vitest side. Runs `checkGearbox` / `solveMinimumSize` on the same inputs and compares at 1e-6 relative. Part of `npm test`. |
| `run.mjs` | Cross-platform runner behind the npm scripts. |

## Run the comparison (no Python needed)

```
npm run parity        # verbose run of parity.test.ts plus a per-quantity max-error table,
                      # the 14 explained verdict differences and the joint printouts side by side
npm test              # includes the same assertions (without the report)
```

`PARITY_DEBUG=13,219 npx vitest run src/calc/__tests__/parity.test.ts` prints the fixture entry and the
full TS check list for those case ids.

## Regenerate the fixtures

numpy is required (only numpy). Keep the venv outside the repo:

```
python -m venv <somewhere outside the repo>/venv
<venv>/Scripts/python -m pip install numpy          # bin/python on Linux/macOS
<venv>/Scripts/python scripts/parity/generate_fixture.py      # fixture.json, ~15 s
<venv>/Scripts/python scripts/parity/solver_bruteforce.py     # solver_fixture.json, ~2 min
```

or `PYTHON=<venv>/Scripts/python npm run parity:gen` (runs `generate_fixture.py`). Generation is deterministic
for a given numpy; fixture values are rounded to 9 significant digits, so the engine can be compared at
1e-6 with ample margin. Keep `fixture.json` under 500 KB (cases: 90 random, 90 random and feasible, corners,
K1 0.05 to 0.99, near-cusp pairs at rho_a = 0.3 mm +/- 0.1 %, undercuts, ligament exactly at t_min
and +/- 1e-7 mm, utilization thresholds, 50 SPEC-extras cases with other materials, bolts, standoffs and bearings).

## What is compared

* Group A (301 cases): inputs the script can express (its hard-coded M3 shank 3.0, standoff 5/2.46, gap 0.5,
  steel on 6061). Compared to the script: every unit value, every scaled number it prints, and its PASS/FAIL.
  The script's `check()` output is also parsed and asserted equal to the replicated formulas inside the generator.
* Group B (50 cases): other gap, shank, standoff, yields, bearings, required life, disc share, disc and pin
  materials (including solid pins and polymers). Compared to `spec_checks.py` only.
* Every case: all 11 checks (value, utilization, status), mass, housing OD, verdict, max utilization.
* The script's PASS covers contact + ligament-to-bore + cusp, so it is compared with the same subset of TS checks.
  The script uses rounded limits 460/240; the engine uses 1.67 Sy = 460.92 and 0.577 sigma_f / 0.25 = 240.032.
  Cases built inside that window disagree on purpose and are listed as explained differences, as are the cases
  at t_min - 1.5e-9 mm (the script tolerates 1e-9 mm, the engine 1e-9 relative).
