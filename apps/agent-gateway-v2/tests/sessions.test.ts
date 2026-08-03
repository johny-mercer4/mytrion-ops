import { beforeAll, describe, expect, it, vi } from 'vitest';

type Parser = typeof import('../src/sessions.js').parseToolArguments;
let parseToolArguments: Parser;
let verifiedAskerId: typeof import('../src/sessions.js').verifiedAskerId;
let sessionKey: typeof import('../src/sessions.js').sessionKey;

beforeAll(async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_INTERNAL_API_KEY', 'test-internal-key');
  ({ parseToolArguments, verifiedAskerId, sessionKey } = await import('../src/sessions.js'));
});

describe('per-user conversation isolation', () => {
  it('uses a distinct queue/history key for each user in the same group', () => {
    expect(sessionKey(-1001, 9)).toBe('-1001:9');
    expect(sessionKey(-1001, 9)).not.toBe(sessionKey(-1001, 10));
  });
});

describe('verifiedAskerId', () => {
  it('reads message and callback sender ids from the trusted envelope', () => {
    expect(
      verifiedAskerId('[msg 23 from Jamshid (id 905434593)]: 917022'),
    ).toBe(905434593);
    expect(
      verifiedAskerId(
        '[button tap from Jamshid (id 905434593)]: confirm:override:yes',
      ),
    ).toBe(905434593);
  });

  it('rejects turns without a verified Telegram envelope', () => {
    expect(() => verifiedAskerId('plain user text')).toThrow(
      'missing a verified Telegram sender id',
    );
  });
});

describe('parseToolArguments', () => {
  it('accepts a plain JSON object', () => {
    expect(parseToolArguments('{"telegram_user_id":42}')).toEqual({
      ok: true,
      value: { telegram_user_id: 42 },
    });
  });

  it('repairs GPT-OSS Harmony and fenced wrappers', () => {
    expect(
      parseToolArguments('<|python_tag|>```json\n{"card_last6":"521752"}\n```'),
    ).toEqual({
      ok: true,
      value: { card_last6: '521752' },
    });
  });

  it('extracts an object from surrounding text', () => {
    expect(parseToolArguments('arguments: {"query":"card status"} done')).toEqual({
      ok: true,
      value: { query: 'card status' },
    });
  });

  it('rejects non-object JSON', () => {
    expect(parseToolArguments('["not","an","object"]')).toEqual({
      ok: false,
      message: 'expected one JSON object',
    });
  });
});
