import { z } from 'zod';
import { callDbtTool } from '../../../integrations/dbtMcp.js';
import { dbtIdentityFromContext } from '../dbtMcpTools.js';
import { fetchAgentRoster } from '../serverCrmScope.js';
import type { ToolManifest } from '../types.js';

/**
 * "My book" gallons/swipes from the warehouse, sourced through the dbt MCP `query` tool.
 *
 * Definition (ratified 2026-07-15): an agent's gallons = fuel pumped by the CARRIERS THEY OWN, not
 * rows where the warehouse tags them as the closer (that `agent` column attributes to a different
 * person and left most reps at 0). So we:
 *   1. resolve the caller's carrier roster via servercrm `/api/clients/by-agent/<zohoId>`
 *      (fetchAgentRoster — the same owner-scoping crm.list_my_clients uses; keyed by the LIVE-CRM
 *      Zoho id, which avoids the warehouse org-prefix mismatch), then
 *   2. sum octane.mart_transaction_line_items over those carrier_ids for the period.
 *
 * RBAC is enforced HERE, not by the model:
 *   - non-admin  → roster is their OWN (resolveZohoUserId locks it); they can never widen it.
 *   - admin      → may pass agentZohoUserId to target one agent's book, or omit it for company-wide.
 *
 * Identity (id + role + admin flag) is also forwarded to the MCP as headers (see dbtMcp.ts) for the
 * per-user query-memory RAG and audit — context, not prompt.
 */
const PERIODS = ['today', 'this_week', 'this_month'] as const;

const inputSchema = z.object({
  /** Time window for the totals. Defaults to the current month. */
  period: z.enum(PERIODS).default('this_month'),
  /** ADMINS ONLY: target another agent's book by their Zoho user id. Ignored for non-admins. */
  agentZohoUserId: z.string().min(1).max(120).optional(),
});

// The MCP `query` tool returns a formatted text blob; pass it through for the model to summarize.
const outputSchema = z.object({
  scope: z.enum(['self', 'agent', 'company']),
  period: z.enum(PERIODS),
  agentName: z.string().nullable(),
  carriersInBook: z.number(),
  result: z.unknown(),
});

const PERIOD_WHERE: Record<(typeof PERIODS)[number], string> = {
  today: `t.transaction_date::date = current_date`,
  this_week: `date_trunc('week', t.transaction_date) = date_trunc('week', current_date)`,
  this_month: `date_trunc('month', t.transaction_date) = date_trunc('month', current_date)`,
};

const GALLONS_SELECT = [
  'select',
  '  coalesce(sum(t.line_item_fuel_quantity), 0) as gallons,',
  '  count(distinct t.transaction_id) as swipes,',
  '  count(distinct t.carrier_id) as carriers',
  'from octane.mart_transaction_line_items t',
].join('\n');

/** Keep only whole carrier ids (integers) so they inline safely into `in (...)`. */
function carrierIdList(ids: Array<number | string>): string {
  const clean = ids
    .map((v) => Number(v))
    .filter((n) => Number.isInteger(n) && n > 0)
    .map((n) => String(n));
  return clean.join(', ');
}

export const warehouseMyGallonsTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'warehouse.my_gallons',
  description:
    "Total fuel gallons and swipes for an agent's BOOK (the carriers/clients they own), from the " +
    "data warehouse. Scoped to the CALLING agent automatically via their client roster — use for " +
    "'my gallons', 'how many gallons did my clients pump', 'my swipes this week/month'. Admins may " +
    'pass agentZohoUserId to target one agent, or omit it for the company-wide total. Never ask the ' +
    'user for their name or id — identity comes from the session.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['servercrm:read'],
  rateLimit: { perMinute: 20 },
  async handler(input, ctx) {
    const isAdmin = ctx.allDepartmentAccess === true;
    const periodWhere = PERIOD_WHERE[input.period];
    const identity = dbtIdentityFromContext(ctx);

    // Admin with no target → company-wide (no carrier filter). Roster not needed.
    if (isAdmin && !input.agentZohoUserId?.trim()) {
      const sql = `${GALLONS_SELECT}\nwhere ${periodWhere}`;
      const result = await callDbtTool(
        'query',
        { sql, question: `company gallons and swipes ${input.period}` },
        identity,
      );
      return { scope: 'company', period: input.period, agentName: null, carriersInBook: 0, result };
    }

    // Otherwise resolve the roster. Non-admins are LOCKED to their own id (override ignored server-
    // side by resolveZohoUserId); admins may pass a target id.
    const override = isAdmin ? input.agentZohoUserId?.trim() : undefined;
    const roster = await fetchAgentRoster(ctx, override ? { override } : {});
    const scope: 'self' | 'agent' = isAdmin && override ? 'agent' : 'self';
    const carrierIds = carrierIdList(roster.carriers.map((c) => c.carrierId));

    // Empty book → no carriers to sum. Return zeros without hitting the warehouse.
    if (!carrierIds) {
      return {
        scope,
        period: input.period,
        agentName: roster.agentName,
        carriersInBook: 0,
        result: { gallons: 0, swipes: 0, carriers: 0, note: 'No carriers in this agent’s book.' },
      };
    }

    const sql = `${GALLONS_SELECT}\nwhere ${periodWhere}\nand t.carrier_id in (${carrierIds})`;
    const question = `gallons and swipes for ${roster.agentName ?? 'my book'} ${input.period}`;
    const result = await callDbtTool('query', { sql, question }, identity);
    return {
      scope,
      period: input.period,
      agentName: roster.agentName,
      carriersInBook: roster.carriers.length,
      result,
    };
  },
};
