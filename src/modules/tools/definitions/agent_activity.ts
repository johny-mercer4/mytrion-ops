import { z } from 'zod';
import { serverCrmGet } from '../../../integrations/serverCrm.js';
import type { ToolManifest } from '../types.js';
import { resolveZohoUserId } from '../serverCrmScope.js';

const inputSchema = z.object({
  /** Admins only: query another agent by Zoho user id. Else locked to the caller. */
  zohoUserId: z.string().min(1).max(40).optional(),
  /** Period: daily (default), weekly, monthly, quarterly, custom. */
  range: z.string().min(1).max(20).optional(),
  from: z.string().min(1).max(40).optional(),
  to: z.string().min(1).max(40).optional(),
});

const outputSchema = z.record(z.unknown());

/** Activity scorecard for the calling agent (calls, notes, leads, applications, tasks, meetings, deal value, conversion). */
export const agentActivityTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'agent.activity',
  description:
    "The calling agent's activity scorecard for a period: calls, notes, leads (created/received/interested), applications filled, tasks, meetings, deal value and conversion funnel. Use for 'my activity', 'what have I done this week', productivity.",
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['servercrm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const zohoUserId = resolveZohoUserId(ctx, input.zohoUserId);
    const query: Record<string, string> = {};
    if (input.range) query.range = input.range;
    if (input.from) query.from = input.from;
    if (input.to) query.to = input.to;
    return serverCrmGet<Record<string, unknown>>(
      `/api/agent/activity/${encodeURIComponent(zohoUserId)}`,
      query,
    );
  },
};
