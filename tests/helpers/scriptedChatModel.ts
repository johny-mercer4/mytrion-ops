/**
 * A sequenced fake chat model for driving the REAL orchestrator/child graph without a network.
 * The built-in LangChain fakes don't fit: FakeListChatModel can't emit tool_calls and
 * FakeStreamingChatModel doesn't sequence. This one:
 *   - implements bindTools (langchain's createAgent requires it) and RECORDS every bound tool
 *     name (`boundToolNames`) so tests can assert what the graph actually gave the model —
 *     including the synthetic `extract-<n>` structured-output tool ToolStrategy binds;
 *   - answers each _generate from a queue whose entries are AIMessages or FUNCTIONS of the
 *     bound tool names (for calls whose tool name is only knowable at bind time);
 *   - never streams — streamAdapter's on_chain_end path picks up the final state, which is
 *     exactly how non-streaming turns are consumed in production.
 */
import {
  BaseChatModel,
  type BaseChatModelParams,
  type BindToolsInput,
} from '@langchain/core/language_models/chat_models';
import { AIMessage, type BaseMessage } from '@langchain/core/messages';
import type { ChatResult } from '@langchain/core/outputs';

export type ScriptEntry = AIMessage | ((boundToolNames: string[]) => AIMessage);

function toolNameOf(tool: unknown): string | undefined {
  if (typeof tool !== 'object' || tool === null) return undefined;
  const t = tool as { name?: unknown; function?: { name?: unknown } };
  if (typeof t.name === 'string') return t.name;
  if (typeof t.function?.name === 'string') return t.function.name;
  return undefined;
}

export class ScriptedChatModel extends BaseChatModel {
  readonly boundToolNames: string[] = [];
  private readonly script: ScriptEntry[];
  /** When set, every _generate past the end of the script returns loop(bound) forever. */
  private readonly loop: ScriptEntry | undefined;

  constructor(script: ScriptEntry[], opts: { loop?: ScriptEntry } & BaseChatModelParams = {}) {
    const { loop, ...fields } = opts;
    super(fields);
    this.script = [...script];
    this.loop = loop;
  }

  _llmType(): string {
    return 'scripted';
  }

  override bindTools(tools: BindToolsInput[]): this {
    for (const tool of tools) {
      const name = toolNameOf(tool);
      if (name && !this.boundToolNames.includes(name)) this.boundToolNames.push(name);
    }
    return this;
  }

  get remaining(): number {
    return this.script.length;
  }

  async _generate(_messages: BaseMessage[]): Promise<ChatResult> {
    const entry =
      this.script.shift() ??
      this.loop ??
      new AIMessage('scripted-model: script exhausted');
    const message = typeof entry === 'function' ? entry(this.boundToolNames) : entry;
    const text = typeof message.content === 'string' ? message.content : '';
    return { generations: [{ text, message }] };
  }
}

/** An AIMessage that calls one tool. */
export function toolCallMessage(name: string, args: Record<string, unknown>, id = 'call_1'): AIMessage {
  return new AIMessage({ content: '', tool_calls: [{ name, args, id, type: 'tool_call' }] });
}

/**
 * Script entry answering the child's structured-output handshake: calls the synthetic
 * `extract-<n>` tool ToolStrategy bound for `responseFormat` with a valid AgentResult.
 */
export function agentResultEntry(answer: string): ScriptEntry {
  return (bound) =>
    toolCallMessage(
      bound.find((n) => /^extract-\d+$/.test(n)) ?? 'extract-1',
      { answer, citations: [], toolsUsed: [], confidence: 'high' },
      'call_structured',
    );
}
