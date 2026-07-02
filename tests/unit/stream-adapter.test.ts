import { describe, expect, it } from 'vitest';
import type { StreamEvent } from '@langchain/core/tracers/log_stream';
import { consumeAgentStream } from '../../src/modules/agents/streamAdapter.js';
import type { SSEStream } from '../../src/modules/chat/streaming.js';

function fakeSink(): { sink: SSEStream; events: Array<{ event: string; data: unknown }> } {
  const events: Array<{ event: string; data: unknown }> = [];
  return {
    events,
    sink: {
      send: (event, data) => void events.push({ event, data }),
      comment: () => undefined,
      close: () => undefined,
    },
  };
}

function ev(partial: Partial<StreamEvent>): StreamEvent {
  // Test fixture: only the fields the adapter reads are populated.
  return {
    event: 'on_chain_end',
    name: '',
    run_id: 'r',
    tags: [],
    metadata: {},
    data: {},
    ...partial,
  } as StreamEvent;
}

async function* stream(events: StreamEvent[]): AsyncIterable<StreamEvent> {
  for (const e of events) yield e;
}

describe('consumeAgentStream', () => {
  it('maps root tokens, task boundaries, and tools to SSE; child tokens stay silent', async () => {
    const { sink, events } = fakeSink();
    const outcome = await consumeAgentStream(
      stream([
        ev({ event: 'on_chat_model_stream', data: { chunk: { content: 'Working… ' } } }),
        ev({
          event: 'on_tool_start',
          name: 'task',
          data: { input: { description: 'check debtors', subagent_type: 'billing' } },
        }),
        // Child-run token — must NOT reach the sink.
        ev({
          event: 'on_chat_model_stream',
          metadata: { lc_agent_name: 'billing' },
          data: { chunk: { content: 'child thinking' } },
        }),
        ev({
          event: 'on_tool_start',
          name: 'agent__debtors',
          metadata: { lc_agent_name: 'billing' },
          data: { input: {} },
        }),
        ev({
          event: 'on_tool_end',
          name: 'agent__debtors',
          metadata: { lc_agent_name: 'billing' },
          data: {},
        }),
        ev({
          event: 'on_tool_end',
          name: 'task',
          data: { input: { description: 'check debtors', subagent_type: 'billing' } },
        }),
        ev({ event: 'on_chat_model_stream', data: { chunk: { content: 'Done.' } } }),
        ev({
          event: 'on_chain_end',
          data: { output: { messages: [{ content: 'Final answer: 3 debtors.' }] } },
        }),
      ]),
      sink,
    );

    expect(outcome.finalText).toBe('Final answer: 3 debtors.');
    expect(outcome.agentPath).toEqual(['billing']);
    expect(outcome.toolCalls).toEqual([{ name: 'agent__debtors', status: 'ok' }]);

    const kinds = events.map((e) => e.event);
    expect(kinds).toEqual(['token', 'agent', 'tool_call', 'tool_result', 'agent', 'token']);
    expect(events.filter((e) => e.event === 'token').map((e) => (e.data as { delta: string }).delta))
      .toEqual(['Working… ', 'Done.']);
    expect(events[1]!.data).toEqual({ key: 'billing', state: 'start' });
  });

  it('falls back to accumulated root tokens when no chain-end message exists', async () => {
    const outcome = await consumeAgentStream(
      stream([
        ev({ event: 'on_chat_model_stream', data: { chunk: { content: 'partial ' } } }),
        ev({ event: 'on_chat_model_stream', data: { chunk: { content: 'answer' } } }),
      ]),
    );
    expect(outcome.finalText).toBe('partial answer');
  });

  it('records tool errors and skips write_todos noise', async () => {
    const { sink, events } = fakeSink();
    const outcome = await consumeAgentStream(
      stream([
        ev({ event: 'on_tool_start', name: 'write_todos', data: { input: {} } }),
        ev({ event: 'on_tool_end', name: 'write_todos', data: {} }),
        ev({ event: 'on_tool_start', name: 'zoho_crm__query', data: { input: {} } }),
        ev({ event: 'on_tool_error', name: 'zoho_crm__query', data: {} }),
      ]),
      sink,
    );
    expect(outcome.toolCalls).toEqual([{ name: 'zoho_crm__query', status: 'error' }]);
    expect(events.map((e) => e.event)).toEqual(['tool_call', 'tool_result']);
  });

  it('handles array content parts in token chunks', async () => {
    const outcome = await consumeAgentStream(
      stream([
        ev({
          event: 'on_chat_model_stream',
          data: { chunk: { content: [{ type: 'text', text: 'hello' }, ' world'] } },
        }),
      ]),
    );
    expect(outcome.finalText).toBe('hello world');
  });
});
