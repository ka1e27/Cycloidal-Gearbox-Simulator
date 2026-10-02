"""Independent FEM with exact (Lagrange-multiplier) constraints: Zw Euler-Bernoulli pins, base clamped, tips
slope-free=0 and translation tied to a rigid ring (ux, uy, rz). Compares max |M| with the closed form."""
import numpy as np, os
src = open(os.path.join(os.path.dirname(__file__), "standoff_ring.py")).read().split("case(\"J2 1 disc")[0]
ns = {}; exec(src, ns)
closed, pin_loads = ns["ring_solve_closed_form"], ns["pin_loads"]

def fem_exact(P_list, r, H, n=40):
    Zw = r.shape[0]
    # put nodes exactly at the load points
    xs = sorted(set(np.linspace(0, H, n + 1).round(9).tolist()) | {round(a, 9) for a, _ in P_list})
    nd = len(xs)
    per = 2 * nd * 2
    N = Zw * per + 3
    K = np.zeros((N, N)); f = np.zeros(N)
    dof = lambda p, pl, i, c: p * per + pl * 2 * nd + 2 * i + c
    for p in range(Zw):
        for pl in range(2):
            for e in range(nd - 1):
                le = xs[e + 1] - xs[e]
                ke = np.array([[12, 6*le, -12, 6*le], [6*le, 4*le*le, -6*le, 2*le*le],
                               [-12, -6*le, 12, -6*le], [6*le, 2*le*le, -6*le, 4*le*le]]) / le**3
                idx = [dof(p, pl, e, 0), dof(p, pl, e, 1), dof(p, pl, e + 1, 0), dof(p, pl, e + 1, 1)]
                K[np.ix_(idx, idx)] += ke
            for a, P in P_list:
                f[dof(p, pl, xs.index(round(a, 9)), 0)] += P[p, pl]
    G = []; U = Zw * per
    for p in range(Zw):
        for pl in range(2):
            for c in (0, 1):
                g = np.zeros(N); g[dof(p, pl, 0, c)] = 1; G.append(g)          # clamped base
            g = np.zeros(N); g[dof(p, pl, nd - 1, 1)] = 1; G.append(g)          # tip slope 0
            zxr = [-r[p, 1], r[p, 0]][pl]
            g = np.zeros(N); g[dof(p, pl, nd - 1, 0)] = 1; g[U + pl] = -1; g[U + 2] = -zxr; G.append(g)
    G = np.array(G); m = G.shape[0]
    A = np.block([[K, G.T], [G, np.zeros((m, m))]])
    x = np.linalg.solve(A, np.concatenate([f, np.zeros(m)]))[:N]
    best = np.zeros(Zw)
    for p in range(Zw):
        Ms = {0: [], 1: []}
        for pl in range(2):
            for e in range(nd - 1):
                le = xs[e + 1] - xs[e]
                w = [x[dof(p, pl, e, 0)], x[dof(p, pl, e, 1)], x[dof(p, pl, e + 1, 0)], x[dof(p, pl, e + 1, 1)]]
                for s in (0.0, 1.0):
                    B = np.array([(-6 + 12*s)/le**2, (-4 + 6*s)/le, (6 - 12*s)/le**2, (-2 + 6*s)/le])
                    Ms[pl].append(B @ np.array(w))
        best[p] = np.max(np.hypot(np.array(Ms[0]), np.array(Ms[1])))
    return best

worst = 0
for (Zw, Rw, H, loads_a) in [(6, 32.9, 7.35, [3.675]), (6, 32.3, 14.2, [3.675, 10.525]),
                              (10, 19.7, 26.9, [6.85, 20.05]), (8, 25.0, 20.0, [5.0]), (4, 15.0, 12.0, [9.0])]:
    for th in np.linspace(0, 2*np.pi, 24, endpoint=False):
        P, r, F = pin_loads(Zw, Rw, 17, th)
        P_list = [(a, P if i == 0 else -P) for i, a in enumerate(loads_a)]   # 2nd disc: eccentric opposite
        c, _ = closed(P_list, r, H); fe = fem_exact(P_list, r, H)
        worst = max(worst, abs(c.max() - fe.max()) / fe.max())
print(f"closed form vs exact-constraint FEM, 5 geometries x 24 angles: max relative difference {worst:.2e}")
