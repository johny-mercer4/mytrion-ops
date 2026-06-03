import { z } from 'zod';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  query: z.string().min(1).max(200),
  limit: z.number().int().min(1).max(50).default(10),
});

const outputSchema = z.object({
  accounts: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      industry: z.string().nullable(),
      annualRevenue: z.number().nullable(),
    }),
  ),
});

/** STUB (V1): deterministic mock data. Wire to the Zoho CRM vendor client later. */
export const zohoCrmSearchAccountsTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'zoho_crm.search_accounts',
  description:
    'Search Zoho CRM accounts by name or other text. Returns up to N matching accounts (internal only).',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['zoho_crm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const count = Math.min(input.limit, 2);
    return {
      accounts: Array.from({ length: count }, (_, i) => ({
        id: `acc_${ctx.tenantId}_${i + 1}`,
        name: `${input.query} Holdings ${i + 1}`,
        industry: 'Transportation',
        annualRevenue: 1_000_000 * (i + 1),
      })),
    };
  },
};
