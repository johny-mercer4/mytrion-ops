import { z } from 'zod';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  cardId: z.string().min(1).max(100),
});

const outputSchema = z.object({
  card: z
    .object({
      id: z.string(),
      last4: z.string(),
      status: z.enum(['active', 'frozen', 'cancelled']),
      customerId: z.string(),
      balanceCents: z.number().int(),
    })
    .nullable(),
});

/** STUB (V1): deterministic mock data. Wire to the Octane internal API later. */
export const octaneCardStatusTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'octane.card_status',
  description: 'Get the status and balance of an Octane fuel card by id (internal only).',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['octane_card:read'],
  rateLimit: { perMinute: 60 },
  async handler(input, ctx) {
    return {
      card: {
        id: input.cardId,
        last4: '4242',
        status: 'active',
        customerId: `cust_${ctx.tenantId}_001`,
        balanceCents: 125_00,
      },
    };
  },
};
