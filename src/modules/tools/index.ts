import { registerTool, ToolRegistry } from './registry.js';
import type { RegisteredTool } from './types.js';
import { knowledgeSearchTool } from './definitions/knowledge_search.js';
import { zohoPeopleSearchEmployeesTool } from './definitions/zoho_people_search_employees.js';
import { zohoCrmQueryTool } from './definitions/zoho_crm_query.js';
import { zohoDeskSearchTicketsTool } from './definitions/zoho_desk_search_tickets.js';
import { agentSalesSnapshotTool } from './definitions/agent_sales_snapshot.js';
import { agentDebtorsTool } from './definitions/agent_debtors.js';
import { agentActivityTool } from './definitions/agent_activity.js';

/**
 * The hard-coded tool catalog. Each registerTool() call infers its own input/output
 * types, so the heterogeneous list collapses to RegisteredTool[] with no casts.
 * Add new tools here (V1 has no dynamic/plugin registration by design).
 */
export const allTools: RegisteredTool[] = [
  registerTool(knowledgeSearchTool),
  // Direct Zoho reads (auth via the Zoho wrapper; module/field names come from the knowledge base):
  registerTool(zohoPeopleSearchEmployeesTool),
  registerTool(zohoCrmQueryTool),
  registerTool(zohoDeskSearchTicketsTool),
  // servercrm agent-API proxies (owner-scoped to the calling agent server-side):
  registerTool(agentSalesSnapshotTool),
  registerTool(agentDebtorsTool),
  registerTool(agentActivityTool),
];

export const toolRegistry = new ToolRegistry(allTools);

export { ToolRegistry, registerTool };
