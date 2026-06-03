import { z } from 'zod';
import type { ToolManifest } from '../types.js';

const inputSchema = z
  .object({
    cardId: z.string().min(1).max(100).optional(),
    customerId: z.string().min(1).max(100).optional(),
    limit: z.number().int().min(1).max(100).default(20),
  })
  .refine((v) => v.cardId !== undefined || v.customerId !== undefined, {
    message: 'Provide cardId or customerId',
  });

const outputSchema = z.object({
  transactions: z.array(
    z.object({
      id: z.string(),
      cardId: z.string(),
      amountCents: z.number().int(),
      merchant: z.string(),
      timestamp: z.string(),
      status: z.enum(['posted', 'pending', 'declined']),
    }),
  ),
});

/** STUB (V1): deterministic mock data. Wire to the Octane internal API later. */
export const octaneTransactionSearchTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'octane.transaction_search',
  description:
    'Search recent Octane fuel card transactions by card or customer (internal only). Returns up to N transactions.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['octane_tx:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const cardId = input.cardId ?? `card_${ctx.tenantId}_001`;
    const count = Math.min(input.limit, 3);
    return {
      transactions: Array.from({ length: count }, (_, i) => ({
        id: `txn_${ctx.tenantId}_${i + 1}`,
        cardId,
        amountCents: 5_000 + i * 1_234,
        merchant: 'Pilot Flying J',
        timestamp: `2026-06-0${i + 1}T12:00:00.000Z`,
        status: 'posted' as const,
      })),
    };
  },
};
