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


INNER_PIN_SUPPORTS = ("ringClamped", "ringPinned", "cantilever")


def standoff_ring_unit(Zw, Zp, Rw, L, gap, discs, nth=240, per_theta=False):
    """Peak inner-pin bending moment (N*mm per N*m on one disc, Kc = 1) for pins fixed at the output face (x = 0)
    whose far ends (x = H) are bolted to one free-floating rigid tie ring. Returns (clamped, pinned): ring bolted
    (tip slope 0) and pins free to rotate in the ring. Vectorized over theta; written from the derivation in
    scripts/parity/standoff/README.md (closed form validated against an exact-constraint FEM there), not from the
    TypeScript engine.
      pin forces: reference sine law, F_j = 1000 |tq_j| / sum(tq^2) over the loaded pins (tq_j < 0), along u
      disc k at a_k = gap + k (L + gap) + L/2, the second disc 180 deg out of phase (force -P_j on the same pins)
      ring: no net force, no net moment about the axis -> tip force Ft_j = -sum_k c_k (P_kj - mean P_k - m_k z x r_j)
      clamped: c = a^2 (3H - 2a) / H^3, tip couple C_j = -sum_k P_kj a_k^2 / (2H) - Ft_j H / 2
      pinned:  c = a^2 (3H - a) / (2 H^3), C_j = 0
      M_j(x) = Ft_j (H - x) + C_j + sum_{a_k > x} P_kj (a_k - x), max |M| over x in {0, H, a_k}."""
    Zc = Zp - 1
    th = 2 * np.pi * np.arange(nth) / nth
    ux, uy = np.cos(th), np.sin(th)
    chi = 2 * np.pi * np.arange(Zw)[None, :] / Zw - th[:, None] / Zc          # (T, Zw)
    rx, ry = Rw * np.cos(chi), Rw * np.sin(chi)
    tq = Rw * (np.cos(chi) * (-uy[:, None]) - np.sin(chi) * (-ux[:, None]))
    lo = tq < 0
    s2 = np.sum(np.where(lo, tq * tq, 0.0), axis=1)
    s2safe = np.where(s2 > 0, s2, 1.0)
    F = np.where(lo & (s2[:, None] > 0), 1e3 * np.abs(tq) / s2safe[:, None], 0.0)
    Px, Py = F * ux[:, None], F * uy[:, None]
    H = discs * L + (discs + 1) * gap
    stations = [(gap + k * (L + gap) + L / 2, 1.0 if k == 0 else -1.0) for k in range(discs)]
    R2 = np.mean(rx * rx + ry * ry, axis=1, keepdims=True)
    out = {}
    for tip in ("clamped", "pinned"):
        Ftx = np.zeros_like(Px); Fty = np.zeros_like(Px)
        Cx = np.zeros_like(Px); Cy = np.zeros_like(Px)
        for a, sg in stations:
            qx, qy = sg * Px, sg * Py
            c = a * a * (3 * H - 2 * a) / H ** 3 if tip == "clamped" else a * a * (3 * H - a) / (2 * H ** 3)
            mz = np.sum(rx * qy - ry * qx, axis=1, keepdims=True) / (Zw * R2)
            Ftx += -c * (qx - qx.mean(axis=1, keepdims=True) + mz * ry)
            Fty += -c * (qy - qy.mean(axis=1, keepdims=True) - mz * rx)
            if tip == "clamped":
                Cx += -qx * a * a / (2 * H)
                Cy += -qy * a * a / (2 * H)
        if tip == "clamped":
            Cx += -Ftx * H / 2
            Cy += -Fty * H / 2
        best = np.zeros(nth)
        for x in [0.0, H] + [a for a, _ in stations]:
            Mx = Ftx * (H - x) + Cx
            My = Fty * (H - x) + Cy
            for a, sg in stations:
                if a > x:
                    Mx = Mx + sg * Px * (a - x)
                    My = My + sg * Py * (a - x)
            best = np.maximum(best, np.max(np.hypot(Mx, My), axis=1))
        out[tip] = best
    if per_theta:
        return out["clamped"], out["pinned"]
    return float(out["clamped"].max()), float(out["pinned"].max())


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
    so_tie = so_cant / 2          # SPEC heuristic, kept as a reported number
    # The check uses the selected inner pin support (default: recessed standoffs + bolted tie ring)
    Mc, Mp = standoff_ring_unit(inp["Zw"], inp["Zp"], u["Rw"], inp["L"], inp["gap"], discs)
    so_ring_c = Mc * Kc * Tdes * share / Zi
    so_ring_p = Mp * Kc * Tdes * share / Zi
    support = inp.get("innerPinSupport", "ringClamped")
    so_used = {"ringClamped": so_ring_c, "ringPinned": so_ring_p, "cantilever": so_cant}[support]

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
        ("standoffBending", so_used, so_lim, "max"),
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
        bolt_fix=bolt_fix, so_cant=so_cant, so_tie=so_tie, Fb_work=Fb_work, share=share,
        Mc=Mc, Mp=Mp, so_ring_c=so_ring_c, so_ring_p=so_ring_p,
        Es_ring=Es_ring, Es_in=Es_in,
    )
