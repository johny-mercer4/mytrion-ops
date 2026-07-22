/**
 * Floating Billing copilot — a fixed launcher + pop-over chat, the same UX as the CS/Sales
 * floating copilots but styled with the billing sky-blue tokens (bm-copilot-*). Streams from
 * the billing department agent via the shared useChat runtime. The zoho widget's "AI Chat" nav
 * tab was a disabled stub; this replaces it as a floating launcher (Phase 3).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { agentKeyFor } from '../../access/mytrions.config';
import type { UserContext } from '../../context/userContext';
import { useChat } from '../../features/chat/useChat';

const SPARK =
  'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z';

const CHIPS = [
  'Total debt outstanding',
  'Unmapped transactions',
  'Prepay balances',
  'Returns needing action',
];

export function BillingCopilot({ user }: { user: UserContext }) {
  const chat = useChat(user, 'billing', agentKeyFor('billing'));
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState('');
  const bodyRef = useRef<HTMLDivElement | null>(null);

  const firstName = (user.userName || 'there').split(/\s+/)[0] || 'there';

  const scroll = useCallback(() => {
    requestAnimationFrame(() => {
      if (bodyRef.current) bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    });
  }, []);

  useEffect(() => {
    if (open) scroll();
  }, [chat.messages, open, scroll]);

  const send = useCallback(
    (raw?: string) => {
      const t = (raw ?? input).trim();
      if (!t || chat.streaming) return;
      chat.send(t);
      setInput('');
      scroll();
    },
    [input, chat, scroll],
  );

  return (
    <>
      {/* LAUNCHER */}
      <button
        type="button"
        className="bm-copilot-fab"
        aria-label="Open Mytrion AI"
        onClick={() =>
          setOpen((o) => {
            const next = !o;
            if (next) scroll();
            return next;
          })
        }
      >
        <span className="bm-copilot-ring" aria-hidden="true" />
        {open ? (
          <svg width="23" height="23" fill="none" stroke="#fff" strokeWidth={2.4} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
          </svg>
        ) : (
          <svg width="24" height="24" fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d={SPARK} />
          </svg>
        )}
      </button>

      {/* PANEL */}
      {open ? (
        <div className="bm-copilot-panel" role="dialog" aria-label="Mytrion AI copilot">
          <div className="bm-copilot-head">
            <div className="bm-copilot-mark">
              <svg width="18" height="18" fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={SPARK} />
              </svg>
              <span className="bm-copilot-dot" />
            </div>
            <div className="bm-copilot-head-txt">
              <div className="bm-copilot-title">Mytrion AI</div>
              <div className="bm-copilot-status">● Online · Billing copilot</div>
            </div>
            <button
              type="button"
              className="bm-copilot-close"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={bodyRef} className="bm-copilot-body">
            {chat.messages.length === 0 ? (
              <div className="bm-copilot-msg bm-copilot-msg-ai">
                <span className="bm-copilot-avatar">
                  <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={SPARK} />
                  </svg>
                </span>
                <div className="bm-copilot-bubble bm-copilot-bubble-ai">
                  Hey {firstName} — I'm Mytrion, your Billing copilot. Ask me about debtors,
                  transactions, prepay balances, or returns.
                </div>
              </div>
            ) : null}

            {chat.messages.map((m) => {
              const ai = m.role !== 'user';
              const dots = ai && m.streaming && !m.text;
              return (
                <div
                  key={m.id}
                  className={`bm-copilot-msg${ai ? ' bm-copilot-msg-ai' : ' bm-copilot-msg-user'}`}
                >
                  {ai ? (
                    <span className="bm-copilot-avatar">
                      <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={SPARK} />
                      </svg>
                    </span>
                  ) : null}
                  {dots ? (
                    <div className="bm-copilot-bubble bm-copilot-bubble-ai bm-copilot-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : (
                    <div className={`bm-copilot-bubble${ai ? ' bm-copilot-bubble-ai' : ' bm-copilot-bubble-user'}`}>
                      {m.error ? <span className="bm-copilot-err">{m.error}</span> : m.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="bm-copilot-foot">
            <div className="bm-copilot-chips">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="bm-copilot-chip"
                  disabled={chat.streaming}
                  onClick={() => send(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="bm-copilot-compose">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask about debtors, transactions, prepay…"
                className="bm-copilot-input"
              />
              <button
                type="button"
                className="bm-copilot-send"
                aria-label="Send"
                disabled={chat.streaming}
                onClick={() => send()}
              >
                <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <line x1="22" y1="2" x2="11" y2="13" />
                  <polygon points="22 2 15 22 11 13 2 9 22 2" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
