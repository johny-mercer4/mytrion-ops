import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  executeConfirmedTurn: vi.fn(),
}));

vi.mock('../src/confirmedTurn.js', () => ({
  executeConfirmedTurn: mocks.executeConfirmedTurn,
}));

vi.mock('../src/telegram.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../src/telegram.js')>();
  return { ...original, startTypingKeepAlive: () => () => undefined };
});

let enqueueConfirmedTurn: typeof import('../src/sessions.js').enqueueConfirmedTurn;

beforeAll(async () => {
  vi.stubEnv('TELEGRAM_BOT_TOKEN', 'test-token');
  vi.stubEnv('OPENAI_API_KEY', 'test-openai-key');
  vi.stubEnv('OCTANE_API_BASE', 'http://localhost:3000');
  vi.stubEnv('OCTANE_INTERNAL_API_KEY', 'test-internal-key');
  ({ enqueueConfirmedTurn } = await import('../src/sessions.js'));
});

describe('confirmed Telegram update acknowledgement', () => {
  beforeEach(() => vi.clearAllMocks());

  it('keeps the returned promise pending until the durable confirmed turn completes', async () => {
    let finish: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    mocks.executeConfirmedTurn.mockImplementation(async () => {
      await gate;
      return {
        finalText: 'done',
        stats: { durationMs: 1, numTurns: 1, usage: {}, isError: false },
      };
    });
    const onReply = vi.fn(async () => undefined);
    const pending = enqueueConfirmedTurn(
      -1001,
      9001,
      'carrier-a',
      'owner',
      {
        confirmationId: 'sbcf_test',
        toolName: 'octane_card_action',
        arguments: { telegram_user_id: 9001 },
        argumentsHash: 'hash',
        turnId: 'confirmation:sbcf_test',
      },
      '[button tap from User (id 9001)]: server-confirmed action',
      onReply,
    );

    await vi.waitFor(() => expect(mocks.executeConfirmedTurn).toHaveBeenCalledOnce());
    let settled = false;
    void pending.then(() => {
      settled = true;
    });
    await Promise.resolve();
    expect(settled).toBe(false);

    finish?.();
    await pending;
    expect(onReply).toHaveBeenCalledWith('done');
  });
});
