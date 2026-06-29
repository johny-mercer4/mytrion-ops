import { useCallback, useEffect, useReducer, useRef } from 'react';
import {
  deleteConversation,
  getConversation,
  listConversations,
  type ConversationSummary,
} from '../../api/chat';
import { streamChat, type ChatRequestBody } from '../../api/stream';
import type { ZohoContext } from '../../zoho/embeddedApp';
import type { UiMessage } from './types';

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
  | { type: 'setConversationId'; id: string }
  | { type: 'streamEnd' }
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
    if (messages[i]!.role === 'assistant') {
      const next = messages.slice();
      next[i] = fn(messages[i]!);
      return next;
    }
  }
  return messages;
}

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case 'send':
      return {
        ...state,
        streaming: true,
        error: null,
        messages: [
          ...state.messages,
          { id: action.userId, role: 'user', text: action.text, status: '', passages: null, error: '', tools: [], streaming: false },
          { id: action.assistantId, role: 'assistant', text: '', status: 'Thinking…', passages: null, error: '', tools: [], streaming: true },
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
    case 'setConversationId':
      return { ...state, conversationId: action.id };
    case 'streamEnd':
      return { ...state, streaming: false, messages: patchLastAssistant(state.messages, (m) => ({ ...m, streaming: false, status: '' })) };
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
  newConversation(): void;
  openConversation(id: string): Promise<void>;
  removeConversation(id: string): Promise<void>;
  refreshConversations(): Promise<void>;
}

export function useChat(ctx: ZohoContext): ChatController {
  const [state, dispatch] = useReducer(reducer, EMPTY);
  const abortRef = useRef<AbortController | null>(null);
  const zohoUserId = ctx.user.id;

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
      if (ctx.user.id) body.zoho_user_id = ctx.user.id;
      if (ctx.user.name) body.user_name = ctx.user.name;
      if (ctx.user.profile) body.profile = ctx.user.profile;
      if (ctx.user.role) body.role = ctx.user.role;
      if (ctx.departmentScope) body.department_scope = ctx.departmentScope;

      void (async () => {
        try {
          await streamChat(
            body,
            {
              onStart: (d) => d.conversationId && dispatch({ type: 'setConversationId', id: d.conversationId }),
              onStatus: (d) => dispatch({ type: 'patchAssistant', patch: { status: d.label ?? '' } }),
              onContext: (d) => dispatch({ type: 'patchAssistant', patch: { passages: d.passages ?? null } }),
              onToolCall: (d) => d.name && dispatch({ type: 'addTool', name: d.name }),
              onToolResult: (d) => d.name && dispatch({ type: 'updateTool', name: d.name, status: d.status ?? 'ok' }),
              onToken: (d) => d.text && dispatch({ type: 'appendToken', text: d.text }),
              onDone: (d) => {
                if (d.conversationId) dispatch({ type: 'setConversationId', id: d.conversationId });
                dispatch({ type: 'patchAssistant', patch: { ...(typeof d.message === 'string' && d.message ? { text: d.message } : {}), ...(d.ragPassages != null ? { passages: d.ragPassages } : {}) } });
              },
              onError: (msg) => dispatch({ type: 'patchAssistant', patch: { error: msg } }),
            },
            controller.signal,
          );
        } catch (e) {
          if (abortRef.current === controller) {
            dispatch({ type: 'patchAssistant', patch: { error: e instanceof Error ? e.message : String(e) } });
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
    [ctx, state.conversationId, state.streaming, refreshConversations],
  );

  const newConversation = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null; // detach: the aborted stream's finally is now inert (won't touch state)
    dispatch({ type: 'newConversation' });
  }, []);

  const openConversation = useCallback(
    async (id: string) => {
      if (state.streaming || id === state.conversationId) return;
      try {
        const { messages } = await getConversation(id, zohoUserId);
        const ui: UiMessage[] = messages.map((m) => ({
          id: m.id,
          role: m.role,
          text: m.content ?? '',
          status: '',
          passages: m.ragPassages,
          error: m.error ?? '',
          tools: Array.isArray(m.tools) ? m.tools : [],
          streaming: false,
        }));
        dispatch({ type: 'loadTranscript', conversationId: id, messages: ui });
      } catch (e) {
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
          dispatch({ type: 'newConversation' });
        }
        await refreshConversations();
      } catch (e) {
        dispatch({ type: 'setError', error: e instanceof Error ? e.message : String(e) });
      }
    },
    [zohoUserId, state.conversationId, refreshConversations],
  );

  // Create-up-front is intentionally omitted: /chat/stream auto-creates and returns the id in `start`.
  return {
    messages: state.messages,
    conversations: state.conversations,
    conversationId: state.conversationId,
    streaming: state.streaming,
    error: state.error,
    send,
    newConversation,
    openConversation,
    removeConversation,
    refreshConversations,
  };
}
