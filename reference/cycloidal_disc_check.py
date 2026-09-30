"""
Cycloidal disc strength check (aluminum disc, steel pins).
Edit the INPUTS block and run:  python3 cycloidal_disc_check.py

Model
- Exact disc profile (pin-centre epitrochoid offset by pin radius) and its local curvature.
- Ring-pin force distribution: line of action through the pitch point, forces proportional
  to moment arm (rigid, zero-clearance baseline), then x Kc for real manufacturing tolerance.
- Hertz line contact at each engaged pin using the real lobe curvature at that contact.
- Inner (output) pins: sine-law distribution, pin inside a hole of dia (pin OD + 2e).
- Eccentric bearing load: vector sum of ring + output pin forces on the disc.
- Outer pin bolt bending (bushing rides on bolt shank, span between plates) and
  inner standoff bending (cantilever to disc mid-plane; tie ring roughly halves it).
"""
import numpy as np

# ------------------------- INPUTS -------------------------
Zp      = 18        # outer (ring) pins; disc lobes = Zp-1, ratio = Zp-1
Zw      = 6         # inner (output) pins
L       = 6.35      # disc thickness = contact length, mm (0.25 in)
rr      = 2.5       # outer pin/bushing radius, mm (5 mm OD)
rw      = 2.5       # inner pin/standoff radius, mm (5 mm OD)
Db      = 19.0      # centre bore in disc for eccentric bearing OD, mm (61800 = 19)
t_min   = 2.0       # minimum ligament (hole-to-bore, hole-to-lobe-root), mm
Kc      = 2.0       # load concentration factor for waterjet tolerance (1 = perfect sharing)
Kc_life = 1.3       # after run-in
P_STATIC = 460.0    # MPa, line-contact yield onset for 6061-T6 (~1.67*Sy)
P_LIFE   = 240.0    # MPa, long-life target (subsurface shear 0.25*p0 vs ~60 MPa shear fatigue)
C_ECC    = 1380.0   # N, eccentric bearing dynamic rating (61800 approx; check datasheet)
RPM_IN   = 300.0    # typical input speed for bearing life
# joints: name: (pin circle dia mm, eccentricity mm, T_required N*m, T_design N*m, n_discs)
JOINTS = {
    "J2": (85, 1.6, 5.85, 8.8, 2),
    "J3": (70, 1.07, 2.25, 3.4, 1),
    "J1": (60, 0.92, 1.3, 2.0, 1),
    "J4": (60, 0.92, 0.3, 1.0, 1),
}
# -----------------------------------------------------------

E_st, nu_st = 200e3, 0.30
E_al, nu_al = 69e3, 0.33
Estar = 1/((1-nu_st**2)/E_st + (1-nu_al**2)/E_al)

def unit_case(Rp, e, nth=240, npf=6000):
    """Everything at T = 1 N*m on one disc, Kc = 1."""
    Zc = Zp-1
    dh = 2*rw + 2*e
    R_root = Rp - e - rr
    Rw = R_root - dh/2 - t_min            # inner pins pushed as far out as ligaments allow
    geo = dict(dh=dh, R_root=R_root, Rw=Rw,
               lig_bore=Rw-dh/2-Db/2, lig_holes=2*Rw*np.sin(np.pi/Zw)-dh)
    p = np.linspace(0, 2*np.pi, npf, endpoint=False)
    dX = -Rp*np.sin(p)+e*Zp*np.sin(Zp*p); dY = Rp*np.cos(p)-e*Zp*np.cos(Zp*p)
    ddX = -Rp*np.cos(p)+e*Zp**2*np.cos(Zp*p); ddY = -Rp*np.sin(p)+e*Zp**2*np.sin(Zp*p)
    kt = (dX*ddY-dY*ddX)/np.hypot(dX, dY)**3
    rho_a = 1/kt - rr
    geo["cusp_risk"] = bool(np.any((rho_a > 0) & (rho_a < 0.3)))
    ka = 1/rho_a
    a = 2*np.pi*np.arange(Zp)/Zp
    Q = np.stack([Rp*np.cos(a), Rp*np.sin(a)], 1)
    chi = 2*np.pi*np.arange(Zw)/Zw
    p0r = 0; Fr = 0; Fb = []
    for th in np.linspace(0, 2*np.pi, nth, endpoint=False):
        ut = np.array([np.cos(th), np.sin(th)])
        C, P = e*ut, e*Zp*ut
        d = P-Q; n = d/np.linalg.norm(d, axis=1)[:, None]
        r = Q + rr*n - C
        arm = r[:, 0]*n[:, 1] - r[:, 1]*n[:, 0]
        ld = arm > 0; l = arm[ld]
        F = np.zeros(Zp); F[ld] = 1e3*l/np.sum(l**2)
        j = (((a+th/Zc) % (2*np.pi))/(2*np.pi)*npf).astype(int) % npf
        invR = 1/rr + ka[j]; ok = ld & (invR > 0)
        if ok.any():
            p0r = max(p0r, np.sqrt(F[ok]*Estar*invR[ok]/(np.pi*L)).max())
        Fr = max(Fr, F.max())
        ch = chi - th/Zc
        tq = Rw*(np.cos(ch)*(-ut[1]) - np.sin(ch)*(-ut[0]))
        lo = tq < 0
        Fw = np.zeros(Zw)
        if lo.any(): Fw[lo] = 1e3*np.abs(tq[lo])/np.sum(tq[lo]**2)
        Fb.append(np.linalg.norm((F[:, None]*n).sum(0) + Fw.sum()*(-ut)))
    Fw_max = 4e3/(Zw*Rw)
    p0w = np.sqrt(Fw_max*Estar*(1/rw - 1/(dh/2))/(np.pi*L))
    return geo, p0r, Fr, p0w, Fw_max, max(Fb)

def check(name, D, e, Treq, Tdes, discs):
    s = 1.0 if discs == 1 else 0.55          # torque share per disc
    geo, p0r, Fr, p0w, Fw, Fb = unit_case(D/2, e)
    ring_s = p0r*np.sqrt(Kc*Tdes*s); ring_l = p0r*np.sqrt(Kc_life*Treq*s)
    in_s = p0w*np.sqrt(Kc*Tdes*s);   in_l = p0w*np.sqrt(Kc_life*Treq*s)
    Fr_pk = Fr*Kc*Tdes*s; Fw_pk = Fw*Kc*Tdes*s
    span = discs*L + (discs+1)*0.5
    bolt = Fr_pk*span/8/(np.pi*3.0**3/32), Fr_pk*span/4/(np.pi*3.0**3/32)
    arm = 0.5 + (discs-1)*(L+0.5) + L/2
    so = Fw_pk*arm/(np.pi*(5**4-2.46**4)/(32*5))
    L10h = (C_ECC/(Fb*Treq*s))**3*1e6/(60*RPM_IN)
    ok = (ring_s <= P_STATIC and ring_l <= P_LIFE and in_s <= P_STATIC and in_l <= P_LIFE
          and geo["lig_bore"] >= t_min-1e-9 and not geo["cusp_risk"])
    print(f"\n{name}: pin circle {D} mm, e = {e} mm, K1 = {e*Zp/(D/2):.2f}, discs = {discs}"
          f"  -> {'PASS' if ok else 'FAIL'}")
    print(f"  ring pin contact p0: strength {ring_s:.0f} MPa (limit {P_STATIC:.0f}), "
          f"life {ring_l:.0f} MPa (limit {P_LIFE:.0f}), peak pin force {Fr_pk:.0f} N")
    print(f"  inner hole contact p0: strength {in_s:.0f}, life {in_l:.0f} MPa, peak pin force {Fw_pk:.0f} N")
    print(f"  inner pin circle radius {geo['Rw']:.1f} mm, hole dia {geo['dh']:.2f} mm, "
          f"ligament to bore {geo['lig_bore']:.1f} mm, between holes {geo['lig_holes']:.1f} mm")
    print(f"  outer M3 bolt bending {bolt[0]:.0f}-{bolt[1]:.0f} MPa (on 3.0 mm shank)")
    print(f"  inner standoff bending {so/2:.0f} (with tie ring) to {so:.0f} MPa (cantilever)")
    print(f"  eccentric bearing peak load {Fb*Tdes*s:.0f} N, L10 ~{L10h:,.0f} h at {RPM_IN:.0f} rpm")

if __name__ == "__main__":
    print(f"Zp={Zp} pins, ratio {Zp-1}:1, disc {L} mm 6061-T6, E*={Estar:.0f} MPa, Kc={Kc}")
    for k, v in JOINTS.items():
        check(k, *v)
