import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  getAttachmentLink,
  listThreadAttachments,
  listThreadMessages,
  markThreadRead,
  postThreadMessage,
  uploadThreadAttachment,
  type AttachmentDto,
  type MessageDto,
  type ParticipantDto,
  type ThreadDto,
} from '@/api/comms';
import type { CommsFrame } from './useCommsSocket';
import { clockTime, dayKey, dayLabel, formatBytes, initials } from './chatFormat';
import c from './comms.module.css';

/**
 * The conversation pane — the ONE chat component in the app.
 *
 * Thread-keyed, not ticket-keyed, which is what makes it reusable: a ticket, an escalation and (later) a DM
 * are all a thread, so this renders any of them without a branch. Everything ticket-specific lives in the
 * header its parent passes as `headerSlot`.
 *
 * Realtime is push-driven with a self-heal: the parent forwards `comms:thread:*` frames, and because each
 * frame carries its `seq`, a gap means frames were missed while the socket was down — so the pane refetches
 * the tail rather than silently showing an incomplete conversation.
 */

export interface ChatThreadProps {
  threadId: string;
  /** Ticket/escalation facts rendered above the messages. Keeps this component thread-generic. */
  headerSlot?: React.ReactNode;
  /** Frames for THIS thread, forwarded by the parent's socket. */
  frame?: CommsFrame | null;
  /** Internal notes are a worker affordance; hidden where the surface is client-facing. */
  allowInternalNotes?: boolean;
  /** Called after a successful send/read so a parent list can refresh its unread badge. */
  onActivity?: (() => void) | undefined;
  disabled?: boolean;
  disabledReason?: string;
}

interface Pending {
  clientMsgId: string;
  body: string;
  isInternal: boolean;
  failed: boolean;
  file?: File;
}

const PAGE = 100;

/** The `@query` being typed at the caret, or null. Unicode-aware so non-ASCII names still match. */
const MENTION_RE = /@([\p{L}\p{N}._-]*)$/u;
function mentionQueryAt(value: string, caret: number): string | null {
  const m = MENTION_RE.exec(value.slice(0, caret));
  return m ? (m[1] ?? '') : null;
}

export function ChatThread({
  threadId,
  headerSlot,
  frame,
  allowInternalNotes = true,
  onActivity,
  disabled = false,
  disabledReason,
}: ChatThreadProps) {
  const [thread, setThread] = useState<ThreadDto | null>(null);
  const [messages, setMessages] = useState<MessageDto[]>([]);
  const [participants, setParticipants] = useState<ParticipantDto[]>([]);
  const [attachments, setAttachments] = useState<AttachmentDto[]>([]);
  const [pending, setPending] = useState<Pending[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [draft, setDraft] = useState('');
  const [asNote, setAsNote] = useState(false);
  const [sending, setSending] = useState(false);
  const [linkBusy, setLinkBusy] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  /** The `@` mention query at the caret (null = not mentioning). Drives the teammate picker. */
  const [mentionQuery, setMentionQuery] = useState<string | null>(null);

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // Highest seq we hold. A frame above this+1 means we missed something and must refetch.
  const seenSeqRef = useRef(0);
  // Suppress auto-scroll when the reader has deliberately scrolled up to read history.
  const stickRef = useRef(true);

  const load = useCallback(async () => {
    setError('');
    try {
      const [msgs, files] = await Promise.all([
        listThreadMessages(threadId, { limit: PAGE }),
        listThreadAttachments(threadId).catch(() => [] as AttachmentDto[]),
      ]);
      setThread(msgs.thread);
      setMessages(msgs.messages);
      setParticipants(msgs.participants);
      setAttachments(files);
      seenSeqRef.current = msgs.messages.reduce((m, x) => Math.max(m, x.seq), 0);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [threadId]);

  // Reset every piece of per-thread state on switch: leaking the previous thread's messages for a frame
  // would show one conversation under another's header.
  useEffect(() => {
    setLoading(true);
    setMessages([]);
    setAttachments([]);
    setParticipants([]);
    setPending([]);
    setThread(null);
    seenSeqRef.current = 0;
    stickRef.current = true;
    void load();
  }, [threadId, load]);

  /** Pull only what we are missing. Cheap, and it is also the reconnect gap-fill. */
  const fillTail = useCallback(async () => {
    try {
      const res = await listThreadMessages(threadId, { afterSeq: seenSeqRef.current, limit: PAGE });
      if (res.messages.length === 0) return;
      setMessages((prev) => {
        const have = new Set(prev.map((m) => m.id));
        return [...prev, ...res.messages.filter((m) => !have.has(m.id))];
      });
      setParticipants(res.participants);
      seenSeqRef.current = res.messages.reduce((m, x) => Math.max(m, x.seq), seenSeqRef.current);
    } catch {
      // A failed gap-fill is not worth an error banner — the next frame or a reopen retries.
    }
  }, [threadId]);

  // --- realtime -------------------------------------------------------------------------------
  useEffect(() => {
    if (!frame || frame.threadId !== threadId) return;

    if (frame.type === 'comms.thread.message' || frame.type === 'comms.thread.attachment') {
      // Reconcile an optimistic bubble on its echoed clientMsgId, not on matching the text — two identical
      // messages a second apart would otherwise collapse into one.
      if (frame.clientMsgId) {
        setPending((prev) => prev.filter((p) => p.clientMsgId !== frame.clientMsgId));
      }
      // Any frame beyond the next expected seq means we missed one, so refetch instead of appending a hole.
      void fillTail();
      if (frame.type === 'comms.thread.attachment') {
        void listThreadAttachments(threadId)
          .then(setAttachments)
          .catch(() => undefined);
      }
      return;
    }
    // Escalation movement writes a system message, so the tail fetch is what renders it.
    if (frame.type.startsWith('comms.escalation.')) void fillTail();
  }, [frame, threadId, fillTail]);

  // --- read receipts ---------------------------------------------------------------------------
  const topSeq = messages.reduce((m, x) => Math.max(m, x.seq), 0);
  useEffect(() => {
    if (loading || topSeq === 0) return;
    // Only while the tab is visible: marking read for a conversation nobody is looking at is a lie, and it
    // is the one thing that makes an unread badge untrustworthy.
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    void markThreadRead(threadId, topSeq)
      .then(() => onActivity?.())
      .catch(() => undefined);
  }, [threadId, topSeq, loading, onActivity]);

  // --- scrolling -------------------------------------------------------------------------------
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || !stickRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, pending, loading]);

  const onScroll = (): void => {
    const el = scrollRef.current;
    if (!el) return;
    // 48px of slack: "close enough to the bottom" should survive a rounding difference.
    stickRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 48;
  };

  // --- sending ---------------------------------------------------------------------------------
  const send = useCallback(
    async (opts: { file?: File } = {}) => {
      const body = draft.trim();
      if (!body && !opts.file) return;
      if (sending || disabled) return;

      const clientMsgId = `c_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const optimistic: Pending = {
        clientMsgId,
        body: body || (opts.file?.name ?? ''),
        isInternal: asNote,
        failed: false,
        ...(opts.file ? { file: opts.file } : {}),
      };
      // Resolve @mentions from the body: any worker participant whose name is written as `@Name`. The
      // server re-validates against thread membership, so this can only ever ping people already here.
      const mentions = participants
        .filter((p) => p.kind === 'worker' && p.name && body.includes(`@${p.name}`))
        .map((p) => p.key);

      setPending((prev) => [...prev, optimistic]);
      setDraft('');
      setMentionQuery(null);
      setSending(true);
      stickRef.current = true;

      try {
        if (opts.file) {
          await uploadThreadAttachment(threadId, opts.file, {
            ...(body ? { body } : {}),
            isInternal: asNote,
            clientMsgId,
          });
        } else {
          await postThreadMessage(threadId, {
            body,
            isInternal: asNote,
            clientMsgId,
            ...(mentions.length > 0 ? { mentions } : {}),
          });
        }
        // The frame usually clears the optimistic row first; this covers the case where our own frame is
        // suppressed (the server excludes the author) so nothing else would remove it.
        setPending((prev) => prev.filter((p) => p.clientMsgId !== clientMsgId));
        await fillTail();
        onActivity?.();
      } catch (err) {
        // Keep the bubble and mark it failed rather than dropping the text the user typed.
        setPending((prev) =>
          prev.map((p) => (p.clientMsgId === clientMsgId ? { ...p, failed: true } : p)),
        );
        setError(err instanceof Error ? err.message : String(err));
      } finally {
        setSending(false);
      }
    },
    [draft, sending, disabled, asNote, threadId, fillTail, onActivity, participants],
  );

  /** Worker participants matching the current `@query` — the mention picker's options. */
  const mentionCandidates = useMemo(() => {
    if (mentionQuery === null) return [];
    const q = mentionQuery.toLowerCase();
    return participants
      .filter((p) => p.kind === 'worker' && p.state !== 'left' && p.name)
      .filter((p) => q === '' || (p.name ?? '').toLowerCase().includes(q))
      .slice(0, 6);
  }, [mentionQuery, participants]);

  /** Replace the `@query` at the caret with `@Name ` and record nothing — send() re-derives from text. */
  const insertMention = useCallback(
    (p: ParticipantDto) => {
      const el = inputRef.current;
      const caret = el?.selectionStart ?? draft.length;
      const before = draft.slice(0, caret).replace(MENTION_RE, `@${p.name} `);
      const next = before + draft.slice(caret);
      setDraft(next);
      setMentionQuery(null);
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(before.length, before.length);
      });
    },
    [draft],
  );

  // Telegram-style drop: dragging a file (or several — the first is taken) anywhere over the
  // conversation attaches it. The upload path is the same as the paperclip, so it lands in Dropbox.
  const onDropFiles = useCallback(
    (ev: React.DragEvent): void => {
      ev.preventDefault();
      setDragging(false);
      const file = ev.dataTransfer?.files?.[0];
      if (file && !disabled) void send({ file });
    },
    [send, disabled],
  );
  const dragProps = {
    onDragOver: (ev: React.DragEvent): void => {
      if (disabled) return;
      ev.preventDefault();
      setDragging(true);
    },
    onDragLeave: (ev: React.DragEvent): void => {
      if (!ev.currentTarget.contains(ev.relatedTarget as Node | null)) setDragging(false);
    },
    onDrop: onDropFiles,
  };

  const retry = (p: Pending): void => {
    setPending((prev) => prev.filter((x) => x.clientMsgId !== p.clientMsgId));
    setDraft(p.body);
    setAsNote(p.isInternal);
    inputRef.current?.focus();
  };

  const openAttachment = async (a: AttachmentDto): Promise<void> => {
    setLinkBusy(a.id);
    try {
      const link = await getAttachmentLink(threadId, a.id);
      // A new tab, not a navigation: losing an open conversation to a download is hostile.
      window.open(link.url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLinkBusy(null);
    }
  };

  const byMessage = useMemo(() => {
    const map = new Map<string, AttachmentDto[]>();
    for (const a of attachments) {
      if (!a.messageId) continue;
      const list = map.get(a.messageId) ?? [];
      list.push(a);
      map.set(a.messageId, list);
    }
    return map;
  }, [attachments]);

  const roster = useMemo(
    () => participants.filter((p) => p.state !== 'left').slice(0, 4),
    [participants],
  );
  const extraPeople = Math.max(0, participants.filter((p) => p.state !== 'left').length - roster.length);

  const canSend = (draft.trim().length > 0 || false) && !sending && !disabled;

  return (
    <>
      {headerSlot}

      {roster.length > 0 && (
        <div className={c.chatFacts} style={{ padding: '0 0.85rem 0.4rem' }}>
          <span className={c.people} aria-label={`${participants.length} participants`}>
            {roster.map((p) => (
              <span
                key={`${p.kind}:${p.key}`}
                className={c.avatar}
                title={`${p.name ?? p.key} · ${p.role}`}
              >
                {initials(p.name ?? p.key)}
              </span>
            ))}
            {extraPeople > 0 && (
              <span className={`${c.avatar} ${c.avatarMore}`} title={`${extraPeople} more`}>
                +{extraPeople}
              </span>
            )}
          </span>
          <span className={c.factSep}>·</span>
          <span className={c.fact}>
            {participants.length} {participants.length === 1 ? 'person' : 'people'}
          </span>
        </div>
      )}

      {error && (
        <p className={c.errorNote} role="alert">
          {error}
        </p>
      )}

      <div className={c.messages} ref={scrollRef} onScroll={onScroll} {...dragProps}>
        {loading ? (
          <div aria-busy="true">
            <span className={c.srOnly} role="status">
              Loading conversation…
            </span>
            <div className={c.skelBubble} />
            <div className={c.skelBubbleMine} style={{ marginTop: '0.45rem' }} />
            <div className={c.skelBubble} style={{ marginTop: '0.45rem' }} />
          </div>
        ) : messages.length === 0 && pending.length === 0 ? (
          <div className={c.empty}>
            <div className={c.emptyInner}>
              <span className={c.emptyTitle}>No messages yet</span>
              <span className={c.emptyBody}>Say something to get this moving.</span>
            </div>
          </div>
        ) : (
          messages.map((m, i) => {
            const prev = messages[i - 1];
            const newDay = !prev || dayKey(prev.createdAt) !== dayKey(m.createdAt);
            const files = byMessage.get(m.id) ?? [];
            return (
              <div key={m.id}>
                {newDay && (
                  <div className={c.dayRule} role="separator">
                    {dayLabel(m.createdAt)}
                  </div>
                )}
                {m.kind === 'system' ? (
                  <div className={c.system}>{m.body}</div>
                ) : (
                  <div className={`${c.msgRow} ${m.mine ? c.msgMine : ''}`}>
                    <div className={c.bubbleWrap}>
                      {/* The author line is dropped on a run from the same person — a name repeated on
                          every line is noise once you know who is talking. */}
                      {!m.mine && (!prev || prev.author.zohoUserId !== m.author.zohoUserId || newDay) && (
                        <span className={c.author}>{m.author.name ?? m.author.zohoUserId}</span>
                      )}
                      <div
                        className={`${c.bubble} ${
                          m.isInternal ? c.bubbleNote : m.mine ? c.bubbleMine : c.bubbleTheirs
                        }`}
                      >
                        {m.isInternal && <span className={c.noteFlag}>Internal note</span>}
                        {m.redactedAt ? (
                          <span className={c.redacted}>This message was removed.</span>
                        ) : (
                          m.body
                        )}
                        {files.length > 0 && (
                          <div className={c.attachRow}>
                            {files.map((a) =>
                              isImage(a.mime) ? (
                                <AttachmentImage
                                  key={a.id}
                                  threadId={threadId}
                                  attachment={a}
                                  busy={linkBusy === a.id}
                                  onOpen={(x) => void openAttachment(x)}
                                />
                              ) : (
                                <button
                                  key={a.id}
                                  type="button"
                                  className={c.attach}
                                  onClick={() => void openAttachment(a)}
                                  disabled={linkBusy === a.id}
                                  title={`${a.name}${a.sizeBytes ? ` · ${formatBytes(a.sizeBytes)}` : ''}`}
                                >
                                  <PaperclipIcon />
                                  <span className={c.attachName}>{a.name}</span>
                                  {a.sizeBytes != null && (
                                    <span className={c.attachSize}>{formatBytes(a.sizeBytes)}</span>
                                  )}
                                </button>
                              ),
                            )}
                          </div>
                        )}
                      </div>
                      <span className={c.msgFoot}>
                        <span title={new Date(m.createdAt).toLocaleString()}>
                          {clockTime(m.createdAt)}
                        </span>
                        {m.editedAt && <span>· edited</span>}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}

        {pending.map((p) => (
          <div key={p.clientMsgId} className={`${c.msgRow} ${c.msgMine}`}>
            <div className={c.bubbleWrap}>
              <div className={`${c.bubble} ${p.isInternal ? c.bubbleNote : c.bubbleMine} ${c.pending}`}>
                {p.isInternal && <span className={c.noteFlag}>Internal note</span>}
                {p.body}
                {p.file && (
                  <div className={c.attachRow}>
                    <span className={c.attach}>
                      <PaperclipIcon />
                      <span className={c.attachName}>{p.file.name}</span>
                    </span>
                  </div>
                )}
              </div>
              <span className={`${c.msgFoot} ${p.failed ? c.failed : ''}`}>
                {p.failed ? (
                  <>
                    Not sent
                    <button type="button" className={c.retryBtn} onClick={() => retry(p)}>
                      Retry
                    </button>
                  </>
                ) : (
                  'Sending…'
                )}
              </span>
            </div>
          </div>
        ))}
      </div>

      <div className={`${c.composer}${dragging ? ` ${c.composerDrag}` : ''}`} {...dragProps}>
        <div className={c.composerRow}>
          <input
            ref={fileRef}
            type="file"
            className={c.srOnly}
            onChange={(ev) => {
              const picked = ev.target.files?.[0];
              // Reset first: picking the same file twice in a row must fire again.
              ev.target.value = '';
              if (picked) void send({ file: picked });
            }}
            // A DISTINCT name from the button that opens it: two controls announcing "Attach a file" is
            // ambiguous to a screen reader (and to a test) even though only one is visible.
            aria-label="Choose a file to attach"
          />
          <button
            type="button"
            className={c.iconBtn}
            onClick={() => fileRef.current?.click()}
            disabled={sending || disabled}
            title="Attach a file"
            aria-label="Attach a file"
          >
            <PaperclipIcon />
          </button>
          {mentionQuery !== null && mentionCandidates.length > 0 ? (
            <ul className={c.mentionPicker} role="listbox" aria-label="Mention a teammate">
              {mentionCandidates.map((p, i) => (
                <li key={p.key}>
                  <button
                    type="button"
                    className={i === 0 ? `${c.mentionItem} ${c.mentionItemActive}` : c.mentionItem}
                    // mousedown, not click: fire before the textarea blurs so focus + caret are intact.
                    onMouseDown={(ev) => {
                      ev.preventDefault();
                      insertMention(p);
                    }}
                  >
                    @{p.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
          <textarea
            ref={inputRef}
            className={c.input}
            value={draft}
            onChange={(ev) =>
              {
                setDraft(ev.target.value);
                setMentionQuery(
                  mentionQueryAt(ev.target.value, ev.target.selectionStart ?? ev.target.value.length),
                );
              }
            }
            onPaste={(ev) => {
              // Paste a screenshot / copied image straight into the conversation (Telegram-style).
              const file = ev.clipboardData?.files?.[0];
              if (file && !disabled) {
                ev.preventDefault();
                void send({ file });
              }
            }}
            onKeyDown={(ev) => {
              // While the mention picker is open, Enter/Tab pick the top match instead of sending.
              if (mentionQuery !== null && mentionCandidates.length > 0) {
                if (ev.key === 'Enter' || ev.key === 'Tab') {
                  ev.preventDefault();
                  const first = mentionCandidates[0];
                  if (first) insertMention(first);
                  return;
                }
                if (ev.key === 'Escape') {
                  ev.preventDefault();
                  setMentionQuery(null);
                  return;
                }
              }
              // Enter sends, Shift+Enter is a newline — the convention every chat user already knows.
              if (ev.key === 'Enter' && !ev.shiftKey) {
                ev.preventDefault();
                void send();
              }
            }}
            placeholder={
              disabled ? (disabledReason ?? 'This conversation is closed.') : 'Write a message…'
            }
            rows={1}
            disabled={disabled}
            aria-label="Message"
          />
          <button
            type="button"
            className={c.sendBtn}
            onClick={() => void send()}
            disabled={!canSend}
            title="Send (Enter)"
            aria-label="Send"
          >
            <SendIcon />
          </button>
        </div>
        <div className={c.composerFoot}>
          {allowInternalNotes ? (
            <label className={c.noteToggle}>
              <input
                type="checkbox"
                checked={asNote}
                onChange={(ev) => setAsNote(ev.target.checked)}
                disabled={disabled}
              />
              Internal note — teammates only
            </label>
          ) : (
            <span />
          )}
          <span className={c.hint}>
            {dragging
              ? 'Drop to attach'
              : thread?.state === 'archived'
                ? 'Archived'
                : 'Enter to send · Shift+Enter for a new line'}
          </span>
        </div>
      </div>
    </>
  );
}

function isImage(mime: string | null): boolean {
  return typeof mime === 'string' && mime.startsWith('image/');
}

/**
 * An image attachment rendered inline as a thumbnail. The presigned link is minted on mount — Dropbox
 * links expire, so they are fetched per view rather than embedded in the list payload — and a click
 * opens the full image in a new tab via the same on-demand path as a file attachment. A link that
 * cannot be minted degrades to the file-chip affordance rather than a broken image.
 */
function AttachmentImage({
  threadId,
  attachment,
  busy,
  onOpen,
}: {
  threadId: string;
  attachment: AttachmentDto;
  busy: boolean;
  onOpen: (a: AttachmentDto) => void;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setUrl(null);
    setFailed(false);
    getAttachmentLink(threadId, attachment.id)
      .then((link) => {
        if (!cancelled) setUrl(link.url);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [threadId, attachment.id]);

  if (failed) {
    return (
      <button
        type="button"
        className={c.attach}
        onClick={() => onOpen(attachment)}
        disabled={busy}
        title={attachment.name}
      >
        <PaperclipIcon />
        <span className={c.attachName}>{attachment.name}</span>
      </button>
    );
  }

  return (
    <button
      type="button"
      className={c.attachImg}
      onClick={() => onOpen(attachment)}
      disabled={busy}
      title={attachment.name}
    >
      {url ? (
        <img src={url} alt={attachment.name} loading="lazy" />
      ) : (
        <span className={c.attachImgLoading} aria-label={`Loading ${attachment.name}`} />
      )}
    </button>
  );
}

function PaperclipIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function SendIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M4 12l16-8-6 8 6 8-16-8z"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
