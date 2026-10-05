// Fix engine ("how to fix it"): single-variable changes that bring every check to <= 0.85.
import { describe, expect, it } from 'vitest';
import {
  BEARINGS, CalcClient, OUTER_PIN_OPTIONS, applyFix, checkGearbox, defaultGearboxInputs,
  discStockFor, motorUtilization, presetInputs, recommendRatio, suggestFixes, suggestFixesAsync,
  type Fix, type FixReport, type GearboxInputs, type MotorSpec, type WorkerResponse,
} from '../index';
import { createWorkerHandler } from '../workerCore';

const T = 0.85;
const full = (inp: GearboxInputs) => checkGearbox(inp);
const passes = (inp: GearboxInputs) => full(inp).maxUtilization <= T + 1e-9;
const strip = (r: FixReport) => ({ ...r, elapsedMs: 0 });

// a spread of designs that are not green
const CASES: Record<string, GearboxInputs> = {
  specJ2: defaultGearboxInputs(), // D 85, e 1.3, 1 disc, 5.85 / 8.8 N*m: FAIL on ring contact life
  def5: { ...defaultGearboxInputs(), Treq: 3.4, Tdes: 5 },
  j3D60: { ...presetInputs('J3'), D: 60, e: 1.0, Treq: 1.6, Tdes: 2.5 },
  j3D46: { ...presetInputs('J3'), D: 46, e: 0.75, Treq: 0.3, Tdes: 0.5 },
  j2: presetInputs('J2'),
};
const REPORTS: Record<string, FixReport> = Object.fromEntries(Object.entries(CASES).map(([k, v]) => [k, suggestFixes(v)]));

describe('fix engine', () => {
  it('a PASS design needs no fixes', () => {
    const inp = presetInputs('J1');
    expect(full(inp).verdict).toBe('pass');
    const r = suggestFixes(inp);
    expect(r.valid).toBe(true);
    expect(r.needed).toBe(false);
    expect(r.fixes).toEqual([]);
    expect(r.byCheck).toEqual([]);
  });

  it('invalid inputs give valid: false and no fixes', () => {
    const r = suggestFixes({ ...defaultGearboxInputs(), D: 5 });
    expect(r.valid).toBe(false);
    expect(r.errors.length).toBeGreaterThan(0);
    expect(r.fixes).toEqual([]);
  });

  it('every reported fix is verified: applying its patch gives the reported max utilization, governing and status', () => {
    let n = 0;
    for (const [name, rep] of Object.entries(REPORTS)) {
      expect(rep.valid, name).toBe(true);
      expect(rep.needed, name).toBe(true);
      for (const f of rep.fixes) {
        const r = full(applyFix(CASES[name], f));
        expect(r.valid, `${name} ${f.field}`).toBe(true);
        expect(r.maxUtilization, `${name} ${f.field}`).toBeCloseTo(f.newMaxUtil, 12);
        expect(r.governing!.label, `${name} ${f.field}`).toBe(f.governing);
        expect(f.passesTarget, `${name} ${f.field}`).toBe(r.verdict === 'pass');
        expect(f.passesLimit, `${name} ${f.field}`).toBe(r.verdict !== 'fail');
        // a fix always lowers what it claims to improve
        for (const id of f.improves) {
          const before = full(CASES[name]).checks.find((c) => c.id === id)!.utilization;
          expect(r.checks.find((c) => c.id === id)!.utilization, `${name} ${f.field} ${id}`).toBeLessThan(before);
        }
        n++;
      }
      // one fix per field at most, passing ones first
      const fields = rep.fixes.map((f) => f.field);
      expect(new Set(fields).size, name).toBe(fields.length);
      const firstHelp = rep.fixes.findIndex((f) => !f.passesTarget);
      if (firstHelp >= 0) expect(rep.fixes.slice(firstHelp).every((f) => !f.passesTarget), name).toBe(true);
    }
    expect(n).toBeGreaterThan(15);
  });

  it('monotone searches return the minimal passing value: the next value down fails', () => {
    let checked = 0;
    for (const [name, rep] of Object.entries(REPORTS)) {
      const inp = CASES[name];
      for (const f of rep.fixes.filter((x) => x.passesTarget)) {
        if (f.field === 'D') {
          const D = f.toValue!;
          expect(D % 0.5, name).toBeCloseTo(0, 9);
          // e scales with D to keep K1 (clamped 0.40..0.85)
          const K1 = Math.min(0.85, Math.max(0.4, (inp.e * inp.Zp) / (inp.D / 2)));
          const eOf = (Dv: number) => Math.round(((K1 * Dv) / 2 / inp.Zp) * 1e4) / 1e4;
          expect(f.patch.e, name).toBe(eOf(D));
          expect((f.patch.e! * inp.Zp) / (D / 2), name).toBeCloseTo(K1, 3);
          if (D - 0.5 > inp.D + 1e-9) { expect(passes({ ...inp, D: D - 0.5, e: eOf(D - 0.5) }), `${name} D ${D - 0.5}`).toBe(false); checked++; }
        }
        if (f.field === 'e') {
          const e = f.toValue!;
          const prev = Math.round((e + (f.direction === 'up' ? -0.01 : 0.01)) * 100) / 100;
          if (f.direction === 'up' ? prev > inp.e + 1e-9 : prev < inp.e - 1e-9) {
            expect(passes({ ...inp, e: prev }), `${name} e ${prev}`).toBe(false); checked++;
          }
        }
        if (f.field === 'L') {
          const stock = discStockFor(inp.discMaterial).filter((s) => s > inp.L + 1e-9);
          const k = stock.indexOf(f.toValue!);
          if (k > 0) { expect(passes({ ...inp, L: stock[k - 1] }), `${name} L ${stock[k - 1]}`).toBe(false); checked++; }
          if (f.exactMin != null) {
            expect(passes({ ...inp, L: f.exactMin }), `${name} exact L`).toBe(true);
            const below = Math.round((f.exactMin - 0.05) * 100) / 100;
            if (below > inp.L + 1e-9) { expect(passes({ ...inp, L: below }), `${name} L ${below}`).toBe(false); checked++; }
          }
        }
        if (f.field === 'rr') {
          const opts = OUTER_PIN_OPTIONS.filter((p) => p.od > 2 * inp.rr + 1e-9);
          const k = opts.findIndex((p) => p.od === f.toValue);
          if (k > 0) { expect(passes({ ...inp, rr: opts[k - 1].od / 2, outerPin: { ...inp.outerPin, shankDia: opts[k - 1].shank } })).toBe(false); checked++; }
        }
      }
    }
    expect(checked).toBeGreaterThanOrEqual(5);
  });

  it('is deterministic', () => {
    for (const name of ['specJ2', 'j3D46']) {
      expect(strip(suggestFixes(CASES[name]))).toEqual(strip(REPORTS[name]));
    }
  });

  it('patches keep coupled fields consistent (pin size sets rr + shank, bearing sets Db, material is a full set)', () => {
    for (const rep of Object.values(REPORTS)) {
      for (const f of rep.fixes) {
        const p = f.patch;
        if (f.field === 'rr') {
          const o = OUTER_PIN_OPTIONS.find((x) => x.od === 2 * p.rr!)!;
          expect(o).toBeDefined();
          expect(p.outerPin!.shankDia).toBe(o.shank);
        }
        if (f.field === 'bearing') {
          const b = BEARINGS.find((x) => x.name === p.bearing!.name)!;
          expect([p.Db, p.bearing!.C, p.bearing!.C0]).toEqual([b.OD, b.C, b.C0]);
        }
        if (f.field === 'discMaterial') expect(Object.keys(p.discMaterial!).sort()).toEqual(['E', 'Sy', 'density', 'form', 'kind', 'nu', 'sigmaF']);
        // never touches the torques or the ratio as a gearbox fix
        expect(p.Treq).toBeUndefined();
        expect(p.Tdes).toBeUndefined();
        if (f.field !== 'Zp') expect(p.Zp).toBeUndefined();
        expect(f.sideEffects.every((s) => typeof s === 'string' && s.length > 0)).toBe(true);
      }
    }
  });

  it('J2 SPEC case (D 85, e 1.3, 1 disc, 5.85 / 8.8 N*m): no single change gets to 0.85; L 12.7 mm, 7075 and 2 discs come closest', () => {
    const r0 = full(CASES.specJ2);
    expect(r0.verdict).toBe('fail');
    expect(r0.governing!.id).toBe('ringContactLife');
    const rep = REPORTS.specJ2;
    expect(rep.maxUtil).toBeCloseTo(1.362, 3);
    expect(rep.governingId).toBe('ringContactLife');
    expect(rep.fixes.some((f) => f.passesTarget)).toBe(false);
    const by = (field: Fix['field']) => rep.fixes.find((f) => f.field === field)!;
    // thicker disc: the 1/2 in plate reaches 0.96 (under 1.0)
    expect(by('L').toValue).toBe(12.7);
    expect(by('L').newMaxUtil).toBeCloseTo(0.963, 3);
    expect(by('L').passesLimit).toBe(true);
    // stronger disc material: 7075-T6, 1.007 (now ring contact strength governs)
    expect(by('discMaterial').to).toBe('Aluminum 7075-T6');
    expect(by('discMaterial').newMaxUtil).toBeCloseTo(1.007, 3);
    expect(by('discMaterial').governingId).toBe('ringContactStrength');
    // two discs: 1.010
    expect(by('discs').toValue).toBe(2);
    expect(by('discs').newMaxUtil).toBeCloseTo(1.010, 3);
    // a bigger D with e scaled to keep K1 0.55: 143 mm is the smallest that gets under 1.0 (0.998); none reaches 0.85 up to 150
    expect(by('D').toValue).toBe(143);
    expect(by('D').patch.e).toBeCloseTo(2.1871, 4);
    expect(by('D').newMaxUtil).toBeCloseTo(0.998, 3);
    expect(by('D').passesLimit).toBe(true);
    expect(by('D').sideEffects[0]).toBe('D 85 → 143 mm, e 1.3 → 2.187 mm to keep K1 0.55');
    // ranked by result: L first
    expect(rep.fixes[0].field).toBe('L');
    // per-check map: what lowers the governing check
    const life = rep.byCheck.find((b) => b.id === 'ringContactLife')!;
    expect(life.fields).toEqual(expect.arrayContaining(['D', 'e', 'L', 'discs', 'discMaterial']));
    expect(rep.byCheck.map((b) => b.id)).toEqual(['ringContactLife', 'ringContactStrength', 'innerContactLife']);
  });

  it('J3 at 2.5 N*m on D 60: D 64 mm (e 1.067), 7075, L 9.525 mm or 2 discs each fix it', () => {
    const rep = REPORTS.j3D60;
    const by = (field: Fix['field']) => rep.fixes.find((f) => f.field === field)!;
    expect(by('D').passesTarget).toBe(true);
    expect(by('D').toValue).toBe(64);
    expect(by('D').patch.e).toBeCloseTo(1.0667, 4);
    expect(by('discMaterial').passesTarget).toBe(true);
    expect(by('L').toValue).toBe(9.525);
    expect(by('L').exactMin).toBeCloseTo(6.95, 9);
    expect(by('discs').passesTarget).toBe(true);
    expect(by('D').sideEffects.join(' ')).toMatch(/housing OD 73 → 77 mm/);
  });

  it('a thin bearing fixes a design whose bore ligament is too thin', () => {
    const rep = REPORTS.j3D46;
    expect(full(CASES.j3D46).governing!.id).toBe('ligamentBore');
    const b = rep.fixes.find((f) => f.field === 'bearing')!;
    expect(b.passesTarget).toBe(true);
    expect(b.patch.bearing!.name).toBe('6700');
    expect(b.patch.Db).toBe(15);
    expect(b.direction).toBe('down');
  });

  it('motor too weak: the ratio fix (recommended ratio, or past it when that is still above 0.85), e rescaled to keep K1', () => {
    const inp = { ...presetInputs('J3'), Treq: 1, Tdes: 1.5 };
    const motor: MotorSpec = { Tpeak_Nm: 0.1, efficiency: 0.85 };
    expect(full(inp).verdict).toBe('pass');
    expect(motorUtilization(inp, motor, inp.Zp)!).toBeGreaterThan(1);
    const rep = suggestFixes(inp, { motor });
    expect(rep.needed).toBe(true);
    expect(rep.governingId).toBe('motor');
    expect(rep.fixes.map((f) => f.field)).toEqual(['Zp']);
    const f = rep.fixes[0];
    const rec = recommendRatio(inp, motor);
    expect(f.toValue!).toBeGreaterThanOrEqual(rec.Zp!);
    expect(motorUtilization(inp, motor, f.toValue!)!).toBeLessThanOrEqual(0.85);
    expect(motorUtilization(inp, motor, f.toValue! - 1)!).toBeGreaterThan(0.85);
    const K1 = (inp.e * inp.Zp) / (inp.D / 2);
    expect((f.patch.e! * f.toValue!) / (inp.D / 2)).toBeCloseTo(K1, 3);
    expect(f.passesTarget).toBe(true);
    expect(f.sideEffects[0]).toMatch(/recommended/);
    // no motor given: the same design needs nothing
    expect(suggestFixes(inp).needed).toBe(false);
  });

  it('runs in the worker (and the main-thread fallback) with the same result; cancel resolves at once', async () => {
    const inp = CASES.j3D60;
    const posted: WorkerResponse[] = [];
    const handle = createWorkerHandler({ post: (m) => posted.push(m) });
    await handle({ type: 'fixes', id: 7, inputs: inp });
    const res = posted.find((m) => m.type === 'result');
    expect(res && res.type === 'result' && res.kind).toBe('fixes');
    expect(strip((res as { result: FixReport }).result)).toEqual(strip(REPORTS.j3D60));
    expect(posted.some((m) => m.type === 'progress' && m.kind === 'fixes')).toBe(true);

    const client = new CalcClient(() => null);
    const job = client.fixes(inp);
    expect(strip(await job.promise)).toEqual(strip(REPORTS.j3D60));
    const job2 = client.fixes(inp);
    job2.cancel();
    expect((await job2.promise).cancelled).toBe(true);
    expect(strip(await suggestFixesAsync(inp))).toEqual(strip(REPORTS.j3D60));
  });
});
