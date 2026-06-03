import { z } from 'zod';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  driverId: z.string().min(1).max(100),
});

const outputSchema = z.object({
  driver: z
    .object({
      id: z.string(),
      name: z.string(),
      status: z.enum(['active', 'inactive']),
      fleetId: z.string(),
      cardLast4: z.string().nullable(),
    })
    .nullable(),
});

/**
 * STUB (V1): deterministic mock data. Partner-facing. Scoped to the caller's own
 * tenant; a driver only resolves data within ctx.tenantId. Wire to the partner API later.
 */
export const partnerDriverLookupTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'partner.driver_lookup',
  description: "Look up a driver in the partner's own fleet by driver id.",
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['partner'],
  requiredScopes: ['partner:self:read'],
  rateLimit: { perMinute: 60 },
  async handler(input, ctx) {
    return {
      driver: {
        id: input.driverId,
        name: 'Jordan Driver',
        status: 'active',
        fleetId: `fleet_${ctx.tenantId}_1`,
        cardLast4: '4242',
      },
    };
  },
};
