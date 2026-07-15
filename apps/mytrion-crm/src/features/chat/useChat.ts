import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  deleteConversation,
  getConversation,
  listConversations,
  type ConversationSummary,
} from '../../api/chat';
import {
  streamAgent,
  streamChat,
  type ChatRequestBody,
  type Elicitation,
} from '../../api/stream';
import { ApiError } from '../../api/transport';
import { getSession } from '../../api/session';
import { AGENT_LABELS, type AgentKey } from '../../access/mytrions.config';
import type { UserContext } from '../../context/userContext';
import { getLastConversationId, setLastConversationId } from './chatStorage';
import { blankMessage, type ErrorKind, type UiMessage } from './types';

/** Route through the orchestrator/agent runtime by default; VITE_USE_AGENT=0 falls back to /v1/chat. */
const USE_AGENT_RUNTIME = import.meta.env.VITE_USE_AGENT !== '0';

interface State {
  messages: UiMessage[];
  conversationId: string | null;
  streaming: boolean;
  conversations: ConversationSummary[];
  error: string | null;
}

type Action =
  | { type: 'send'; text: string; userId: string; assistantId: string }
  | { type: 'appendToken'; text: string }
  | { type: 'patchAssistant'; patch: Partial<UiMessage> }
  | { type: 'addTool'; name: string }
  | { type: 'updateTool'; name: string; status: string }
  | { type: 'setElicitation'; elicitation: Elicitation }
  | { type: 'appendAgentPath'; key: string }
  | { type: 'setConversationId'; id: string }
  | { type: 'stopStream' }
  | { type: 'streamEnd' }
  | { type: 'retryTurn'; assistantId: string }
  | { type: 'setConversations'; conversations: ConversationSummary[] }
  | { type: 'loadTranscript'; conversationId: string; messages: UiMessage[] }
  | { type: 'newConversation' }
  | { type: 'setError'; error: string | null };

const EMPTY: State = { messages: [], conversationId: null, streaming: false, conversations: [], error: null };

/** A stable client id for a freshly-created message row (crypto when available, else a session counter). */
let uidSeq = 0;
function uid(): string {
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  uidSeq += 1;
  return `m_${uidSeq}`;
}

/** Apply `fn` to the last assistant message immutably. */
function patchLastAssistant(messages: UiMessage[], fn: (m: UiMessage) => UiMessage): UiMessage[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const m = messages[i];
    if (m && m.role === 'assistant') {
      const next = messages.slice();
      next[i] = fn(m);
      return next;
    }
  }
  return messages;
}

/** Classify a stream failure so the bubble copy + retry affordance fit the cause. */
export function classifyStreamError(e: unknown): { message: string; kind: ErrorKind } {
  if (e instanceof ApiError) {
    if (e.status === 429) {
      return { message: 'Too many requests — wait a moment, then retry.', kind: 'rate-limit' };
    }
    if (e.status >= 500) {
      return { message: `The AI service had a problem (${e.message})`, kind: 'server' };
    }
    if (e.code === 'NETWORK' || e.status === 0) {
      return { message: 'Connection lost — check your network and retry.', kind: 'network' };
    }
    return { message: e.message, kind: 'stream' };
  }
  return { message: e instanceof Error ? e.message : String(e), kind: 'stream' };
}

export function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'send':
      return {
        ...state,
        streaming: true,
        error: null,
        messages: [
          // Retire any open picker: sending IS the answer to it.
          ...state.messages.map((m) => (m.elicitation ? { ...m, elicitation: null } : m)),
          blankMessage(action.userId, 'user', action.text),
          { ...blankMessage(action.assistantId, 'assistant'), status: 'Thinking…', streaming: true },
        ],
      };
    case 'appendToken':
      return { ...state, messages: patchLastAssistant(state.messages, (m) => ({ ...m, text: m.text + action.text, status: '' })) };
    case 'patchAssistant':
      return { ...state, messages: patchLastAssistant(state.messages, (m) => ({ ...m, ...action.patch })) };
    case 'addTool':
      return {
        ...state,
        messages: patchLastAssistant(state.messages, (m) =>
          m.tools.some((t) => t.name === action.name)
            ? m
            : { ...m, tools: [...m.tools, { name: action.name, status: 'running' }] },
        ),
      };
    case 'updateTool':
      return {
        ...state,
        messages: patchLastAssistant(state.messages, (m) => ({
          ...m,
          tools: m.tools.map((t) => (t.name === action.name ? { ...t, status: action.status } : t)),
        })),
      };
    case 'setElicitation':
      return { ...state, messages: patchLastAssistant(state.messages, (m) => ({ ...m, elicitation: action.elicitation })) };
    case 'appendAgentPath':
      return {
        ...state,
        messages: patchLastAssistant(state.messages, (m) =>
          m.agentPath.at(-1) === action.key
            ? m
            : { ...m, agentKey: action.key, agentPath: [...m.agentPath, action.key] },
        ),
      };
    case 'setConversationId':
      return { ...state, conversationId: action.id };
    case 'stopStream':
      // User pressed Stop: keep partial text, mark the row; the aborted stream's finally still
      // runs streamEnd (idempotent) and detaches the controller itself.
      return {
        ...state,
        streaming: false,
        messages: patchLastAssistant(state.messages, (m) => ({ ...m, streaming: false, stopped: true, status: '' })),
      };
    case 'streamEnd':
      // Minimal finalize — must not clear stopped/agentPath/citations set earlier in the turn.
      return { ...state, streaming: false, messages: patchLastAssistant(state.messages, (m) => ({ ...m, streaming: false, status: '' })) };
    case 'retryTurn': {
      const idx = state.messages.findIndex((m) => m.id === action.assistantId);
      if (idx < 0) return state;
      // Remove the failed assistant row and its preceding user row (the pair being retried).
      const from = idx > 0 && state.messages[idx - 1]?.role === 'user' ? idx - 1 : idx;
      return { ...state, messages: [...state.messages.slice(0, from), ...state.messages.slice(idx + 1)] };
    }
    case 'setConversations':
      return { ...state, conversations: action.conversations };
    case 'loadTranscript':
      return { ...state, conversationId: action.conversationId, messages: action.messages, error: null };
    case 'newConversation':
      // Optimistically unlock the composer: a proxy stream can't be cancelled, so we don't wait for
      // its (now-ignored) response to flip streaming off. The stale stream's frames are dropped by
      // its abort signal, and its finally won't touch state once a newer controller has replaced it.
      return { ...state, conversationId: null, messages: [], error: null, streaming: false };
    case 'setError':
      return { ...state, error: action.error };
    default:
      return state;
  }
}

export interface ChatController {
  messages: UiMessage[];
  conversations: ConversationSummary[];
  conversationId: string | null;
  streaming: boolean;
  error: string | null;
  send(text: string): void;
  /** Abort the in-flight generation, keeping the partial answer. */
  stop(): void;
  /** Re-send the user message behind a failed assistant row. */
  retry(assistantId: string): void;
  newConversation(): void;
  openConversation(id: string, opts?: { silent?: boolean }): Promise<void>;
  removeConversation(id: string): Promise<void>;
  refreshConversations(): Promise<void>;
}

export function useChat(
  ctx: UserContext,
  department: string | string[] | null,
  agentKey: AgentKey | null = null,
): ChatController {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const restoredForRef = useRef<string | null>(null);
  const zohoUserId = ctx.userId;

  const refreshConversations = useCallback(async () => {
    if (!zohoUserId) return;
    try {
      const { conversations } = await listConversations(zohoUserId);
      dispatch({ type: 'setConversations', conversations });
    } catch {
      /* non-fatal: history just stays as-is */
    }
  }, [zohoUserId]);

  useEffect(() => {
    void refreshConversations();
  }, [refreshConversations]);

  const send = useCallback(
    (raw: string) => {
      const text = raw.trim();
      if (!text || state.streaming) return;
      dispatch({ type: 'send', text, userId: uid(), assistantId: uid() });

      const controller = new AbortController();
      abortRef.current = controller;

      const body: ChatRequestBody = { message: text };
      if (state.conversationId) body.conversationId = state.conversationId;
      if (ctx.userId) body.zoho_user_id = ctx.userId;
      if (ctx.userName) body.user_name = ctx.userName;
      const sessionEmail = getSession()?.worker.email?.trim();
      if (sessionEmail) body.email = sessionEmail;
      if (ctx.profile) body.profile = ctx.profile;
      if (ctx.role) body.role = ctx.role;
      if (department) body.department_scope = department;
      if (agentKey && USE_AGENT_RUNTIME) body.agent = agentKey;

      const run = USE_AGENT_RUNTIME ? streamAgent : streamChat;

      void (async () => {
        try {
          await run(
            body,
            {
              onStart: (d) => {
                if (d.conversationId) {
                  dispatch({ type: 'setConversationId', id: d.conversationId });
                  setLastConversationId(zohoUserId, d.conversationId);
                }
              },
              onStatus: (d) => dispatch({ type: 'patchAssistant', patch: { status: d.label ?? '' } }),
              onContext: (d) =>
                dispatch({
                  type: 'patchAssistant',
                  patch: {
                    passages: d.passages ?? null,
                    ...(d.citations ? { citations: d.citations } : {}),
                  },
                }),
              onToolCall: (d) => d.name && dispatch({ type: 'addTool', name: d.name }),
              onToolResult: (d) => d.name && dispatch({ type: 'updateTool', name: d.name, status: d.status ?? 'ok' }),
              // Agent path emits {delta}; chat path emits {text}.
              onToken: (d) => { const t = d.delta ?? d.text; if (t) dispatch({ type: 'appendToken', text: t }); },
              // "Consulting Sales…" as a child starts (agent path only) + persist the trail.
              onAgent: (d) => {
                if (d.state === 'start' && d.key) {
                  const label = AGENT_LABELS[d.key as AgentKey] ?? d.label ?? d.key;
                  dispatch({ type: 'appendAgentPath', key: d.key });
                  dispatch({ type: 'patchAssistant', patch: { status: `Consulting ${label}…` } });
                }
              },
              onElicitation: (d) => dispatch({ type: 'setElicitation', elicitation: d }),
              onDone: (d) => {
                if (d.conversationId) {
                  dispatch({ type: 'setConversationId', id: d.conversationId });
                  setLastConversationId(zohoUserId, d.conversationId);
                }
                // done is authoritative — its message/attribution/citations replace accumulation.
                dispatch({
                  type: 'patchAssistant',
                  patch: {
                    ...(typeof d.message === 'string' && d.message ? { text: d.message } : {}),
                    ...(d.ragPassages != null ? { passages: d.ragPassages } : {}),
                    ...(d.agentPath && d.agentPath.length > 0
                      ? { agentPath: d.agentPath, agentKey: d.agentPath.at(-1) ?? null }
                      : {}),
                    ...(d.citations ? { citations: d.citations } : {}),
                  },
                });
              },
              onError: (msg) => dispatch({ type: 'patchAssistant', patch: { error: msg, errorKind: 'stream' } }),
            },
            controller.signal,
          );
        } catch (e) {
          if (abortRef.current === controller) {
            const { message, kind } = classifyStreamError(e);
            dispatch({ type: 'patchAssistant', patch: { error: message, errorKind: kind } });
          }
        } finally {
          // Only finalize if this is still the active stream. If New chat / a newer turn replaced the
          // controller, leave the current state alone — don't unlock or clobber the newer stream.
          if (abortRef.current === controller) {
            dispatch({ type: 'streamEnd' });
            abortRef.current = null;
          }
          void refreshConversations();
        }
      })();
    },
    [ctx, department, agentKey, state.conversationId, state.streaming, refreshConversations, zohoUserId],
  );

  const stop = useCallback(() => {
    if (!abortRef.current) return;
    // Abort but KEEP the ref (unlike newConversation): the stream's finally must still run
    // streamEnd + detach itself, preserving the identity-guard semantics.
    abortRef.current.abort();
    dispatch({ type: 'stopStream' });
  }, []);

  const retry = useCallback(
    (assistantId: string) => {
      if (state.streaming) return;
      const idx = state.messages.findIndex((m) => m.id === assistantId);
      const userRow = idx > 0 ? state.messages[idx - 1] : undefined;
      if (!userRow || userRow.role !== 'user' || !userRow.text) return;
      dispatch({ type: 'retryTurn', assistantId });
      send(userRow.text);
    },
    [state.streaming, state.messages, send],
  );

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null; // detach: the aborted stream's finally is now inert (won't touch state)
    setLastConversationId(zohoUserId, null);
    dispatch({ type: 'newConversation' });
  }, [zohoUserId]);

  const openConversation = useCallback(
    async (id: string, opts: { silent?: boolean } = {}) => {
      if (state.streaming || id === state.conversationId) return;
      try {
        const { messages } = await getConversation(id, zohoUserId);
        const ui: UiMessage[] = messages.map((m) => ({
          ...blankMessage(m.id, m.role, m.content ?? ''),
          passages: m.ragPassages,
          error: m.error ?? '',
          tools: Array.isArray(m.tools) ? m.tools : [],
        }));
        dispatch({ type: 'loadTranscript', conversationId: id, messages: ui });
        setLastConversationId(zohoUserId, id);
      } catch (e) {
        if (opts.silent) {
          setLastConversationId(zohoUserId, null); // stale/deleted id — stop restoring it
          return;
        }
        dispatch({ type: 'setError', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [state.streaming, state.conversationId, zohoUserId],
  );

  const removeConversation = useCallback(
    async (id: string) => {
      try {
        await deleteConversation(id, zohoUserId);
        if (id === state.conversationId) {
          abortRef.current?.abort(); // a stream may still be writing to the conversation we just deleted
          abortRef.current = null;
          setLastConversationId(zohoUserId, null);
          dispatch({ type: 'newConversation' });
        }
        await refreshConversations();
      } catch (e) {
        dispatch({ type: 'setError', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [zohoUserId, state.conversationId, refreshConversations],
  );

  // Restore the last conversation once per user — only into an untouched chat. Deliberately
  // depends on zohoUserId alone (the restoredForRef guard makes re-runs no-ops anyway).
  useEffect(() => {
    if (!zohoUserId || restoredForRef.current === zohoUserId) return;
    restoredForRef.current = zohoUserId;
    const last = getLastConversationId(zohoUserId);
    if (last && state.messages.length === 0 && !state.streaming) {
      void openConversation(last, { silent: true });
    }
  }, [zohoUserId, state.messages.length, state.streaming, openConversation]);

  // Create-up-front is intentionally omitted: /chat/stream auto-creates and returns the id in `start`.
  return {
    messages: state.messages,
    conversations: state.conversations,
    conversationId: state.conversationId,
    streaming: state.streaming,
    error: state.error,
    send,
    stop,
    retry,
    newConversation,
    openConversation,
    removeConversation,
    refreshConversations,
  };
}
