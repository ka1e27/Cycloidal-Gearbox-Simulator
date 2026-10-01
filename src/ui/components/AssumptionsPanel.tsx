import { useEffect, useId, useRef, useState } from 'react';
import { BEARING_NOTE, SUPPLIER_DATA_NOTE } from '../../calc';
import { Icon } from './Icon';
import { OPEN_ASSUMPTIONS_EVENT } from './Header';
import { useU } from '../store';

const GROUPS: { title: string; items: string[] }[] = [
  {
    title: 'Gearbox model (SPEC)',
    items: [
      'Rigid-body, zero-clearance force distribution scaled by Kc. Real load sharing depends on manufacturing tolerance and run-in.',
      'Kc = 2 and the aluminum contact-fatigue limit are engineering judgment. Contact-fatigue data for 6061 is sparse, so treat results near the life limit as marginal.',
      'The two-disc share of 0.55 is a standard approximation.',
      'Hard anodizing improves wear, not subsurface fatigue. It is not modeled.',
      'Bushing-on-bolt friction, pin rotation, disc tilt, thermal effects and dynamic impact are not modeled. The TMC2209 current limit should cap motor torque near T_des.',
      'Contact length assumes the full disc thickness bears on each pin.',
      'J1 and J4 torques are estimates until link masses come from CAD.',
    ],
  },
  {
    title: 'Materials and parts',
    items: [
      SUPPLIER_DATA_NOTE,
      'PETG and PLA are printed polymers: they creep under sustained load, soften with friction heat (PLA near 60 °C) and are weaker across layers. The Hertz limits are only a rough screen for them.',
      'For solid pins the bending limits are min(0.4 · Sy, σf) for outer pins and min(0.5 · Sy, σf) for inner pins. Steel bolts and standoffs use 0.4 · and 0.5 · their yield strength.',
      BEARING_NOTE,
      'Disc mass is the profile area minus the centre bore and inner holes, times thickness and density, times the number of discs.',
    ],
  },
  {
    title: 'Arm load model',
    items: [
      'The default masses and lengths are placeholders until CAD masses exist. They were chosen to give roughly the SPEC torques at J2 (5.85 N·m) and J3 (2.25 N·m).',
      'The arm is evaluated fully extended horizontally, the worst gravity pose. Joint masses are lumped at the joint centres; links are uniform rods with their centre of mass at the midpoint.',
      'Dynamic torque is α · I about the joint axis with the same α for everything outboard. Friction, payload swing, shocks and cable forces are ignored.',
      'J4 (roll) torque assumes J5 is bent 90°, so the tool is horizontal and perpendicular to the roll axis. J1 (yaw) has no gravity torque, only α · I.',
      'J5 is a direct-drive servo: the app reports the torque it must deliver but does not check a gearbox for it.',
      'Output-bearing loads are information for sizing the joint bearing or housing, not pass/fail checks. The gravity torque about the axis goes through the gearbox; it is not the tilting moment on the bearing.',
      'J1 (vertical axis): the outboard weight is an axial thrust, and its horizontal reach gives an overturning moment. J2 and J3 (horizontal axis): radial load = outboard weight, tilting moment = radial load × the link offset from the output bearing along the axis (an input, default 15 mm). J4 (roll): radial load = outboard weight, tilting moment = Σ m·g × axial distance along the roll axis with the forearm and tool straight out, the worse pose for the bearing. J5 is a servo and has none.',
    ],
  },
];

export function AssumptionsPanel() {
  const u = useU();
  const [open, setOpen] = useState(false);
  const id = useId();
  const root = useRef<HTMLElement>(null);

  useEffect(() => {
    const on = () => {
      setOpen(true);
      window.setTimeout(() => root.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 30);
    };
    window.addEventListener(OPEN_ASSUMPTIONS_EVENT, on);
    return () => window.removeEventListener(OPEN_ASSUMPTIONS_EVENT, on);
  }, []);

  return (
    <section className="card assumptions" ref={root} id="assumptions" aria-label="Assumptions and limitations">
      <h2 className="assumptions-h">
        <button type="button" className="assumptions-toggle" aria-expanded={open} aria-controls={id} onClick={() => setOpen((o) => !o)}>
          <span>Assumptions and limitations</span>
          <Icon name="chevron" size={14} className="assumptions-chevron" />
        </button>
      </h2>
      <div className={`assumptions-body${open ? ' is-open' : ''}`} id={id} inert={!open}>
        <div className="assumptions-inner">
          <div className="assumptions-grid">
            {GROUPS.map((g) => (
              <div key={g.title}>
                <h3 className="assumptions-group">{g.title}</h3>
                <ul>
                  {g.items.map((t) => (
                    <li key={t}>{u.text(t)}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
