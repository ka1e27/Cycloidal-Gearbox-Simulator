"""Lead's derivation check: inner standoffs fixed (recessed, bolted) at the output face and tied at the far
end by a free-floating rigid ring that is bolted to every standoff (tip slope 0, tips share one rigid-body
in-plane motion). Compare the peak standoff bending moment with (a) the cantilever value F*a and (b) the SPEC
heuristic F*a/2. Uses brute-force FEM-free beam superposition AND an independent stiffness-matrix solve."""
import numpy as np

def pin_loads(Zw, Rw, Zc, th, sign=1.0):
    """Reference sine-law inner-pin forces at input angle th, per 1 N*m (reference unit_case).
    Returns force vectors on the PINS (reaction to the force on the disc, which acts along -u)."""
    u = np.array([np.cos(th), np.sin(th)])
    chi = 2*np.pi*np.arange(Zw)/Zw - th/Zc
    tq = Rw*(np.cos(chi)*(-u[1]) - np.sin(chi)*(-u[0]))
    lo = tq < 0
    F = np.zeros(Zw)
    if lo.any():
        F[lo] = 1e3*np.abs(tq[lo])/np.sum(tq[lo]**2)
    # force on disc along -u  ->  force on pin along +u
    P = sign*F[:, None]*u[None, :]
    r = Rw*np.stack([np.cos(chi), np.sin(chi)], 1)
    return P, r, F

def ring_solve_closed_form(P_list, r, H):
    """P_list: list of (a, P[Zw,2]) loads along each pin (one per disc). Closed form derived for fixed-guided
    pins joined by a rigid floating ring. Returns max |M| along each pin."""
    Zw = r.shape[0]
    Rw2 = np.mean(np.sum(r**2, 1))
    # tip reaction from each load: R = c*P - k*delta ; c = a^2(3H-2a)/H^3 ; ring removes rigid-body part
    Rtip = np.zeros((Zw, 2))
    for a, P in P_list:
        c = a*a*(3*H - 2*a)/H**3
        avg = P.mean(0)
        mz = np.sum(r[:, 0]*P[:, 1] - r[:, 1]*P[:, 0]) / (Zw*Rw2)   # rotation share
        rot = mz*np.stack([-r[:, 1], r[:, 0]], 1)                     # (z x r) * mz
        Rtip += c*(P - avg - rot)
    # internal moment along each pin (beam fixed at x=0, guided at x=H, loads P at a, tip force Rtip, tip moment Mh)
    # tip moment from slope-0 condition, superposed per load: Mh = (sum P a^2/2 - R H^2/2)/H
    Mh = np.zeros((Zw, 2))
    for a, P in P_list:
        Mh += P*a*a/2/H
    Mh -= Rtip*H/2
    xs = sorted({0.0, H} | {a for a, _ in P_list})
    best = np.zeros(Zw)
    Ft = -Rtip            # ring force on the pin tip
    C = -Mh               # ring couple on the pin tip
    for x in np.linspace(0, H, 401).tolist() + xs:
        # bending moment at section x from everything outboard (x..H): loads beyond x, tip force, tip couple
        M = Ft*(H - x) + C
        for a, P in P_list:
            if a > x:
                M += P*(a - x)
        best = np.maximum(best, np.hypot(M[:, 0], M[:, 1]))
    return best, Rtip

def stiffness_solve(P_list, r, H, n=60):
    """Independent check: discretize every pin into Euler-Bernoulli elements (EI=1), clamp the base, join all
    tips to a rigid ring (master node: ux, uy, rz-about-axis; tip slopes 0), solve, return max |M| per pin."""
    Zw = r.shape[0]
    le = H/n
    nd = n + 1
    # per pin: 2 bending planes (x and y), each node dof (w, slope); planes uncoupled except via ring rotation
    ndof_pin = 2*nd*2
    N = Zw*ndof_pin + 3      # + ring ux, uy, rz
    K = np.zeros((N, N)); f = np.zeros(N)
    ke = np.array([[12, 6*le, -12, 6*le], [6*le, 4*le*le, -6*le, 2*le*le],
                   [-12, -6*le, 12, -6*le], [6*le, 2*le*le, -6*le, 4*le*le]])/le**3
    def dof(p, plane, node, comp):
        return p*ndof_pin + plane*2*nd + 2*node + comp
    for p in range(Zw):
        for plane in range(2):
            for e in range(n):
                idx = [dof(p, plane, e, 0), dof(p, plane, e, 1), dof(p, plane, e+1, 0), dof(p, plane, e+1, 1)]
                K[np.ix_(idx, idx)] += ke
        for a, P in P_list:
            node = int(round(a/le))
            for plane in range(2):
                f[dof(p, plane, node, 0)] += P[p, plane]
    # constraints via penalty: base w=0, slope=0; tip slope=0; tip w = ring motion
    big = 1e12
    U = Zw*ndof_pin
    for p in range(Zw):
        for plane in range(2):
            for comp in (0, 1):
                i = dof(p, plane, 0, comp); K[i, i] += big
            i = dof(p, plane, n, 1); K[i, i] += big
            # w_tip - (ring_u[plane] + rz * (z x r)[plane]) = 0
            zxr = [-r[p, 1], r[p, 0]][plane]
            g = np.zeros(N); g[dof(p, plane, n, 0)] = 1; g[U+plane] = -1; g[U+2] = -zxr
            K += big*np.outer(g, g)
    x = np.linalg.solve(K, f)
    best = np.zeros(Zw)
    for p in range(Zw):
        Mx = []; My = []
        for plane, out in ((0, Mx), (1, My)):
            for e in range(n):
                w1, t1, w2, t2 = (x[dof(p, plane, e, 0)], x[dof(p, plane, e, 1)], x[dof(p, plane, e+1, 0)], x[dof(p, plane, e+1, 1)])
                # curvature at element start (EI=1): M = w''
                for xi in (0.0, 1.0):
                    s = xi
                    B = np.array([(-6 + 12*s)/le**2, (-4 + 6*s)/le, (6 - 12*s)/le**2, (-2 + 6*s)/le])
                    out.append(B @ np.array([w1, t1, w2, t2]))
        best[p] = np.max(np.hypot(np.array(Mx), np.array(My)))
    return best

def case(name, Zw, Rw, Zc, L, gap, discs, T=1.0):
    H = discs*L + (discs+1)*gap                     # output face to ring
    worst = {"cant": 0, "heur": 0, "ring": 0, "fem": 0}
    for th in np.linspace(0, 2*np.pi, 120, endpoint=False):
        loads = []
        share = 1.0 if discs == 1 else 0.55
        P, r, F = pin_loads(Zw, Rw, Zc, th, 1.0)
        for k in range(discs):
            a = gap + k*(L + gap) + L/2
            sign = 1.0 if k == 0 else -1.0            # 2nd disc: eccentric 180 deg out -> opposite force, same pins
            loads.append((a, sign*P*T*share))
        a_far = loads[-1][0]
        Fmax = max(np.max(np.hypot(P[:, 0], P[:, 1])) for _, P in loads)
        cant = Fmax*a_far
        worst["cant"] = max(worst["cant"], cant)
        worst["heur"] = max(worst["heur"], cant/2)
        ring, _ = ring_solve_closed_form(loads, r, H)
        worst["ring"] = max(worst["ring"], ring.max())
        if int(round(th/(2*np.pi/120))) % 10 == 0:   # FEM check on every 10th angle (slow)
            fem = stiffness_solve(loads, r, H).max()
            worst["fem"] = max(worst["fem"], fem)
            worst.setdefault("maxdiff", 0)
            worst["maxdiff"] = max(worst["maxdiff"], abs(fem - ring.max())/fem)
    print(f"{name:34s} H={H:5.2f}  cantilever {worst['cant']:7.1f}  heuristic/2 {worst['heur']:7.1f}  "
          f"ring model {worst['ring']:7.1f}  FEM {worst['fem']:7.1f}  closed-form vs FEM max diff {worst['maxdiff']*100:.2f}%  "
          f"ring/cantilever {worst['ring']/worst['cant']:.3f}")

case("J2 1 disc  (Rw 32.9, Zw 6)", 6, 32.9, 17, 6.35, 0.5, 1)
case("J2 2 discs (Rw 32.3, Zw 6)", 6, 32.3, 17, 6.35, 0.5, 2)
case("J3 1 disc  (Rw 25.9, Zw 6)", 6, 25.9, 17, 6.35, 0.5, 1)
case("Zw 10, Rw 19.7, 2x12.7 discs", 10, 19.7, 17, 12.7, 0.5, 2)
