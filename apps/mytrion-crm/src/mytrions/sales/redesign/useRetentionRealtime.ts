/**
 * Shell-level Octane retention realtime — toast + bus publish so Cases/Pool
 * panes refresh instantly when a case is created or pool/ops events fire.
 */
import { getSession } from '@/api/session';
import {
  parseRetentionCaseId,
  publishRetentionLive,
} from './retentionLiveBus';
import { useOctaneRealtime } from './useOctaneRealtime';
// Suffix-normalized: event ownerId / session id / View-as id may differ by org prefix (zohoIds.ts).
import { zohoIdsMatch } from './zohoIds';

export function useRetentionRealtime(
  currentUserId: string,
  pushToast?: (title: string, msg: string) => void,
): void {
  const sessionZoho = getSession()?.worker.zohoUserId ?? '';
  // When View-as differs from the signed-in worker, subscribe to the acted-as feed too.
  const extraTopics = [
    'retention:pool',
    ...(currentUserId && sessionZoho && !zohoIdsMatch(currentUserId, sessionZoho)
      ? [`inbox:worker:${currentUserId.trim()}`]
      : []),
  ];

  useOctaneRealtime({
    enabled: !!currentUserId,
    extraTopics,
    onInboxEvent: (event) => {
      if (!event.type.startsWith('retention.')) return;

      const forMe = zohoIdsMatch(event.ownerId, currentUserId);
      // Pool-topic peers need claim lifecycle refreshes (toasts stay owner-scoped below).
      const poolBroadcast =
        event.type === 'retention.pool.opened' ||
        event.type === 'retention.claim_request' ||
        event.type === 'retention.claim_approved' ||
        event.type === 'retention.claim_declined';
      if (!forMe && !poolBroadcast) return;

      publishRetentionLive({
        type: event.type,
        ownerId: event.ownerId,
        title: event.title,
        detail: event.detail,
        caseId: parseRetentionCaseId(event.detail),
      });

      // Toasts only for the event owner (avoid every agent toasting Ryan's notify).
      if (!forMe) return;
      if (event.type === 'retention.case.created') {
        pushToast?.(event.title, event.detail ?? 'New retention case — 2 BD to act');
      } else if (event.type === 'retention.pool.opened') {
        pushToast?.(event.title, event.detail ?? 'Deal entered Open Pool');
      } else if (event.type === 'retention.ops.vacation_signoff') {
        pushToast?.(event.title, event.detail ?? 'Ops vacation confirmation needed');
      }
    },
  });
}
