// UI side of "how to fix": the TO FIX sentence, the count badges and the per-field view of a fix report.
import { describe, expect, it } from 'vitest';
import { checkGearbox, defaultGearboxInputs, presetInputs, suggestFixes } from '../../calc';
import { fixCountText, fixesByField, fixKey, needsFixes } from '../fixes';
import { toFixText } from '../screens/GearboxResults';

const id = (s: string) => s;

describe('fix report in the UI', () => {
  it('TO FIX lists the real top fixes when one passes, the closest ones when none does, the generic advice while pending', () => {
    const inp = { ...presetInputs('J3'), D: 60, e: 1.0, Treq: 1.6, Tdes: 2.5 };
    const r = checkGearbox(inp);
    const rep = suggestFixes(inp);
    const t = toFixText(r, { report: rep, pending: false }, id);
    expect(t).toMatch(/^Any one of these fixes it on its own: /);
    expect(t).toContain(rep.fixes[0].short);

    const spec = defaultGearboxInputs();
    const t2 = toFixText(checkGearbox(spec), { report: suggestFixes(spec), pending: false }, id);
    expect(t2).toMatch(/^No single change gets every check to 0\.85\. The ones that help most: ▲ L → 12\.7 mm \(0\.96\)/);
    expect(t2).toMatch(/Design Advisor/);

    const t3 = toFixText(checkGearbox(spec), { report: null, pending: true }, id);
    expect(t3).toMatch(/Looking for the smallest single changes/);
  });

  it('count badges and the per-field view', () => {
    const rep = suggestFixes({ ...presetInputs('J3'), D: 60, e: 1.0, Treq: 1.6, Tdes: 2.5 });
    const pass = rep.fixes.filter((f) => f.passesTarget).length;
    expect(fixCountText(rep.fixes)).toMatch(new RegExp(`^${pass} fixes`));
    expect(fixCountText([])).toBeNull();
    const by = fixesByField(rep);
    expect(by.D?.toValue).toBe(64);
    expect(Object.keys(by).length).toBe(rep.fixes.length);
  });

  it('needsFixes follows the 0.85 line (motor included) and the key changes with the inputs', () => {
    expect(needsFixes(presetInputs('J1'), null)).toBe(false);
    expect(needsFixes(defaultGearboxInputs(), null)).toBe(true);
    const inp = { ...presetInputs('J3'), Treq: 1, Tdes: 1.5 };
    expect(needsFixes(inp, null)).toBe(false);
    expect(needsFixes(inp, { Tpeak_Nm: 0.1, efficiency: 0.85 })).toBe(true);
    expect(fixKey(inp, null)).not.toBe(fixKey({ ...inp, D: 71 }, null));
  });
});
