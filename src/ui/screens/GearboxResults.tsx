import { POLYMER_WARNING_LINES, type Check, type GearboxResult, type InnerPinSupport } from '../../calc';
import { Card, DataTable, Notice, ResponsiveTable, STATUS_WORD, StatusChip, UtilBar, verdictKind, type StatusKind } from '../components/primitives';
import { checkLimit, checkValue, fixed, hours, num, util, DASH } from '../format';
import { PLAIN, verdictHeadline } from '../plain';
import { useStore } from '../store';

// ---------------------------------------------------------------------------
// Verdict block
// ---------------------------------------------------------------------------

export function VerdictBanner({ r }: { r: GearboxResult }) {
  const kind: StatusKind = verdictKind(r.verdict);
  const head = verdictHeadline(r);
  return (
    <div className={`verdict verdict-${kind}`} role="status" aria-live="polite">
      <div className="verdict-head">
        <StatusChip kind={kind}>{r.verdict === 'invalid' ? 'INVALID' : STATUS_WORD[kind]}</StatusChip>
        {r.governing && (
          <span className="verdict-util">
            MAX UTILIZATION <strong>{util(r.maxUtilization)}</strong>
          </span>
        )}
      </div>
      <p className="verdict-text">{head.text}</p>
      {r.governing && r.verdict !== 'pass' && (
        <p className="verdict-fix"><span className="verdict-fix-tag">TO FIX</span> {PLAIN[r.governing.id].fix}</p>
      )}
    </div>
  );
}

export function InvalidCard({ r }: { r: GearboxResult }) {
  const { u } = useStore();
  return (
    <Notice kind="error" title="These inputs cannot be computed yet">
      <ul className="plain-list">
        {r.errors.slice(0, 5).map((e) => <li key={e}>{u.text(e)}</li>)}
      </ul>
      <p>Usually that means a larger pin circle diameter, a smaller eccentricity, or smaller pins. Your other values are kept.</p>
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Key data table
// ---------------------------------------------------------------------------

export function KeyData({ r, discs }: { r: GearboxResult; discs: number }) {
  const { u } = useStore();
  const d = r.derived;
  const k1Ok = d.K1 >= 0.4 && d.K1 <= 0.85;
  return (
    <Card title="Key data">
      <DataTable
        rows={[
          { label: 'Gear ratio', value: `${num(d.ratio, 0)}:1`, note: `Zp ${num(d.ratio + 1, 0)}, ${num(d.Zc, 0)} lobes` },
          { label: 'K1 (eccentricity ratio)', value: fixed(d.K1, 3), flag: k1Ok ? 'ok' : 'marginal', note: k1Ok ? 'usual 0.40 to 0.85' : 'outside 0.40 to 0.85' },
          { label: 'Inner pin circle radius, Rw', value: u.fu('length', d.Rw, { dp: 1 }), note: d.RwIsOverride ? 'overridden' : 'automatic' },
          { label: 'Housing outside diameter', value: u.fu('length', d.housingOD, { dp: 1 }), note: 'D + 2·rr + 2·wall' },
          { label: 'Peak ring pin force', value: u.fu('force', r.loads.FRingPeak, { dp: 0 }), note: 'at design torque' },
          { label: 'Peak inner pin force', value: u.fu('force', r.loads.FInnerPeak, { dp: 0 }), note: 'at design torque' },
          { label: 'Peak eccentric bearing load', value: u.fu('force', r.loads.bearingPeak, { dp: 0 }), note: 'limit is the static rating C0' },
          { label: 'Bearing life, L10h', value: hours(r.loads.L10h), note: `at ${u.fu('force', r.loads.bearingWorking, { dp: 0 })} working load` },
          { label: 'Disc mass', value: u.fu('mass', r.mass.total_g, { dp: 0 }), note: discs > 1 ? `${discs} discs, ${u.fu('mass', r.mass.perDisc_g, { dp: 0 })} each` : '1 disc' },
        ]}
      />
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Polymer warning
// ---------------------------------------------------------------------------

export function PolymerCard() {
  return (
    <Notice kind="warning" title="Polymer part: read this before trusting the numbers">
      <ul className="plain-list">
        {POLYMER_WARNING_LINES.map((l) => <li key={l}>{l}</li>)}
      </ul>
      <p>This is a warning, not a failed check.</p>
    </Notice>
  );
}

// ---------------------------------------------------------------------------
// Checks table
// ---------------------------------------------------------------------------

function checkNote(c: Check, u: ReturnType<typeof useStore>['u'], used: InnerPinSupport): string | null {
  if (c.info && c.id === 'boltBending') {
    return `fixed-fixed ${u.fu('stress', c.info.fixedFixed, { dp: 0 })}, simply supported ${u.fu('stress', c.info.simplySupported, { dp: 0 })} (used)`;
  }
  if (c.info && c.id === 'standoffBending') return standoffNote(c, used, u);
  return null;
}

/** "Ring (bolted) 61 MPa (used) · ring (pinned) 84 MPa · cantilever 113 MPa": the model used plus the other two as info. */
export function standoffNote(c: Check, used: InnerPinSupport, u: ReturnType<typeof useStore>['u']): string {
  const info = c.info ?? {};
  const parts: [InnerPinSupport, string, number | undefined][] = [
    ['ringClamped', 'ring (bolted)', info.ringClamped],
    ['ringPinned', 'ring (pinned)', info.ringPinned],
    ['cantilever', 'cantilever', info.cantilever],
  ];
  const s = parts
    .map(([id, label, v]) => `${label} ${u.fu('stress', v ?? NaN, { dp: 0 })}${id === used ? ' (used)' : ''}`)
    .join(' · ');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** `compact`: the narrow inspector column keeps it a table (smaller type, no bar) instead of stacking cards. */
export function CheckCards({ r, compact }: { r: GearboxResult; compact?: boolean }) {
  const { u } = useStore();
  return (
    <Card title="Checks">
      <p className="card-sub">Utilization is value ÷ limit (or limit ÷ value for minimums). Pass up to 0.85, marginal up to 1.00, fail above. Bars end at 1.2; ticks mark 0.85 and 1.00.</p>
      <ResponsiveTable threshold={compact ? 330 : 600} className={`checks-table${compact ? ' is-compact' : ''}`}>
        <thead>
          <tr>
            <th scope="col">Check</th>
            <th scope="col" className="num">Value</th>
            <th scope="col" className="num">Limit</th>
            <th scope="col" className="util-col">Utilization</th>
            <th scope="col">Status</th>
          </tr>
        </thead>
        <tbody>
          {r.checks.map((c) => {
            const kind = c.status as StatusKind;
            const gov = r.governing?.id === c.id;
            const valueText = c.id === 'cusp' && !Number.isFinite(c.value) ? DASH : checkValue(c.id, c.value, c.unit, u);
            const note = checkNote(c, u, r.innerPinSupport) ?? (c.id === 'cusp' && !Number.isFinite(c.value) ? 'no convex lobe to measure' : c.basis);
            return (
              <tr key={c.id} className={gov ? 'is-gov' : undefined}>
                <th scope="row" data-label="Check">
                  <span className="check-name">{c.label}{gov && <span className="gov-tag">GOVERNING</span>}</span>
                  <span className="check-basis">{u.text(note)}</span>
                </th>
                <td className="num" data-label="Value">{valueText}</td>
                <td className="num" data-label="Limit">{checkLimit(c.id, c.limit, c.unit, c.kind, u)}</td>
                <td className="util-col" data-label="Utilization">
                  <div className="util-cell">
                    <UtilBar value={c.utilization} kind={kind} label={`Utilization ${util(c.utilization)}`} />
                    <span className="util-num">{util(c.utilization)}</span>
                  </div>
                </td>
                <td data-label="Status"><StatusChip kind={kind}>{STATUS_WORD[kind]}</StatusChip></td>
              </tr>
            );
          })}
        </tbody>
      </ResponsiveTable>
      {r.warnings.length > 0 && (
        <ul className="plain-list warn-list">
          {r.warnings.map((w) => <li key={w}>{u.text(w)}</li>)}
        </ul>
      )}
    </Card>
  );
}

