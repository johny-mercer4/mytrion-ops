/**
 * Verification Inbox — the desk's own messages, live.
 *
 * WIRED END TO END, on Mytrion's own plumbing and nothing else:
 *
 *   fetch     `GET /v1/inbox/messages?tag=verification` — owner-scoped SERVER-side
 *             (`resolveZohoUserId`), so a reviewer sees their messages and an admin can View-as.
 *   live      `GET /v1/realtime` via `useOctaneRealtime`, which the API auto-subscribes to the
 *             caller's own inbox topic. `createInboxMessage` persists the row and publishes the
 *             event in the same call, so a new application appears here without a refresh.
 *   read      `POST /v1/inbox/messages/:id/read` when a message is opened, and
 *             `POST /v1/inbox/messages/read-all` behind "Mark all read".
 *
 * WHY A RELOAD RATHER THAN AN OPTIMISTIC PREPEND. The socket frame is an `OctaneInboxEvent`, a
 * narrower shape than `InboxMessage` — no `sourceUrl`, so no linked case, and no `ownerName`.
 * Splicing it in would put a row on screen whose "Open case" button could not work until the next
 * fetch. Verification messages arrive a handful of times a day; one round trip per arrival buys a
 * row that is complete and cannot drift from the list it joins.
 */
import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  Icon,
  Skeleton,
  SkeletonRegion,
  Tabs,
  type BadgeIntent,
  type IconName,
} from '@/ds';
import { markAllInboxRead, setInboxMessageRead, type InboxMessage } from '@/api/inbox';
import { PageHead } from '../../_shared/page';
import { useOctaneRealtime } from '../../sales/redesign/useOctaneRealtime';
import { useVerificationInbox, VERIFICATION_INBOX_TAG } from '../verificationData';
import {
  caseIdFromSource,
  fullWhen,
  inScope,
  isUnread,
  scopeTabs,
  styleFor,
  timelineFor,
  whenLabel,
  type InboxTone,
} from './inboxModel';
import './inbox.css';

const BADGE_INTENT: Record<InboxTone, BadgeIntent> = {
  info: 'info',
  ok: 'success',
  warn: 'warning',
  danger: 'danger',
  plain: 'neutral',
};

export function VerificationInbox({
  onOpenCase,
}: {
  onOpenCase?: ((caseId: string) => void) | undefined;
}) {
  const inbox = useVerificationInbox();
  const [scope, setScope] = useState<string>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const messages = useMemo(() => inbox.data?.messages ?? [], [inbox.data]);
  // One clock for the page, so two rows an hour apart never disagree about "today".
  const now = useMemo(() => Date.now(), [inbox.data]);

  /**
   * A verification message landed on the caller's own topic — refetch.
   *
   * The tag filter matters: the same socket carries retention, collections and carrier events, and
   * this surface is scoped to one tag on the server. Reloading on somebody else's event would spend
   * a round trip to render exactly what is already on screen.
   */
  const onInboxEvent = useCallback(
    (event: { tag: string | null; type: string }) => {
      if (event.tag !== VERIFICATION_INBOX_TAG && !event.type.startsWith('verification.')) return;
      void inbox.reload();
    },
    [inbox],
  );
  useOctaneRealtime({ onInboxEvent });

  const visible = useMemo(() => messages.filter((m) => inScope(m, scope)), [messages, scope]);
  const tabs = useMemo(() => scopeTabs(messages), [messages]);
  const unread = messages.filter(isUnread).length;

  // The selected message follows the filter: a row hidden by a tab change must not stay open in the
  // panel beside a list that no longer contains it.
  const open = visible.find((m) => m.id === openId) ?? visible[0] ?? null;

  const openMessage = async (message: InboxMessage): Promise<void> => {
    setOpenId(message.id);
    if (!isUnread(message)) return;
    try {
      await setInboxMessageRead(message.id, true);
      await inbox.reload();
    } catch {
      // A failed read-receipt must not stop the reviewer reading; the row stays bold and the next
      // open retries. Nothing here is worth a banner.
    }
  };

  const markAll = async (): Promise<void> => {
    setBusy(true);
    try {
      await markAllInboxRead();
      await inbox.reload();
    } finally {
      setBusy(false);
    }
  };

  const firstLoad = inbox.loading && !inbox.data;

  return (
    <SkeletonRegion busy={firstLoad} label="Loading the verification inbox" className="vi-page">
      <PageHead
        title="Inbox"
        description="New cases, documents, escalations and breaches, each linked to its case."
        actions={
          <div className="vi-head-actions">
            <span className="vi-unread">
              <strong className="num">{unread}</strong> unread
            </span>
            <Button
              variant="secondary"
              icon="check"
              loading={busy}
              disabled={unread === 0}
              onClick={() => void markAll()}
            >
              Mark all read
            </Button>
          </div>
        }
      />

      {/* An error ABOVE content means "these rows may be stale". An error INSTEAD of content is a
          different fact and takes the error tone — "no messages" and "we could not find out" must
          never look the same (ds/EmptyState's own contract). */}
      {inbox.error && messages.length > 0 ? (
        <div className="vi-banner" role="alert">
          <Icon name="error" size="sm" />
          <span>
            <strong>Could not refresh the inbox</strong> {inbox.error}
          </span>
        </div>
      ) : null}

      {firstLoad ? (
        <div className="vi-split">
          <Skeleton variant="rect" height="380px" radius="panel" />
          <Skeleton variant="rect" height="380px" radius="panel" />
        </div>
      ) : inbox.error && messages.length === 0 ? (
        <EmptyState
          size="page"
          tone="error"
          title="Could not load the inbox"
          description={inbox.error}
          primaryAction={
            <Button variant="primary" icon="refresh" onClick={() => void inbox.reload()}>
              Try again
            </Button>
          }
        />
      ) : messages.length === 0 ? (
        <EmptyState
          size="page"
          icon="inbox"
          title="No verification inbox messages yet"
          description="New applications, decisions and blacklist notices land here."
        />
      ) : (
        <>
          <Tabs
            items={tabs.map((t) => ({ value: t.id, label: t.label, count: t.count }))}
            value={tabs.some((t) => t.id === scope) ? scope : 'all'}
            onValueChange={setScope}
            variant="line"
            aria-label="Filter inbox messages"
          />

          <div className="vi-split">
            <ul className="vi-list">
              {visible.map((message) => {
                const style = styleFor(message.type);
                const unreadRow = isUnread(message);
                return (
                  <li key={message.id}>
                    <button
                      type="button"
                      className="vi-row"
                      data-tone={style.tone}
                      data-unread={unreadRow}
                      data-selected={open?.id === message.id}
                      aria-current={open?.id === message.id ? 'true' : undefined}
                      onClick={() => void openMessage(message)}
                    >
                      <span
                        className="vi-dot"
                        aria-hidden="true"
                        // The bold subject carries "unread" too — the dot is reinforcement.
                      />
                      <span className="vi-chip" aria-hidden="true">
                        <Icon name={style.icon as IconName} size="sm" />
                      </span>
                      <span className="vi-row-body">
                        <span className="vi-subject">{message.subject}</span>
                        <span className="vi-row-meta">
                          <span className="t-eyebrow vi-row-type">{style.label}</span>
                          <span className="vi-row-sep" aria-hidden="true" />
                          <span className="vi-row-when num">
                            {whenLabel(message.createdTime, now)}
                          </span>
                          {unreadRow ? <span className="sr-only">Unread</span> : null}
                        </span>
                      </span>
                    </button>
                  </li>
                );
              })}
              {visible.length === 0 ? (
                <li className="vi-none">Nothing in this filter.</li>
              ) : null}
            </ul>

            {open ? <MessageDetail message={open} onOpenCase={onOpenCase} /> : null}
          </div>

          {inbox.data?.pagination.hasMore ? (
            <p className="vi-window">
              {messages.length} most recent of {inbox.data.pagination.total}.
            </p>
          ) : null}
        </>
      )}
    </SkeletonRegion>
  );
}

function MessageDetail({
  message,
  onOpenCase,
}: {
  message: InboxMessage;
  // `| undefined` because tsconfig sets exactOptionalPropertyTypes — see the note in ds/Icon.
  onOpenCase?: ((caseId: string) => void) | undefined;
}) {
  const style = styleFor(message.type);
  const caseId = caseIdFromSource(message.sourceUrl);
  const timeline = timelineFor(message);

  return (
    <div className="vi-detail" data-tone={style.tone}>
      <span className="vi-detail-edge" aria-hidden="true" />

      <div className="vi-detail-head">
        <div className="vi-detail-title-row">
          <span className="vi-detail-glyph" aria-hidden="true">
            <Icon name={style.icon as IconName} />
          </span>
          <div className="vi-detail-titles">
            <h2 className="vi-detail-subject">{message.subject}</h2>
            <div className="vi-detail-meta">
              <Badge intent={BADGE_INTENT[style.tone]} icon={style.icon as IconName}>
                {style.label}
              </Badge>
              {message.ownerName ? (
                <span className="vi-detail-from">
                  to <strong>{message.ownerName}</strong>
                </span>
              ) : null}
              <span className="vi-detail-sep" aria-hidden="true" />
              <span className="vi-detail-when num">{fullWhen(message.createdTime)}</span>
            </div>
          </div>
        </div>
        {message.content ? <p className="vi-detail-body">{message.content}</p> : null}
      </div>

      <div className="vi-detail-panes">
        <div className="vi-linked">
          <span className="vi-linked-text">
            <span className="t-eyebrow">Linked case</span>
            <span className="vi-linked-id num" data-empty={caseId == null}>
              {caseId ?? 'Not linked to a case'}
            </span>
          </span>
          {caseId && onOpenCase ? (
            <Button variant="primary" iconEnd="arrow_forward" onClick={() => onOpenCase(caseId)}>
              Open case
            </Button>
          ) : null}
        </div>

        <div className="vi-timeline-block">
          <h3 className="t-eyebrow vi-timeline-title">How it got here</h3>
          <ol className="vi-timeline">
            {timeline.map((event, i) => (
              <li className="vi-tl-row" key={event.text}>
                <span className="vi-tl-mark" aria-hidden="true">
                  <span className="vi-tl-dot" data-first={i === 0} />
                  <span className="vi-tl-rail" data-last={i === timeline.length - 1} />
                </span>
                <span className="vi-tl-text">
                  <span className="vi-tl-what">{event.text}</span>
                  <span className="vi-tl-when num">{event.when}</span>
                </span>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </div>
  );
}
