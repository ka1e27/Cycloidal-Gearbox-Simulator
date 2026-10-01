"""
Generate scripts/parity/fixture.json: deterministic (seeded) test cases plus the numbers the Python
reference (reference/cycloidal_disc_check.py, imported unmodified) and an independent SPEC.md
implementation (spec_checks.py) produce for them. The TypeScript side is
src/calc/__tests__/parity.test.ts, which reads the fixture and runs checkGearbox on the same inputs.

Usage (numpy required, see README.md):
    python scripts/parity/generate_fixture.py            # writes scripts/parity/fixture.json
"""
import contextlib
import io
import json
import math
import os
import random
import sys

sys.dont_write_bytecode = True   # do not leave __pycache__ next to the reference script

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
sys.path.insert(0, os.path.join(ROOT, "reference"))
sys.path.insert(0, HERE)
import cycloidal_disc_check as ref  # noqa: E402  (the reference script, never edited)
import spec_checks as sc  # noqa: E402

SEED = 20260930

# ----------------------------------------------------------------------------- materials / catalog
STEEL = dict(E=200000, nu=0.30, Sy=300, sigmaF=190, density=7.85, kind="metal")  # SPEC generic steel
MATS = {
    "al6061": dict(E=69000, nu=0.33, Sy=276, sigmaF=104, density=2.70, kind="metal"),
    "al7075": dict(E=71700, nu=0.33, Sy=503, sigmaF=160, density=2.81, kind="metal"),
    "st1018": dict(E=200000, nu=0.29, Sy=370, sigmaF=190, density=7.87, kind="metal"),
    "st4140": dict(E=205000, nu=0.29, Sy=655, sigmaF=380, density=7.85, kind="metal"),
    "petg": dict(E=2000, nu=0.38, Sy=40, sigmaF=12, density=1.27, kind="polymer"),
    "pla": dict(E=3300, nu=0.36, Sy=50, sigmaF=15, density=1.24, kind="polymer"),
}
BEARINGS = [(1380, 585), (1430, 670), (1560, 800), (1680, 930), (2700, 1500), (4550, 1960), (5100, 2360), (5600, 2850)]
OUTER_SHANKS = [2.0, 2.5, 3.0, 4.0, 5.0, 6.0]
INNER_STANDOFFS = [(4.5, 2.05), (5.0, 2.46), (7.0, 3.24), (8.0, 4.13), (10.0, 4.9)]


def defaults():
    """The input set the reference script hard-codes (and SPEC.md lists as defaults)."""
    return dict(
        Zp=18, Zw=6, D=85.0, e=1.3, L=6.35, rr=2.5, rw=2.5, Db=19.0, tMin=2.0, discs=1, gap=0.5, wall=4.0,
        Treq=5.85, Tdes=8.8, Kc=2.0, KcLife=1.3, discShare=None, bearing=dict(C=1380.0, C0=585.0), rpm=300.0,
        reqLifeH=2000.0, discMat=dict(MATS["al6061"]),
        outerPin=dict(kind="boltBushing", shank=3.0, **{"yield": 640.0}, mat=dict(STEEL)),
        innerPin=dict(kind="standoff", od=5.0, bore=2.46, **{"yield": 300.0}, mat=dict(STEEL)),
    )


def diff(inp):
    """Keys of inp that differ from defaults(), for a compact fixture."""
    d0 = defaults()
    return {k: v for k, v in inp.items() if v != d0[k]}


# ----------------------------------------------------------------------------- reference plumbing
def set_ref_globals(inp):
    ref.Zp, ref.Zw, ref.L, ref.rr, ref.rw = inp["Zp"], inp["Zw"], inp["L"], inp["rr"], inp["rw"]
    ref.Db, ref.t_min = inp["Db"], inp["tMin"]
    ref.Kc, ref.Kc_life = inp["Kc"], inp["KcLife"]
    ref.C_ECC, ref.RPM_IN = inp["bearing"]["C"], inp["rpm"]
    ref.Estar = ref_estar_default()


def ref_estar_default():
    return 1 / ((1 - ref.nu_st ** 2) / ref.E_st + (1 - ref.nu_al ** 2) / ref.E_al)


def rnd(x, n=8):
    if x is None:
        return None
    if isinstance(x, (bool, str)):
        return x
    x = float(x)
    if math.isinf(x):
        return None
    return float(f"{x:.{n}g}")


def ref_scaled(inp, geo, p0r, Fr, p0w, Fw, Fb):
    """The scaled numbers check() prints, same expressions as check() (verified against its printout)."""
    discs, Tdes, Treq = inp["discs"], inp["Tdes"], inp["Treq"]
    Kc, Kl, L = inp["Kc"], inp["KcLife"], inp["L"]
    s = 1.0 if discs == 1 else 0.55
    ring_s = p0r * np.sqrt(Kc * Tdes * s)
    ring_l = p0r * np.sqrt(Kl * Treq * s)
    in_s = p0w * np.sqrt(Kc * Tdes * s)
    in_l = p0w * np.sqrt(Kl * Treq * s)
    Fr_pk = Fr * Kc * Tdes * s
    Fw_pk = Fw * Kc * Tdes * s
    span = discs * L + (discs + 1) * 0.5
    bolt = (Fr_pk * span / 8 / (np.pi * 3.0 ** 3 / 32), Fr_pk * span / 4 / (np.pi * 3.0 ** 3 / 32))
    arm = 0.5 + (discs - 1) * (L + 0.5) + L / 2
    so = Fw_pk * arm / (np.pi * (5 ** 4 - 2.46 ** 4) / (32 * 5))
    L10h = (inp["bearing"]["C"] / (Fb * Treq * s)) ** 3 * 1e6 / (60 * inp["rpm"])
    ok = bool(ring_s <= ref.P_STATIC and ring_l <= ref.P_LIFE and in_s <= ref.P_STATIC and in_l <= ref.P_LIFE
              and geo["lig_bore"] >= inp["tMin"] - 1e-9 and not geo["cusp_risk"])
    return dict(ring_s=ring_s, ring_l=ring_l, in_s=in_s, in_l=in_l, Fr_pk=Fr_pk, Fw_pk=Fw_pk,
                bolt_lo=bolt[0], bolt_hi=bolt[1], so_tie=so / 2, so_cant=so, Fb_pk=Fb * Tdes * s, L10h=L10h,
                ok460=ok)


def run_reference_print(name, inp):
    buf = io.StringIO()
    with contextlib.redirect_stdout(buf):
        ref.check(name, inp["D"], inp["e"], inp["Treq"], inp["Tdes"], inp["discs"])
    return buf.getvalue()


def verify_against_printout(text, inp, geo, sc_):
    """Assert the replicated scaled numbers equal what the unmodified check() printed (to its precision)."""
    expect_lines = {
        "ring": f"strength {sc_['ring_s']:.0f} MPa (limit {ref.P_STATIC:.0f}), life {sc_['ring_l']:.0f} MPa "
                f"(limit {ref.P_LIFE:.0f}), peak pin force {sc_['Fr_pk']:.0f} N",
        "inner": f"strength {sc_['in_s']:.0f}, life {sc_['in_l']:.0f} MPa, peak pin force {sc_['Fw_pk']:.0f} N",
        "bolt": f"bending {sc_['bolt_lo']:.0f}-{sc_['bolt_hi']:.0f} MPa",
        "so": f"bending {sc_['so_tie']:.0f} (with tie ring) to {sc_['so_cant']:.0f} MPa",
        "bear": f"peak load {sc_['Fb_pk']:.0f} N, L10 ~{sc_['L10h']:,.0f} h",
        "verdict": "-> PASS" if sc_["ok460"] else "-> FAIL",
    }
    for key, line in expect_lines.items():
        if line not in text:
            raise AssertionError(f"printout mismatch ({key}): expected '{line}' in\n{text}")


# ----------------------------------------------------------------------------- case construction
CASES = []


def add_case(tag, inp, group, extra_ref_check=True):
    """Compute reference + independent numbers for one fully resolved input dict."""
    set_ref_globals(inp)
    if inp["outerPin"]["mat"] != STEEL or inp["innerPin"]["mat"] != STEEL or inp["discMat"] != MATS["al6061"]:
        assert group == "B"
    Rp = inp["D"] / 2
    geo, p0r, Fr, p0w, Fw, Fb = ref.unit_case(Rp, inp["e"])
    ex = sc.profile_extras(inp["Zp"], Rp, inp["e"], inp["rr"])
    assert ex["cusp"] == geo["cusp_risk"], (tag, ex["cusp"], geo["cusp_risk"])
    u = dict(p0r=p0r, Fr=Fr, p0w=p0w, Fw=Fw, Fb=Fb, Rw=geo["Rw"], dh=geo["dh"], Rroot=geo["R_root"],
             lig_bore=geo["lig_bore"], lig_holes=geo["lig_holes"], Estar_ref=ref.Estar)
    spec = sc.spec_checks(inp, u, ex)
    case = dict(
        id=len(CASES), tag=tag, g=group, x=diff(inp),
        u={k: rnd(v) for k, v in dict(p0r=p0r, Fr=Fr, p0w=p0w, Fw=Fw, Fb=Fb, Rw=geo["Rw"], dh=geo["dh"],
                                      ligB=geo["lig_bore"], ligH=geo["lig_holes"], Rroot=geo["R_root"]).items()},
        ex=dict(rho=rnd(ex["rho_min"]), cusp=ex["cusp"], under=ex["undercut"], area=rnd(ex["area"])),
        spec=dict(
            checks={c[0]: [rnd(c[1]), rnd(c[3]), c[4][0]] for c in spec["checks"]},  # value, utilization, status
            verdict=spec["verdict"], maxU=rnd(spec["max_util"]), maxUnc=rnd(spec["max_util_noncusp"]),
            cuspFlag=spec["cusp_flag"], mass=rnd(spec["mass_total"]),
            housingOD=rnd(spec["housingOD"]), boltFix=rnd(spec["bolt_fix"]), soCant=rnd(spec["so_cant"]),
            share=spec["share"],
        ),
    )
    if group == "A":
        s = ref_scaled(inp, geo, p0r, Fr, p0w, Fw, Fb)
        verify_against_printout(run_reference_print(tag, inp), inp, geo, s)
        # limits the script uses: 460/240 (rounded) and the exact SPEC values for comparison
        p46, p24 = ref.P_STATIC, ref.P_LIFE
        case["ref"] = {k: rnd(v) for k, v in s.items() if k != "ok460"}
        case["ref"]["ok460"] = s["ok460"]
        cont = [s["ring_s"], s["ring_l"], s["in_s"], s["in_l"]]
        lims_exact = [1.67 * 276, 0.577 * 104 / 0.25] * 2
        okx = (all(v <= l for v, l in zip(cont, lims_exact)) and geo["lig_bore"] >= inp["tMin"] - 1e-9
               and not geo["cusp_risk"])
        case["ref"]["okExact"] = bool(okx)
        case["ref"]["cusp"] = bool(geo["cusp_risk"])
        case["ref"]["limHit"] = bool(any(p46 < v <= l for v, l in zip(cont[::2], lims_exact[::2]))
                                     or any(p24 < v <= l for v, l in zip(cont[1::2], lims_exact[1::2])))
    CASES.append(case)
    return case


def geom_ok(inp, min_rw=1.0, min_clear=0.2):
    Rp = inp["D"] / 2
    e = inp["e"]
    if e * inp["Zp"] / Rp >= 0.995:
        return False
    dh = 2 * inp["rw"] + 2 * e
    Rroot = Rp - e - inp["rr"]
    Rw = Rroot - dh / 2 - inp["tMin"]
    if Rw < min_rw:
        return False
    return 2 * Rp * math.sin(math.pi / inp["Zp"]) - 2 * inp["rr"] >= min_clear


def lig_feasible(inp):
    Rp = inp["D"] / 2
    dh = 2 * inp["rw"] + 2 * inp["e"]
    Rw = Rp - inp["e"] - inp["rr"] - dh / 2 - inp["tMin"]
    lb = Rw - dh / 2 - inp["Db"] / 2
    lh = 2 * Rw * math.sin(math.pi / inp["Zw"]) - dh
    return lb >= inp["tMin"] and lh >= inp["tMin"]


def torques(rng, inp):
    inp["Treq"] = round(10 ** rng.uniform(-1, 1.3), 3)
    inp["Tdes"] = round(inp["Treq"] * rng.uniform(1.0, 2.0), 3)


def random_inputs(rng, k1lo=0.35, k1hi=0.9, factors=False):
    while True:
        inp = defaults()
        inp["Zp"] = rng.randint(10, 30)
        inp["Zw"] = rng.randint(3, 12)
        inp["D"] = round(rng.uniform(30, 150), 3)
        K1 = rng.uniform(k1lo, k1hi)
        inp["e"] = round(K1 * (inp["D"] / 2) / inp["Zp"], 4)
        inp["rr"] = round(rng.uniform(1, 5), 3)
        inp["rw"] = round(rng.uniform(1, 5), 3)
        inp["L"] = round(rng.uniform(2, 15), 3)
        inp["Db"] = round(rng.uniform(10, 30), 3)
        inp["tMin"] = round(rng.uniform(1, 3), 3)
        inp["discs"] = rng.choice([1, 2])
        torques(rng, inp)
        if factors:
            inp["Kc"] = round(rng.uniform(1, 3), 3)
            inp["KcLife"] = round(rng.uniform(1, 2), 3)
            inp["bearing"] = dict(C=round(rng.uniform(500, 6000), 1), C0=585.0)
            inp["rpm"] = round(rng.uniform(50, 3000), 1)
        if geom_ok(inp):
            return inp


def rho_min_at(Zp, Rp, K1, rr):
    return sc.profile_extras(Zp, Rp, K1 * Rp / Zp, rr)


def find_k1_for_rho(Zp, Rp, rr, target):
    """K1 with minimum convex rho_a == target (scan up from 0.5, bisect the first crossing)."""
    prev = 0.5
    k = 0.5
    while k < 0.999:
        k += 0.005
        ex = rho_min_at(Zp, Rp, k, rr)
        if ex["rho_min"] < target or ex["undercut"]:
            lo, hi = prev, k
            for _ in range(60):
                mid = 0.5 * (lo + hi)
                m = rho_min_at(Zp, Rp, mid, rr)
                if m["rho_min"] < target or m["undercut"]:
                    hi = mid
                else:
                    lo = mid
            return lo
        prev = k
    return None


def build_cases():
    rng = random.Random(SEED)

    # 1. the four joints of the reference script and the SPEC J2 single-disc case
    for name, (D, e, Treq, Tdes, discs) in {**ref.JOINTS}.items():
        inp = defaults()
        inp.update(D=float(D), e=float(e), Treq=Treq, Tdes=Tdes, discs=discs)
        add_case(f"joint {name}", inp, "A")
    inp = defaults()
    add_case("SPEC J2 e1.3 1 disc", inp, "A")

    # 2. random free sampling over the requested ranges (some fail ligaments / cusp, that is fine)
    for _ in range(90):
        add_case("random", random_inputs(rng, factors=rng.random() < 0.3), "A")

    # 3. random but fully feasible (ligaments ok, no cusp) so verdicts are decided by loads
    n = 0
    while n < 90:
        inp = random_inputs(rng, factors=rng.random() < 0.3)
        if lig_feasible(inp) and not sc.profile_extras(inp["Zp"], inp["D"] / 2, inp["e"], inp["rr"])["cusp"]:
            add_case("random-feasible", inp, "A")
            n += 1

    # 4. corners of the requested ranges
    corners = [
        dict(Zp=10, D=30.0, rr=1.0, rw=1.0, Db=10.0, tMin=1.0, Zw=3, L=2.0, K1=0.4),
        dict(Zp=30, D=150.0, rr=5.0, rw=5.0, Db=30.0, tMin=3.0, Zw=12, L=15.0, K1=0.85),
        dict(Zp=30, D=150.0, rr=1.0, rw=1.0, Db=10.0, tMin=1.0, Zw=3, L=2.0, K1=0.35),
        dict(Zp=10, D=150.0, rr=5.0, rw=5.0, Db=30.0, tMin=3.0, Zw=12, L=15.0, K1=0.9),
        dict(Zp=24, D=100.0, rr=3.0, rw=3.0, Db=20.0, tMin=2.0, Zw=8, L=10.0, K1=0.6),   # 6000/24 integer
        dict(Zp=25, D=110.0, rr=3.0, rw=3.0, Db=20.0, tMin=2.0, Zw=7, L=10.0, K1=0.6),   # 6000/25 integer
        dict(Zp=20, D=90.0, rr=2.0, rw=2.0, Db=15.0, tMin=2.0, Zw=5, L=8.0, K1=0.5),     # 6000/20 integer
    ]
    for c in corners:
        for discs in (1, 2):
            inp = defaults()
            for k in ("Zp", "D", "rr", "rw", "Db", "tMin", "Zw", "L"):
                inp[k] = c[k]
            inp["e"] = round(c["K1"] * (c["D"] / 2) / c["Zp"], 5)
            inp["discs"] = discs
            inp["Treq"], inp["Tdes"] = (0.8, 1.5) if discs == 1 else (1.5, 2.5)
            if geom_ok(inp, min_rw=0.3, min_clear=0.0):
                add_case("corner", inp, "A")

    # 5. very small and very large K1
    for K1 in (0.05, 0.1, 0.2, 0.3, 0.95, 0.97, 0.99):
        inp = defaults()
        inp.update(D=100.0, Zp=18, rr=2.5, rw=2.5, Db=19.0, Treq=2.0, Tdes=3.0)
        inp["e"] = round(K1 * 50.0 / 18, 5)
        add_case(f"K1={K1}", inp, "A")

    # 6. near-cusp profiles: rho_min just above / just below 0.3 mm, and an undercut
    for Zp, D, rr in [(30, 150.0, 5.0), (12, 60.0, 4.0), (20, 120.0, 5.0), (10, 100.0, 5.0), (25, 130.0, 4.5),
                      (16, 90.0, 5.0), (18, 85.0, 2.5)]:
        Rp = D / 2
        for fac, label in ((1.001, "cusp rho=0.3+0.1%"), (0.999, "cusp rho=0.3-0.1%"), (1.00001, "cusp rho=0.3+1e-3%")):
            k1 = find_k1_for_rho(Zp, Rp, rr, 0.3 * fac)
            if k1 is None:
                continue
            inp = defaults()
            inp.update(Zp=Zp, D=D, rr=rr, rw=2.0, Db=12.0, Treq=1.0, Tdes=1.5)
            inp["e"] = k1 * Rp / Zp
            if geom_ok(inp, min_rw=0.3, min_clear=0.0):
                add_case(f"{label} Zp{Zp}", inp, "A")
        k1u = find_k1_for_rho(Zp, Rp, rr, 1e-9)
        if k1u:
            inp = defaults()
            inp.update(Zp=Zp, D=D, rr=rr, rw=2.0, Db=12.0, Treq=1.0, Tdes=1.5)
            inp["e"] = (k1u + 0.01) * Rp / Zp
            if geom_ok(inp, min_rw=0.3, min_clear=0.0):
                add_case(f"undercut Zp{Zp}", inp, "A")

    # 7. ligament exactly at t_min (bore), and just either side
    bases = [(100.0, 1.0, 18, 6, 2.0, 2.5, 2.5), (85.0, 1.6, 18, 6, 2.0, 2.5, 2.5), (70.0, 1.07, 18, 6, 2.0, 2.5, 2.5),
             (120.0, 1.5, 24, 8, 1.5, 3.0, 2.0), (60.0, 0.92, 18, 6, 2.0, 2.5, 2.5), (45.0, 0.7, 12, 4, 1.0, 2.0, 2.0)]
    for D, e, Zp, Zw, tMin, rr, rw in bases:
        dh = 2 * rw + 2 * e
        Rw = D / 2 - e - rr - dh / 2 - tMin
        Db_exact = 2 * (Rw - dh / 2 - tMin)
        for off, label in ((0.0, "exact"), (1e-7, "+1e-7"), (-1e-7, "-1e-7"), (-1.5e-9, "-1.5e-9"), (1e-9, "+1e-9")):
            inp = defaults()
            inp.update(D=D, e=e, Zp=Zp, Zw=Zw, tMin=tMin, rr=rr, rw=rw, Treq=1.0, Tdes=1.5)
            inp["Db"] = Db_exact - 2 * off      # lig_bore = tMin + off
            if inp["Db"] > 0:
                add_case(f"ligBore {label} t_min", inp, "A")

    # 7b. ligament between holes exactly at t_min (solve t_min), and just either side
    n = 0
    while n < 6:
        inp = random_inputs(rng)
        inp["Zw"] = rng.randint(8, 12)
        inp["rw"] = round(rng.uniform(3.5, 5.0), 3)
        s = math.sin(math.pi / inp["Zw"])
        Rp = inp["D"] / 2
        dh = 2 * inp["rw"] + 2 * inp["e"]
        Rroot = Rp - inp["e"] - inp["rr"]
        t_star = (2 * s * (Rroot - dh / 2) - dh) / (1 + 2 * s)
        if not (0.5 <= t_star <= 4.0):
            continue
        for off, label in ((0.0, "exact"), (1e-7, "+1e-7"), (-1e-7, "-1e-7")):
            i2 = dict(inp)
            # lig_holes = 2 Rw s - dh with Rw = Rroot - dh/2 - tMin ; shift tMin so the ligament is tMin+off
            # (solve again with the offset: 2 s (Rroot - dh/2 - t) - dh = t + off)
            i2["tMin"] = (2 * s * (Rroot - dh / 2) - dh - off) / (1 + 2 * s)
            i2["Db"] = 10.0
            if geom_ok(i2, min_rw=0.3, min_clear=0.0):
                add_case(f"ligHoles {label} t_min", i2, "A")
        n += 1

    # 8. utilization-threshold cases: scale T_des so one check sits just either side of 0.85 and 1.0
    base = defaults()
    base.update(D=70.0, e=1.07, Treq=1.0, Tdes=1.0)
    set_ref_globals(base)
    geo, p0r, Fr, p0w, Fw, Fb = ref.unit_case(35.0, base["e"])
    ex = sc.profile_extras(18, 35.0, base["e"], 2.5)
    u = dict(p0r=p0r, Fr=Fr, p0w=p0w, Fw=Fw, Fb=Fb, Rw=geo["Rw"], dh=geo["dh"], lig_bore=geo["lig_bore"],
             lig_holes=geo["lig_holes"], Estar_ref=ref.Estar)
    chk = {c[0]: c for c in sc.spec_checks(base, u, ex)["checks"]}
    for target in (0.85 * 0.999, 0.85 * 1.001, 0.999, 1.001):
        for cid, power in (("boltBending", 1.0), ("bearingStatic", 1.0), ("ringContactStrength", 0.5),
                           ("standoffBending", 1.0)):
            inp = dict(base)
            inp["Tdes"] = round((target / chk[cid][3]) ** (1 / power), 9)
            inp["Treq"] = 0.05
            add_case(f"util {cid} {target:.4f}", inp, "A")
    # a window where the script's rounded 460 MPa limit and the exact 1.67*Sy = 460.92 disagree
    for target, label in ((460.4, "p0 ring strength 460.4"), (460.7, "p0 ring strength 460.7")):
        inp = dict(base)
        inp["Tdes"] = round((target / chk["ringContactStrength"][1]) ** 2, 9)
        inp["Treq"] = 0.05
        add_case(label, inp, "A")
    # life limit window 240 .. 240.016 (chk values were evaluated at Treq = 1; life p0 scales with sqrt(Treq))
    inp = dict(base)
    inp["Treq"] = round((240.008 / chk["ringContactLife"][1]) ** 2, 9)
    inp["Tdes"] = inp["Treq"]
    add_case("p0 ring life 240.008", inp, "A")

    # 9. group B: SPEC-only extras (gap, shank, standoff, yields, bearing, reqLife, materials, share override)
    nB = 0
    while nB < 50:
        inp = random_inputs(rng, factors=True)
        if not (lig_feasible(inp) or rng.random() < 0.3):
            continue
        inp["gap"] = round(rng.uniform(0.0, 1.5), 3)
        inp["wall"] = round(rng.uniform(2, 8), 2)
        inp["reqLifeH"] = round(rng.uniform(100, 20000), 0)
        b = rng.choice(BEARINGS)
        inp["bearing"] = dict(C=float(b[0]), C0=float(b[1]))
        inp["discShare"] = round(rng.uniform(0.4, 1.0), 3) if rng.random() < 0.25 else None
        names = list(MATS)
        inp["discMat"] = dict(MATS[rng.choice(names)])
        if rng.random() < 0.65:
            inp["outerPin"] = dict(kind="boltBushing", shank=rng.choice(OUTER_SHANKS),
                                   **{"yield": round(rng.uniform(400, 900), 0)},
                                   mat=dict(rng.choice([STEEL, MATS["st1018"], MATS["st4140"]])))
        else:
            inp["outerPin"] = dict(kind="solid", shank=3.0, **{"yield": 640.0}, mat=dict(MATS[rng.choice(names)]))
        if rng.random() < 0.65:
            od, bore = rng.choice(INNER_STANDOFFS)
            inp["innerPin"] = dict(kind="standoff", od=od, bore=bore, **{"yield": round(rng.uniform(200, 500), 0)},
                                   mat=dict(rng.choice([STEEL, MATS["st1018"], MATS["st4140"]])))
        else:
            inp["innerPin"] = dict(kind="solid", od=5.0, bore=2.46, **{"yield": 300.0},
                                   mat=dict(MATS[rng.choice(names)]))
        add_case("spec-extras", inp, "B")
        nB += 1

    # 10. group B, appended (does not disturb the seeded sequence above): the contact limit is set by the weaker
    # of the disc and the pin part (bushing / standoff / solid pin), not by the disc alone.
    steel, s1018 = dict(STEEL), dict(MATS["st1018"])
    base = defaults()
    base.update(D=70.0, e=1.07, Treq=0.2, Tdes=0.3)

    def weaker(tag, disc, outer_mat, inner_mat, outer_kind="boltBushing", inner_kind="standoff", **over):
        inp = dict(base)
        inp.update(over)
        inp["discMat"] = dict(MATS[disc])
        inp["outerPin"] = dict(kind=outer_kind, shank=3.0, **{"yield": 640.0}, mat=dict(outer_mat))
        inp["innerPin"] = dict(kind=inner_kind, od=5.0, bore=2.46, **{"yield": 300.0}, mat=dict(inner_mat))
        add_case(tag, inp, "B")

    weaker("weaker: PETG bushing on 6061", "al6061", MATS["petg"], steel)
    weaker("weaker: PLA standoff on 6061", "al6061", steel, MATS["pla"])
    weaker("weaker: steel bushing on 4140 disc", "st4140", steel, steel, Treq=2.25, Tdes=3.4)
    weaker("weaker: 1018 parts on 7075 disc", "al7075", s1018, s1018, Treq=2.25, Tdes=3.4)
    weaker("weaker: spec steel on 7075 disc", "al7075", steel, steel, Treq=2.25, Tdes=3.4)
    weaker("weaker: solid 1018 on 7075 disc", "al7075", s1018, s1018, "solid", "solid", Treq=2.25, Tdes=3.4)
    weaker("weaker: steel on PLA disc", "pla", steel, steel)
    weaker("weaker: PETG bushing and PLA standoff on PLA disc", "pla", MATS["petg"], MATS["pla"])
    weaker("weaker: PLA bushing on PETG disc", "petg", MATS["pla"], steel)
    weaker("weaker: 4140 parts on 1018 disc", "st1018", MATS["st4140"], MATS["st4140"], Treq=2.25, Tdes=3.4)


def main():
    build_cases()
    # Run the reference script unmodified, as the user would (module globals back at their defaults).
    import subprocess
    out = subprocess.run([sys.executable, os.path.join(ROOT, "reference", "cycloidal_disc_check.py")],
                         capture_output=True, text=True, check=True).stdout
    fixture = dict(
        meta=dict(seed=SEED, generator="scripts/parity/generate_fixture.py", numpy=np.__version__,
                  cases=len(CASES), reference_printout=out,
                  limits=dict(P_STATIC=ref.P_STATIC, P_LIFE=ref.P_LIFE)),
        cases=CASES,
    )
    path = os.path.join(HERE, "fixture.json")
    with open(path, "w", encoding="utf-8", newline="\n") as f:
        json.dump(fixture, f, separators=(",", ":"), allow_nan=False)
        f.write("\n")
    n = {g: sum(1 for c in CASES if c["g"] == g) for g in "AB"}
    print(f"wrote {path}: {len(CASES)} cases {n}, {os.path.getsize(path) / 1024:.0f} KB")


if __name__ == "__main__":
    main()
