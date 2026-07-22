import { z } from 'zod';
import { runCoql } from '../../../integrations/zohoCrm.js';
import type { ToolManifest } from '../types.js';

const inputSchema = z.object({
  /**
   * A read-only COQL SELECT, e.g.
   *   select id, Last_Name, Email from Contacts where Lead_Source = 'Web' limit 0, 50
   * COQL REQUIRES a WHERE clause — to match all rows use `where id is not null`. Use the exact
   * module/field API names from the business-context knowledge base. Max 2000 rows per page;
   * paginate with the LIMIT offset (`limit 0, 2000` then `limit 2000, 2000`, …).
   */
  select_query: z.string().min(1).max(4000),
});

const outputSchema = z.object({
  count: z.number(),
  moreRecords: z.boolean(),
  rows: z.array(z.record(z.unknown())),
});

/**
 * Real tool (Zoho CRM). Runs a read-only COQL query. The model supplies the query; module and
 * field API names come from the knowledge base (RAG), not from this manifest. Read-only is
 * guaranteed by the SELECT-only `/coql` endpoint and the read-only OAuth scope (ZohoCRM.coql.READ),
 * plus this tool's read riskClass + RBAC; assertReadOnlyCoql is just a fail-fast sanity check.
 */
export const zohoCrmQueryTool: ToolManifest<z.infer<typeof inputSchema>, z.infer<typeof outputSchema>> = {
  name: 'zoho_crm.query',
  description:
    'Run a read-only COQL query against Zoho CRM and return matching records. COQL grammar: ' +
    'SELECT <fields> FROM <Module> WHERE <conditions> [ORDER BY …] [LIMIT offset, count] (max 2000 ' +
    'rows/page). A WHERE clause is REQUIRED — use `where id is not null` to match all rows. Use the ' +
    'exact module and field API names for our org from the knowledge base. Internal use only.',
  inputSchema,
  outputSchema,
  riskClass: 'read',
  allowedAudiences: ['internal'],
  requiredScopes: ['zoho_crm:read'],
  rateLimit: { perMinute: 30 },
  async handler(input) {
    const { rows, count, moreRecords } = await runCoql(input.select_query);
    return { count, moreRecords, rows };
  },
};
