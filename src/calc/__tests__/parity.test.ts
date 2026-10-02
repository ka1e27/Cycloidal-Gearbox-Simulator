// Numerical parity between the TypeScript engine and
//   (a) reference/cycloidal_disc_check.py (unit values and every scaled number the script prints), and
//   (b) an independent Python implementation of the SPEC.md checks the script does not have
//       (scripts/parity/spec_checks.py: ligament between holes, bolt / standoff limits, bearing, mass,
//       utilization, status thresholds, verdict, and the inner pins tied by a floating ring: bolted / pinned tips).
// The cases and the Python numbers live in scripts/parity/fixture.json (seeded, regenerate with
// `npm run parity:gen`, see scripts/parity/README.md). Tolerance: 1e-6 relative.
// `npm run parity` sets PARITY_REPORT=1 to print the per-quantity error table and the joint printout.

import { describe, expect, it } from 'vitest';
import { checkGearbox, createGearboxModel, defaultGearboxInputs, solveMinimumSize } from '../index';
import type { CheckId, GearboxInputs, GearboxResult } from '../index';
import fixtureJson from '../../../scripts/parity/fixture.json';
import solverFixtureJson from '../../../scripts/parity/solver_fixture.json';

// ------------------------------------------------------------------------------------------ fixture types
interface Mat { E: number; nu: number; Sy: number; sigmaF: number; density: number; kind: 'metal' | 'polymer' }
interface FixtureCase {
  id: number;
  tag: string;
  g: 'A' | 'B';
  x: Record<string, unknown>;
  u: {
    p0r: number; Fr: number; p0w: number; Fw: number; Fb: number; Rw: number; dh: number; ligB: number; ligH: number; Rroot: number;
    /** tied-standoff peak bending moment per N*m on one disc (Kc = 1), N*mm: bolted ring / pinned tips */
    Mc: number; Mp: number;
  };
  ex: { rho: number | null; cusp: boolean; under: boolean; area: number };
  spec: {
    checks: Record<string, [number | null, number, string]>;
    /** maxUnc is written only when it differs from maxU, cuspFlag only when true (keeps the fixture small) */
    verdict: string; maxU: number; maxUnc?: number; cuspFlag?: boolean; mass: number; housingOD: number;
    boltFix: number; soCant: number; share: number;
  };
  ref?: {
    ring_s: number; ring_l: number; in_s: number; in_l: number; Fr_pk: number; Fw_pk: number;
    bolt_lo: number; bolt_hi: number; so_tie: number; so_cant: number; Fb_pk: number; L10h: number;
    ok460: boolean; okExact: boolean; cusp: boolean; limHit: boolean;
  };
}
interface Fixture { meta: { seed: number; cases: number; reference_printout: string; limits: { P_STATIC: number; P_LIFE: number } }; cases: FixtureCase[] }
const fixture = fixtureJson as unknown as Fixture;
interface SolverFixtureCase {
  name: string; over: Record<string, number>; floorD: number | null; floorK1: number | null;
  minD: number | null; bestK1: number | null; bestE: number | null; bestScore: number | null; noSolution: boolean;
  undercutOnlySkips: number;
}
const solverFixture = solverFixtureJson as unknown as { cases: SolverFixtureCase[] };

const REL_TOL = 1e-6;
const THRESHOLDS = [0.85, 1.0];

// ------------------------------------------------------------------------------------------ input mapping
function buildInputs(x: Record<string, any>): GearboxInputs { // eslint-disable-line @typescript-eslint/no-explicit-any
  const o = defaultGearboxInputs();
  for (const k of ['Zp', 'Zw', 'D', 'e', 'L', 'rr', 'rw', 'Db', 'tMin', 'discs', 'gap', 'wall', 'Treq', 'Tdes', 'Kc', 'KcLife', 'discShare', 'rpm', 'reqLifeH'] as const) {
    if (k in x) (o as unknown as Record<string, unknown>)[k] = x[k];
  }
  if (typeof x.innerPinSupport === 'string') o.innerPinSupport = x.innerPinSupport as GearboxInputs['innerPinSupport'];
  if (x.bearing) o.bearing = { name: 'fixture', C: x.bearing.C, C0: x.bearing.C0 };
  if (x.discMat) o.discMaterial = { ...(x.discMat as Mat) };
  if (x.outerPin) {
    const p = x.outerPin;
    o.outerPin = { construction: p.kind, shankDia: p.shank, boltYield: p.yield, material: { ...(p.mat as Mat) } };
  }
  if (x.innerPin) {
    const p = x.innerPin;
    o.innerPin = { construction: p.kind, od: p.od, bore: p.bore, standoffYield: p.yield, material: { ...(p.mat as Mat) } };
  }
  return o;
}

// ------------------------------------------------------------------------------------------ error bookkeeping
interface Stat { max: number; id: number; tag: string; n: number }
const stats = new Map<string, Stat>();
const failures: string[] = [];

function relErr(got: number, want: number): number {
  if (got === want) return 0;
  return Math.abs(got - want) / Math.max(Math.abs(want), 1e-9);
}

function cmp(name: string, c: FixtureCase, got: number, want: number | null) {
  const w = want === null ? Infinity : want;
  const err = Number.isFinite(w) && Number.isFinite(got) ? relErr(got, w) : (got === w ? 0 : Infinity);
  let s = stats.get(name);
  if (!s) { s = { max: 0, id: -1, tag: '', n: 0 }; stats.set(name, s); }
  s.n++;
  if (err >= s.max) { s.max = err; s.id = c.id; s.tag = c.tag; }
  if (!(err <= REL_TOL)) failures.push(`case ${c.id} [${c.tag}] ${name}: ts ${got} vs py ${w} (rel ${err.toExponential(2)})`);
}

const STATUS: Record<string, string> = { ok: 'o', marginal: 'm', fail: 'f' };

const SUBSET: CheckId[] = ['ringContactStrength', 'ringContactLife', 'innerContactStrength', 'innerContactLife', 'ligamentBore', 'cusp'];
const unexplainedVerdict: string[] = [];
const explainedVerdict: string[] = [];
let verdictCompared = 0;

// ------------------------------------------------------------------------------------------ run everything once
const results = new Map<number, GearboxResult>();
for (const c of fixture.cases) {
  const inp = buildInputs(c.x);
  const r = checkGearbox(inp);
  results.set(c.id, r);
  if (!r.valid) { failures.push(`case ${c.id} [${c.tag}] engine returned invalid: ${r.errors.join('; ')}`); continue; }

  // ---- unit values (identical geometry / E* for group A; load-independent ones for B)
  cmp('unit F_ring', c, r.unit.FRing, c.u.Fr);
  cmp('unit F_in', c, r.unit.FInner, c.u.Fw);
  cmp('unit Fb (bearing)', c, r.unit.Fb, c.u.Fb);
  cmp('Rw', c, r.derived.Rw, c.u.Rw);
  cmp('hole dia dh', c, r.derived.dh, c.u.dh);
  cmp('R_root', c, r.derived.Rroot, c.u.Rroot);
  cmp('ligament to bore', c, r.derived.ligBore, c.u.ligB);
  cmp('ligament between holes', c, r.derived.ligHoles, c.u.ligH);
  if (c.ex.rho !== null && !c.ex.under) cmp('min convex rho_a', c, r.unit.rhoMinConvex, c.ex.rho);
  cmp('unit standoff moment, bolted ring', c, r.unit.MRingClamped, c.u.Mc);
  cmp('unit standoff moment, pinned tips', c, r.unit.MRingPinned, c.u.Mp);
  if (c.g === 'A') {
    cmp('unit p0_ring', c, r.unit.p0Ring, c.u.p0r);
    cmp('unit p0_in', c, r.unit.p0Inner, c.u.p0w);
  }

  // ---- reference-scaled numbers (group A: reference hard-codes match the engine defaults)
  if (c.ref) {
    const f = c.ref;
    cmp('ring strength p0', c, r.loads.p0RingStrength, f.ring_s);
    cmp('ring life p0', c, r.loads.p0RingLife, f.ring_l);
    cmp('inner strength p0', c, r.loads.p0InnerStrength, f.in_s);
    cmp('inner life p0', c, r.loads.p0InnerLife, f.in_l);
    cmp('peak ring pin force', c, r.loads.FRingPeak, f.Fr_pk);
    cmp('peak inner pin force', c, r.loads.FInnerPeak, f.Fw_pk);
    cmp('bolt bending fixed-fixed', c, r.loads.boltBendingFixed, f.bolt_lo);
    cmp('bolt bending simply supported', c, r.loads.boltBendingSimple, f.bolt_hi);
    cmp('standoff bending tie ring', c, r.loads.standoffBendingTie, f.so_tie);
    cmp('standoff bending cantilever', c, r.loads.standoffBendingCantilever, f.so_cant);
    cmp('bearing peak load', c, r.loads.bearingPeak, f.Fb_pk);
    cmp('bearing L10h', c, r.loads.L10h, f.L10h);

    // Reference PASS/FAIL (contact + ligament-to-bore + cusp) vs the same subset of TS checks.
    const tsPass = r.checks.filter((k) => SUBSET.includes(k.id)).every((k) => k.status !== 'fail');
    const undercutOnly = c.ex.under && !f.cusp; // deliberate: TS also flags an undercut as cusp
    const window = /-1\.5e-9/.test(c.tag);       // t_min - 1.5e-9: script tolerance 1e-9 mm vs TS 1e-9 relative
    verdictCompared++;
    if (tsPass !== f.okExact) {
      (undercutOnly || window ? explainedVerdict : unexplainedVerdict)
        .push(`case ${c.id} [${c.tag}] vs exact limits: ts ${tsPass} py ${f.okExact}${undercutOnly ? ' (undercut)' : ''}${window ? ' (1e-9 window)' : ''}`);
    }
    if (tsPass !== f.ok460) {
      const why = f.limHit ? ' (p0 between the script\'s 460/240 and the SPEC 460.92/240.03)' : '';
      (undercutOnly || window || f.limHit ? explainedVerdict : unexplainedVerdict)
        .push(`case ${c.id} [${c.tag}] vs script limits 460/240: ts ${tsPass} py ${f.ok460}${why}${undercutOnly ? ' (undercut)' : ''}`);
    }
  }

  // ---- independent SPEC implementation: every check, utilization, status
  const sp = c.spec;
  const cusped = sp.cuspFlag === true;
  const maxUnc = sp.maxUnc ?? sp.maxU;
  for (const chk of r.checks) {
    const e = sp.checks[chk.id];
    if (!e) { failures.push(`case ${c.id} [${c.tag}] unexpected check ${chk.id}`); continue; }
    const [val, util, st] = e;
    if (chk.id === 'cusp') {
      // value = min convex rho; utilization/status are special when flagged (SPEC only says: none allowed)
      if (cusped) {
        if (chk.status !== 'fail') failures.push(`case ${c.id} [${c.tag}] cusp not failed`);
        continue;
      }
      cmp('check cusp value', c, chk.value, val);
      cmp('check cusp utilization', c, chk.utilization, util);
      continue;
    }
    cmp(`check ${chk.id} value`, c, chk.value, val);
    cmp(`check ${chk.id} utilization`, c, chk.utilization, util);
    const nearThreshold = THRESHOLDS.some((t) => Math.abs(util - t) < 1e-7);
    if (!nearThreshold && STATUS[chk.status] !== st) failures.push(`case ${c.id} [${c.tag}] ${chk.id} status ${chk.status} vs py ${st} (util ${util})`);
  }
  if (r.checks.length !== Object.keys(sp.checks).length) failures.push(`case ${c.id} [${c.tag}] check count ${r.checks.length}`);
  cmp('bolt bending fixed-fixed (SPEC)', c, r.loads.boltBendingFixed, sp.boltFix);
  cmp('standoff cantilever (SPEC)', c, r.loads.standoffBendingCantilever, sp.soCant);
  cmp('standoff tie ring heuristic cantilever / 2 (SPEC)', c, r.loads.standoffBendingTie, sp.soCant / 2);
  if (r.innerPinSupport !== ((c.x.innerPinSupport as string | undefined) ?? 'ringClamped')) {
    failures.push(`case ${c.id} [${c.tag}] inner pin support ${r.innerPinSupport}`);
  }
  cmp('disc mass (total g)', c, r.mass.total_g, sp.mass);
  cmp('housing OD', c, r.derived.housingOD, sp.housingOD);
  cmp('disc share', c, r.derived.share, sp.share);
  if (cusped) {
    if (r.verdict !== 'fail') failures.push(`case ${c.id} [${c.tag}] cusp flagged but verdict ${r.verdict}`);
    if (r.maxUtilization < maxUnc * (1 - 1e-6)) failures.push(`case ${c.id} [${c.tag}] maxUtilization below other checks`);
    if (r.cusp !== true) failures.push(`case ${c.id} [${c.tag}] result.cusp false but py flags cusp/undercut`);
  } else {
    cmp('max utilization', c, r.maxUtilization, sp.maxU);
    if (!THRESHOLDS.some((t) => Math.abs(sp.maxU - t) < 1e-7) && r.verdict !== sp.verdict) {
      failures.push(`case ${c.id} [${c.tag}] verdict ${r.verdict} vs py ${sp.verdict}`);
    }
    if (r.cusp !== false) failures.push(`case ${c.id} [${c.tag}] result.cusp true but py has none`);
  }
}

// Debugging aid: PARITY_DEBUG=13,132 prints the full TS result next to the fixture entry for those case ids.
const DEBUG_IDS = (((globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PARITY_DEBUG) ?? '')
  .split(',').filter(Boolean).map(Number);
for (const id of DEBUG_IDS) {
  const c = fixture.cases[id];
  const r = results.get(id)!;
  // eslint-disable-next-line no-console
  console.log(`DEBUG case ${id} [${c.tag}]
fixture: ${JSON.stringify(c)}
ts checks: ${JSON.stringify(r.checks.map((k) => [k.id, k.value, k.utilization, k.status]))}
ts max ${r.maxUtilization} verdict ${r.verdict} cusp ${r.cusp}`);
}

// ------------------------------------------------------------------------------------------ joint printout
function commas(n: number): string {
  const s = n.toFixed(0);
  return s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** Rebuild the reference script's printout for the four joints from the TS engine's numbers. */
function tsPrintout(): string {
  const { P_STATIC, P_LIFE } = fixture.meta.limits;
  const lines: string[] = [];
  const r0 = results.get(0)!;
  lines.push(`Zp=18 pins, ratio 17:1, disc 6.35 mm 6061-T6, E*=${r0.derived.EstarRing.toFixed(0)} MPa, Kc=2.0`);
  for (const c of fixture.cases.slice(0, 4)) {
    const name = c.tag.replace('joint ', '');
    const inp = buildInputs(c.x);
    const r = results.get(c.id)!;
    const pass = r.checks.filter((k) => SUBSET.includes(k.id)).every((k) => k.status !== 'fail');
    const l = r.loads, d = r.derived;
    lines.push('');
    lines.push(`${name}: pin circle ${inp.D} mm, e = ${inp.e} mm, K1 = ${d.K1.toFixed(2)}, discs = ${inp.discs}  -> ${pass ? 'PASS' : 'FAIL'}`);
    lines.push(`  ring pin contact p0: strength ${l.p0RingStrength.toFixed(0)} MPa (limit ${P_STATIC.toFixed(0)}), life ${l.p0RingLife.toFixed(0)} MPa (limit ${P_LIFE.toFixed(0)}), peak pin force ${l.FRingPeak.toFixed(0)} N`);
    lines.push(`  inner hole contact p0: strength ${l.p0InnerStrength.toFixed(0)}, life ${l.p0InnerLife.toFixed(0)} MPa, peak pin force ${l.FInnerPeak.toFixed(0)} N`);
    lines.push(`  inner pin circle radius ${d.Rw.toFixed(1)} mm, hole dia ${d.dh.toFixed(2)} mm, ligament to bore ${d.ligBore.toFixed(1)} mm, between holes ${d.ligHoles.toFixed(1)} mm`);
    lines.push(`  outer M3 bolt bending ${l.boltBendingFixed.toFixed(0)}-${l.boltBendingSimple.toFixed(0)} MPa (on 3.0 mm shank)`);
    lines.push(`  inner standoff bending ${l.standoffBendingTie.toFixed(0)} (with tie ring) to ${l.standoffBendingCantilever.toFixed(0)} MPa (cantilever)`);
    lines.push(`  eccentric bearing peak load ${l.bearingPeak.toFixed(0)} N, L10 ~${commas(l.L10h)} h at ${inp.rpm.toFixed(0)} rpm`);
  }
  return lines.join('\n');
}

const refLines = fixture.meta.reference_printout.replace(/\r/g, '').trim();
const tsLines = tsPrintout();

// ------------------------------------------------------------------------------------------ tests
describe('parity with reference/cycloidal_disc_check.py and the independent SPEC implementation', () => {
  it('fixture is large enough and covers both groups', () => {
    expect(fixture.cases.length).toBeGreaterThanOrEqual(300);
    expect(fixture.cases.filter((c) => c.g === 'A').length).toBeGreaterThanOrEqual(250);
    expect(fixture.cases.filter((c) => c.g === 'B').length).toBeGreaterThanOrEqual(30);
  });

  it('every case is valid in the engine', () => {
    expect(fixture.cases.filter((c) => !results.get(c.id)!.valid).map((c) => c.id)).toEqual([]);
  });

  it('every compared number agrees within 1e-6 relative', () => {
    expect(failures.slice(0, 40)).toEqual([]);
  });

  it('the reference printout of the four joints is reproduced by the TS numbers (line by line)', () => {
    const a = refLines.split('\n'), b = tsLines.split('\n');
    expect(b).toEqual(a);
  });

  it('script PASS/FAIL (contact + ligament-to-bore + cusp) equals the TS subset verdict, except explained windows', () => {
    expect(verdictCompared).toBeGreaterThanOrEqual(250);
    expect(unexplainedVerdict).toEqual([]);
  });

  it('the explained verdict differences are exactly the documented ones', () => {
    // 460/240 (script) vs 460.92/240.03 (SPEC formulas): cases built inside that window; undercut cases.
    expect(explainedVerdict.some((s) => s.includes('script limits'))).toBe(true);
  });

  it('covers edge cases: near-cusp, ligament exactly at t_min, very small and very large K1', () => {
    const tags = fixture.cases.map((c) => c.tag).join('|');
    for (const t of ['cusp rho=0.3+0.1%', 'cusp rho=0.3-0.1%', 'undercut', 'ligBore exact', 'ligHoles exact', 'K1=0.05', 'K1=0.99', 'util boltBending',
      'util standoffBending', 'support ringPinned', 'support cantilever']) {
      expect(tags, t).toContain(t);
    }
    // the near-cusp pair really straddles the flag
    const above = fixture.cases.filter((c) => c.tag.startsWith('cusp rho=0.3+0.1%'));
    const below = fixture.cases.filter((c) => c.tag.startsWith('cusp rho=0.3-0.1%'));
    expect(above.length).toBeGreaterThan(3);
    expect(above.every((c) => !results.get(c.id)!.cusp)).toBe(true);
    expect(below.every((c) => results.get(c.id)!.cusp)).toBe(true);
  });
});


const solverCases = solverFixture.cases;
const solverTs = new Map<string, ReturnType<typeof solveMinimumSize>>();
for (const sc of solverCases) {
  const inp = { ...defaultGearboxInputs(), ...(sc.over as Partial<GearboxInputs>) } as GearboxInputs;
  solverTs.set(sc.name, solveMinimumSize(inp));
}

describe('model data is consistent with the checked numbers (chart sweep, per-theta pins)', () => {
  const sample = fixture.cases.filter((c) => c.id % 9 === 0);
  it('sweep maxima equal the headline loads', () => {
    for (const c of sample) {
      const r = results.get(c.id)!;
      const mx = (a: number[]) => a.reduce((m, v) => (v > m ? v : m), 0);
      expect(relErr(mx(r.sweep.p0Strength), r.loads.p0RingStrength), `case ${c.id} p0 strength`).toBeLessThan(1e-12);
      expect(relErr(mx(r.sweep.p0Life), r.loads.p0RingLife), `case ${c.id} p0 life`).toBeLessThan(1e-12);
      expect(relErr(mx(r.sweep.FPeak), r.loads.FRingPeak), `case ${c.id} F`).toBeLessThan(1e-12);
      expect(relErr(mx(r.sweep.bearingLoad), r.loads.bearingPeak), `case ${c.id} bearing`).toBeLessThan(1e-12);
    }
  });
  it('pinsAt(theta) at the sweep angles reproduces the sweep (forces exactly, p0 within profile-sample ambiguity)', () => {
    for (const c of sample.slice(0, 20)) {
      const inp = buildInputs(c.x);
      const m = createGearboxModel(inp);
      const r = m.result;
      const nth = r.resolution.nth;
      for (const t of [0, 7, 31, 60, 101, 177, nth - 1]) {
        const pins = m.pinsAt((2 * Math.PI * t) / nth)!;
        const fmax = Math.max(...pins.map((p) => p.force));
        expect(relErr(fmax, r.sweep.FPeak[t]), `case ${c.id} t=${t} force`).toBeLessThan(1e-9);
        const p0max = Math.max(...pins.map((p) => p.p0Strength));
        expect(relErr(p0max, r.sweep.p0Strength[t]), `case ${c.id} t=${t} p0`).toBeLessThan(5e-3);
      }
    }
  });
});

describe('minimum-size solver vs a Python brute force with the reference unit_case (full resolution everywhere)', () => {
  it('has the SPEC cases', () => {
    expect(solverCases.length).toBeGreaterThanOrEqual(8);
  });
  for (const sc of solverCases) {
    it(`${sc.name}: min D, best e, score and geometric floor agree`, () => {
      const r = solverTs.get(sc.name)!;
      expect(r.valid).toBe(true);
      expect(r.floorD, 'floor D').toBe(sc.floorD);
      expect(r.noSolution, 'noSolution').toBe(sc.noSolution);
      expect(r.minD, 'min D').toBe(sc.minD);
      if (!sc.noSolution) {
        expect(r.bestK1).toBeCloseTo(sc.bestK1!, 9);
        expect(relErr(r.bestE!, sc.bestE!)).toBeLessThan(1e-9);
        expect(relErr(r.bestScore!, sc.bestScore!)).toBeLessThan(1e-6);
      }
    });
  }
  it('the SPEC.md solver expectations hold (+/- 1 mm on D)', () => {
    const want: Record<string, [number | null, number | null]> = {
      'floor Db=19': [45, null], 'floor Db=24': [51, null], 'J3 1 disc': [63, 1.22], 'J3 2 discs': [47, null],
      J1: [47, null], J4: [45, null], 'J2 2 discs': [79, 1.65], 'J2 1 disc': [null, null],
    };
    for (const sc of solverCases) {
      const r = solverTs.get(sc.name)!;
      const [d, e] = want[sc.name];
      if (sc.name.startsWith('floor')) expect(Math.abs(r.floorD! - d!), sc.name).toBeLessThanOrEqual(1);
      else if (d === null) expect(r.noSolution, sc.name).toBe(true);
      else {
        expect(Math.abs(r.minD! - d), sc.name).toBeLessThanOrEqual(1);
        if (e !== null) expect(Math.abs(r.bestE! - e), `${sc.name} e`).toBeLessThanOrEqual(0.03);
      }
    }
  });
});

const REPORT = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PARITY_REPORT;
if (REPORT) {
  describe('parity report', () => {
    it('prints', () => {
      const rows = [...stats.entries()].sort((a, b) => b[1].max - a[1].max);
      const lines = rows.map(([k, s]) => `${k.padEnd(44)} n=${String(s.n).padStart(4)}  max rel err ${s.max.toExponential(2)}  (case ${s.id} ${s.tag})`);
      // eslint-disable-next-line no-console
      console.log(`\nPARITY: ${fixture.cases.length} cases (seed ${fixture.meta.seed})\n${lines.join('\n')}`);
      // eslint-disable-next-line no-console
      console.log(`\nVerdict subset compared on ${verdictCompared} cases; explained differences (${explainedVerdict.length}):\n${explainedVerdict.join('\n')}`);
      // eslint-disable-next-line no-console
      const spot = fixture.cases.filter((_, i) => i % 17 === 0).slice(0, 20);
      const rows20 = spot.map((c) => {
        const r = results.get(c.id)!;
        const ids = r.checks.map((k) => `${k.id.replace(/Contact|Bending|ligament/g, '').slice(0, 9)}=${k.utilization.toFixed(3)}/${c.spec.checks[k.id][1].toFixed(3)}`);
        return `#${String(c.id).padStart(3)} ${c.tag.padEnd(22)} ${r.verdict.padEnd(8)}(py ${c.spec.verdict.padEnd(8)}) mass ${r.mass.total_g.toFixed(1)}g/${c.spec.mass.toFixed(1)}g  ${ids.join(' ')}`;
      });
      // eslint-disable-next-line no-console
      console.log(`\n20 spot cases, utilization TS/py per check:\n${rows20.join('\n')}`);
      const srows = solverFixture.cases.map((sc) => {
        const r = solverTs.get(sc.name)!;
        return `${sc.name.padEnd(12)} ts: floor ${r.floorD} minD ${r.minD} e ${r.bestE?.toFixed(4)} score ${r.bestScore?.toFixed(4)} | py: floor ${sc.floorD} minD ${sc.minD} e ${sc.bestE?.toFixed(4)} score ${sc.bestScore?.toFixed(4)}`;
      });
      // eslint-disable-next-line no-console
      console.log(`\nsolver:\n${srows.join('\n')}`);
      // eslint-disable-next-line no-console
      console.log(`\n--- reference printout ---\n${refLines}\n--- TS printout ---\n${tsLines}`);
      expect(true).toBe(true);
    });
  });
}
