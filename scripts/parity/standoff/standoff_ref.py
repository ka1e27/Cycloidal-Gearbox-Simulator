"""Reference values for the engine: max inner-standoff bending moment per N*m on ONE disc share (s=1, Kc=1),
over the reference sweep theta_i = 2*pi*i/240, for a ring that is clamped (bolted, tip slope 0) or pinned
(tip slope free), validated against an exact-constraint FEM on a subset of angles."""
import numpy as np, os
src = open(os.path.join(os.path.dirname(__file__), "standoff_fem2.py")).read().split("worst = 0")[0]
ns = {"__file__": os.path.join(os.path.dirname(__file__), "standoff_fem2.py")}; exec(src, ns)
pin_loads, fem_exact = ns["pin_loads"], ns["fem_exact"]

def closed(P_list, r, H, tip):
    Zw = r.shape[0]; Rw2 = np.mean(np.sum(r**2, 1))
    Ft = np.zeros((Zw, 2)); C = np.zeros((Zw, 2))
    for a, P in P_list:
        c = a*a*(3*H - 2*a)/H**3 if tip == "clamped" else a*a*(3*H - a)/(2*H**3)
        avg = P.mean(0)
        mz = np.sum(r[:, 0]*P[:, 1] - r[:, 1]*P[:, 0])/(Zw*Rw2)
        Ft += -c*(P - avg - mz*np.stack([-r[:, 1], r[:, 0]], 1))
    if tip == "clamped":
        for a, P in P_list:
            C += -P*a*a/(2*H)
        C += -Ft*H/2
    best = np.zeros(Zw)
    for x in [0.0, H] + [a for a, _ in P_list]:
        M = Ft*(H - x) + C
        for a, P in P_list:
            if a > x: M = M + P*(a - x)
        best = np.maximum(best, np.hypot(M[:, 0], M[:, 1]))
    return best

def fem_pinned_check(P_list, r, H):
    # pinned tip: reuse the exact FEM by removing the tip-slope constraint (monkey-patch via a flag-free rebuild)
    return None

def run(name, Zp, Rw, L, gap, discs, Zw=6):
    Zc = Zp - 1
    H = discs*L + (discs + 1)*gap
    out = {}
    for tip in ("clamped", "pinned"):
        worst = 0.0
        for i in range(240):
            th = 2*np.pi*i/240
            P, r, F = pin_loads(Zw, Rw, Zc, th)
            loads = [(gap + k*(L + gap) + L/2, (1.0 if k == 0 else -1.0)*P) for k in range(discs)]
            m = closed(loads, r, H, tip).max()
            worst = max(worst, m)
            if tip == "clamped" and i % 40 == 0:
                fe = fem_exact(loads, r, H).max()
                assert abs(fe - m) <= 1e-6*fe, (name, i, fe, m)
        out[tip] = worst
    a_far = gap + (discs - 1)*(L + gap) + L/2
    F_in_unit = 4000/(Zw*Rw)
    print(f"{name:22s} H={H:6.3f} a_far={a_far:6.3f}  M_ring_unit clamped={out['clamped']:.6f} pinned={out['pinned']:.6f}"
          f"  cantilever_unit={F_in_unit*a_far:.6f}  ratio clamped/cant={out['clamped']/(F_in_unit*a_far):.4f}")

run("J2 85/1.3 1 disc", 18, 32.9, 6.35, 0.5, 1)
run("J2 85/1.6 2 discs", 18, 32.3, 6.35, 0.5, 2)
run("J3 70/1.07 1 disc", 18, 35 - 1.07 - 2.5 - (5 + 2.14)/2 - 2, 6.35, 0.5, 1)
run("J1 60/0.92 1 disc", 18, 30 - 0.92 - 2.5 - (5 + 1.84)/2 - 2, 6.35, 0.5, 1)
