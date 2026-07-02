/**
 * Translate a LangGraph `streamEvents` (v2) stream into the widget's SSE vocabulary
 * (start/status/token/tool_call/tool_result/done + the new `agent` events), while collecting
 * the run outcome for persistence. Also used WITHOUT a sink for non-stream turns, so both
 * modes share one consumption path.
 *
 * Token policy: only the ROOT graph's model tokens stream to the user (children run inside the
 * `task` tool and are surfaced as `agent`/`tool_call` progress instead — their transcripts stay
 * out of the user-facing stream by design). Child runs are identified by the `lc_agent_name`
 * config deepagents sets when invoking a subagent.
 */
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import type { SSEStream } from '../chat/streaming.js';

export interface StreamOutcome {
  finalText: string;
  toolCalls: Array<{ name: string; status: 'ok' | 'error' }>;
  agentPath: string[];
}

interface AgentEventPayload {
  key: string;
  state: 'start' | 'done';
}

function contentToText(content: unknown): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    return content
      .map((part) =>
        typeof part === 'string'
          ? part
          : typeof (part as { text?: unknown }).text === 'string'
            ? (part as { text: string }).text
            : '',
      )
      .join('');
  }
  return '';
}

function isChildRun(event: StreamEvent): boolean {
  return typeof event.metadata?.['lc_agent_name'] === 'string';
}

function subagentTypeOf(input: unknown): string | undefined {
  if (typeof input !== 'object' || input === null) return undefined;
  const raw = (input as { input?: unknown }).input ?? input;
  if (typeof raw === 'object' && raw !== null && 'subagent_type' in raw) {
    const v = (raw as { subagent_type?: unknown }).subagent_type;
    return typeof v === 'string' ? v : undefined;
  }
  return undefined;
}

/** Consume the whole event stream; emit SSE when a sink is given; return the outcome. */
export async function consumeAgentStream(
  events: AsyncIterable<StreamEvent>,
  sink?: SSEStream,
): Promise<StreamOutcome> {
  let rootText = '';
  let lastRootMessage = '';
  const toolCalls: StreamOutcome['toolCalls'] = [];
  const agentPath: string[] = [];

  for await (const event of events) {
    switch (event.event) {
      case 'on_chat_model_stream': {
        if (isChildRun(event)) break; // child tokens never reach the user stream
        const chunk = event.data?.chunk as { content?: unknown } | undefined;
        const delta = contentToText(chunk?.content);
        if (delta) {
          rootText += delta;
          sink?.send('token', { delta });
        }
        break;
      }
      case 'on_tool_start': {
        if (event.name === 'task') {
          const key = subagentTypeOf(event.data?.input);
          if (key) {
            agentPath.push(key);
            sink?.send('agent', { key, state: 'start' } satisfies AgentEventPayload);
          }
          break;
        }
        if (event.name === 'write_todos') break; // internal planning noise
        sink?.send('tool_call', { name: event.name, agent: event.metadata?.['lc_agent_name'] ?? null });
        break;
      }
      case 'on_tool_end': {
        if (event.name === 'task') {
          const key = subagentTypeOf(event.data?.input) ?? agentPath.at(-1);
          if (key) sink?.send('agent', { key, state: 'done' } satisfies AgentEventPayload);
          break;
        }
        if (event.name === 'write_todos') break;
        toolCalls.push({ name: event.name, status: 'ok' });
        sink?.send('tool_result', { name: event.name, status: 'ok' });
        break;
      }
      case 'on_tool_error': {
        if (event.name === 'task' || event.name === 'write_todos') break;
        toolCalls.push({ name: event.name, status: 'error' });
        sink?.send('tool_result', { name: event.name, status: 'error' });
        break;
      }
      case 'on_chain_end': {
        // The root graph's final state carries the definitive last message — the LAST such
        // event in the stream wins (streamed root tokens can include intermediate turns).
        if (isChildRun(event)) break;
        const output = event.data?.output as { messages?: Array<{ content?: unknown }> } | undefined;
        const last = output?.messages?.at(-1);
        const text = contentToText(last?.content);
        if (text) lastRootMessage = text;
        break;
      }
      default:
        break;
    }
  }

  return {
    finalText: (lastRootMessage || rootText).trim(),
    toolCalls,
    agentPath,
  };
}
