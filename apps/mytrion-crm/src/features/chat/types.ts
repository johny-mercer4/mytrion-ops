import type { ToolSummary } from '../../api/chat';
import type { Elicitation } from '../../api/stream';

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
  tools: ToolSummary[];
  streaming: boolean;
  /** A dynamic-UI picker the agent asked for (e.g. choose which client). Null when none. */
  elicitation: Elicitation | null;
}
