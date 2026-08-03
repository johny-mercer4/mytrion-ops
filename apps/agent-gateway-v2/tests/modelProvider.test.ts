import { beforeAll, describe, expect, it, vi } from 'vitest';
import type { ToolManifest } from '../src/toolRuntime.js';

type ProviderModule = typeof import('../src/modelProvider.js');
let provider: ProviderModule;

beforeAll(async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_INTERNAL_API_KEY', 'test-internal-key');
  provider = await import('../src/modelProvider.js');
});

describe('OpenAI provider adapter', () => {
  it('preserves tool calls and outputs when converting to Responses input', () => {
    expect(
      provider.toOpenAIInput([
        { role: 'system', content: 'system' },
        { role: 'user', content: 'status' },
        {
          role: 'assistant',
          content: null,
          toolCalls: [{ id: 'call-1', name: 'card_status', arguments: '{"last6":"123456"}' }],
        },
        { role: 'tool', toolCallId: 'call-1', content: '{"status":"active"}' },
      ]),
    ).toEqual([
      { role: 'system', content: 'system' },
      { role: 'user', content: 'status' },
      {
        type: 'function_call',
        call_id: 'call-1',
        name: 'card_status',
        arguments: '{"last6":"123456"}',
      },
      {
        type: 'function_call_output',
        call_id: 'call-1',
        output: '{"status":"active"}',
      },
    ]);
  });

  it('creates a stable privacy-preserving chat identifier', () => {
    const first = provider.safetyIdentifierForChat(-100123);
    expect(first).toBe(provider.safetyIdentifierForChat(-100123));
    expect(first).not.toContain('-100123');
    expect(first).toHaveLength(64);
  });

  it('rejects a required tool that was not authorized for the turn', async () => {
    await expect(
      provider.completeModel([], [], 'safe-id', 'unavailable_tool'),
    ).rejects.toThrow('Required tool "unavailable_tool" is not available for this turn');
  });

  it('rejects a disabled Money Code tool before any provider request', async () => {
    const manifest: ToolManifest = {
      name: 'octane_money_code',
      description: 'Issue Money Code',
      parameters: { type: 'object' },
      riskClass: 'write',
      async execute() {
        return { content: [{ type: 'text', text: 'issued' }] };
      },
    };
    await expect(
      provider.completeModel([], [manifest], 'safe-id', 'octane_money_code'),
    ).rejects.toThrow(
      'Required tool "octane_money_code" is not available for this turn',
    );
  });
});
