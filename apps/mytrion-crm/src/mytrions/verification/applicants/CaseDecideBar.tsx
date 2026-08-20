/**
 * The case decision bar — Pass / pending docs / manager / deposit / Decline.
 *
 * Split from CaseView so Phase 5/6 gates do not push that file over the cap.
 */
import { Button, Icon } from '@/ds';
import type { VerificationPhaseOutcome } from '@/api/verificationFlow';
import type { CaseActionKey } from './caseActions';

export function CaseDecideBar({
  note,
  showDecide,
  canAct,
  idle,
  passReady,
  pending,
  pendingDocs,
  showDeposit,
  onDecide,
  onRequestDocs,
  declineOutcome,
}: {
  note: string;
  showDecide: boolean;
  canAct: boolean;
  idle: boolean;
  passReady: boolean;
  pending: CaseActionKey | null;
  pendingDocs: boolean;
  showDeposit: boolean;
  onDecide: (outcome: VerificationPhaseOutcome) => void;
  onRequestDocs: () => void;
  declineOutcome: VerificationPhaseOutcome;
}) {
  return (
    <footer className="va-decide">
      <span className="va-decide-note" data-tone={showDecide ? 'plain' : 'muted'}>
        <Icon name={showDecide ? 'shield' : 'lock'} size="sm" />
        {note}
      </span>
      {showDecide ? (
        <div className="va-decide-actions">
          <Button
            variant="primary"
            icon="check"
            loading={pending === 'pass'}
            disabled={!canAct || !idle || !passReady}
            onClick={() => onDecide('pass')}
          >
            Pass phase
          </Button>
          {pendingDocs ? (
            <Button
              variant="secondary"
              icon="cloud_upload"
              loading={pending === 'request'}
              disabled={!canAct || !idle}
              onClick={onRequestDocs}
            >
              Pending documents
            </Button>
          ) : null}
          <Button
            variant="secondary"
            icon="gavel"
            loading={pending === 'manager'}
            disabled={!canAct || !idle}
            onClick={() => onDecide('manager_review')}
          >
            Send to manager
          </Button>
          {showDeposit ? (
            <Button
              variant="secondary"
              icon="payments"
              loading={pending === 'deposit'}
              disabled={!canAct || !idle}
              onClick={() => onDecide('deposit_prepaid')}
            >
              Deposit / prepaid
            </Button>
          ) : null}
          <Button
            variant="danger"
            icon="block"
            loading={pending === 'decline'}
            disabled={!canAct || !idle}
            onClick={() => onDecide(declineOutcome)}
          >
            Decline
          </Button>
        </div>
      ) : null}
    </footer>
  );
}
