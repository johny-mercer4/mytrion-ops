/**
 * Phase 6 — both reviews, in the order Phase 5 stored (or the same computed order until then).
 */
import { Button } from '@/ds';
import type { VerificationDeskDetail, VerificationReviewOrder } from '@/api/verificationFlow';
import {
  BANKING_CHECKS,
  CREDIT_CRITERIA,
  type BankingMark,
  type CreditBankingMarks,
  type CreditVerdict,
} from './caseCreditBanking';
import { reviewOrderLabel } from './caseRouting';

const CREDIT_VERDICTS: ReadonlyArray<{ id: CreditVerdict; label: string }> = [
  { id: 'strong', label: 'Strong' },
  { id: 'acceptable', label: 'Acceptable' },
  { id: 'borderline', label: 'Borderline / Mixed' },
  { id: 'unacceptable', label: 'Unacceptable' },
];

const BANK_MARKS: ReadonlyArray<{ id: BankingMark; label: string }> = [
  { id: 'ok', label: 'OK' },
  { id: 'missing', label: 'Missing' },
  { id: 'concern', label: 'Concern' },
];

function CreditBlock({
  marks,
  onMarks,
}: {
  marks: CreditBankingMarks;
  onMarks: (next: CreditBankingMarks) => void;
}) {
  return (
    <section className="va-cb-block">
      <h3 className="va-cb-title">Credit report review</h3>
      <p className="va-pane-body">Manual — no bureau pull. Mark the profile from the file.</p>
      <ul className="va-cb-criteria">
        {CREDIT_CRITERIA.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ul>
      <div className="va-id-check" data-mark={marks.credit ?? 'unset'}>
        <div className="va-id-check-copy">
          <span className="va-id-check-label">Credit profile result</span>
          <span className="va-id-check-value">
            Strong or Acceptable passes this side. Borderline goes to the manager. Unacceptable is
            a deposit / prepaid offer.
          </span>
        </div>
        <div className="va-id-check-marks" role="group" aria-label="Credit profile result">
          {CREDIT_VERDICTS.map((m) => (
            <Button
              key={m.id}
              variant={marks.credit === m.id ? 'secondary' : 'ghost'}
              size="sm"
              aria-pressed={marks.credit === m.id}
              onClick={() => onMarks({ ...marks, credit: m.id })}
            >
              {m.label}
            </Button>
          ))}
        </div>
      </div>
    </section>
  );
}

function BankingBlock({
  marks,
  onMarks,
}: {
  marks: CreditBankingMarks;
  onMarks: (next: CreditBankingMarks) => void;
}) {
  return (
    <section className="va-cb-block">
      <h3 className="va-cb-title">Banking review — last 3 months</h3>
      <p className="va-pane-body">Manual — prompt to be drafted. Missing rows ask Sales for statements.</p>
      <div className="va-id-checks">
        {BANKING_CHECKS.map((check) => {
          const mark = marks.banking[check.id];
          return (
            <div className="va-id-check" key={check.id} data-mark={mark ?? 'unset'}>
              <div className="va-id-check-copy">
                <span className="va-id-check-label">{check.label}</span>
              </div>
              <div className="va-id-check-marks" role="group" aria-label={check.label}>
                {BANK_MARKS.map((m) => (
                  <Button
                    key={m.id}
                    variant={mark === m.id ? 'secondary' : 'ghost'}
                    size="sm"
                    aria-pressed={mark === m.id}
                    onClick={() =>
                      onMarks({ ...marks, banking: { ...marks.banking, [check.id]: m.id } })
                    }
                  >
                    {m.label}
                  </Button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function CreditBankingPane({
  detail,
  order,
  source,
  assumedMissingTrucks,
  marks,
  onMarks,
}: {
  detail: VerificationDeskDetail;
  order: VerificationReviewOrder;
  source: 'phase5' | 'computed';
  assumedMissingTrucks: boolean;
  marks: CreditBankingMarks;
  onMarks: (next: CreditBankingMarks) => void;
}) {
  const first = order === 'banking_first' ? 'banking' : 'credit';
  return (
    <div className="va-stack">
      <div className="va-pane-head">
        <h3 className="va-phase-title">Credit &amp; banking</h3>
        <span className="va-pane-note">
          Both reviews must be completed before Phase 7 unless the applicant is declined earlier.
        </span>
      </div>
      <p className="va-pane-body">
        Order: {reviewOrderLabel(order)}
        {source === 'phase5' ? ' — confirmed in Routing.' : ' — same rule as Routing.'}
        {assumedMissingTrucks
          ? ' Truck count is missing, so credit is first until a count is saved.'
          : null}{' '}
        {detail.case.trucksCount == null ? null : `${detail.case.trucksCount} trucks on file.`}
      </p>
      <div className="va-cb-cols">
        {first === 'banking' ? (
          <>
            <BankingBlock marks={marks} onMarks={onMarks} />
            <CreditBlock marks={marks} onMarks={onMarks} />
          </>
        ) : (
          <>
            <CreditBlock marks={marks} onMarks={onMarks} />
            <BankingBlock marks={marks} onMarks={onMarks} />
          </>
        )}
      </div>
    </div>
  );
}
