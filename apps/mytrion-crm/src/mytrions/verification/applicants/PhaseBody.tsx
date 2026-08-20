/**
 * The working pane for the active underwriting phase.
 *
 * Split from CaseView so that file stays under the cap after the live-refresh hook landed.
 * Phases 2–6 are the manual SOP panes; 1 is the editable application; 7, 9 and 10 keep the
 * desk's remaining write surfaces; everything else is the recorded-so-far summary.
 */
import { addDeskPrincipal, removeDeskPrincipal } from '@/api/verificationDeskWrites';
import {
  patchDeskIntake,
  runScreening,
  saveRiskAssessment,
  setScreeningVerdict,
  submitFinalDecision,
  type VerificationDeskDetail,
  type VerificationRailPhase,
} from '@/api/verificationFlow';

import { DecisionPane, RiskPane } from '../flow/ReviewPanes';
import { IntakePane } from './CaseIntakePane';
import { IdentityPane } from './CaseIdentityPane';
import { runAuthorityLookup } from '@/api/verificationDeskWrites';
import { HardStopsPane } from './CaseHardStopsPane';
import type { HardStopAck } from './caseHardStops';
import { ScreeningPane } from './CaseScreeningPane';
import { AuthorityPane } from './CaseAuthorityPane';
import { CreditBankingPane } from './CaseCreditBankingPane';
import { RoutingPane } from './CaseRoutingPane';
import { RecordedPane } from './CasePanes';
import type { CaseActionKey } from './caseActions';
import type { IdentityMark } from './caseIdentity';
import type { ScreeningMarks } from './caseScreening';
import type { AuthorityMarks } from './caseAuthority';
import type { CreditBankingMarks } from './caseCreditBanking';
import { deskReviewOrder } from './caseRouting';

export function PhaseBody({
  detail,
  phase,
  caseId,
  pending,
  canAct,
  canScreen,
  hardStopAck,
  onHardStopAck,
  onGoToPhase,
  wexCardCutoff,
  onRun,
  identityMarks,
  onIdentityMarks,
  screeningMarks,
  onScreeningMarks,
  authorityMarks,
  onAuthorityMarks,
  creditBankingMarks,
  onCreditBankingMarks,
}: {
  detail: VerificationDeskDetail;
  phase: VerificationRailPhase;
  caseId: string;
  pending: CaseActionKey | null;
  canAct: boolean;
  /** Screening runs on a LOCKED case; only a decided one is out of reach. See CaseScreeningPane. */
  canScreen: boolean;
  /** Phase 7's own record. The stops are derived; the reviewer's read of them was captured nowhere. */
  hardStopAck: HardStopAck | null;
  onHardStopAck: (next: HardStopAck) => void;
  /** Phase 7 sends the reviewer back to Phase 6 when the figure it needs was never recorded. */
  onGoToPhase: (code: string) => void;
  wexCardCutoff: number | null;
  onRun: (scope: CaseActionKey, fn: () => Promise<VerificationDeskDetail>) => Promise<void>;
  identityMarks: Record<string, IdentityMark>;
  onIdentityMarks: (next: Record<string, IdentityMark>) => void;
  screeningMarks: ScreeningMarks;
  onScreeningMarks: (next: ScreeningMarks) => void;
  authorityMarks: AuthorityMarks;
  onAuthorityMarks: (next: AuthorityMarks) => void;
  creditBankingMarks: CreditBankingMarks;
  onCreditBankingMarks: (next: CreditBankingMarks) => void;
}) {
  /* A pane is disabled while ANY action runs — two concurrent saves against one case would race —
     but only the pane whose action is running says it is busy. That distinction is the whole fix:
     `disabled` is shared, `busy` is not. */
  const idle = pending === null;
  switch (phase.code) {
    case 'p1_intake':
      return (
        <IntakePane
          detail={detail}
          wexCardCutoff={wexCardCutoff}
          closed={Boolean(detail.case.closedAt)}
          busy={pending === 'intake'}
          principalBusy={pending === 'principal'}
          onSave={(body) => onRun('intake', () => patchDeskIntake(caseId, body))}
          onAddPrincipal={(fullName) =>
            onRun('principal', () => addDeskPrincipal(caseId, { fullName }))
          }
          onRemovePrincipal={(principalId) =>
            onRun('principal', () => removeDeskPrincipal(caseId, principalId))
          }
        />
      );
    case 'p2_identity':
      return (
        <IdentityPane
          detail={detail}
          caseId={caseId}
          marks={identityMarks}
          onMarks={onIdentityMarks}
        />
      );
    case 'p3_screening':
      return (
        <ScreeningPane
          detail={detail}
          marks={screeningMarks}
          onMarks={onScreeningMarks}
          canAct={canAct}
          canScreen={canScreen}
          running={pending === 'screening'}
          verdictBusy={pending === 'screening'}
          /* `runScreening` was a route and a client function nothing ever called — this is the door.
             It reports through the same one-action-at-a-time `pending` key every other pane uses. */
          onRun={() => void onRun('screening', () => runScreening(caseId))}
          onVerdict={(hitId, verdict) =>
            void onRun('screening', () => setScreeningVerdict(caseId, hitId, { verdict }))
          }
        />
      );
    case 'p4_authority':
      return (
        <AuthorityPane
          detail={detail}
          caseId={caseId}
          marks={authorityMarks}
          onMarks={onAuthorityMarks}
          canAct={canAct}
          canScreen={canScreen}
          running={pending === 'authority'}
          /* Same one-action-at-a-time `pending` key every other pane reports through. */
          onRun={() => void onRun('authority', () => runAuthorityLookup(caseId))}
        />
      );
    case 'p5_routing':
      return (
        <RoutingPane
          detail={detail}
          closed={Boolean(detail.case.closedAt)}
          busy={pending === 'intake'}
          onSave={(body) => onRun('intake', () => patchDeskIntake(caseId, body))}
        />
      );
    case 'p6_credit_banking': {
      const routing = deskReviewOrder(detail);
      // `credit` and `banking` stay separate action keys: separate routes, separate saves, and the
      // error slot has to land beside the step that failed. Each step passes its own scope up.
      return (
        <CreditBankingPane
          detail={detail}
          caseId={caseId}
          order={routing.order}
          source={routing.source}
          assumedMissingTrucks={routing.assumedMissingTrucks}
          marks={creditBankingMarks}
          onMarks={onCreditBankingMarks}
          canAct={canAct}
          /* One `pending` key for both steps: they save to different routes but the reviewer is on
             one step at a time, and two spinners for one region is the double-loader this app bans. */
          busy={pending === 'credit' || pending === 'banking'}
          onSaved={(scope, run) => void onRun(scope, run)}
        />
      );
    }
    case 'p7_hard_stops':
      return (
        <HardStopsPane
          detail={detail}
          ack={hardStopAck}
          onAck={onHardStopAck}
          canAct={canAct}
          onGoToPhase={onGoToPhase}
        />
      );
    case 'p9_risk_capacity':
      return (
        <RiskPane
          detail={detail}
          busy={pending === 'risk'}
          disabled={!canAct || !idle}
          onSave={(b) => void onRun('risk', () => saveRiskAssessment(caseId, b))}
        />
      );
    case 'p10_decision':
      return (
        <DecisionPane
          detail={detail}
          busy={pending === 'decision'}
          disabled={!canAct || !idle}
          onDecide={(b) => void onRun('decision', () => submitFinalDecision(caseId, b))}
        />
      );
    default:
      return <RecordedPane detail={detail} phase={phase} wexCardCutoff={wexCardCutoff} />;
  }
}
