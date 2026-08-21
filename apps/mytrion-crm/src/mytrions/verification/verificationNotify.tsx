/**
 * The desk's arrival notice — one socket subscription at the MODULE root, and a popup top-right.
 *
 * TWO THINGS WERE MISSING, and they compound. The `verification` socket was only listened to inside
 * the Inbox tab and inside an open case, and `ModuleShell` unmounts inactive tabs — so a message
 * arriving while the agent worked a case, or the queue, or Mytrion Watch, reached nobody. And there
 * was no popup anywhere in the app: `ds/ToastProvider` existed and was mounted by nothing, so the
 * only sign a case had arrived was a sidebar badge the agent had to happen to look at.
 *
 * Subscribing here rather than per-tab means one socket for the whole desk, which is also what makes
 * the badge, the popup and any open list agree — they all move on the same frame.
 *
 * TOP RIGHT, deliberately overriding the DS default. `ds/Toast` pins bottom-end and argues for it
 * ("the top of the screen belongs to the header and to the thing the user is reading"), which is the
 * right default for a confirmation of something the user just did. This is the opposite kind of
 * message: unsolicited, about work arriving from another desk, and the thing it must not cover is the
 * case the agent is reading — which on this desk runs down the middle and bottom of the page.
 * `ToastProvider` exposes `className` on the viewport for exactly this ("the rare surface that needs
 * it elsewhere"); only the anchor changes, and the card, both live regions, the motion and the hover
 * pause stay the DS's.
 */
import { useCallback, useRef } from 'react';
import { ToastProvider, useToast } from '@/ds';
import { useOctaneRealtime, type OctaneInboxEvent } from '../sales/redesign/useOctaneRealtime';
import { caseIdFromLiveDetail, isVerificationLiveEvent } from './applicants/useVerificationCaseLive';
import './verificationNotify.css';

/**
 * Types that are LIVE-REFRESH signals, not news.
 *
 * `caseNotify` publishes on the same tag for two different purposes: real inbox messages (a case
 * arrived, documents were requested) and pings that only mean "refetch, something changed" — Sales
 * saving a field, or attaching a file. Toasting the second kind would pop a card every time an agent
 * on the other desk typed into a form, which is how a notification channel gets ignored.
 */
const REFRESH_ONLY = new Set([
  'verification.application.updated',
  'verification.application.documents_uploaded',
]);

function Listener({
  onOpenCase,
  onEvent,
}: {
  onOpenCase: (caseId: string) => void;
  onEvent: () => void;
}) {
  const { toast } = useToast();
  /**
   * Ids already shown, so a reconnect cannot re-announce the backlog.
   *
   * `publishInboxEvent` fans every frame out to the owner's topic AND the admin firehose, so an admin
   * subscribed to both receives the same event twice — without this they see every notice in stereo.
   */
  const seen = useRef<Set<string>>(new Set());

  const onInboxEvent = useCallback(
    (event: OctaneInboxEvent) => {
      if (!isVerificationLiveEvent(event)) return;
      // Every verification frame refreshes the badge and any open list, news or not.
      onEvent();
      if (REFRESH_ONLY.has(event.type)) return;
      if (seen.current.has(event.id)) return;
      seen.current.add(event.id);

      const caseId = caseIdFromLiveDetail(event.detail);
      toast({
        intent: event.priority === 'high' ? 'warning' : 'info',
        title: event.title,
        // The detail carries `caseId=…` for the machine; a person needs the sentence, and on the
        // rows where it is only the marker there is nothing worth printing.
        ...(event.detail && !event.detail.startsWith('caseId=')
          ? { description: event.detail }
          : {}),
        ...(caseId
          ? { action: { label: 'Open case', onClick: () => onOpenCase(caseId) } }
          : {}),
      });
    },
    [toast, onEvent, onOpenCase],
  );

  useOctaneRealtime({ onInboxEvent });
  return null;
}

export function VerificationNotifications({
  onOpenCase,
  onEvent,
}: {
  onOpenCase: (caseId: string) => void;
  /** Refresh whatever counts this desk shows — the rail badge reads the same SWR key. */
  onEvent: () => void;
}) {
  return (
    <ToastProvider className="vf-toasts" dismissLabel="Dismiss notification">
      <Listener onOpenCase={onOpenCase} onEvent={onEvent} />
    </ToastProvider>
  );
}
