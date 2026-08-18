/**
 * The Inbox's wiring, asserted where a browser cannot reach it.
 *
 * `/v1/inbox/messages` is owner-scoped through `resolveZohoUserId`, which throws for any principal
 * without a Zoho id — so the dev-mock auth the screenshot harness runs under can only ever render
 * the error state. These cover the three things that matter and are otherwise unverifiable locally:
 * the list and detail render from real DTO shapes, opening an unread message posts a read receipt,
 * and a socket event scoped to this tag triggers a refetch.
 */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { InboxMessage, InboxMessagePage } from '@/api/inbox';

const listInboxMessages = vi.fn();
const setInboxMessageRead = vi.fn();
const markAllInboxRead = vi.fn();
vi.mock('@/api/inbox', async () => {
  const actual = await vi.importActual<typeof import('@/api/inbox')>('@/api/inbox');
  return {
    ...actual,
    listInboxMessages: (...a: unknown[]) => listInboxMessages(...a),
    setInboxMessageRead: (...a: unknown[]) => setInboxMessageRead(...a),
    markAllInboxRead: (...a: unknown[]) => markAllInboxRead(...a),
  };
});

/** Captured so a test can fire an event exactly as the socket would. */
let onInboxEvent: ((event: { tag: string | null; type: string }) => void) | undefined;
vi.mock('../../sales/redesign/useOctaneRealtime', () => ({
  useOctaneRealtime: (opts: { onInboxEvent?: typeof onInboxEvent }) => {
    onInboxEvent = opts.onInboxEvent;
  },
}));

const { VerificationInbox } = await import('./VerificationInbox');
const { invalidateSwrCache } = await import('../../_shared/swrCache');

function msg(over: Partial<InboxMessage> & { id: string }): InboxMessage {
  return {
    name: 'Ridge & Vale Transport',
    subject: 'New application · Ridge & Vale Transport',
    content: 'Sales created an application for Ridge & Vale Transport.',
    type: 'verification.application.created',
    priority: 'medium',
    tag: 'verification',
    sourceUrl: '/verification/applicants/vc_ridgevale01',
    createdTime: '2026-08-17T09:12:00.000Z',
    ownerId: '6227679000088272001',
    ownerName: 'John Mercer',
    ownerEmail: null,
    readAt: null,
    ...over,
  };
}

const page = (messages: InboxMessage[]): InboxMessagePage => ({
  messages,
  counts: { all: messages.length, unread: messages.filter((m) => !m.readAt).length, task: 0, alert: 0, reminder: messages.length },
  pagination: { limit: 100, offset: 0, total: messages.length, hasMore: false, cursor: null, nextCursor: null },
});

beforeEach(() => {
  // The SWR store is module state and survives between tests; a warm cache would let a stale
  // payload satisfy the next assertion without the fetch ever running.
  invalidateSwrCache('verification:inbox');
  listInboxMessages.mockReset();
  setInboxMessageRead.mockReset().mockResolvedValue(undefined);
  markAllInboxRead.mockReset().mockResolvedValue(undefined);
  onInboxEvent = undefined;
});

describe('VerificationInbox', () => {
  it('asks the server for its own tag, and nothing wider', async () => {
    listInboxMessages.mockResolvedValue(page([msg({ id: 'i1' })]));
    render(<VerificationInbox />);
    await waitFor(() => expect(listInboxMessages).toHaveBeenCalled());
    expect(listInboxMessages.mock.calls[0]?.[0]).toMatchObject({ tag: 'verification' });
  });

  it('renders the subject, its type and the linked case', async () => {
    listInboxMessages.mockResolvedValue(page([msg({ id: 'i1' })]));
    render(<VerificationInbox />);

    // The subject appears twice by design — once in the list, once in the open detail panel.
    await waitFor(() =>
      expect(screen.getAllByText('New application · Ridge & Vale Transport')).toHaveLength(2),
    );
    // The label comes from the event type, not from a category the row does not carry.
    expect(screen.getAllByText('New application').length).toBeGreaterThan(0);
    expect(screen.getByText('vc_ridgevale01')).toBeInTheDocument();
  });

  it('posts a read receipt when an unread message is opened, and not when a read one is', async () => {
    listInboxMessages.mockResolvedValue(
      page([msg({ id: 'i1' }), msg({ id: 'i2', subject: 'Second', readAt: '2026-08-17T10:00:00.000Z' })]),
    );
    render(<VerificationInbox />);
    const rows = await waitFor(() => {
      const found = document.querySelectorAll('.vi-row');
      expect(found).toHaveLength(2);
      return [...found] as HTMLElement[];
    });

    // Row 2 is already read — opening it must not post a receipt.
    await userEvent.click(rows[1]!);
    expect(setInboxMessageRead).not.toHaveBeenCalled();

    await userEvent.click(rows[0]!);
    await waitFor(() => expect(setInboxMessageRead).toHaveBeenCalledWith('i1', true));
  });

  it('marks everything read, and offers nothing to do when nothing is unread', async () => {
    listInboxMessages.mockResolvedValue(page([msg({ id: 'i1' })]));
    render(<VerificationInbox />);
    const button = await screen.findByRole('button', { name: /mark all read/i });
    await userEvent.click(button);
    await waitFor(() => expect(markAllInboxRead).toHaveBeenCalled());

    // A second, independent mount: nothing unread, so the control has nothing to do.
    cleanup();
    invalidateSwrCache('verification:inbox');
    listInboxMessages.mockResolvedValue(page([msg({ id: 'i1', readAt: '2026-08-17T10:00:00.000Z' })]));
    render(<VerificationInbox />);
    await waitFor(() =>
      expect(screen.getByRole('button', { name: /mark all read/i })).toBeDisabled(),
    );
  });

  it('refetches on a verification socket event, and ignores everyone else’s', async () => {
    listInboxMessages.mockResolvedValue(page([msg({ id: 'i1' })]));
    render(<VerificationInbox />);
    await waitFor(() => expect(listInboxMessages).toHaveBeenCalledTimes(1));
    expect(onInboxEvent).toBeTypeOf('function');

    onInboxEvent?.({ tag: 'retention', type: 'retention.claim_request' });
    await new Promise((r) => setTimeout(r, 20));
    expect(listInboxMessages).toHaveBeenCalledTimes(1);

    onInboxEvent?.({ tag: 'verification', type: 'verification.application.created' });
    await waitFor(() => expect(listInboxMessages).toHaveBeenCalledTimes(2));
  });

  it('hands the linked case up rather than navigating itself', async () => {
    listInboxMessages.mockResolvedValue(page([msg({ id: 'i1' })]));
    const onOpenCase = vi.fn();
    render(<VerificationInbox onOpenCase={onOpenCase} />);

    const open = await screen.findByRole('button', { name: /open case/i });
    await userEvent.click(within(open).getByText('Open case'));
    expect(onOpenCase).toHaveBeenCalledWith('vc_ridgevale01');
  });

  it('says nothing is here rather than rendering an empty shell', async () => {
    listInboxMessages.mockResolvedValue(page([]));
    render(<VerificationInbox />);
    await screen.findByText(/no verification inbox messages yet/i);
    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
  });

  it('shows a load failure as an ERROR, never as "no messages"', async () => {
    listInboxMessages.mockRejectedValue(new Error('No Zoho user id on the request'));
    render(<VerificationInbox />);

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/could not load the inbox/i);
    // The two states must not both be on screen: one invites a retry, the other invites patience.
    expect(screen.queryByText(/no verification inbox messages yet/i)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
  });
});
