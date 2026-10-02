// Status of each joint for the rail dots and the inspector badge (CLAUDE.md Addition 10): the cycloidal gearbox verdict,
// or the servo check, or a motor warning when that is worse. Pure TypeScript; the gearbox models are cached by inputs so
// the rail, the inspector and the stage share one computation per design.
import {
  analyzeJointMotor, createGearboxModel, type ArmJoint, type ArmResult, type GearboxInputs, type GearboxModel,
} from '../../calc';
import { motorChip } from '../motorUi';
import { plainName } from '../plain';
import { effectiveInputs, type Session } from '../session';
import type { StatusKind } from '../components/primitives';

const CACHE_MAX = 24;
const cache = new Map<string, GearboxModel>();

/** The gearbox model (full SPEC resolution) of a set of inputs, cached by value. */
export function modelFor(inputs: GearboxInputs): GearboxModel {
  const key = JSON.stringify(inputs);
  const hit = cache.get(key);
  if (hit) {
    cache.delete(key);
    cache.set(key, hit); // most recently used last
    return hit;
  }
  const m = createGearboxModel(inputs);
  cache.set(key, m);
  if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
  return m;
}

const RANK: Record<StatusKind, number> = { neutral: 0, ok: 1, marginal: 2, fail: 3 };

export interface JointStatus {
  kind: StatusKind;
  /** Short word: PASS, MARGINAL, FAIL, INVALID, SERVO OK, TOO WEAK, ... */
  word: string;
  /** Sentence for the tooltip and the aria label */
  text: string;
}

const pct = (x: number) => (Number.isFinite(x) ? x.toFixed(2) : '—');

/** Status of one joint of the arm. */
export function jointStatus(s: Session, arm: ArmResult, joint: ArmJoint, index: number): JointStatus {
  const name = `J${index + 1}${joint.name.trim() ? ` ${joint.name.trim()}` : ''}`;
  const load = arm.joints[index];
  if (joint.drive === 'servo') {
    if (!arm.valid || !load) return { kind: 'neutral', word: 'ARM INPUT', text: `${name}: servo, waiting for valid arm inputs` };
    const info = analyzeJointMotor(joint, { Treq: load.Treq, Tdes: load.Tdes }, null);
    if (!info) return { kind: 'neutral', word: 'NO SERVO DATA', text: `${name}: servo, no ratings entered (needs ${load.Tdes.toFixed(2)} N·m peak)` };
    const c = info.check;
    if (c.status === 'ok') return { kind: 'ok', word: 'SERVO OK', text: `${name}: servo OK` };
    if (c.status === 'short') return { kind: 'fail', word: 'SERVO TOO SMALL', text: `${name}: servo too small. ${c.problems[0] ?? ''}`.trim() };
    if (c.status === 'invalid') return { kind: 'fail', word: 'CHECK INPUT', text: `${name}: servo values need fixing` };
    return { kind: 'neutral', word: 'INCOMPLETE', text: `${name}: servo, enter its peak torque` };
  }
  const eff = effectiveInputs(s, joint.id, arm);
  const r = modelFor(eff).result;
  const base = gearboxStatus(r.verdict, r.maxUtilization, r.governing ? plainName(r.governing) : null);
  let out: JointStatus = { ...base, text: `${name}: gearbox ${base.text}` };
  if (joint.motor) {
    const info = analyzeJointMotor(joint, { Treq: eff.Treq, Tdes: eff.Tdes }, eff.Zp);
    const chip = motorChip(info);
    if (RANK[chip.kind] > RANK[out.kind]) out = { kind: chip.kind, word: chip.word, text: `${out.text}; motor ${chip.word.toLowerCase()}` };
    else if (chip.kind === 'fail' || chip.kind === 'marginal') out = { ...out, text: `${out.text}; motor ${chip.word.toLowerCase()}` };
  }
  return out;
}

/** Status of a gearbox from its verdict. */
export function gearboxStatus(verdict: string, maxUtil: number, governing: string | null): JointStatus {
  if (verdict === 'invalid') return { kind: 'fail', word: 'INVALID', text: 'inputs cannot be computed' };
  const kind: StatusKind = verdict === 'pass' ? 'ok' : verdict === 'marginal' ? 'marginal' : 'fail';
  const word = kind === 'ok' ? 'PASS' : kind === 'marginal' ? 'MARGINAL' : 'FAIL';
  return { kind, word, text: `${word} ${pct(maxUtil)}${governing ? ` (${governing})` : ''}` };
}
