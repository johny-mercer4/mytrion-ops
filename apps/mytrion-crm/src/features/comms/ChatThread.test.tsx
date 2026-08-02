/**
 * ChatThread — the behaviours a chat is unusable without.
 *
 * Focused on what a backend test cannot see: that an optimistic bubble reconciles on its echoed id rather
 * than on matching text (two identical messages must not collapse), that a failed send keeps the user's
 * words instead of losing them, that a realtime frame gap triggers a refetch rather than rendering a hole,
 * and that an internal note is unmistakable.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { MessageDto, ThreadMessages } from '@/api/comms';
import type { CommsFrame } from './useCommsSocket';

const api = vi.hoisted(() => ({
  listThreadMessages: vi.fn(),
  listThreadAttachments: vi.fn(),
  postThreadMessage: vi.fn(),
  uploadThreadAttachment: vi.fn(),
  markThreadRead: vi.fn(),
  getAttachmentLink: vi.fn(),
}));
vi.mock('@/api/comms', () => api);

import { ChatThread } from './ChatThread';

function msg(over: Partial<MessageDto> = {}): MessageDto {
  return {
    id: 'm1',
    seq: 1,
    kind: 'message',
    body: 'Hello there',
    bodyFormat: 'text',
    author: { kind: 'worker', zohoUserId: '77', carrierId: null, name: 'Dilnoza' },
    isInternal: false,
    systemEvent: null,
    mentions: [],
    editedAt: null,
    redactedAt: null,
    createdAt: '2026-08-01T10:00:00.000Z',
    mine: false,
    ...over,
  };
}

function page(messages: MessageDto[]): ThreadMessages {
  return {
    thread: {
      id: 'mth_1',
      kind: 'ticket',
      visibility: 'department',
      department: 'customer-service',
      subject: 'Card activation',
      state: 'open',
      messageCount: messages.length,
      lastMessageSeq: messages.reduce((m, x) => Math.max(m, x.seq), 0),
    },
    messages,
    participants: [
      { kind: 'worker', key: '42', name: 'Ali Karimov', role: 'requester', state: 'active' },
      { kind: 'worker', key: '77', name: 'Dilnoza Karimova', role: 'assignee', state: 'active' },
    ],
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  api.listThreadMessages.mockResolvedValue(page([msg()]));
  api.listThreadAttachments.mockResolvedValue([]);
  api.markThreadRead.mockResolvedValue({ seq: 1 });
});

describe('ChatThread — rendering', () => {
  it('shows one loading state, then the conversation', async () => {
    const { container } = render(<ChatThread threadId="mth_1" />);
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(1);
    expect(await screen.findByText('Hello there')).toBeInTheDocument();
    expect(container.querySelectorAll('[aria-busy="true"]')).toHaveLength(0);
  });

  it('marks the thread read at the highest seq it holds', async () => {
    api.listThreadMessages.mockResolvedValue(page([msg({ id: 'm1', seq: 1 }), msg({ id: 'm2', seq: 7 })]));
    render(<ChatThread threadId="mth_1" />);
    await waitFor(() => expect(api.markThreadRead).toHaveBeenCalledWith('mth_1', 7));
  });

  it('renders a system event as a divider, not a chat bubble', async () => {
    api.listThreadMessages.mockResolvedValue(
      page([msg({ kind: 'system', body: 'Escalated to C-Level — Kamola.', systemEvent: 'advanced' })]),
    );
    render(<ChatThread threadId="mth_1" />);
    const el = await screen.findByText('Escalated to C-Level — Kamola.');
    // A system line must not be attributed to anybody — it is the spine of the escalation, not speech.
    expect(el.className).toMatch(/system/);
  });

  it('labels an internal note explicitly — colour alone is not enough', async () => {
    api.listThreadMessages.mockResolvedValue(page([msg({ isInternal: true, body: 'Do not tell the client' })]));
    render(<ChatThread threadId="mth_1" />);
    expect(await screen.findByText('Internal note')).toBeInTheDocument();
  });

  it('serves a placeholder for a redacted message instead of its text', async () => {
    api.listThreadMessages.mockResolvedValue(
      page([msg({ body: 'oops secret', redactedAt: '2026-08-01T11:00:00.000Z' })]),
    );
    render(<ChatThread threadId="mth_1" />);
    expect(await screen.findByText(/was removed/i)).toBeInTheDocument();
    expect(screen.queryByText('oops secret')).not.toBeInTheDocument();
  });

  it('shows an empty state rather than a blank pane', async () => {
    api.listThreadMessages.mockResolvedValue(page([]));
    render(<ChatThread threadId="mth_1" />);
    expect(await screen.findByText(/no messages yet/i)).toBeInTheDocument();
  });
});

describe('ChatThread — sending', () => {
  it('sends on Enter, clears the box, and echoes a clientMsgId for reconciliation', async () => {
    const user = userEvent.setup();
    api.postThreadMessage.mockResolvedValue({ message: msg({ id: 'm2', seq: 2, mine: true }) });
    render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');

    const box = screen.getByLabelText('Message');
    await user.type(box, 'On it{Enter}');

    await waitFor(() => expect(api.postThreadMessage).toHaveBeenCalled());
    const [, body] = api.postThreadMessage.mock.calls[0] as [string, { body: string; clientMsgId: string }];
    expect(body.body).toBe('On it');
    // Reconciliation must key on an id, not on the text: two identical messages a second apart would
    // otherwise collapse into one bubble.
    expect(body.clientMsgId).toBeTruthy();
    expect(box).toHaveValue('');
  });

  it('Shift+Enter inserts a newline instead of sending', async () => {
    const user = userEvent.setup();
    render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    const box = screen.getByLabelText('Message');
    await user.type(box, 'line one{Shift>}{Enter}{/Shift}line two');
    expect(api.postThreadMessage).not.toHaveBeenCalled();
    expect(box).toHaveValue('line one\nline two');
  });

  it('does not send an empty or whitespace-only message', async () => {
    const user = userEvent.setup();
    render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    await user.type(screen.getByLabelText('Message'), '   {Enter}');
    expect(api.postThreadMessage).not.toHaveBeenCalled();
  });

  it('KEEPS the text and offers a retry when the send fails', async () => {
    const user = userEvent.setup();
    api.postThreadMessage.mockRejectedValue(new Error('offline'));
    render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    await user.type(screen.getByLabelText('Message'), 'important{Enter}');

    expect(await screen.findByText('Not sent')).toBeInTheDocument();
    // Losing what someone typed is the worst failure a chat can have.
    await user.click(screen.getByRole('button', { name: /retry/i }));
    expect(screen.getByLabelText('Message')).toHaveValue('important');
  });

  it('sends an internal note when the toggle is on', async () => {
    const user = userEvent.setup();
    api.postThreadMessage.mockResolvedValue({ message: msg({ id: 'm2', seq: 2, isInternal: true }) });
    render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    await user.click(screen.getByLabelText(/internal note/i));
    await user.type(screen.getByLabelText('Message'), 'fyi{Enter}');
    await waitFor(() =>
      expect(api.postThreadMessage).toHaveBeenCalledWith(
        'mth_1',
        expect.objectContaining({ isInternal: true }),
      ),
    );
  });

  it('hides the internal-note toggle where notes are not allowed', async () => {
    render(<ChatThread threadId="mth_1" allowInternalNotes={false} />);
    await screen.findByText('Hello there');
    expect(screen.queryByLabelText(/internal note/i)).not.toBeInTheDocument();
  });

  it('disables the composer on a closed conversation and says why', async () => {
    render(<ChatThread threadId="mth_1" disabled disabledReason="This ticket is resolved." />);
    await screen.findByText('Hello there');
    const box = screen.getByLabelText('Message');
    expect(box).toBeDisabled();
    expect(box).toHaveAttribute('placeholder', 'This ticket is resolved.');
  });
});

describe('ChatThread — attachments', () => {
  it('uploads a picked file with the caption as one message', async () => {
    const user = userEvent.setup();
    api.uploadThreadAttachment.mockResolvedValue({
      message: msg({ id: 'm2', seq: 2 }),
      attachment: {
        id: 'a1',
        messageId: 'm2',
        name: 'report.pdf',
        mime: 'application/pdf',
        sizeBytes: 2048,
        storage: 'dropbox',
        isInternal: false,
        uploadedBy: '42',
        createdAt: '2026-08-01T10:05:00.000Z',
      },
    });
    render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');

    await user.type(screen.getByLabelText('Message'), 'see attached');
    const file = new File(['pdf-bytes'], 'report.pdf', { type: 'application/pdf' });
    await user.upload(screen.getByLabelText('Choose a file to attach'), file);

    await waitFor(() => expect(api.uploadThreadAttachment).toHaveBeenCalled());
    const [, uploaded, opts] = api.uploadThreadAttachment.mock.calls[0] as [
      string,
      File,
      { body?: string; clientMsgId?: string },
    ];
    expect(uploaded.name).toBe('report.pdf');
    // The caption travels WITH the file, so it is one bubble rather than a comment plus an orphan file.
    expect(opts.body).toBe('see attached');
  });

  it('fetches a download link on click rather than embedding one per row', async () => {
    const user = userEvent.setup();
    api.listThreadAttachments.mockResolvedValue([
      {
        id: 'a1',
        messageId: 'm1',
        name: 'invoice.pdf',
        mime: 'application/pdf',
        sizeBytes: 1024 * 1024,
        storage: 'dropbox',
        isInternal: false,
        uploadedBy: '77',
        createdAt: '2026-08-01T10:01:00.000Z',
      },
    ]);
    api.getAttachmentLink.mockResolvedValue({
      url: 'https://dl.example/x',
      expiresAt: '2026-08-01T14:00:00.000Z',
      name: 'invoice.pdf',
      mime: 'application/pdf',
      sizeBytes: 1024 * 1024,
    });
    const open = vi.spyOn(window, 'open').mockReturnValue(null);
    render(<ChatThread threadId="mth_1" />);

    const chip = await screen.findByRole('button', { name: /invoice\.pdf/ });
    // A Dropbox link is a round trip that expires in ~4h, so nothing is resolved until the user clicks.
    expect(api.getAttachmentLink).not.toHaveBeenCalled();
    expect(screen.getByText('1.0 MB')).toBeInTheDocument();

    await user.click(chip);
    await waitFor(() => expect(api.getAttachmentLink).toHaveBeenCalledWith('mth_1', 'a1'));
    // A new tab: losing an open conversation to a download would be hostile.
    expect(open).toHaveBeenCalledWith('https://dl.example/x', '_blank', 'noopener,noreferrer');
    open.mockRestore();
  });
});

describe('ChatThread — realtime', () => {
  const frame = (over: Partial<CommsFrame> = {}): CommsFrame =>
    ({
      kind: 'comms',
      topic: 'comms:thread:mth_1',
      type: 'comms.thread.message',
      threadId: 'mth_1',
      seq: 2,
      ...over,
    }) as CommsFrame;

  it('fetches only the tail when a message frame arrives', async () => {
    const { rerender } = render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    api.listThreadMessages.mockResolvedValue(page([msg({ id: 'm2', seq: 2, body: 'Live reply' })]));

    rerender(<ChatThread threadId="mth_1" frame={frame()} />);

    expect(await screen.findByText('Live reply')).toBeInTheDocument();
    // afterSeq, not a full reload: a gap-fill must not refetch a long conversation on every message.
    const tail = api.listThreadMessages.mock.calls.find(
      (call) => (call[1] as { afterSeq?: number } | undefined)?.afterSeq !== undefined,
    );
    expect(tail).toBeTruthy();
  });

  it('ignores a frame for a DIFFERENT thread', async () => {
    const { rerender } = render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    const before = api.listThreadMessages.mock.calls.length;
    rerender(<ChatThread threadId="mth_1" frame={frame({ threadId: 'mth_other' })} />);
    await new Promise((r) => setTimeout(r, 10));
    expect(api.listThreadMessages.mock.calls.length).toBe(before);
  });

  it('refreshes the attachment list on an attachment frame', async () => {
    const { rerender } = render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    const before = api.listThreadAttachments.mock.calls.length;
    rerender(<ChatThread threadId="mth_1" frame={frame({ type: 'comms.thread.attachment' })} />);
    await waitFor(() =>
      expect(api.listThreadAttachments.mock.calls.length).toBeGreaterThan(before),
    );
  });

  it('an escalation frame pulls the tail so the system line renders', async () => {
    const { rerender } = render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');
    api.listThreadMessages.mockResolvedValue(
      page([msg({ id: 'm3', seq: 3, kind: 'system', body: 'Handed off to billing — Nodira.' })]),
    );
    rerender(<ChatThread threadId="mth_1" frame={frame({ type: 'comms.escalation.handed_off' })} />);
    expect(await screen.findByText('Handed off to billing — Nodira.')).toBeInTheDocument();
  });

  it('resets completely when the thread changes', async () => {
    const { rerender } = render(<ChatThread threadId="mth_1" />);
    await screen.findByText('Hello there');

    api.listThreadMessages.mockResolvedValue(page([msg({ id: 'z1', seq: 1, body: 'Other thread' })]));
    rerender(<ChatThread threadId="mth_2" />);

    expect(await screen.findByText('Other thread')).toBeInTheDocument();
    // Leaking the previous thread's messages would show one conversation under another's header.
    expect(screen.queryByText('Hello there')).not.toBeInTheDocument();
  });
});
