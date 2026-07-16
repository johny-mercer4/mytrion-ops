import { z } from 'zod';
import { WILDCARD_SCOPE } from '../../../config/constants.js';
import { callDbtTool } from '../../../integrations/dbtMcp.js';
import { ToolError } from '../../../lib/errors.js';
import { dbtIdentityFromContext } from '../dbtMcpTools.js';
import type { ToolContext, ToolManifest } from '../types.js';

/**
 * "My gallons / swipes" from the data warehouse, sourced through the dbt MCP `query` tool.
 *
 * Row-level access is enforced by SCOPING THE dbt QUERY to the caller's Zoho user id — the same
 * identity we forward to the MCP as headers (X-User-Id / X-User-Role / X-User-Admin, see dbtMcp.ts).
 * Ownership lives in the warehouse itself: `octane.dim_company.agent_zoho_user_id` is the owning
 * agent for each `carrier_id`, so a rep's book = every transaction on a carrier they own. We resolve
 * that entirely inside ONE dbt query (no servercrm round-trip), so the MCP is ALWAYS called and a rep
 * can never see another rep's — or the company's — numbers:
 *   - non-admin → filtered to THEIR OWN zoho id (locked; an agentZohoUserId override is ignored).
 *   - admin     → may pass agentZohoUserId to target one rep's book, or omit it for company-wide.
 *
 * The Zoho id is matched on its last 12 digits (`right(...,12)`) because the session id and the
 * warehouse id can carry different org prefixes while sharing the same record suffix.
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
  agentZohoUserId: z.string().nullable(),
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

/**
 * Carrier → owning-agent map, deduped to ONE row per carrier (dim_company is SCD, so a carrier can
 * have several rows; the newest wins). Joined on carrier_id, it lets us filter transactions by owner
 * without fanning out the sum.
 */
const OWNER_JOIN = [
  'join (',
  '  select distinct on (carrier_id) carrier_id, agent_zoho_user_id',
  '  from octane.dim_company',
  '  where carrier_id is not null',
  '  order by carrier_id, update_date desc nulls last',
  ') c on c.carrier_id = t.carrier_id',
].join('\n');

/**
 * Elevated (admin/manager-tier) authority. We CANNOT use `allDepartmentAccess` here: when this tool
 * runs inside an agent, authority.narrowContext has already forced that flag to false. The wildcard
 * scope survives narrowing, so it's the reliable admin signal for a tool executed by a child agent.
 */
function callerIsElevated(ctx: ToolContext): boolean {
  return ctx.allDepartmentAccess === true || ctx.scopes.includes(WILDCARD_SCOPE);
}

/** The caller's raw Zoho user id (chat sets ctx.userId = `zoho:<id>`), or null. */
function callerZohoId(ctx: ToolContext): string | null {
  return /^zoho:(.+)$/.exec(ctx.userId)?.[1] ?? null;
}

/**
 * Last 12 digits of a Zoho id — safe to inline (digits only) and matches across the DWH org-prefix
 * mismatch (session id and warehouse id share the record suffix, not the org prefix).
 */
function zohoIdSuffix(id: string): string {
  return id.replace(/\D+/g, '').slice(-12);
}

export const warehouseMyGallonsTool: ToolManifest<
  z.infer<typeof inputSchema>,
  z.infer<typeof outputSchema>
> = {
  name: 'warehouse.my_gallons',
  description:
    "Total fuel gallons and swipes for the calling agent's BOOK (the carriers/clients they own), " +
    'from the data warehouse. Scoped automatically to the CALLER via their Zoho session id — use for ' +
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
    const isAdmin = callerIsElevated(ctx);
    const periodWhere = PERIOD_WHERE[input.period];
    const identity = dbtIdentityFromContext(ctx);

    // Admin with no target → company-wide (no owner filter). Everyone else is scoped by Zoho id.
    if (isAdmin && !input.agentZohoUserId?.trim()) {
      const sql = `${GALLONS_SELECT}\nwhere ${periodWhere}`;
      const result = await callDbtTool(
        'query',
        { sql, question: `company gallons and swipes ${input.period}` },
        identity,
      );
      return { scope: 'company', period: input.period, agentZohoUserId: null, result };
    }

    // Owner-scoped. Non-admins are LOCKED to their own id; admins may target another agent's book.
    const targetId = isAdmin ? input.agentZohoUserId?.trim() ?? null : callerZohoId(ctx);
    if (!targetId) {
      throw new ToolError('No Zoho user id on the request to scope gallons to your book.');
    }
    const suffix = zohoIdSuffix(targetId);
    if (!suffix) {
      throw new ToolError('Zoho user id has no digits to match a warehouse agent id.');
    }
    const scope: 'self' | 'agent' = isAdmin ? 'agent' : 'self';

    const sql =
      `${GALLONS_SELECT}\n${OWNER_JOIN}\n` +
      `where ${periodWhere}\nand right(c.agent_zoho_user_id::text, 12) = '${suffix}'`;
    const question = `gallons and swipes for zoho ${targetId} ${input.period}`;
    const result = await callDbtTool('query', { sql, question }, identity);
    return { scope, period: input.period, agentZohoUserId: targetId, result };
  },
};
