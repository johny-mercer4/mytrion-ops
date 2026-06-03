import { z } from 'zod';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  /** Customer id or email. */
  identifier: z.string().min(1).max(200),
});

const outputSchema = z.object({
  customer: z
    .object({
      id: z.string(),
      name: z.string(),
      email: z.string(),
      status: z.enum(['active', 'suspended', 'closed']),
      accountId: z.string(),
    })
    .nullable(),
});

/** STUB (V1): deterministic mock data. Wire to the Octane internal API later. */
export const octaneCustomerLookupTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'octane.customer_lookup',
  description: 'Look up an Octane customer by id or email (internal only).',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['octane_card:read'],
  rateLimit: { perMinute: 60 },
  async handler(input, ctx) {
    return {
      customer: {
        id: `cust_${ctx.tenantId}_001`,
        name: 'Acme Trucking',
        email: input.identifier.includes('@') ? input.identifier : 'ops@acme.example',
        status: 'active',
        accountId: `acc_${ctx.tenantId}_1`,
      },
    };
  },
};
