"""
Brute-force the SPEC.md minimum-size solver with the Python reference's unit_case() (full 6000 / 240
resolution at every grid point, no screening shortcut) and write scripts/parity/solver_fixture.json.
The TypeScript solver is compared with it in src/calc/__tests__/parity.test.ts.

SPEC.md: sweep D 30..120 mm (1 mm) x K1 0.40..0.85 (0.025), e = K1*Rp/Zp; skip geometrically
infeasible (Rw <= 0 or a ligament < t_min) and cusp cases; score = max utilization of the four
contact checks (limits 1.67*Sy = 460.92 and 0.577*sigma_f/0.25 = 240.032); report the smallest D
with score <= 1, its best e, and the geometric floor (smallest feasible D regardless of load).

Usage: python scripts/parity/solver_bruteforce.py     (takes a few minutes; runs cases in parallel)
"""
import json
import math
import os
import sys

sys.dont_write_bytecode = True   # do not leave __pycache__ next to the reference script
from concurrent.futures import ProcessPoolExecutor

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "reference"))
sys.path.insert(0, HERE)

LIM_STATIC, LIM_LIFE = 1.67 * 276, 0.577 * 104 / 0.25

# name, D-independent inputs (everything else is the SPEC default), expectation quoted in SPEC.md
CASES = [
    ("floor Db=19", dict(Db=19.0), "floor ~45"),
    ("floor Db=24", dict(Db=24.0), "floor ~51"),
    ("J3 1 disc", dict(Treq=2.25, Tdes=3.4, discs=1), "~63 mm, e ~1.22"),
    ("J3 2 discs", dict(Treq=2.25, Tdes=3.4, discs=2), "~47 mm"),
    ("J1", dict(Treq=1.3, Tdes=2.0, discs=1), "~47 mm"),
    ("J4", dict(Treq=0.3, Tdes=1.0, discs=1), "~45 mm"),
    ("J2 2 discs", dict(Treq=5.85, Tdes=8.8, discs=2), "~79 mm, e ~1.65"),
    ("J2 1 disc", dict(Treq=5.85, Tdes=8.8, discs=1), "no solution <= 120 mm"),
]
K1S = [round(0.40 + 0.025 * i, 10) for i in range(19)]
DS = list(range(30, 121))


def solve(args):
    name, over, _ = args
    import cycloidal_disc_check as ref
    import spec_checks as sc
    Zp, Zw, L, rr, rw, Db, tmin = 18, 6, 6.35, 2.5, 2.5, over.get("Db", 19.0), 2.0
    Treq, Tdes, discs = over.get("Treq", 1.0), over.get("Tdes", 1.0), over.get("discs", 1)
    ref.Zp, ref.Zw, ref.L, ref.rr, ref.rw, ref.Db, ref.t_min = Zp, Zw, L, rr, rw, Db, tmin
    share = 1.0 if discs == 1 else 0.55
    floor = None
    best = None
    undercut_only_skips = 0
    for D in DS:
        Rp = D / 2
        row_best = (math.inf, None)
        for K1 in K1S:
            e = K1 * Rp / Zp
            dh = 2 * rw + 2 * e
            Rroot = Rp - e - rr
            Rw = Rroot - dh / 2 - tmin
            if Rw <= 0:
                continue
            lig_b = Rw - dh / 2 - Db / 2
            lig_h = 2 * Rw * math.sin(math.pi / Zw) - dh
            if lig_b < tmin - 1e-9 or lig_h < tmin - 1e-9:
                continue
            ex = sc.profile_extras(Zp, Rp, e, rr)
            if ex["cusp"]:
                continue
            if ex["undercut"]:
                undercut_only_skips += 1   # the reference flag would not skip it, SPEC intent does
                continue
            if floor is None:
                floor = (D, K1)
            if best is not None:
                continue                     # answer already found; only the floor mattered
            geo, p0r, Fr, p0w, Fw, Fb = ref.unit_case(Rp, e)
            sc_ = [p0r * math.sqrt(2.0 * Tdes * share), p0r * math.sqrt(1.3 * Treq * share),
                   p0w * math.sqrt(2.0 * Tdes * share), p0w * math.sqrt(1.3 * Treq * share)]
            lims = [LIM_STATIC, LIM_LIFE, LIM_STATIC, LIM_LIFE]
            score = max(v / l for v, l in zip(sc_, lims))
            if score < row_best[0]:
                row_best = (score, (K1, e))
        if best is None and row_best[0] <= 1.0:
            best = dict(minD=D, bestK1=row_best[1][0], bestE=row_best[1][1], bestScore=row_best[0])
        if best is not None and floor is not None:
            break
    out = dict(name=name, over=dict(Treq=Treq, Tdes=Tdes, discs=discs, Db=Db), floorD=None if floor is None else floor[0],
               floorK1=None if floor is None else floor[1],
               minD=None if best is None else best["minD"],
               bestK1=None if best is None else best["bestK1"],
               bestE=None if best is None else best["bestE"],
               bestScore=None if best is None else best["bestScore"],
               noSolution=best is None, undercutOnlySkips=undercut_only_skips)
    return out


def main():
    with ProcessPoolExecutor(max_workers=min(8, os.cpu_count() or 2)) as ex:
        results = list(ex.map(solve, CASES))
    for r, c in zip(results, CASES):
        print(f"{r['name']:12s} floor {r['floorD']}  minD {r['minD']}  e {r['bestE']}  score {r['bestScore']}   (SPEC: {c[2]})")
    path = os.path.join(HERE, "solver_fixture.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(dict(cases=results, limits=[LIM_STATIC, LIM_LIFE]), f, indent=1)
        f.write("\n")
    print("wrote", path)


if __name__ == "__main__":
    main()
