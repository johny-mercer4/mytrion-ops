/**
 * Refetch the open Verification case when Sales (or anyone) writes it.
 *
 * Same socket the inbox already listens on: `useOctaneRealtime` + a `verification` tag or a
 * `verification.*` type. No second bus. A `caseId=` in the event detail scopes the reload to
 * THIS case so another application's attach does not bounce the pane.
 */
import { useCallback } from 'react';
import { useOctaneRealtime } from '../../sales/redesign/useOctaneRealtime';

export const VERIFICATION_LIVE_TAG = 'verification';

export function caseIdFromLiveDetail(detail: string | null | undefined): string | null {
  const match = detail?.match(/caseId=([A-Za-z0-9_-]+)/);
  return match?.[1] ?? null;
}

export function isVerificationLiveEvent(event: { tag: string | null; type: string }): boolean {
  return event.tag === VERIFICATION_LIVE_TAG || event.type.startsWith('verification.');
}

export function useVerificationCaseLive(caseId: string, refetch: () => void): void {
  const onInboxEvent = useCallback(
    (event: { tag: string | null; type: string; detail?: string | null }) => {
      if (!isVerificationLiveEvent(event)) return;
      const mentioned = caseIdFromLiveDetail(event.detail);
      if (mentioned && mentioned !== caseId) return;
      refetch();
    },
    [caseId, refetch],
  );
  useOctaneRealtime({ onInboxEvent });
}
