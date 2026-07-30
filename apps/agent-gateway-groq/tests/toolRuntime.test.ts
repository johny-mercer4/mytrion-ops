import { z } from 'zod';
import { describe, expect, it, vi } from 'vitest';
import { defineTool, toolDispatcher } from '../src/toolRuntime.js';

const context = { chatId: -1001, carrierId: 'carrier-1' };

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
});
