// Tooltip texts for every editable setting.
// what: what the setting is, in plain words. why: why it matters. up / down: what happens if you raise or lower it.
// typical: a sensible starting value. formula: the equation behind it, only when it helps (shown small, last).
// Numbers with units are written in mm, g, N, N·m or MPa so the unit switch can convert them.

export interface HelpEntry {
  title?: string;
  what: string;
  why?: string;
  up?: string;
  down?: string;
  typical?: string;
  formula?: string;
}

export const HELP: Record<string, HelpEntry> = {
  // ------------------------------------------------------------------ Geometry
  Zp: {
    what: 'Number of outer pins in the ring. It sets the gear ratio: the output turns once for every Zp − 1 turns of the motor.',
    why: 'The ratio decides how much the motor torque is multiplied and how fast the joint can move.',
    up: 'More torque from the same motor and finer positioning, but a slower joint. The lobes get smaller and closer together, so contact stress rises at the same size.',
    down: 'A faster joint with bigger, stronger lobes, but less torque multiplication, so you need a stronger motor.',
    typical: '18 pins (17:1). Usual range 12 to 26.',
    formula: 'ratio = (Zp − 1) : 1',
  },
  Zw: {
    what: 'Number of inner pins that pass the torque from the disc to the output.',
    why: 'The torque is shared between them, so the count sets how hard each pin and its hole work.',
    up: 'Each pin and hole carries less force, but the holes crowd together and the walls between them get thin, or no longer fit.',
    down: 'Fewer parts and more room in the disc, but every pin bends more and presses harder on its hole.',
    typical: '6. Usual range 4 to 10.',
  },
  D: {
    what: 'Diameter of the circle through the outer pin centres. It is the main size of the gearbox.',
    why: 'The same torque spread over a bigger circle means smaller forces on every pin, lobe and bearing.',
    up: 'Lower forces and stresses everywhere, and more room for pins and the bearing, but a bigger, heavier gearbox.',
    down: 'Smaller and lighter, but forces and contact stress rise. The minimum-size solver finds the smallest D that still passes.',
    typical: '60 to 85 mm for this arm.',
  },
  e: {
    what: 'Eccentricity: how far the disc is offset from the input shaft, so how much it wobbles. It sets the shape of the lobes.',
    why: 'Too little and the lobes are too flat to grip the pins well; too much and the profile gets pointy or undercut.',
    up: 'Deeper, rounder lobes that engage the pins better, but more wobble and vibration and bigger inner holes. Too far and the profile forms a cusp.',
    down: 'Smoother, quieter running with less wobble, but flatter lobes with higher contact stress.',
    typical: 'About 0.9 to 1.6 mm, chosen so K1 lands between 0.40 and 0.85.',
    formula: 'K1 = e · Zp / (D / 2)',
  },
  L: {
    what: 'Thickness of each disc. It is also the length of the line where every pin touches the disc.',
    why: 'A longer contact line spreads the load, so thickness is the easiest way to lower contact stress.',
    up: 'Lower contact stress and longer life, but a wider, heavier gearbox and longer pins that bend more.',
    down: 'Thinner and lighter, but contact stress rises (roughly with 1/√L).',
    typical: '6.35 mm (1/4 in plate). Plate stock runs from 3.175 to 12.7 mm.',
  },
  rr: {
    what: 'Radius of the outer pins (half the bushing outside diameter).',
    why: 'Bigger pins are stiffer and touch the lobes over a wider patch.',
    up: 'Lower contact stress and stiffer pins, but the pins take up room, the lobes get a tighter root, and the pins sit closer together.',
    down: 'More room and a smaller gearbox, but higher contact stress and thinner bolts that bend more.',
    typical: '2.5 mm (5 mm bushing on an M3 bolt).',
  },
  rw: {
    what: 'Radius of the inner (output) pins.',
    why: 'Thicker pins are much stronger in bending, but their holes in the disc grow too.',
    up: 'Stronger pins and lower hole contact stress, but bigger holes, thinner disc walls, and the inner pin circle moves inward.',
    down: 'More room in the disc, but the pins bend more and press harder on their holes.',
    typical: '2.5 mm (5 mm standoff).',
    formula: 'inner hole diameter = 2·rw + 2·e',
  },
  Db: {
    what: 'Diameter of the centre hole in the disc. It is the outside diameter of the eccentric bearing that drives the disc.',
    why: 'A bigger bearing carries more load and lasts longer, but takes space from the disc.',
    up: 'Room for a stronger, longer-lasting bearing, but less material between the bore and the inner holes.',
    down: 'More room for the inner pins, but only small bearings fit, which can fail the bearing life check.',
    typical: '19 mm for a 61800 bearing.',
  },
  tMin: {
    what: 'The thinnest wall you accept anywhere in the disc: between inner holes, around the centre bore and at the lobe roots.',
    why: 'Thin walls crack, distort when cut or printed, and wear out early.',
    up: 'A sturdier disc that is easier to make, but the inner pins are pulled inward, which raises their forces.',
    down: 'More room for the pins and bearing, but the thin walls may not survive cutting or loading.',
    typical: '2 mm for waterjet-cut aluminum; more for 3D prints.',
  },
  discs: {
    what: 'Number of cycloidal discs. Two discs run half a turn apart.',
    why: 'Two discs cancel each other’s wobble and split the torque (about 55% each).',
    up: 'Lower stresses, smoother running and less vibration, but more parts, a wider stack and longer pins.',
    down: 'Simpler and narrower, but one disc carries everything and the gearbox vibrates more.',
    typical: '1 for light joints, 2 for heavily loaded joints such as the shoulder.',
  },
  gap: {
    what: 'Axial clearance between each disc and its neighbours (other disc or plates).',
    why: 'The discs need room to run, but every gap lengthens the unsupported span of the pins.',
    up: 'Easier assembly and no rubbing, but the pins span further and bend more.',
    down: 'Stiffer pins, but the discs may rub against each other or the plates.',
    typical: '0.5 mm.',
  },
  RwOverride: {
    what: 'Sets the radius of the inner pin circle by hand. Leave it empty and the app pushes the pins as far out as the minimum wall allows.',
    why: 'Use it when the output plate hole pattern is already fixed.',
    up: 'Lower inner pin forces, but thinner walls toward the lobe roots.',
    down: 'More wall around the holes, but higher forces on every inner pin.',
    typical: 'Empty (automatic).',
  },
  wall: {
    what: 'Housing material outside the outer pins. It only affects the reported housing size and the DXF outline.',
    why: 'The housing has to hold the pin bolts without flexing.',
    up: 'A stiffer housing, but a larger outside diameter.',
    down: 'A smaller housing, but a thin rim can flex or crack around the pin holes.',
    typical: '4 mm.',
    formula: 'housing OD = D + 2·rr + 2·wall',
  },
  copyFrom: {
    what: 'Copies every gearbox input from a joint preset or the SPEC defaults into the custom gearbox, as a starting point.',
    typical: 'Pick the preset closest to your load, then edit.',
  },
  stockThickness: {
    what: 'Picks a disc thickness from standard plate (or print) sizes, so the design matches material you can buy.',
    why: 'Plate only comes in fixed thicknesses; an in-between value means machining or a different stock. Metals and machined plastics use plate sizes (1/8 to 1/2 in); 3D-printed discs use round print sizes.',
    up: 'Thicker stock lowers contact stress but makes the gearbox wider and heavier.',
    down: 'Thinner stock is lighter but raises contact stress.',
    typical: '1/4 in (6.35 mm) aluminum plate.',
  },

  // ------------------------------------------------------------------ Materials
  discMaterial: {
    what: 'Material of the cycloidal disc. Picking one fills in its properties, which you can still edit. The list has four families: metals, composites (G10 / FR4 glass-epoxy sheet), machined plastics (HDPE, UHMW-PE, acetal, Delrin 150, nylon PA66; cut from plate) and 3D-printed plastics (PETG, PLA, ABS, ASA, PC, nylon PA12, PA6-CF).',
    why: 'The disc lobes take the highest contact stress in the gearbox, so the material sets most of the limits.',
    up: 'Stronger choices (7075, steel) allow higher loads; steel is much heavier.',
    down: 'Plastics are light and quiet, but their limits are a small fraction of aluminum’s and they creep under constant load. Acetal (POM) is the best plastic for a disc; HDPE and UHMW-PE suit bushings and light joints.',
    typical: 'Aluminum 6061-T6.',
  },
  E: {
    what: 'Young’s modulus: how stiff the material is.',
    why: 'Together with the pin material it sets how the contact patch spreads.',
    up: 'A stiffer material makes a smaller contact patch, so contact stress actually rises, but parts deflect less.',
    down: 'A softer material spreads the contact and lowers the stress, but the parts deflect and wear more.',
    typical: 'Aluminum 69,000 MPa, steel about 200,000 MPa, PETG/PLA 2,000 to 3,300 MPa.',
  },
  nu: {
    what: 'Poisson’s ratio: how much the material bulges sideways when squeezed.',
    why: 'It has only a small effect on contact stress.',
    typical: '0.29 to 0.38. Rarely worth changing.',
  },
  Sy: {
    what: 'Yield strength: the stress where the material starts to deform permanently.',
    why: 'It sets the limit for the peak (design torque) contact checks.',
    up: 'A higher overload limit, so the gearbox survives bigger peaks.',
    down: 'Peaks dent the lobes or holes sooner.',
    typical: '6061-T6: 276 MPa.',
    formula: 'strength contact limit = 1.67 × Sy',
  },
  sigmaF: {
    what: 'Fatigue strength: the stress the material survives for about 10 million load cycles.',
    why: 'It sets the limit for the long-life checks, which decide pitting and wear over time.',
    up: 'A higher life limit, so the gearbox runs longer before the lobes pit.',
    down: 'The life checks fail sooner. Aluminum data is sparse, so treat results near the limit as marginal.',
    typical: '6061-T6: about 104 MPa.',
    formula: 'life contact limit = 0.577 × σf / 0.25',
  },
  density: {
    what: 'Material density. It is only used to estimate the disc mass.',
    why: 'Disc mass adds to the joint mass, which loads every joint closer to the base.',
    typical: 'Aluminum 2.70, steel 7.85, PETG 1.27 g/cm³.',
  },
  materialKind: {
    what: 'Whether the material counts as a metal or a polymer (machined or 3D-printed plastic). Picking a material sets it.',
    why: 'Any polymer part brings up the creep and heat warning card.',
    typical: 'Set by the material you pick.',
  },
  materialForm: {
    what: 'How the disc stock comes: plate (metal plate or machined plastic sheet) or printed (3D print). Picking a material sets it.',
    why: 'It picks the thickness list: plate sizes 1/8 to 1/2 in (3.175 to 12.7 mm), or print sizes 4 to 12 mm. The Design Advisor and the fix suggestions use the same list.',
    typical: 'Plate for metals and machined plastics, printed for PETG, PLA and the other printed plastics.',
  },
  outerConstruction: {
    what: 'How the outer pins are built: a bolt with a free-spinning bushing, or one solid pin.',
    why: 'A spinning bushing rolls on the lobes instead of sliding, which cuts friction and wear.',
    typical: 'Bolt + bushing (M3 bolt with a 5 mm bushing).',
  },
  outerPinSize: {
    what: 'Size of the outer pins: the bushing outside diameter and the bolt it rides on.',
    why: 'Pin size sets both the contact stress on the lobes and how much the bolt bends.',
    up: 'Lower contact stress and a stiffer bolt, but the pins take more room around the ring.',
    down: 'A tighter ring, but higher contact stress and more bolt bending.',
    typical: 'M3 bolt with a 5 mm bushing.',
  },
  pinMaterial: {
    what: 'Material of the pin, bushing or standoff that touches the disc.',
    why: 'The contact limits use the weaker of the disc and the pin, and the stiffness pair sets the contact stress.',
    up: 'Steel pins are strong and wear-resistant.',
    down: 'Printed pins are easy to make but lower the contact limits and wear quickly.',
    typical: 'Steel.',
  },
  shankDia: {
    what: 'Diameter of the plain (unthreaded) part of the bolt inside the bushing. This is the part that bends.',
    why: 'Bending stress falls very fast as the shank gets thicker (with 1/d³).',
    up: 'Much less bolt bending, but the bushing must grow with it.',
    down: 'Room for a smaller bushing, but the bolt bends a lot more.',
    typical: '3.0 mm for an M3 bolt.',
  },
  boltYield: {
    what: 'Yield strength of the outer pin bolts.',
    why: 'The bolts bend every time a pin passes under load, so the limit is set well below yield for fatigue.',
    up: 'A higher-grade bolt (10.9, 12.9) raises the bending limit.',
    down: 'Softer bolts (stainless, 4.6) fail the bending check sooner.',
    typical: '640 MPa for class 8.8.',
    formula: 'bending limit = 0.4 × bolt yield',
  },
  innerConstruction: {
    what: 'How the inner pins are built: threaded round standoffs, or solid pins.',
    why: 'Standoffs can be screwed into the output and the tie ring; solid pins are stronger for the same diameter.',
    typical: 'Steel standoffs (M3, 5 mm).',
  },
  innerPinSize: {
    what: 'Size of the inner pins (standoff outside diameter and its threaded bore).',
    why: 'It sets the pin bending stress and the size of the holes in the disc.',
    up: 'Much stronger pins, but bigger holes and thinner disc walls.',
    down: 'More room in the disc, but the pins bend more.',
    typical: 'M3 standoff, 5 mm.',
  },
  standoffOd: {
    what: 'Outside diameter of the standoffs used as inner pins.',
    why: 'Bending strength grows very fast with diameter.',
    up: 'Much stronger pins, but bigger holes in the disc.',
    down: 'Smaller holes, but the pins bend more.',
    typical: '5 mm for M3.',
  },
  standoffBore: {
    what: 'Diameter of the threaded hole through the standoff.',
    why: 'The hole removes material from the middle of the pin and weakens it slightly.',
    up: 'A weaker pin (bigger screw inside).',
    down: 'A stronger pin.',
    typical: '2.46 mm for M3.',
  },
  innerPinSupport: {
    what: 'How the inner pins are held. They are always fixed at the output face. The far ends can be bolted to a floating tie ring, sit loose in a tie ring, or be left free.',
    why: 'A tie ring lets the pins share load and stops their tips from swinging, which can cut pin bending by half or more.',
    up: 'Bolted tie ring: the lowest bending, which matches the arm’s hardware.',
    down: 'Loose ring or no ring: higher and more conservative bending stress.',
    typical: 'Recessed + bolted tie ring.',
  },
  standoffYield: {
    what: 'Yield strength of the standoffs.',
    why: 'Standoffs are often soft low-carbon steel, so this can decide the inner pin check.',
    up: 'A stronger standoff (alloy steel) raises the bending limit.',
    down: 'Brass or aluminum standoffs fail the bending check sooner.',
    typical: '300 MPa (low-carbon steel, assumed).',
    formula: 'bending limit = 0.5 × standoff yield',
  },
  bearing: {
    what: 'The eccentric bearing that sits in the centre of the disc and drives it around.',
    why: 'It carries the full combined pin load every revolution, so it is often the part that wears out first.',
    up: 'A bigger bearing lasts much longer and takes higher peaks, but needs a bigger centre hole.',
    down: 'A smaller bearing frees room in the disc but can fail the life or static check. The ultra-thin 67xx series (4 mm wide) has the smallest outside diameter for its bore, and the lowest ratings.',
    typical: '61800: 10 mm bore, 19 mm outside, 5 mm wide. Grouped as ultra-thin 67xx, thin 618xx and standard 60xx. Verify ratings on the datasheet.',
  },

  // ------------------------------------------------------------------ Loads & factors
  Treq: {
    what: 'The everyday torque the joint must deliver.',
    why: 'It drives the long-life checks: contact fatigue and bearing life.',
    up: 'The gearbox wears out sooner, so the life checks get harder to pass.',
    down: 'Easier life checks, but only if the joint really never works harder.',
    typical: 'The shoulder about 5.9 N·m and the elbow about 2.3 N·m with the default arm.',
  },
  Tdes: {
    what: 'The peak torque the joint must survive without damage.',
    why: 'It drives the strength checks: lobe and hole denting, pin bending and the bearing static load.',
    up: 'More margin for impacts and stalls, but a bigger gearbox.',
    down: 'A smaller gearbox, but a hard stall or crash could damage it.',
    typical: 'About 1.5 × the working torque.',
  },
  armLoads: {
    what: 'Takes the working and design torques from the arm model. Turn it off to type your own torques.',
    why: 'The arm model updates the torques automatically when masses or lengths change.',
    typical: 'On.',
  },
  Kc: {
    what: 'Load concentration for the peak case: how unevenly the pins share the load because parts are not perfectly made.',
    why: 'Real parts have small errors, so a few pins take more than their share.',
    up: 'Assumes sloppier parts: safer, but a bigger gearbox.',
    down: 'Assumes precise parts: only justified for accurately machined or ground parts.',
    typical: '2.0 for waterjet-cut parts.',
  },
  KcLife: {
    what: 'Load concentration for the long-life case, after the parts have worn in and share load better.',
    why: 'Running in smooths the high spots, so load sharing improves over time.',
    up: 'More conservative life checks.',
    down: 'Assumes the parts bed in well.',
    typical: '1.3.',
  },
  discShare: {
    what: 'Fraction of the torque each disc carries. Leave it empty for automatic (1.0 for one disc, 0.55 for two).',
    why: 'Two discs never share exactly half because of small timing and size differences.',
    up: 'More conservative: each disc is checked for more of the torque.',
    down: 'Assumes the two discs share almost perfectly.',
    typical: 'Automatic.',
  },
  bearingC: {
    what: 'Dynamic load rating of the eccentric bearing, from its datasheet.',
    why: 'It sets how many hours the bearing lasts under the working load.',
    up: 'Longer bearing life (life grows with the cube of the rating).',
    down: 'Shorter life.',
    typical: '61800: 1,380 N. Use your datasheet value.',
  },
  bearingC0: {
    what: 'Static load rating of the eccentric bearing, from its datasheet.',
    why: 'Peak loads above it dent the bearing races.',
    up: 'More room for peak loads.',
    down: 'The static check fails sooner.',
    typical: '61800: 585 N. Use your datasheet value.',
  },
  rpm: {
    what: 'Typical speed of the motor (input) shaft.',
    why: 'The eccentric bearing wears per revolution, so faster input uses up its life in fewer hours.',
    up: 'Fewer hours of bearing life.',
    down: 'More hours of bearing life.',
    typical: '300 rpm.',
  },
  reqLifeH: {
    what: 'How many running hours the eccentric bearing must last.',
    why: 'This is the target for the bearing life check.',
    up: 'A stricter check that may need a bigger bearing.',
    down: 'An easier check, fine for a prototype or a rarely used joint.',
    typical: '2,000 h.',
  },

  // ------------------------------------------------------------------ Arm
  jointMass: {
    what: 'Mass of the joint itself: motor, gearbox and housing, treated as a point at the joint centre.',
    why: 'Every joint’s weight loads all the joints closer to the base.',
    up: 'More torque on every joint inboard of this one.',
    down: 'Less torque inboard. Keep heavy motors close to the base where you can.',
    typical: '100 to 800 g. Placeholders until you have CAD masses.',
  },
  barMass: {
    what: 'Mass of the link from this joint to the next one, spread evenly along it.',
    why: 'Link weight acts at the middle of the link, so it loads every joint inboard of it.',
    up: 'More torque on the joints behind it.',
    down: 'Less torque: lighter links (pockets, tubes) help the shoulder most.',
    typical: '40 to 120 g.',
  },
  barLength: {
    what: 'Centre-to-centre length of the link from this joint to the next one.',
    why: 'Length is the lever arm: everything beyond it pushes harder on the joints behind it.',
    up: 'More reach, but torque on the inboard joints rises about in step with length.',
    down: 'Less reach, but lower torques and a stiffer arm.',
    typical: '80 to 230 mm.',
  },
  toolMass: {
    what: 'Mass of the tool or gripper from the last joint to the tip, spread evenly along it.',
    why: 'It sits at the far end of the arm, so it has the longest lever on every joint.',
    up: 'More torque on every joint.',
    down: 'Less torque everywhere: a light gripper pays off the most.',
    typical: '40 to 100 g.',
  },
  toolLength: {
    what: 'Length of the tool or gripper from the last joint to the tip, where the payload is held.',
    why: 'It extends the lever arm of the payload on every joint.',
    up: 'More reach, but more torque on every joint.',
    down: 'Lower torques.',
    typical: '50 to 150 mm.',
  },
  baseColumnLength: {
    what: 'Height from the turntable up to the shoulder axis.',
    why: 'This part sits on the base axis, so it adds height but no gravity torque or turning inertia.',
    up: 'More height for the arm to work in.',
    down: 'A more compact base. 0 puts the shoulder right on the turntable.',
    typical: '0 to 50 mm.',
  },
  baseColumnMass: {
    what: 'Mass of the turntable top plate and shoulder bracket.',
    why: 'It sits on the base axis, so it only adds load on the base bearing.',
    up: 'More load on the yaw bearing.',
    down: 'Less load on the yaw bearing.',
    typical: '40 to 120 g.',
  },
  jointName: {
    what: 'Your label for the joint, shown after its number everywhere (for example "J2 shoulder").',
    typical: 'shoulder, elbow, wrist.',
  },
  jointMotion: {
    what: 'How the joint moves. Base yaw turns the arm about a vertical axis. Pitch bends up and down. Roll twists along the link.',
    why: 'Each motion feels gravity differently, so it changes the worst-case torque the joint must carry.',
    typical: 'Base yaw first, then pitch joints, with a roll in the forearm.',
  },
  jointDrive: {
    what: 'Cycloidal: the joint gets a gearbox with checks, an advisor and DXF export. Servo: a direct-drive servo, where you only get the torque it must deliver.',
    why: 'Small, light joints near the tip are often easier with a hobby servo.',
    typical: 'Cycloidal for heavy joints, servo for the wrist.',
  },
  jointCount: {
    what: 'Degrees of freedom: one per joint, 1 to 8.',
    why: 'More joints give the arm more ways to reach a point, but add weight and torque on the base joints.',
    typical: '5 for the default arm.',
  },
  payload: {
    what: 'Mass carried at the tool tip.',
    why: 'It has the longest lever of anything on the arm, so it affects every joint.',
    up: 'More torque on every pitch joint, roughly weight × reach.',
    down: 'Lower torques everywhere.',
    typical: '250 g placeholder.',
  },
  linkOffset: {
    what: 'How far the link’s load sits from this joint’s output bearing, measured along the joint axis.',
    why: 'An offset load tries to tilt the output bearing, which needs a wider or bigger bearing to resist.',
    up: 'A bigger tilting moment on the joint’s output bearing.',
    down: 'Less tilting: mount the link as close to the bearing as you can.',
    typical: '15 mm placeholder.',
  },
  alpha: {
    what: 'The fastest angular acceleration you want from this joint.',
    why: 'Speeding up or stopping the arm takes extra torque on top of holding it against gravity.',
    up: 'Snappier moves, but more torque needed.',
    down: 'Gentler moves that need less torque.',
    typical: '3 rad/s².',
  },
  SF: {
    what: 'Service factor: how much the peak (design) torque exceeds the everyday torque.',
    why: 'It covers bumps, stalls, sudden stops and model error.',
    up: 'More safety margin, but bigger gearboxes.',
    down: 'Lighter, smaller gearboxes with less margin for the unexpected.',
    typical: '1.5.',
    formula: 'T_des = max(SF × T_req, T_des floor)',
  },
  TdesFloor: {
    what: 'The smallest design torque any gearbox is checked for, even when the model says less.',
    why: 'Tiny modelled torques (wrist, base yaw) would otherwise give flimsy gearboxes that break on the first bump.',
    up: 'Sturdier small joints.',
    down: 'Smaller gearboxes on lightly loaded joints.',
    typical: '1.0 N·m.',
  },
  ovTreq: {
    what: 'Type a working torque to replace the arm model for this joint. Leave it empty to use the model.',
    typical: 'Empty.',
  },
  ovTdes: {
    what: 'Type a design torque to replace the computed one for this joint. Leave it empty to use the service factor and floor.',
    typical: 'Empty.',
  },
  poseAngle: {
    what: 'The joint’s angle in the 3D view. It only changes the pose shown and the loads at that pose; the checks always use the worst case.',
    typical: 'Use the presets, or drag the joint in the view.',
  },
  drawingPose: {
    what: 'Ready shows the arm as it usually sits (upper arm up, forearm out). Straight out shows the worst-case pose the torques are computed for.',
    typical: 'Ready.',
  },
  cameraView: {
    what: 'Turns the 3D view to a standard direction. It only changes how you look at the arm, not the arm or its loads.',
    typical: 'Side, which matches the schematic. Drag the background to orbit freely.',
  },
  discTheta: {
    what: 'Input (motor) shaft angle for the disc drawing and the charts. It only changes the view, not the checks, which cover a full turn.',
    typical: 'Drag it, or press Play to animate.',
  },
  poseLimits: {
    what: 'Optional range of motion for the joint. Dragging, presets and the sweep stay inside it.',
    why: 'It matches the 3D view to what your hardware can actually reach.',
    typical: '±180° (no limit).',
  },

  // ------------------------------------------------------------------ Motor and recommended ratio
  motorPreset: {
    what: 'Fills the motor fields with typical values for a common stepper motor. Pick Custom to type your own.',
    typical: 'Typical values only: check your motor’s datasheet.',
  },
  motorPeak: {
    what: 'The most torque the motor can put out (stepper: holding torque; servo: stall torque).',
    why: 'The gearbox multiplies it, so it decides how big a ratio the joint needs.',
    up: 'A stronger motor needs a lower ratio, so the joint can move faster.',
    down: 'A weaker motor needs a higher ratio, so the joint gets slower.',
    typical: 'NEMA 17: about 0.26 to 0.6 N·m. NEMA 23: about 1 to 3 N·m.',
    formula: 'ratio ≥ T_des ÷ (efficiency × peak torque)',
  },
  motorCont: {
    what: 'Torque the motor can hold continuously without overheating. Optional.',
    why: 'A motor working at its peak all day overheats, so the everyday torque must fit under this.',
    up: 'Less likely to push the ratio up.',
    down: 'May need a higher ratio so the motor runs cool.',
    typical: 'Often 50 to 70% of the peak torque.',
  },
  motorSpeed: {
    what: 'Top speed of the motor shaft.',
    why: 'The gearbox divides speed by the ratio, so this caps how high the ratio can go and still meet the joint speed.',
    up: 'Allows a higher ratio. Steppers lose torque quickly above about 500 to 1,000 rpm.',
    down: 'Caps the ratio lower.',
    typical: '1,000 rpm for a stepper.',
  },
  motorReqSpeed: {
    what: 'How fast the joint must turn at its output.',
    why: 'A faster joint limits how much reduction you can use.',
    up: 'Caps the ratio lower, so you may need a stronger motor.',
    down: 'Allows a higher ratio and a smaller motor.',
    typical: '30 to 180 deg/s for a hobby arm.',
  },
  motorEta: {
    what: 'Efficiency: the share of motor torque that reaches the output after friction in the gearbox.',
    why: 'Friction eats some torque, so the ratio must be a little higher than torque alone suggests.',
    up: 'A lower recommended ratio.',
    down: 'A higher recommended ratio.',
    typical: '0.85 (a single cycloidal stage is about 0.75 to 0.9).',
  },
  servoPeak: {
    what: 'Peak (stall) torque of the servo. It is compared with the design torque.',
    why: 'A direct-drive servo has no gearbox to multiply its torque.',
    typical: 'At least the design torque.',
  },
  servoCont: {
    what: 'Rated (continuous) torque of the servo. It is compared with the working torque.',
    typical: 'At least the working torque.',
  },
  recRatio: {
    what: 'The smallest cycloidal ratio your motor can drive this joint with, and still be fast enough if you gave speeds.',
    why: 'Using the lowest ratio that works keeps the joint as fast as possible.',
    typical: 'Single stages usually run 11:1 to 25:1; above about 40:1 is a stretch.',
  },
  motorMargin: {
    what: 'Torque the motor can deliver through the recommended ratio, divided by the torque the joint needs.',
    why: 'Above 1 the motor is strong enough.',
    typical: 'Slightly above 1.0, because the ratio is rounded up to a whole pin count.',
  },
  motorOverload: {
    what: 'At full current the motor can push more torque through the gearbox than it was designed for.',
    why: 'A stall or crash could then overload the gearbox. Limiting the driver current (torque follows current) prevents it.',
    typical: 'Set the driver current limit to the value shown.',
  },

  // ------------------------------------------------------------------ Advisor
  target: {
    what: 'How close to its limit any check may get in the advisor’s designs (1.0 = right at the limit).',
    why: 'Margin covers manufacturing errors and loads you did not model.',
    up: 'Smaller gearboxes that run closer to their limits.',
    down: 'More margin, but bigger gearboxes.',
    typical: '0.85. Range 0.70 to 1.00.',
  },
  advWall: {
    what: 'Housing wall thickness the advisor adds outside the outer pins when it ranks designs by size.',
    typical: '4 mm.',
  },
  Dmin: {
    what: 'Smallest pin circle diameter the advisor may propose.',
    typical: '30 mm.',
  },
  Dmax: {
    what: 'Largest pin circle diameter the advisor may propose.',
    typical: '150 mm.',
  },
  minPinClearance: {
    what: 'Smallest gap allowed between neighbouring outer pins.',
    why: 'Pins packed edge to edge leave no room for the housing or for cutting tolerances.',
    up: 'Easier to build, but fewer small designs qualify.',
    down: 'More compact designs, but tighter to manufacture.',
    typical: '1 mm.',
  },
  altWindowMm: {
    what: 'How far above the smallest housing the advisor looks for the lightest and the most-margin alternatives.',
    up: 'More choice of alternatives.',
    down: 'Alternatives stay close to the smallest size.',
    typical: '15 mm.',
  },
};

/** Design Advisor lock rows: what locking does for each design variable. */
export const LOCK_HELP: Record<string, HelpEntry> = {
  Zp: {
    what: 'Gear ratio (outer pin count). Lock it to keep the ratio your motor needs. Free tries 12 to 26 pins (slower). From motor tries only the ratios your motor can drive.',
    why: 'The ratio sets torque multiplication and joint speed, so you usually lock it.',
    typical: 'Locked at the current ratio.',
  },
  D: {
    what: 'Pin circle diameter, the main size of the gearbox. Lock it if the housing size is fixed; free lets the advisor find the smallest that passes.',
    typical: 'Free: 30 to 150 mm.',
  },
  e: {
    what: 'Eccentricity. Lock it to keep a disc profile you already cut; free lets the advisor pick the best lobe shape.',
    typical: 'Free: K1 from 0.40 to 0.85.',
  },
  outerPin: {
    what: 'Outer pin size. Lock it to the bolts and bushings you have on hand; free lets the advisor pick from standard sizes.',
    typical: 'Free: 3 to 10 mm.',
  },
  innerPin: {
    what: 'Inner pin (standoff) size. Lock it to the standoffs you have; free lets the advisor pick from standard sizes.',
    typical: 'Free: 4.5 to 10 mm.',
  },
  Zw: {
    what: 'Inner pin count. Lock it to match an existing output plate; free tries 4 to 10.',
    typical: 'Free.',
  },
  L: {
    what: 'Disc thickness. Lock it to the plate you have; free tries standard stock sizes.',
    typical: 'Free.',
  },
  discs: {
    what: 'One or two discs. Lock it to keep the stack you planned; free tries both.',
    typical: 'Free.',
  },
  bearing: {
    what: 'Eccentric bearing. Lock it to a bearing you already have; free tries the ultra-thin 67xx, thin 618xx and standard 60xx sizes. Ratings are approximate.',
    typical: 'Free.',
  },
  maxHousingOD: {
    what: 'Optional largest housing outside diameter. The advisor only considers designs that fit inside it.',
    why: 'Use it when the gearbox has to fit an existing arm or enclosure.',
    typical: 'No limit.',
  },
};

/** DXF export options. */
export const DXF_HELP: Record<string, HelpEntry> = {
  units: {
    what: 'Units written into the DXF file.',
    why: 'Your CAM or CAD program reads this to scale the drawing.',
    typical: 'mm for most waterjet and laser shops.',
  },
  profileClearance: {
    what: 'Shrinks the disc outline slightly so it runs freely against the outer pins.',
    why: 'A disc cut exactly to the theoretical profile can bind, and cutting is never perfect.',
    up: 'Freer running and room for cutting error, but more backlash (play) at the output.',
    down: 'Less backlash, but the disc may bind or need hand fitting.',
    typical: '0.05 to 0.15 mm for a free-running disc. 0 cuts the exact profile.',
  },
  resolution: {
    what: 'How finely the curved disc outline is broken into straight segments.',
    why: 'Too coarse leaves visible flats; too fine makes large files that some CAM tools choke on.',
    up: 'A smoother profile, but bigger files.',
    down: 'Smaller files, but small flats on the lobes.',
    typical: '120 points per lobe (well under 0.005 mm error).',
  },
  discHoleClearance: {
    what: 'Extra diameter added to the disc’s centre bore and inner pin holes.',
    why: 'A press-fit bearing needs 0; a slip fit or a rough cut needs a little extra.',
    up: 'Easier assembly, but looser fits and more play.',
    down: 'Tighter fits.',
    typical: '0 mm.',
  },
  pinHoleClearance: {
    what: 'Extra diameter on the bolt and pin holes in the housing and output plates, and inside the bushings.',
    why: 'Bolts need a little room to slide in.',
    up: 'Easier assembly, but pins can shift and add play.',
    down: 'More precise pin positions, but tight to assemble.',
    typical: '0.2 mm (M3 bolt: 3.2 mm hole).',
  },
  shaftDia: {
    what: 'Diameter of the input shaft hole through the eccentric cam.',
    why: 'It has to fit your motor shaft while leaving a solid wall to the bearing seat.',
    up: 'Fits a bigger shaft, but thins the cam wall.',
    down: 'A thicker cam wall.',
    typical: '5 mm. Keep at least 1 mm of wall.',
  },
  bearingBore: {
    what: 'Inner diameter of the eccentric bearing, which is the outside of the cam. Leave it empty to use the catalog value.',
    typical: '10 mm for a 61800 bearing.',
  },
  housingCentre: {
    what: 'Optional hole through the middle of the housing plate, for the input shaft or a support bearing.',
    typical: 'Off.',
  },
  plateOutline: {
    what: 'Outside diameter of the output and tie plates. Leave it empty for an automatic size around the inner pins.',
    up: 'More material around the pin holes.',
    down: 'A lighter plate.',
    typical: 'About 10 to 25% smaller than the housing.',
  },
  outputCentre: {
    what: 'Optional hole through the middle of the output and tie plates.',
    typical: 'Off.',
  },
};

/** One plain sentence under each page title. */
export const STEP_HINTS: Record<number, string> = {
  1: 'Build your arm: add or remove joints, give each a motion type, then enter masses and lengths. The torque each joint must carry is worked out as you type.',
  2: 'Pick a joint, then set its geometry and materials. The verdict and every check update as you type.',
  3: 'Find the smallest gearbox that passes every check for the selected joint.',
  4: 'Every gearbox joint checked side by side. Design opens the advisor for that joint.',
};
