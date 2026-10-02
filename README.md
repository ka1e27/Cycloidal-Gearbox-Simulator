# Cycloidal Gearbox Simulator

**Live site:** https://ka1e27.github.io/Cycloidal-Gearbox-Simulator/

A static web app for sizing and checking pin-type cycloidal gearboxes for a robot arm of 1 to 8
joints (the default is a 5-DOF arm: J1–J4 cycloidal, J5 direct-drive servo). Everything runs in the browser.

The app is a one-screen workbench:

- **Joints rail (left):** build the arm joint by joint. Add, remove, reorder or rename joints.
  Each joint is a base yaw, a pitch or a roll, driven by a cycloidal gearbox or a servo. Every
  row shows a pass/marginal/fail status.
- **Stage (centre):**
  - **3D arm:** drag joints to pose the arm. Joints are coloured by torque against design
    torque, links by bending moment.
  - **Schematic:** ready pose and worst-case pose.
  - **Disc:** the disc animation and charts.
  - **Summary:** every joint's verdict.
- **Inspector (right):** for the selected joint.
  - Joint & link, motor and recommended gear ratio, loads.
  - Gearbox design: contact stresses, pin forces and bending, ligaments, cusp, and eccentric-bearing
    static and life checks. Discs and pins can be steel, aluminum, PETG or PLA.
  - Disc & charts, the minimum-size solver, and the Design Advisor. In the Advisor you can lock
    any dimension and let it optimize the rest.
  - DXF export of the disc, plates, cam and pins.

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
