import { describe, expect, it } from 'vitest';
import {
  ADVISOR_ZP_RANGE, DEFAULT_MOTOR_EFFICIENCY, RECOMMEND_ZP_RANGE, analyzeJointMotor, checkMotor, computeArm, defaultArmInputs,
  hasMotorTorque, motorZpSet, normalizeArmInputs, normalizeMotor, ratioLabel, recommendRatio, summarizeAllJoints, validateMotor,
  type MotorSpec,
} from '..';

const NEMA17: MotorSpec = { Tpeak_Nm: 0.45, efficiency: 0.85 };

describe('recommendRatio: hand-computed cases (0.45 N·m NEMA 17, 85%)', () => {
  it('J2: T_des 8.81 -> ratio_min 23.03 -> 24:1 (Zp 25)', () => {
    const r = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, NEMA17);
    // 8.81 / (0.85 * 0.45) = 8.81 / 0.3825 = 23.0327
    expect(r.ratioMinPeak).toBeCloseTo(23.0327, 3);
    expect(r.ratioMin).toBeCloseTo(23.0327, 3);
    expect(r.minSetBy).toBe('peak');
    expect(r.ratioMax).toBeNull();
    expect(r.Zp).toBe(25);
    expect(r.ratio).toBe(24);
    expect(r.status).toBe('ok');
    expect(r.inAdvisorRange).toBe(true);
    expect(r.singleStageSensible).toBe(true);
    // capacity: 0.85 * 0.45 * 24 = 9.18 N·m, margin 9.18 / 8.81 = 1.042
    expect(r.outputPeak_Nm).toBeCloseTo(9.18, 6);
    expect(r.marginPeak).toBeCloseTo(9.18 / 8.81, 6);
    expect(r.outputCont_Nm).toBeNull();
    expect(r.headline).toBe('24:1 (Zp 25)');
    expect(r.reasons[0]).toBe('Needs ≥ 23.0:1 for 8.81 N·m (T_des) with a 0.45 N·m motor at 85% efficiency.');
  });

  it('J3: T_des 3.38 -> 8.84 -> 9:1 (Zp 10), below the advisor range', () => {
    const r = recommendRatio({ Treq: 2.25, Tdes: 3.38 }, NEMA17);
    expect(r.ratioMin).toBeCloseTo(3.38 / 0.3825, 6); // 8.8366
    expect(r.Zp).toBe(10);
    expect(r.ratio).toBe(9);
    expect(r.inAdvisorRange).toBe(false);
    expect(r.status).toBe('warning');
    expect(r.reasons.join(' ')).toMatch(/outside the Design Advisor/);
    expect(r.outputPeak_Nm).toBeCloseTo(0.3825 * 9, 9);
  });

  it('a ratio exactly on an integer does not round up (24.0 -> 24:1)', () => {
    const r = recommendRatio({ Treq: 1, Tdes: 0.3825 * 24 }, NEMA17);
    expect(r.ratioMin).toBeCloseTo(24, 9);
    expect(r.ratio).toBe(24);
  });

  it('a tiny load is lifted to the smallest cycloidal ratio (Zp 8)', () => {
    const r = recommendRatio({ Treq: 0.05, Tdes: 0.1 }, NEMA17);
    expect(r.ratioMin).toBeLessThan(1);
    expect(r.Zp).toBe(8);
    expect(r.ratio).toBe(7);
    expect(r.reasons.join(' ')).toMatch(/at least 7:1/);
    expect(r.inAdvisorRange).toBe(false);
  });

  it('a zero load still gives a ratio and no NaN', () => {
    const r = recommendRatio({ Treq: 0, Tdes: 0 }, NEMA17);
    expect(r.Zp).toBe(8);
    expect(r.marginPeak).toBeNull();
    expect(JSON.stringify(r)).not.toMatch(/NaN|null.*Infinity/);
  });

  it('continuous torque can set ratio_min', () => {
    // peak: 8.81/(0.85*0.45)=23.03 ; continuous: 5.87/(0.85*0.2)=34.53 -> 35:1 (Zp 36)
    const r = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, Tcont_Nm: 0.2 });
    expect(r.ratioMinCont).toBeCloseTo(5.87 / 0.17, 6);
    expect(r.minSetBy).toBe('continuous');
    expect(r.ratioMin).toBeCloseTo(34.5294, 3);
    expect(r.ratio).toBe(35);
    expect(r.Zp).toBe(36);
    expect(r.inAdvisorRange).toBe(false);
    expect(r.singleStageSensible).toBe(true);
    expect(r.outputCont_Nm).toBeCloseTo(0.85 * 0.2 * 35, 9);
    expect(r.marginCont).toBeCloseTo((0.85 * 0.2 * 35) / 5.87, 9);
  });

  it('peak still wins when the continuous rating is generous', () => {
    const r = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, Tcont_Nm: 0.4 });
    expect(r.minSetBy).toBe('peak');
    expect(r.ratio).toBe(24);
  });

  it('more than 40:1 in one stage is flagged but still recommended', () => {
    const r = recommendRatio({ Treq: 10, Tdes: 15 }, NEMA17); // 15/0.3825 = 39.2 -> 40:1: sensible edge
    expect(r.ratio).toBe(40);
    expect(r.singleStageSensible).toBe(true);
    const r2 = recommendRatio({ Treq: 10, Tdes: 16 }, NEMA17); // 41.83 -> 42:1
    expect(r2.ratio).toBe(42);
    expect(r2.Zp).toBe(43);
    expect(r2.singleStageSensible).toBe(false);
    expect(r2.status).toBe('warning');
    expect(r2.reasons.join(' ')).toMatch(/more than a single cycloidal stage/);
  });

  it('beyond the Zp range is infeasible by range', () => {
    const r = recommendRatio({ Treq: 20, Tdes: 30 }, NEMA17); // 78.4:1 > 59:1
    expect(r.status).toBe('infeasible');
    expect(r.infeasibleBy).toBe('range');
    expect(r.Zp).toBeNull();
    expect(r.headline).toMatch(/too high for one stage/);
    expect(RECOMMEND_ZP_RANGE).toEqual({ min: 8, max: 60 });
  });

  it('a custom Zp range is honoured', () => {
    const r = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, NEMA17, { zpRange: { min: 8, max: 20 } });
    expect(r.status).toBe('infeasible');
    expect(r.infeasibleBy).toBe('range');
  });
});

describe('recommendRatio: speed limits', () => {
  it('ratio_max = rpm * 6 / required deg/s, and the Zp stays under it', () => {
    // 1000 rpm = 6000 deg/s; at 300 deg/s -> ratio_max 20
    const r = recommendRatio({ Treq: 2.25, Tdes: 3.38 }, { ...NEMA17, maxSpeed_rpm: 1000, requiredSpeed_degps: 300 });
    expect(r.ratioMax).toBeCloseTo(20, 9);
    expect(r.ratio).toBe(9);
    expect(r.status).toBe('warning'); // Zp 10 is below the advisor range, but feasible
    // output speed at 9:1 = 6000 / 9 = 666.7 deg/s = 111.1 rpm
    expect(r.outputSpeed_degps).toBeCloseTo(6000 / 9, 9);
    expect(r.outputSpeed_rpm).toBeCloseTo(1000 / 9, 9);
    expect(r.motorSpeedNeeded_rpm).toBeCloseTo((300 * 9) / 6, 9); // 450 rpm
  });

  it('a speed cap below the torque requirement is infeasible, with a way out', () => {
    // J2: needs >= 23.03:1, 1000 rpm and 360 deg/s allow only <= 16.67:1
    const r = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, maxSpeed_rpm: 1000, requiredSpeed_degps: 360 });
    expect(r.ratioMax).toBeCloseTo(6000 / 360, 9);
    expect(r.status).toBe('infeasible');
    expect(r.infeasibleBy).toBe('speed');
    expect(r.Zp).toBeNull();
    expect(r.ratio).toBeNull();
    expect(r.headline).toMatch(/No ratio fits/);
    const text = r.reasons.join(' ');
    expect(text).toMatch(/torque needs ≥ 23\.0:1 but the speed limit allows only ≤ 16\.7:1/);
    // option 1: peak torque needed at 16:1 = 8.81 / (0.85 * 16) = 0.648 N·m
    expect(text).toMatch(/at least 0\.648 N·m peak torque \(at 16:1\)/);
    // option 2: motor speed at 24:1 for 360 deg/s = 360 * 24 / 6 = 1440 rpm
    expect(text).toMatch(/reaches 1440 rpm \(at 24:1\)/);
    // option 3: joint speed at 24:1 with 1000 rpm = 6000 / 24 = 250 deg/s
    expect(text).toMatch(/at most 250 deg\/s \(at 24:1\)/);
  });

  it('no whole number between ratio_min and ratio_max is infeasible', () => {
    // ratio_min 23.03, ratio_max 23.5
    const r = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, maxSpeed_rpm: 1000, requiredSpeed_degps: 6000 / 23.5 });
    expect(r.ratioMax).toBeCloseTo(23.5, 9);
    expect(r.status).toBe('infeasible');
    expect(r.reasons.join(' ')).toMatch(/no whole-number ratio fits between 23\.0:1 and 23\.5:1/);
  });

  it('a speed cap below the 7:1 minimum says so', () => {
    const r = recommendRatio({ Treq: 0.1, Tdes: 0.2 }, { ...NEMA17, maxSpeed_rpm: 100, requiredSpeed_degps: 300 }); // ratio_max 2
    expect(r.status).toBe('infeasible');
    expect(r.reasons.join(' ')).toMatch(/below the 7:1 minimum/);
  });

  it('only one of the two speeds gives no ratio_max but still informs', () => {
    const a = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, maxSpeed_rpm: 1000 });
    expect(a.ratioMax).toBeNull();
    expect(a.outputSpeed_degps).toBeCloseTo(6000 / 24, 9);
    expect(a.motorSpeedNeeded_rpm).toBeNull();
    const b = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, requiredSpeed_degps: 120 });
    expect(b.ratioMax).toBeNull();
    expect(b.outputSpeed_degps).toBeNull();
    expect(b.motorSpeedNeeded_rpm).toBeCloseTo((120 * 24) / 6, 9);
  });
});

describe('recommendRatio: validation and NaN safety', () => {
  it('no motor, no peak torque, bad numbers', () => {
    expect(recommendRatio({ Treq: 1, Tdes: 2 }, undefined).status).toBe('incomplete');
    expect(recommendRatio({ Treq: 1, Tdes: 2 }, { Tpeak_Nm: null, efficiency: 0.85 }).status).toBe('incomplete');
    const bad = recommendRatio({ Treq: 1, Tdes: 2 }, { Tpeak_Nm: -1, efficiency: 0.85 });
    expect(bad.status).toBe('invalid');
    expect(bad.errors[0]).toBe('Motor peak torque must be > 0 N·m');
    expect(recommendRatio({ Treq: NaN, Tdes: 2 }, NEMA17).status).toBe('invalid');
    expect(recommendRatio({ Treq: 1, Tdes: Infinity }, NEMA17).status).toBe('invalid');
    expect(recommendRatio({ Treq: -1, Tdes: 2 }, NEMA17).status).toBe('invalid');
  });

  it('never throws and never leaks NaN on garbage input', () => {
    const junk: unknown[] = [null, undefined, 5, 'x', [], {}, { Tpeak_Nm: 'a' }, { Tpeak_Nm: NaN, efficiency: NaN }, { Tpeak_Nm: 1e308, efficiency: 1 }];
    for (const m of junk) {
      const r = recommendRatio({ Treq: 1, Tdes: 2 }, m as MotorSpec);
      expect(['ok', 'warning', 'infeasible', 'incomplete', 'invalid']).toContain(r.status);
      expect(JSON.stringify(r)).not.toContain('NaN');
      const c = checkMotor({ Treq: 1, Tdes: 2 }, m as MotorSpec, 'cycloidal', 18);
      expect(JSON.stringify(c)).not.toContain('NaN');
    }
    const huge = recommendRatio({ Treq: 1e300, Tdes: 1e300 }, { Tpeak_Nm: 1e-3, efficiency: 0.85 });
    expect(huge.status).toBe('infeasible');
    expect(Number.isFinite(huge.ratioMin as number)).toBe(true);
  });

  it('validateMotor ranges with friendly messages', () => {
    expect(validateMotor(NEMA17).errors).toEqual([]);
    expect(validateMotor({ Tpeak_Nm: 0, efficiency: 0.85 }).errors).toEqual(['Motor peak torque must be > 0 N·m']);
    expect(validateMotor({ Tpeak_Nm: 20000, efficiency: 0.85 }).errors).toEqual(['Motor peak torque must be at most 10000 N·m']);
    expect(validateMotor({ Tpeak_Nm: 1, Tcont_Nm: -2, efficiency: 0.85 }).errors).toEqual(['Motor continuous torque must be > 0 N·m']);
    expect(validateMotor({ Tpeak_Nm: 1, Tcont_Nm: 2, efficiency: 0.85 }).errors).toEqual(['Motor continuous torque cannot be above the peak torque']);
    expect(validateMotor({ Tpeak_Nm: 1, maxSpeed_rpm: 0, efficiency: 0.85 }).errors).toEqual(['Motor max speed must be > 0 rpm']);
    expect(validateMotor({ Tpeak_Nm: 1, maxSpeed_rpm: 1e6, efficiency: 0.85 }).errors).toEqual(['Motor max speed must be at most 100000 rpm']);
    expect(validateMotor({ Tpeak_Nm: 1, requiredSpeed_degps: -5, efficiency: 0.85 }).errors).toEqual(['Required joint speed must be > 0 deg/s']);
    expect(validateMotor({ Tpeak_Nm: 1, efficiency: 1.5 }).errors[0]).toMatch(/efficiency must be between 0\.1 and 1/);
    expect(validateMotor({ Tpeak_Nm: 1, efficiency: 0.05 }).errors[0]).toMatch(/efficiency must be between/);
    expect(validateMotor({ Tpeak_Nm: 1, efficiency: 0.5 }).warnings[0]).toMatch(/unusually low/);
    expect(validateMotor({ Tpeak_Nm: 1, efficiency: NaN }).errors[0]).toBe('Gearbox efficiency is not a number');
    expect(validateMotor(null)).toEqual({ errors: [], warnings: [] });
  });

  it('normalizeMotor fills the efficiency default and drops junk', () => {
    expect(normalizeMotor(undefined)).toBeUndefined();
    expect(normalizeMotor('x')).toBeUndefined();
    expect(normalizeMotor([])).toBeUndefined();
    expect(normalizeMotor({})).toEqual({ Tpeak_Nm: null, Tcont_Nm: null, maxSpeed_rpm: null, requiredSpeed_degps: null, efficiency: DEFAULT_MOTOR_EFFICIENCY });
    expect(normalizeMotor({ Tpeak_Nm: 0.45, name: 'NEMA 17', maxSpeed_rpm: 'fast', efficiency: 0.9, extra: 1 }))
      .toEqual({ name: 'NEMA 17', Tpeak_Nm: 0.45, Tcont_Nm: null, maxSpeed_rpm: null, requiredSpeed_degps: null, efficiency: 0.9 });
    expect(hasMotorTorque(NEMA17)).toBe(true);
    expect(hasMotorTorque({ Tpeak_Nm: null, efficiency: 0.85 })).toBe(false);
    expect(hasMotorTorque(undefined)).toBe(false);
  });
});

describe('checkMotor: cycloidal gearbox and overload', () => {
  it('J2 at Zp 25 delivers 9.18 N·m: ok, with an overload warning (stall 104% of T_des)', () => {
    const c = checkMotor({ Treq: 5.87, Tdes: 8.81 }, NEMA17, 'cycloidal', 25);
    expect(c.status).toBe('ok');
    expect(c.ratio).toBe(24);
    expect(c.outputPeak_Nm).toBeCloseTo(9.18, 9);
    expect(c.peakUtil).toBeCloseTo(8.81 / 9.18, 9);
    expect(c.peakOk).toBe(true);
    expect(c.contOk).toBeNull();
    const o = c.overload!;
    expect(o.exceeds).toBe(true);
    expect(o.stallOutput_Nm).toBeCloseTo(9.18, 9);
    expect(o.factor).toBeCloseTo(9.18 / 8.81, 9);
    // Y = T_des / (eta * ratio) = 8.81 / (0.85 * 24) = 0.43186 N·m = 95.97% of the 0.45 N·m peak
    expect(o.motorLimit_Nm).toBeCloseTo(8.81 / (0.85 * 24), 9);
    expect(o.limitFraction).toBeCloseTo(8.81 / (0.85 * 24) / 0.45, 9);
    expect(o.message).toContain('Motor stall can exceed the gearbox design torque');
    expect(o.message).toContain('≤ 0.432 N·m');
    expect(o.message).toContain('96% of its peak current');
  });

  it('the overload warning never turns the verdict into a failure', () => {
    // 10x too big a ratio: heavy overload, but the motor delivers the torque
    const c = checkMotor({ Treq: 1, Tdes: 1.5 }, NEMA17, 'cycloidal', 61);
    expect(c.status).toBe('ok');
    expect(c.overload!.exceeds).toBe(true);
    expect(c.overload!.factor).toBeGreaterThan(5);
  });

  it('a ratio that is too low falls short; overload is absent', () => {
    const c = checkMotor({ Treq: 5.87, Tdes: 8.81 }, NEMA17, 'cycloidal', 18); // 17:1 -> 6.50 N·m
    expect(c.status).toBe('short');
    expect(c.outputPeak_Nm).toBeCloseTo(0.3825 * 17, 9);
    expect(c.peakOk).toBe(false);
    expect(c.problems[0]).toBe('Peak torque falls short: 6.5 N·m available, 8.81 N·m needed.');
    expect(c.overload!.exceeds).toBe(false);
  });

  it('continuous torque and speed are checked too', () => {
    const m: MotorSpec = { ...NEMA17, Tcont_Nm: 0.2, maxSpeed_rpm: 1000, requiredSpeed_degps: 300 };
    const c = checkMotor({ Treq: 5.87, Tdes: 8.81 }, m, 'cycloidal', 25); // 24:1: cont 0.17*24 = 4.08 < 5.87
    expect(c.status).toBe('short');
    expect(c.contOk).toBe(false);
    expect(c.contUtil).toBeCloseTo(5.87 / 4.08, 9);
    expect(c.speedOk).toBe(false); // 6000/24 = 250 deg/s < 300
    expect(c.outputSpeed_degps).toBeCloseTo(250, 9);
    expect(c.problems).toHaveLength(2);
  });

  it('needs a valid Zp', () => {
    expect(checkMotor({ Treq: 1, Tdes: 2 }, NEMA17, 'cycloidal', NaN).status).toBe('invalid');
    expect(checkMotor({ Treq: 1, Tdes: 2 }, NEMA17, 'cycloidal', null).status).toBe('invalid');
    expect(checkMotor({ Treq: 1, Tdes: 2 }, NEMA17, 'cycloidal', 1).status).toBe('invalid');
    expect(checkMotor({ Treq: 1, Tdes: 2 }, undefined, 'cycloidal', 12).status).toBe('incomplete');
    expect(checkMotor({ Treq: 1, Tdes: 2 }, { Tpeak_Nm: null, efficiency: 0.85 }, 'cycloidal', 12).status).toBe('incomplete');
  });
});

describe('checkMotor: servo joints', () => {
  it('a too-small servo fails peak and continuous', () => {
    const servo: MotorSpec = { Tpeak_Nm: 0.3, Tcont_Nm: 0.1, efficiency: 0.85 };
    const c = checkMotor({ Treq: 0.32, Tdes: 0.48 }, servo, 'servo');
    expect(c.status).toBe('short');
    expect(c.ratio).toBe(1);
    expect(c.eta).toBe(1); // direct drive, no gearbox loss
    expect(c.outputPeak_Nm).toBe(0.3);
    expect(c.peakUtil).toBeCloseTo(0.48 / 0.3, 9);
    expect(c.peakOk).toBe(false);
    expect(c.contOk).toBe(false);
    expect(c.contUtil).toBeCloseTo(3.2, 9);
    expect(c.overload).toBeNull();
    expect(c.problems).toEqual([
      'Peak torque falls short: 0.3 N·m available, 0.48 N·m needed.',
      'Continuous torque falls short: 0.1 N·m available, 0.32 N·m needed.',
    ]);
  });

  it('a big enough servo passes, and speed compares directly', () => {
    const c = checkMotor({ Treq: 0.32, Tdes: 0.48 }, { Tpeak_Nm: 1.2, Tcont_Nm: 0.4, maxSpeed_rpm: 50, requiredSpeed_degps: 240, efficiency: 0.85 }, 'servo');
    expect(c.status).toBe('ok');
    expect(c.outputSpeed_degps).toBe(300);
    expect(c.speedOk).toBe(true);
    expect(c.outputPeak_Nm).toBe(1.2);
  });
});

describe('motorZpSet (advisor ratio mode "From motor")', () => {
  it('J2: Zp 25 and up inside 12..26', () => {
    const rec = recommendRatio({ Treq: 5.87, Tdes: 8.81 }, NEMA17);
    const z = motorZpSet(rec);
    expect(z.feasible).toBe(true);
    expect(z.zps).toEqual([25, 26]);
    expect(z.note).toContain('24:1 to 25:1 (Zp 25 to 26)');
  });

  it('J3: every Zp from 12 to 26 qualifies (ratio_min 8.8)', () => {
    const z = motorZpSet(recommendRatio({ Treq: 2.25, Tdes: 3.38 }, NEMA17));
    expect(z.zps[0]).toBe(12);
    expect(z.zps[z.zps.length - 1]).toBe(26);
    expect(z.zps).toHaveLength(15);
  });

  it('a speed cap trims the top of the set', () => {
    const rec = recommendRatio({ Treq: 2.25, Tdes: 3.38 }, { ...NEMA17, maxSpeed_rpm: 1000, requiredSpeed_degps: 400 }); // ratio_max 15
    const z = motorZpSet(rec);
    expect(z.zps).toEqual([12, 13, 14, 15, 16]);
  });

  it('nothing in range: the nearest Zp and a note', () => {
    const high = motorZpSet(recommendRatio({ Treq: 10, Tdes: 16 }, NEMA17)); // 42:1
    expect(high.feasible).toBe(false);
    expect(high.zps).toEqual([26]);
    expect(high.nearest).toBe(26);
    expect(high.note).toMatch(/No Zp in the advisor range \(12 to 26\) is motor-feasible: the motor needs ≥ 41\.8:1\. Nearest is 25:1 \(Zp 26\)/);
    const slow = motorZpSet(recommendRatio({ Treq: 0.5, Tdes: 1 }, { ...NEMA17, maxSpeed_rpm: 100, requiredSpeed_degps: 100 })); // ratio_max 6 -> infeasible
    expect(slow.feasible).toBe(false);
    expect(slow.nearest).toBe(12);
    const inf = motorZpSet(recommendRatio({ Treq: 5.87, Tdes: 8.81 }, { ...NEMA17, maxSpeed_rpm: 1000, requiredSpeed_degps: 360 }));
    expect(inf.feasible).toBe(false);
    expect(inf.zps).toHaveLength(1);
  });

  it('incomplete motor gives an empty set', () => {
    const z = motorZpSet(recommendRatio({ Treq: 1, Tdes: 2 }, undefined));
    expect(z.zps).toEqual([]);
    expect(z.feasible).toBe(false);
    expect(ADVISOR_ZP_RANGE).toEqual({ min: 12, max: 26 });
    expect(ratioLabel(25)).toBe('24:1 (Zp 25)');
  });
});

describe('default arm with a 0.45 N·m motor on J1..J4', () => {
  it('worked example (T_des from the arm model, eta 0.85)', () => {
    const arm = defaultArmInputs();
    const res = computeArm(arm);
    const got = ['J1', 'J2', 'J3', 'J4'].map((id) => {
      const l = res.joints.find((j) => j.joint === id)!;
      const r = recommendRatio({ Treq: l.Treq, Tdes: l.Tdes }, NEMA17);
      return [id, Number(l.Tdes.toFixed(2)), Number((r.ratioMin as number).toFixed(2)), r.Zp];
    });
    // J1 T_des max(1.5 * 0.70, 1.0); J2 8.81; J3 3.38; J4 floor 1.0
    expect(got[1]).toEqual(['J2', 8.81, 23.03, 25]);
    expect(got[2]).toEqual(['J3', 3.38, 8.82, 10]);
    expect(got[3][3]).toBe(8); // J4: 1.0 / 0.3825 = 2.61 -> floor of 7:1 -> Zp 8
    expect(got[0][3]).toBe(8); // J1: 1.055 / 0.3825 = 2.76 -> Zp 8
  });

  it('adding a motor does not change the arm result or the default arm', () => {
    const base = defaultArmInputs();
    const withMotor = { ...base, joints: base.joints.map((j) => ({ ...j, motor: { ...NEMA17 } })) };
    expect(computeArm(withMotor)).toEqual(computeArm(base));
    expect(base.joints.every((j) => !('motor' in j))).toBe(true);
  });

  it('normalizeArmInputs keeps a valid motor and leaves joints without one alone', () => {
    const base = defaultArmInputs();
    const raw = JSON.parse(JSON.stringify({ ...base, joints: base.joints.map((j, i) => (i === 1 ? { ...j, motor: { Tpeak_Nm: 0.45, maxSpeed_rpm: 1000, efficiency: 0.8, name: 'NEMA 17' } } : j)) }));
    const n = normalizeArmInputs(raw);
    expect(n.joints[1].motor).toEqual({ name: 'NEMA 17', Tpeak_Nm: 0.45, Tcont_Nm: null, maxSpeed_rpm: 1000, requiredSpeed_degps: null, efficiency: 0.8 });
    expect('motor' in n.joints[0]).toBe(false);
    expect(normalizeArmInputs(base)).toEqual(base);
    // a garbled motor is dropped, not fatal
    const bad = normalizeArmInputs({ ...raw, joints: raw.joints.map((j: object, i: number) => (i === 1 ? { ...j, motor: 'zz' } : j)) });
    expect('motor' in bad.joints[1]).toBe(false);
  });

  it('summarizeAllJoints carries the motor info per joint and per servo', () => {
    const arm = defaultArmInputs();
    arm.joints[1].motor = { ...NEMA17 };
    arm.joints[4].motor = { Tpeak_Nm: 0.2, efficiency: 0.85 }; // J5 servo, T_des 0.48
    const s = summarizeAllJoints(arm, {});
    expect(s.rows.find((r) => r.joint === 'J1')!.motor).toBeNull();
    const j2 = s.rows.find((r) => r.joint === 'J2')!;
    expect(j2.motor!.recommendation!.Zp).toBe(25);
    expect(j2.motor!.check.ratio).toBe(j2.inputs.Zp - 1); // checks the gearbox actually stored for J2 (Zp 18 -> 17:1)
    expect(j2.motor!.check.status).toBe('short');
    expect(s.servos[0].motor!.check.status).toBe('short');
    expect(s.servos[0].motor!.recommendation).toBeNull();
    // an invalid arm gives no false OK for a servo
    const broken = { ...arm, SF: -1 };
    expect(summarizeAllJoints(broken, {}).servos[0].motor!.check.status).toBe('invalid');
  });

  it('analyzeJointMotor returns null without motor data', () => {
    expect(analyzeJointMotor({ drive: 'cycloidal' }, { Treq: 1, Tdes: 2 }, 18)).toBeNull();
  });
});
