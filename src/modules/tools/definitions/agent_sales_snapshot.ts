import { z } from 'zod';
import { serverCrmPost } from '../../../integrations/serverCrm.js';
import type { ToolManifest } from '../types.js';
import { resolveAgentName } from '../serverCrmScope.js';

const inputSchema = z.object({
  /** Admins only: query another agent. Everyone else is locked to their own portfolio. */
  agentName: z.string().min(1).max(200).optional(),
});

// servercrm responses are large/variable; pass them through (the model summarizes).
const outputSchema = z.record(z.unknown());

/** Portfolio KPIs for the calling agent (clients active/inactive/stuck, this-vs-last-week tx/gallons/new cards). */
export const agentSalesSnapshotTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'agent.sales_snapshot',
  description:
    "The calling agent's home-panel snapshot: client counts (active/inactive/stuck), and this-week-vs-last-week transactions, gallons, and new cards. Use for 'how am I doing', 'my numbers this week', portfolio health.",
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['servercrm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const agentName = resolveAgentName(ctx, input.agentName);
    return serverCrmPost<Record<string, unknown>>('/api/agent/dwh/snapshot', { agentName });
  },
};
