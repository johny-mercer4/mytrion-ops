import { Button } from '../../ds/Button/Button';
import {
  claimVerificationCase,
  releaseVerificationCase,
  type VerificationCaseDetail,
  type VerificationCaseRow,
} from '../../api/verificationCases';
import { useUserContext } from '../../context/UserContextProvider';
import { ownerMatchesViewer, TRANSFER_UNAVAILABLE, viewerActor } from './verificationCaseDesk';
import { reviewOwnerLabel } from './verificationCaseUi';

export function VerificationCaseQueueBar({
  caseId,
  row,
  busy,
  onAct,
}: {
  caseId: string;
  row: VerificationCaseRow;
  busy: string | null;
  onAct: (label: string, fn: () => Promise<VerificationCaseDetail>) => Promise<void>;
}) {
  const user = useUserContext();
  const review = reviewOwnerLabel(row.cpOwnerUsername);
  const mine = ownerMatchesViewer(row.cpOwnerUsername, viewerActor(user));
  const bound = Boolean(row.requestId);

  return (
    <section className="vf-section">
      <h3 className="vf-section-title">Queue</h3>
      <div className="vf-card-chips">
        <span className={`vf-pill ${review.claimed ? 'is-on' : 'is-mute'}`}>{review.label}</span>
        {row.slaLabel ? (
          <span className={`vf-pill ${row.slaStale ? 'is-warn' : 'is-mute'}`}>{row.slaLabel}</span>
        ) : null}
      </div>
      <p className="vf-stage-note">
        First run does not need a claim. Claim is for manual analyst work only.
      </p>
      <div className="vf-stage-btns">
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(busy) || !bound || review.claimed}
          loading={busy === 'claim'}
          onClick={() => void onAct('claim', () => claimVerificationCase(caseId))}
        >
          Claim
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={Boolean(busy) || !bound || !review.claimed || !mine}
          loading={busy === 'release'}
          onClick={() => void onAct('release', () => releaseVerificationCase(caseId))}
        >
          Release
        </Button>
        <Button variant="ghost" size="sm" disabled title={TRANSFER_UNAVAILABLE}>
          Transfer
        </Button>
      </div>
    </section>
  );
}
