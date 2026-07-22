/**
 * CS Shell — subscribe to retention:pool for Open Pool claim queue refreshes.
 */
import { useOctaneRealtime } from '../../sales/redesign/useOctaneRealtime';
import { publishCsRetentionLive } from './retentionLiveBus';

export function useCsRetentionRealtime(
  enabled: boolean,
  onToast?: (title: string, detail: string) => void,
): void {
  useOctaneRealtime({
    enabled,
    extraTopics: ['retention:pool'],
    onInboxEvent: (event) => {
      if (!event.type.startsWith('retention.')) return;
      publishCsRetentionLive({
        type: event.type,
        title: event.title,
        detail: event.detail,
      });
      if (event.type === 'retention.claim_request') {
        onToast?.(event.title, event.detail ?? 'New Open Pool claim awaiting review');
      }
    },
  });
}
