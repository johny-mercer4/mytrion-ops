import type { ToolSummary } from '../../api/chat';
import type { Citation, Elicitation } from '../../api/stream';

export type { Citation };

/** How a failed turn failed — drives the copy + retry affordance. */
export type ErrorKind = 'rate-limit' | 'server' | 'network' | 'stream';

/** A message as rendered in the chat (assistant rows accrete tokens/tools/grounding while streaming). */
export interface UiMessage {
  /** Stable React key — backend message id for loaded transcripts, a generated id for new turns. */
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** Live status label (e.g. "Consulting Sales…") shown until the first token. */
  status: string;
  /** Grounded-passage count for the answer (assistant). */
  passages: number | null;
  error: string;
  errorKind: ErrorKind | null;
  tools: ToolSummary[];
  streaming: boolean;
  /** The user pressed Stop mid-generation; partial text is kept. */
  stopped: boolean;
  /** Agent that authored the final answer (agent path; null = orchestrator/unknown). */
  agentKey: string | null;
  /** Delegation trail for the turn (e.g. ['sales']). */
  agentPath: string[];
  /** Knowledge sources backing the answer; null = none reported (legacy count-only display). */
  citations: Citation[] | null;
  /** A dynamic-UI picker the agent asked for (e.g. choose which client). Null when none. */
  elicitation: Elicitation | null;
}

/** A fresh UiMessage with every accreting field zeroed. */
export function blankMessage(id: string, role: 'user' | 'assistant', text = ''): UiMessage {
  return {
    id,
    role,
    text,
    status: '',
    passages: null,
    error: '',
    errorKind: null,
    tools: [],
    streaming: false,
    stopped: false,
    agentKey: null,
    agentPath: [],
    citations: null,
    elicitation: null,
  };
}
