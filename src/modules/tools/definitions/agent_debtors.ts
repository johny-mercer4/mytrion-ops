import { z } from 'zod';
import { serverCrmPost } from '../../../integrations/serverCrm.js';
import type { ToolManifest } from '../types.js';
import { resolveAgentName } from '../serverCrmScope.js';

const inputSchema = z.object({
  /** Admins only: query another agent. Everyone else is locked to their own carriers. */
  agentName: z.string().min(1).max(200).optional(),
});

const outputSchema = z.record(z.unknown());

/** Overdue invoices for the calling agent's carriers, grouped per carrier, hard-debtor flagged. */
export const agentDebtorsTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'agent.debtors',
  description:
    "Overdue invoices for the calling agent's carriers — per-carrier totals owed/remaining, days past due, and a hard-debtor flag. Use for 'who owes me money', 'my debtors', 'overdue accounts'.",
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['servercrm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input, ctx) {
    const agentName = resolveAgentName(ctx, input.agentName);
    return serverCrmPost<Record<string, unknown>>('/api/agent/dwh/debtors', { agentName });
  },
};
