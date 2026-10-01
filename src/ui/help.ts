// Tooltip texts: what a field is and a typical value. Keep them short.

export interface HelpEntry {
  title?: string;
  what: string;
  typical?: string;
}

export const HELP: Record<string, HelpEntry> = {
  // Geometry
  Zp: { what: 'Number of outer (ring) pins. The disc has Zp − 1 lobes, so the gear ratio is (Zp − 1) : 1.', typical: '18 gives 17:1. Usual range 12 to 26; must be an integer of at least 8.' },
  Zw: { what: 'Number of inner (output) pins that carry torque from the disc to the output. More pins share the load but need more room.', typical: '6. Usual range 4 to 10; integer of at least 3.' },
  D: { what: 'Diameter of the circle through the centres of the outer pins. It mostly sets the size of the gearbox.', typical: '60 to 85 mm for this arm (30 to 150 mm searched by the advisor).' },
  e: { what: 'Eccentricity: how far the eccentric shaft offsets the disc. Larger e lets the lobes carry more load but thins the profile.', typical: 'About 0.9 to 1.6 mm. K1 = e·Zp / Rp should land between 0.40 and 0.85.' },
  L: { what: 'Disc thickness. It is also the contact length between disc and pins, so thicker discs lower the contact stress.', typical: '6.35 mm (1/4 in plate) is the default. Plate stock runs from 3.175 to 12.7 mm (1/8 to 1/2 in).' },
  rr: { what: 'Radius of the outer pin (the bushing outside diameter / 2). The pin OD is 2 × rr.', typical: '2.5 mm (5 mm OD bushing on an M3 bolt).' },
  rw: { what: 'Radius of the inner (output) pin. The disc holes are 2·rw + 2·e wide.', typical: '2.5 mm (5 mm OD standoff).' },
  Db: { what: 'Diameter of the centre bore in the disc. It equals the outside diameter of the eccentric bearing.', typical: '19 mm for a 61800 bearing.' },
  tMin: { what: 'Minimum wall (ligament) you accept between the inner holes, the centre bore and the lobe root. It also pushes the inner pins as far out as allowed.', typical: '2 mm for waterjet-cut aluminum.' },
  discs: { what: 'Number of discs. Two discs run 180° out of phase and each takes about 55% of the torque, which also balances the eccentric mass.', typical: '1 for light joints, 2 for the shoulder.' },
  gap: { what: 'Axial clearance at every interface between discs and plates. It lengthens the pin span and so raises pin bending.', typical: '0.5 mm.' },
  RwOverride: { what: 'Fix the inner pin circle radius by hand. Leave empty to let the app push the pins as far out as the minimum ligament allows.', typical: 'Empty (automatic) in most cases.' },
  wall: { what: 'Housing wall outside the outer pins. Only used to report the housing outside diameter: D + 2·rr + 2·wall.', typical: '4 mm.' },

  // Materials
  discMaterial: { what: 'Material of the cycloidal disc. Choosing one fills the property fields below, which stay editable.', typical: 'Aluminum 6061-T6 is the SPEC default.' },
  E: { what: 'Young’s modulus (stiffness). With the pin material it sets the effective contact modulus E*.', typical: 'Aluminum 69,000 MPa, steel about 200,000 MPa, PETG/PLA 2,000 to 3,300 MPa.' },
  nu: { what: 'Poisson’s ratio of the material.', typical: '0.29 to 0.38.' },
  Sy: { what: 'Yield strength. The strength-case contact limit is 1.67 × Sy.', typical: '6061-T6: 276 MPa.' },
  sigmaF: { what: 'Fatigue strength at 10⁷ cycles. The life-case contact limit is 0.577 × σf / 0.25.', typical: '6061-T6: about 104 MPa (sparse data).' },
  density: { what: 'Density, used only to estimate the disc mass.', typical: 'Aluminum 2.70, steel 7.85, PETG 1.27 g/cm³.' },
  shankDia: { what: 'Diameter of the unthreaded bolt shank inside the bushing. This is the section that bends under the pin force.', typical: '3.0 mm for an M3 bolt.' },
  boltYield: { what: 'Yield strength of the bolt. The bending limit is 0.4 × this value (fatigue).', typical: '640 MPa for class 8.8.' },
  standoffOd: { what: 'Outside diameter of the round standoff used as inner pin.', typical: '5 mm for M3.' },
  standoffBore: { what: 'Bore (tapped hole) of the standoff. It weakens the section.', typical: '2.46 mm for M3.' },
  standoffYield: { what: 'Yield strength of the standoff. The bending limit is 0.5 × this value.', typical: '300 MPa (low-carbon steel, assumed).' },

  // Loads & factors
  Treq: { what: 'Working output torque the joint has to deliver. It drives the life checks (contact fatigue and bearing life).', typical: 'J2 about 5.9 N·m and J3 about 2.3 N·m with the default arm.' },
  Tdes: { what: 'Design (peak) torque, about 1.5 × T_req. It drives the strength checks.', typical: 'SF × T_req, never below the T_des floor.' },
  Kc: { what: 'Load concentration factor for the strength case. Waterjet tolerances are larger than the elastic deflection, so only a few pins share the load.', typical: '2.0.' },
  KcLife: { what: 'Load concentration factor for the life case, after the parts have run in.', typical: '1.3.' },
  discShare: { what: 'Fraction of the torque carried by each disc. Leave empty for automatic: 1.0 for one disc, 0.55 for two.', typical: 'Automatic.' },
  bearingC: { what: 'Dynamic load rating C of the eccentric bearing. Used for the L10 life. Approximate: verify on the datasheet.', typical: '61800: 1,380 N.' },
  bearingC0: { what: 'Static load rating C0 of the eccentric bearing. The peak bearing load must stay below it.', typical: '61800: 585 N.' },
  rpm: { what: 'Speed of the eccentric (input) shaft, used for the bearing life.', typical: '300 rpm.' },
  reqLifeH: { what: 'How many hours the eccentric bearing has to last at the working torque.', typical: '2,000 h.' },

  // Arm
  jointMass: { what: 'Mass of the joint: motor, gearbox and housing, lumped at the joint centre.', typical: '100 to 800 g for this arm (placeholders until CAD masses exist).' },
  barMass: { what: 'Mass of the link between two joints. It is treated as a uniform rod with its centre of mass at the midpoint.', typical: '40 to 120 g.' },
  barLength: { what: 'Centre-to-centre length of the link, along the arm.', typical: '80 to 230 mm.' },
  baseColumnLength: { what: 'Height of the base column, from the top of the J1 turntable up to the J2 shoulder axis. The column rotates with J1 (it is part of the base, not a driven link), so it adds weight and height but no yaw inertia.', typical: '100 mm placeholder. 0 puts the J2 axis right on the turntable.' },
  baseColumnMass: { what: 'Mass of the base column, J1 to J2. It is a vertical rod on the J1 axis, so it adds axial load on the J1 bearing but no gravity torque or yaw inertia.', typical: '40 to 120 g.' },
  payload: { what: 'Mass carried at the tool tip.', typical: '250 g placeholder.' },
  linkOffset: { what: 'How far the link’s load plane sits from this joint’s output bearing, measured along the joint axis. The radial load times this offset is the tilting moment on the bearing. Used for the two pitch joints (J2, J3) only.', typical: '15 mm placeholder; about half the bearing width plus the link thickness.' },
  alpha: { what: 'Maximum angular acceleration of the joint. It sets the dynamic torque term α · I.', typical: '3 rad/s².' },
  SF: { what: 'Service factor: T_des = max(SF × T_req, the T_des floor).', typical: '1.5.' },
  TdesFloor: { what: 'Smallest design torque you want a gearbox checked for, even when the model torque is tiny.', typical: '1.0 N·m.' },
  ovTreq: { what: 'Type a torque here to replace the modelled T_req for this joint. Leave empty to use the arm model.', typical: 'Empty.' },
  ovTdes: { what: 'Type a torque here to replace the computed T_des for this joint. Leave empty to use max(SF × T_req, floor).', typical: 'Empty.' },

  // Advisor
  target: { what: 'Every check must stay at or under this utilization. 0.85 is the green limit; 1.0 is the physical limit.', typical: '0.85. Range 0.70 to 1.00.' },
  advWall: { what: 'Housing wall thickness beyond the outer pins, for the housing outside diameter.', typical: '4 mm.' },
  Dmin: { what: 'Smallest outer pin circle diameter the advisor may propose.', typical: '30 mm.' },
  Dmax: { what: 'Largest outer pin circle diameter the advisor may propose.', typical: '150 mm.' },
  minPinClearance: { what: 'Smallest edge-to-edge gap between neighbouring outer pins that the advisor allows.', typical: '1 mm.' },
  altWindowMm: { what: 'How far above the smallest housing OD the advisor searches for the lightest and the most-margin alternatives.', typical: '15 mm.' },
};

/** One plain sentence under each page title. */
export const STEP_HINTS: Record<number, string> = {
  1: 'Enter the masses and lengths of your arm. The torque each joint must carry is worked out as you type.',
  2: 'Pick a joint, then set its geometry and materials. The verdict and every check update as you type.',
  3: 'Find the smallest gearbox that passes every check for the selected joint.',
  4: 'Every gearbox joint checked side by side. Design opens the advisor for that joint.',
};
