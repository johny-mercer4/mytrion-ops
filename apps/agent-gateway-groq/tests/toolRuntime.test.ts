import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { defineTool, toolDispatcher } from '../src/toolRuntime.js';

const context = {
  chatId: -1001,
  carrierId: 'carrier-1',
  principalRole: 'admin' as const,
  role: 'owner' as const,
};

describe('toolDispatcher', () => {
  it('emits JSON Schema-compatible numeric exclusive bounds', () => {
    const manifest = defineTool(
      'positive_amount',
      'Positive amount',
      { amount: z.number().positive() },
      () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
    const properties = manifest.parameters['properties'];
    expect(properties).toMatchObject({
      amount: { type: 'number', exclusiveMinimum: 0 },
    });
  });

  it('validates and executes a known manifest', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const manifest = defineTool(
      'lookup',
      'Test lookup',
      { id: z.number().int() },
      ({ id }) => ({ content: [{ type: 'text', text: `found:${id}` }] }),
    );

    await expect(toolDispatcher([manifest], 'lookup', { id: 7 }, context)).resolves.toBe(
      'found:7',
    );
  });

  it('rejects a call when the authorization re-check fails', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const base = defineTool(
      'private_lookup',
      'Private lookup',
      { telegram_user_id: z.number() },
      () => ({ content: [{ type: 'text', text: 'secret' }] }),
    );
    const manifest = {
      ...base,
      authorize: () => 'sender is not authorized for this chat',
    };

    await expect(
      toolDispatcher([manifest], 'private_lookup', { telegram_user_id: 9 }, context),
    ).resolves.toBe('error: sender is not authorized for this chat');
  });

  it('rejects unknown tools and malformed arguments', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await expect(toolDispatcher([], 'missing', {}, context)).resolves.toBe(
      'error: unknown tool "missing"',
    );

    const manifest = defineTool(
      'needs_number',
      'Needs number',
      { value: z.number() },
      () => ({ content: [{ type: 'text', text: 'ok' }] }),
    );
    await expect(
      toolDispatcher([manifest], 'needs_number', { value: 'wrong' }, context),
    ).resolves.toContain('invalid arguments');
  });

  it('refuses a disabled service even when its manifest reaches the dispatcher', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const execute = vi.fn(() => ({
      content: [{ type: 'text' as const, text: 'issued' }],
    }));
    const manifest = defineTool(
      'octane_money_code',
      'Issue code',
      { amount: z.number() },
      execute,
      'write',
    );

    await expect(
      toolDispatcher([manifest], 'octane_money_code', { amount: 500 }, context),
    ).resolves.toBe('error: tool "octane_money_code" is disabled');
    expect(execute).not.toHaveBeenCalled();
  });

  it('re-checks role authorization even when a forbidden manifest reaches dispatch', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const execute = vi.fn(() => ({
      content: [{ type: 'text' as const, text: 'invoice' }],
    }));
    const manifest = defineTool(
      'octane_invoice',
      'Latest invoice',
      { telegram_user_id: z.number() },
      execute,
    );

    await expect(
      toolDispatcher(
        [manifest],
        'octane_invoice',
        { telegram_user_id: 9 },
        { ...context, role: 'driver' },
      ),
    ).resolves.toBe(
      'error: tool "octane_invoice" is not allowed for role "driver"',
    );
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses a write manifest unless dispatch carries a server confirmation', async () => {
    vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const execute = vi.fn(() => ({
      content: [{ type: 'text' as const, text: 'changed' }],
    }));
    const manifest = {
      ...defineTool(
        'octane_card_action',
        'Change card status',
        { telegram_user_id: z.number() },
        execute,
        'write',
      ),
      confirmationMode: 'trusted_button' as const,
    };

    await expect(
      toolDispatcher(
        [manifest],
        'octane_card_action',
        { telegram_user_id: 9 },
        context,
      ),
    ).resolves.toContain('requires a server-confirmed Telegram button');
    expect(execute).not.toHaveBeenCalled();

    await expect(
      toolDispatcher(
        [manifest],
        'octane_card_action',
        { telegram_user_id: 9 },
        { ...context, principalRole: 'user', confirmationId: 'sbcf_test' },
      ),
    ).resolves.toContain('requires the admin service principal');
    expect(execute).not.toHaveBeenCalled();

    await expect(
      toolDispatcher(
        [manifest],
        'octane_card_action',
        { telegram_user_id: 9 },
        { ...context, confirmationId: 'sbcf_test' },
      ),
    ).resolves.toBe('changed');
    expect(execute).toHaveBeenCalledOnce();
  });
});
