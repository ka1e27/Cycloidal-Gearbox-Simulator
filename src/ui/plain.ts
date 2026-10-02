import type { Check, CheckId, GearboxResult } from '../calc';
import { util as fmtUtil } from './format';

/** Plain-language names and explanations of the failure modes. */
export const PLAIN: Record<CheckId, { name: string; problem: string; fix: string }> = {
  ringContactStrength: {
    name: 'ring-pin contact strength',
    problem: 'the ring pins press on the disc lobes harder than the aluminum can take at peak torque, so the lobes could dent or yield',
    fix: 'Increase the disc thickness or pin diameter, use a stronger disc material, or lower the design torque.',
  },
  ringContactLife: {
    name: 'ring-pin contact fatigue',
    problem: 'the contact stress between ring pins and lobes is above the fatigue limit, so the lobes may pit or wear out early',
    fix: 'Increase the disc thickness or pin diameter, grow the gearbox, or use a stronger disc material.',
  },
  innerContactStrength: {
    name: 'output-hole contact strength',
    problem: 'the output pins press on the holes in the disc harder than the material can take at peak torque',
    fix: 'Use larger or more output pins, a thicker disc or a stronger material.',
  },
  innerContactLife: {
    name: 'output-hole contact fatigue',
    problem: 'the contact stress at the output-pin holes is above the fatigue limit',
    fix: 'Use larger or more output pins, a thicker disc or a stronger material.',
  },
  ligamentBore: {
    name: 'wall between holes and centre bore',
    problem: 'the wall between the output holes and the centre bore is thinner than the minimum',
    fix: 'Use a smaller bearing, a smaller eccentricity or a larger pin circle.',
  },
  ligamentHoles: {
    name: 'web between output holes',
    problem: 'the web between neighbouring output holes is thinner than the minimum',
    fix: 'Use fewer or smaller output pins, or a smaller eccentricity.',
  },
  ligamentRoot: {
    name: 'wall to the lobe root',
    problem: 'the output holes come too close to the lobe root (Rw is overridden)',
    fix: 'Reduce the Rw override or clear it so the app places the pins automatically.',
  },
  cusp: {
    name: 'profile cusp / undercut',
    problem: 'the disc profile pinches into a cusp, so the lobes cannot be cut cleanly and the pins would not roll correctly',
    fix: 'Reduce K1 (smaller eccentricity or fewer pins on this circle) or use smaller outer pins.',
  },
  boltBending: {
    name: 'outer pin bending',
    problem: 'the outer pins would bend more than the fatigue limit allows',
    fix: 'Use a larger bolt, a stiffer pin, or shorten the span (thinner disc, smaller gap).',
  },
  standoffBending: {
    name: 'inner pin bending',
    problem: 'the output standoffs would bend more than the limit allows',
    fix: 'Use a larger standoff, more output pins, or a stronger material, or bolt the pin ends to a tie ring.',
  },
  bearingStatic: {
    name: 'eccentric bearing static load',
    problem: 'the peak load on the eccentric bearing is above its static rating C0',
    fix: 'Use a larger bearing, add a second disc, or lower the design torque.',
  },
  bearingLife: {
    name: 'eccentric bearing life',
    problem: 'the eccentric bearing would wear out before the required life',
    fix: 'Use a bigger bearing, add a second disc, lower the speed or lower the working torque.',
  },
};

export function plainName(c: Check): string {
  return PLAIN[c.id]?.name ?? c.label;
}

export function verdictHeadline(r: GearboxResult): { title: string; text: string } {
  const g = r.governing;
  if (!r.valid || !g) return { title: 'INVALID', text: 'The inputs cannot be computed yet.' };
  const p = PLAIN[g.id];
  const u = fmtUtil(g.utilization);
  if (r.verdict === 'pass') {
    return {
      title: 'PASS',
      text: `Every check is within its green limit. The tightest is ${p.name} at ${u} of its limit.`,
    };
  }
  if (r.verdict === 'marginal') {
    return {
      title: 'MARGINAL',
      text: `Holds on paper but with little margin. Governing mode: ${p.name} at ${u} of its limit.`,
    };
  }
  const over = g.kind === 'max' ? `${u}× its limit` : `utilization ${u}, it falls short of its minimum`;
  return {
    title: 'FAIL',
    text: `Governing failure mode: ${p.name} (${over}). ${capitalize(p.problem)}.`,
  };
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
