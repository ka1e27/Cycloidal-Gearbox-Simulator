"""Exact-constraint FEM for BOTH tip conditions (bolted ring = tip slope 0, pinned = tip slope free) against the
vectorized closed form the parity fixture uses (scripts/parity/spec_checks.standoff_ring_unit, per theta).
Same element formulation as standoff_fem2.py (Euler-Bernoulli, EI = 1, Lagrange multipliers, nodes at the loads),
with the tip-slope constraint optional. Prints the max relative difference over several geometries and angles."""
import os
import sys

import numpy as np

sys.dont_write_bytecode = True
sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
import spec_checks as sc  # noqa: E402


def pin_loads(Zw, Rw, Zc, th):
    u = np.array([np.cos(th), np.sin(th)])
    chi = 2 * np.pi * np.arange(Zw) / Zw - th / Zc
    tq = Rw * (np.cos(chi) * (-u[1]) - np.sin(chi) * (-u[0]))
    lo = tq < 0
    F = np.zeros(Zw)
    if lo.any():
        F[lo] = 1e3 * np.abs(tq[lo]) / np.sum(tq[lo] ** 2)
    return F[:, None] * u[None, :], Rw * np.stack([np.cos(chi), np.sin(chi)], 1)


def fem(P_list, r, H, tip_slope_zero, n=40):
    Zw = r.shape[0]
    xs = sorted(set(np.linspace(0, H, n + 1).round(9).tolist()) | {round(a, 9) for a, _ in P_list})
    nd = len(xs)
    per = 2 * nd * 2
    N = Zw * per + 3
    K = np.zeros((N, N)); f = np.zeros(N)
    dof = lambda p, pl, i, c: p * per + pl * 2 * nd + 2 * i + c  # noqa: E731
    for p in range(Zw):
        for pl in range(2):
            for e in range(nd - 1):
                le = xs[e + 1] - xs[e]
                ke = np.array([[12, 6 * le, -12, 6 * le], [6 * le, 4 * le * le, -6 * le, 2 * le * le],
                               [-12, -6 * le, 12, -6 * le], [6 * le, 2 * le * le, -6 * le, 4 * le * le]]) / le ** 3
                idx = [dof(p, pl, e, 0), dof(p, pl, e, 1), dof(p, pl, e + 1, 0), dof(p, pl, e + 1, 1)]
                K[np.ix_(idx, idx)] += ke
            for a, P in P_list:
                f[dof(p, pl, xs.index(round(a, 9)), 0)] += P[p, pl]
    G = []; U = Zw * per
    for p in range(Zw):
        for pl in range(2):
            for c in (0, 1):
                g = np.zeros(N); g[dof(p, pl, 0, c)] = 1; G.append(g)            # clamped at the output face
            if tip_slope_zero:
                g = np.zeros(N); g[dof(p, pl, nd - 1, 1)] = 1; G.append(g)        # bolted ring: tip slope 0
            zxr = [-r[p, 1], r[p, 0]][pl]
            g = np.zeros(N); g[dof(p, pl, nd - 1, 0)] = 1; g[U + pl] = -1; g[U + 2] = -zxr; G.append(g)  # rigid ring
    G = np.array(G); m = G.shape[0]
    A = np.block([[K, G.T], [G, np.zeros((m, m))]])
    x = np.linalg.solve(A, np.concatenate([f, np.zeros(m)]))[:N]
    best = 0.0
    for p in range(Zw):
        Ms = {0: [], 1: []}
        for pl in range(2):
            for e in range(nd - 1):
                le = xs[e + 1] - xs[e]
                w = [x[dof(p, pl, e, 0)], x[dof(p, pl, e, 1)], x[dof(p, pl, e + 1, 0)], x[dof(p, pl, e + 1, 1)]]
                for s in (0.0, 1.0):
                    B = np.array([(-6 + 12 * s) / le ** 2, (-4 + 6 * s) / le, (6 - 12 * s) / le ** 2, (-2 + 6 * s) / le])
                    Ms[pl].append(B @ np.array(w))
        best = max(best, float(np.max(np.hypot(np.array(Ms[0]), np.array(Ms[1])))))
    return best


worst = {"clamped": 0.0, "pinned": 0.0}
nth = 240
for Zw, Zp, Rw, L, gap, discs in [(6, 18, 32.9, 6.35, 0.5, 1), (6, 18, 32.3, 6.35, 0.5, 2), (10, 18, 19.7, 12.7, 0.5, 2),
                                  (8, 12, 25.0, 9.0, 1.0, 1), (4, 26, 15.0, 3.175, 0.2, 2), (3, 9, 12.0, 5.0, 0.0, 1)]:
    pc, pp = sc.standoff_ring_unit(Zw, Zp, Rw, L, gap, discs, nth=nth, per_theta=True)
    H = discs * L + (discs + 1) * gap
    for i in range(0, nth, 20):
        P, r = pin_loads(Zw, Rw, Zp - 1, 2 * np.pi * i / nth)
        P_list = [(gap + k * (L + gap) + L / 2, P if k == 0 else -P) for k in range(discs)]
        for tip, val, slope0 in (("clamped", pc[i], True), ("pinned", pp[i], False)):
            fe = fem(P_list, r, H, slope0)
            worst[tip] = max(worst[tip], abs(fe - val) / fe)
print(f"closed form vs exact-constraint FEM, 6 geometries x 12 angles: max relative difference "
      f"clamped {worst['clamped']:.2e}, pinned {worst['pinned']:.2e}")
