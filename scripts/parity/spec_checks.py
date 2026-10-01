"""
Independent implementation of the docs/SPEC.md formulas that are NOT in the reference script
(ligament between holes, bolt / standoff bending limits, bearing static and life, disc mass,
utilization definitions, status thresholds, verdict). Written from SPEC.md only; it does not
look at the TypeScript engine. It takes the *unit* numbers from the reference script's
unit_case() and builds the full check list from them.
"""
import math

import numpy as np

GREEN = 0.85          # utilization <= 0.85 green, <= 1.0 amber, > 1.0 red
UTIL_CAP = 99.0       # what a check that cannot be evaluated reports (SPEC does not define it)
CUSP_RHO = 0.3


def estar(pin, disc):
    return 1.0 / ((1 - pin["nu"] ** 2) / pin["E"] + (1 - disc["nu"] ** 2) / disc["E"])


def profile_extras(Zp, Rp, e, rr, npf=6000):
    """Profile formulas of SPEC.md: minimum convex rho_a, cusp flag (0 < rho_a < 0.3),
    undercut flag (path curvature > 1/rr), and the polygon area of the actual profile."""
    p = np.linspace(0, 2 * np.pi, npf, endpoint=False)
    X = Rp * np.cos(p) - e * np.cos(Zp * p)
    Y = Rp * np.sin(p) - e * np.sin(Zp * p)
    dX = -Rp * np.sin(p) + e * Zp * np.sin(Zp * p)
    dY = Rp * np.cos(p) - e * Zp * np.cos(Zp * p)
    ddX = -Rp * np.cos(p) + e * Zp ** 2 * np.cos(Zp * p)
    ddY = -Rp * np.sin(p) + e * Zp ** 2 * np.sin(Zp * p)
    kt = (dX * ddY - dY * ddX) / (dX ** 2 + dY ** 2) ** 1.5
    rho = 1 / kt - rr
    conv = rho[rho > 0]
    rho_min = float(conv.min()) if conv.size else math.inf
    cusp = bool(np.any((rho > 0) & (rho < CUSP_RHO)))
    undercut = bool(np.any((kt > 0) & (rho <= 0)))
    d = np.hypot(dX, dY)
    nx, ny = dY / d, -dX / d
    qx, qy = X - rr * nx, Y - rr * ny
    area = 0.5 * abs(float(np.sum(qx * np.roll(qy, -1) - np.roll(qx, -1) * qy)))
    return dict(rho_min=rho_min, cusp=cusp, undercut=undercut, area=area)


def status_of(util):
    if util > 1.0:
        return "fail"
    return "ok" if util <= GREEN else "marginal"


def _util_max(value, limit):
    if not math.isfinite(value):
        return UTIL_CAP
    return min(value / limit, UTIL_CAP)


def _util_min(value, limit):
    if value <= 0:
        return UTIL_CAP
    return min(limit / value, UTIL_CAP)


def spec_checks(inp, u, extras):
    """inp: fully resolved input dict (see generate_fixture.defaults()).
    u: dict with p0r, Fr, p0w, Fw, Fb (reference unit values at E*_ref, L = inp['L']) and
       Estar_ref (the E* the reference used), plus geometry dh, Rw, lig_bore, lig_holes.
    extras: profile_extras() output.
    Returns dict(checks=[(id, value, limit, util, status)], mass, verdict, max_util, housingOD, ...)."""
    discs = inp["discs"]
    share = inp["discShare"] if inp["discShare"] else (1.0 if discs == 1 else 0.55)
    disc = inp["discMat"]
    op, ip = inp["outerPin"], inp["innerPin"]
    Es_ring = estar(op["mat"], disc)
    Es_in = estar(ip["mat"], disc)
    p0r = u["p0r"] * math.sqrt(Es_ring / u["Estar_ref"])
    p0w = u["p0w"] * math.sqrt(Es_in / u["Estar_ref"])

    Kc, Kl, Tdes, Treq = inp["Kc"], inp["KcLife"], inp["Tdes"], inp["Treq"]
    s_str = math.sqrt(Kc * Tdes * share)
    s_life = math.sqrt(Kl * Treq * share)
    Fr_pk = u["Fr"] * Kc * Tdes * share
    Fw_pk = u["Fw"] * Kc * Tdes * share

    # contact limits (strength = 1.67 Sy, life = 0.577 sigma_f / 0.25). The contact is between the pin part
    # (bushing, standoff or solid pin) and the disc, so the weaker of the two governs.
    def limits(pin, solid):
        sy = min(disc["Sy"], pin["Sy"])
        sf = min(disc["sigmaF"], pin["sigmaF"])
        return 1.67 * sy, 0.577 * sf / 0.25

    ring_lim = limits(op["mat"], op["kind"] == "solid")
    in_lim = limits(ip["mat"], ip["kind"] == "solid")

    # bolt bending (simply supported value is the check, fixed-fixed is info)
    span = discs * inp["L"] + (discs + 1) * inp["gap"]
    d_o = op["shank"] if op["kind"] == "boltBushing" else 2 * inp["rr"]
    Zo = math.pi * d_o ** 3 / 32
    bolt_fix = Fr_pk * span / 8 / Zo
    bolt_sim = Fr_pk * span / 4 / Zo
    bolt_lim = 0.4 * op["yield"] if op["kind"] == "boltBushing" else min(0.4 * op["mat"]["Sy"], op["mat"]["sigmaF"])

    # standoff bending (tie-ring value is the check, cantilever is info)
    arm = inp["gap"] + (discs - 1) * (inp["L"] + inp["gap"]) + inp["L"] / 2
    if ip["kind"] == "standoff":
        Zi = math.pi * (ip["od"] ** 4 - ip["bore"] ** 4) / (32 * ip["od"])
        so_lim = 0.5 * ip["yield"]
    else:
        Zi = math.pi * (2 * inp["rw"]) ** 3 / 32
        so_lim = min(0.5 * ip["mat"]["Sy"], ip["mat"]["sigmaF"])
    so_cant = Fw_pk * arm / Zi
    so_tie = so_cant / 2

    # bearing
    Fb_peak = u["Fb"] * Tdes * share
    Fb_work = u["Fb"] * Treq * share
    C, C0 = inp["bearing"]["C"], inp["bearing"]["C0"]
    L10h = (C / Fb_work) ** 3 * 1e6 / (60 * inp["rpm"]) if Fb_work > 0 else math.inf

    tmin = inp["tMin"]
    rows = [
        ("ringContactStrength", p0r * s_str, ring_lim[0], "max"),
        ("ringContactLife", p0r * s_life, ring_lim[1], "max"),
        ("innerContactStrength", p0w * s_str, in_lim[0], "max"),
        ("innerContactLife", p0w * s_life, in_lim[1], "max"),
        ("ligamentBore", u["lig_bore"], tmin, "min"),
        ("ligamentHoles", u["lig_holes"], tmin, "min"),
        ("cusp", extras["rho_min"], CUSP_RHO, "min"),
        ("boltBending", bolt_sim, bolt_lim, "max"),
        ("standoffBending", so_tie, so_lim, "max"),
        ("bearingStatic", Fb_peak, C0, "max"),
        ("bearingLife", L10h, inp["reqLifeH"], "min"),
    ]
    checks = []
    for cid, value, limit, kind in rows:
        if cid == "bearingLife" and math.isinf(value):
            util = 0.0 if limit > 0 else UTIL_CAP
        elif kind == "max":
            util = _util_max(value, limit)
        else:
            util = _util_min(value, limit) if math.isfinite(value) else 0.0
        checks.append((cid, value, limit, util, status_of(util)))
    cusp_flag = extras["cusp"] or extras["undercut"]

    net = extras["area"] - math.pi * (inp["Db"] / 2) ** 2 - inp["Zw"] * math.pi * (u["dh"] / 2) ** 2
    per_disc = max(0.0, net) * inp["L"] * disc["density"] / 1000.0
    others = [c for c in checks if c[0] != "cusp"]
    max_util = max(c[3] for c in others)
    if cusp_flag:
        verdict = "fail"
    else:
        max_util = max(max_util, [c for c in checks if c[0] == "cusp"][0][3])
        verdict = {"ok": "pass", "marginal": "marginal", "fail": "fail"}[status_of(max_util)]
    return dict(
        checks=checks, cusp_flag=cusp_flag, max_util=max_util, max_util_noncusp=max(c[3] for c in others),
        verdict=verdict, mass_total=per_disc * discs, mass_net_area=net,
        housingOD=inp["D"] + 2 * inp["rr"] + 2 * inp["wall"],
        bolt_fix=bolt_fix, so_cant=so_cant, Fb_work=Fb_work, share=share,
        Es_ring=Es_ring, Es_in=Es_in,
    )
