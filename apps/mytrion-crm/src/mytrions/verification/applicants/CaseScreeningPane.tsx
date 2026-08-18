/**
 * Phase 3 working pane — two manual checks against the application facts. No vendor query.
 */
import { Button } from '@/ds';
import type { VerificationDeskDetail } from '@/api/verificationFlow';
import {
  screeningIdentityFacts,
  type ScreeningBlacklistMark,
  type ScreeningDuplicateMark,
  type ScreeningMarks,
} from './caseScreening';

const BLACKLIST: ReadonlyArray<{ id: ScreeningBlacklistMark; label: string }> = [
  { id: 'none', label: 'No match' },
  { id: 'possible', label: 'Possible match' },
  { id: 'confirmed', label: 'Confirmed match' },
];

const DUPLICATE: ReadonlyArray<{ id: ScreeningDuplicateMark; label: string }> = [
  { id: 'no', label: 'No duplicate' },
  { id: 'yes', label: 'Duplicate / active' },
];

export function ScreeningPane({
  detail,
  marks,
  onMarks,
}: {
  detail: VerificationDeskDetail;
  marks: ScreeningMarks;
  onMarks: (next: ScreeningMarks) => void;
}) {
  const c = detail.case as VerificationDeskDetail['case'] & Record<string, unknown>;
  const facts = screeningIdentityFacts(c, detail.principals);

  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Internal screening</h3>
        <span className="va-pane-note">Manual — compare the application against your lists</span>
      </div>

      <div className="va-id-compare" data-cols="2">
        <section className="va-id-col">
          <h4 className="va-field-label">Check A — Blacklist</h4>
          {facts.map((f) => (
            <p className="va-pane-body" key={`a-${f.id}`}>
              {f.label}: {f.value}
            </p>
          ))}
          <div className="va-id-check-marks" role="group" aria-label="Blacklist">
            {BLACKLIST.map((m) => (
              <Button
                key={m.id}
                variant={marks.blacklist === m.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={marks.blacklist === m.id}
                onClick={() => onMarks({ ...marks, blacklist: m.id })}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </section>
        <section className="va-id-col">
          <h4 className="va-field-label">Check B — Active customer / duplicate</h4>
          {facts.map((f) => (
            <p className="va-pane-body" key={`b-${f.id}`}>
              {f.label}: {f.value}
            </p>
          ))}
          <div className="va-id-check-marks" role="group" aria-label="Duplicate">
            {DUPLICATE.map((m) => (
              <Button
                key={m.id}
                variant={marks.duplicate === m.id ? 'secondary' : 'ghost'}
                size="sm"
                aria-pressed={marks.duplicate === m.id}
                onClick={() => onMarks({ ...marks, duplicate: m.id })}
              >
                {m.label}
              </Button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
