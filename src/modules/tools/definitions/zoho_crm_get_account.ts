import { z } from 'zod';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  accountId: z.string().min(1).max(100),
});

const outputSchema = z.object({
  account: z
    .object({
      id: z.string(),
      name: z.string(),
      industry: z.string().nullable(),
      annualRevenue: z.number().nullable(),
      ownerEmail: z.string().nullable(),
    })
    .nullable(),
});

/** STUB (V1): deterministic mock data. Wire to the Zoho CRM vendor client later. */
export const zohoCrmGetAccountTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'zoho_crm.get_account',
  description: 'Fetch a single Zoho CRM account by id (internal only).',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['zoho_crm:read'],
  rateLimit: { perMinute: 60 },
  async handler(input, ctx) {
    return {
      account: {
        id: input.accountId,
        name: `Account ${input.accountId}`,
        industry: 'Transportation',
        annualRevenue: 2_500_000,
        ownerEmail: `owner@${ctx.tenantId}.example`,
      },
    };
  },
};
