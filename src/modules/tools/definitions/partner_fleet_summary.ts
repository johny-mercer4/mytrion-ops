import { z } from 'zod';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  fleetId: z.string().min(1).max(100).optional(),
});

const outputSchema = z.object({
  fleet: z.object({
    id: z.string(),
    name: z.string(),
    driverCount: z.number().int(),
    activeCards: z.number().int(),
    monthToDateSpendCents: z.number().int(),
  }),
});

/**
 * STUB (V1): deterministic mock data. Partner-facing fleet rollup, scoped to the
 * caller's tenant. Wire to the partner API later.
 */
export const partnerFleetSummaryTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'partner.fleet_summary',
  description: "Summarize the partner's fleet: driver count, active cards, and month-to-date spend.",
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['partner'],
  requiredScopes: ['partner:fleet:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    return {
      fleet: {
        id: input.fleetId ?? `fleet_${ctx.tenantId}_1`,
        name: 'Primary Fleet',
        driverCount: 12,
        activeCards: 11,
        monthToDateSpendCents: 4_820_00,
      },
    };
  },
};
