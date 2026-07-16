/**
 * Floating CS copilot — a fixed launcher + pop-over chat, the same UX as the Sales
 * Mytrion's floating copilot but styled with the CS "Paper White / Royal Blue" tokens.
 * Streams from the department agent via the shared useChat runtime (department
 * 'customer-service', direct-to-child agent). Replaces the old full "AI Chat" nav tab.
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { agentKeyFor } from '../../access/mytrions.config';
import type { UserContext } from '../../context/userContext';
import { useChat } from '../../features/chat/useChat';

const SPARK =
  'M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z';

const CHIPS = [
  'Open tickets today',
  'Applications pending TA',
  'Citifuel clients in process',
  'How do I onboard a carrier?',
];

export function CsCopilot({ user }: { user: UserContext }) {
  const chat = useChat(user, 'customer-service', agentKeyFor('customer-service'));
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
        className="cs-copilot-fab"
        aria-label="Open Mytrion AI"
        onClick={() =>
          setOpen((o) => {
            const next = !o;
            if (next) scroll();
            return next;
          })
        }
      >
        <span className="cs-copilot-ring" aria-hidden="true" />
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
        <div className="cs-copilot-panel" role="dialog" aria-label="Mytrion AI copilot">
          <div className="cs-copilot-head">
            <div className="cs-copilot-mark">
              <svg width="18" height="18" fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={SPARK} />
              </svg>
              <span className="cs-copilot-dot" />
            </div>
            <div className="cs-copilot-head-txt">
              <div className="cs-copilot-title">Mytrion AI</div>
              <div className="cs-copilot-status">● Online · Customer Service copilot</div>
            </div>
            <button
              type="button"
              className="cs-copilot-close"
              aria-label="Close chat"
              onClick={() => setOpen(false)}
            >
              <svg width="15" height="15" fill="none" stroke="currentColor" strokeWidth={2.4} viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M18 6L6 18M6 6l12 12" />
              </svg>
            </button>
          </div>

          <div ref={bodyRef} className="cs-copilot-body">
            {chat.messages.length === 0 ? (
              <div className="cs-copilot-msg cs-copilot-msg-ai">
                <span className="cs-copilot-avatar">
                  <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d={SPARK} />
                  </svg>
                </span>
                <div className="cs-copilot-bubble cs-copilot-bubble-ai">
                  Hey {firstName} — I'm Mytrion, your Customer Service copilot. Ask me about tickets,
                  applications, Citifuel clients, or how to onboard a carrier.
                </div>
              </div>
            ) : null}

            {chat.messages.map((m) => {
              const ai = m.role !== 'user';
              const dots = ai && m.streaming && !m.text;
              return (
                <div
                  key={m.id}
                  className={`cs-copilot-msg${ai ? ' cs-copilot-msg-ai' : ' cs-copilot-msg-user'}`}
                >
                  {ai ? (
                    <span className="cs-copilot-avatar">
                      <svg width="13" height="13" fill="none" stroke="#fff" strokeWidth={2} viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" d={SPARK} />
                      </svg>
                    </span>
                  ) : null}
                  {dots ? (
                    <div className="cs-copilot-bubble cs-copilot-bubble-ai cs-copilot-typing">
                      <span />
                      <span />
                      <span />
                    </div>
                  ) : (
                    <div className={`cs-copilot-bubble${ai ? ' cs-copilot-bubble-ai' : ' cs-copilot-bubble-user'}`}>
                      {m.error ? <span className="cs-copilot-err">{m.error}</span> : m.text}
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <div className="cs-copilot-foot">
            <div className="cs-copilot-chips">
              {CHIPS.map((c) => (
                <button
                  key={c}
                  type="button"
                  className="cs-copilot-chip"
                  disabled={chat.streaming}
                  onClick={() => send(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <div className="cs-copilot-compose">
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Ask about tickets, applications, clients…"
                className="cs-copilot-input"
              />
              <button
                type="button"
                className="cs-copilot-send"
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
