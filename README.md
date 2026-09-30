# Cycloidal Gearbox Simulator

**Live site:** https://ka1e27.github.io/Cycloidal-Gearbox-Simulator/

A static web app for sizing and checking pin-type cycloidal gearboxes for a 5-DOF robot arm
(J1–J4 cycloidal, J5 direct-drive servo). Everything runs in the browser.

- **Arm & Loads:** enter joint masses, bar masses and center-to-center lengths. The app derives
  the static and dynamic torque on each joint, the output-bearing loads, and the J5 servo
  requirement.
- **Gearbox:** contact stresses, pin forces, pin bending, ligaments, cusp, and eccentric-bearing
  static and life checks. Discs and pins can be steel, aluminum, PETG or PLA. Each check shows its
  utilization and the governing failure mode, alongside an animated disc drawing and charts.
- **Design Advisor:** recommends pin circle and housing diameter, eccentricity, pin sizes, inner
  pin count, disc thickness, disc count and bearing.
- **All Joints:** pass/fail for every joint at a glance.

The calculation engine in `src/calc/` reproduces `reference/cycloidal_disc_check.py`. The test
suite checks it against the validation cases in `docs/SPEC.md`.

## Development

```bash
npm install
npm run dev      # dev server
npm test         # Vitest
npm run build    # production build in dist/
```

Pushes to `main` deploy to GitHub Pages through `.github/workflows/deploy.yml`.

Results are engineering estimates, not a substitute for testing. See the Assumptions panel in the
app.
