import { registerTool, ToolRegistry } from './registry.js';
import type { RegisteredTool } from './types.js';
import { knowledgeSearchTool } from './definitions/knowledge_search.js';
import { zohoCrmSearchAccountsTool } from './definitions/zoho_crm_search_accounts.js';
import { zohoCrmGetAccountTool } from './definitions/zoho_crm_get_account.js';
import { octaneCustomerLookupTool } from './definitions/octane_customer_lookup.js';
import { octaneCardStatusTool } from './definitions/octane_card_status.js';
import { octaneTransactionSearchTool } from './definitions/octane_transaction_search.js';
import { partnerDriverLookupTool } from './definitions/partner_driver_lookup.js';
import { partnerFleetSummaryTool } from './definitions/partner_fleet_summary.js';
import { zohoPeopleSearchEmployeesTool } from './definitions/zoho_people_search_employees.js';

/**
 * The hard-coded tool catalog. Each registerTool() call infers its own input/output
 * types, so the heterogeneous list collapses to RegisteredTool[] with no casts.
 * Add new tools here (V1 has no dynamic/plugin registration by design).
 */
export const allTools: RegisteredTool[] = [
  registerTool(knowledgeSearchTool),
  registerTool(zohoCrmSearchAccountsTool),
  registerTool(zohoCrmGetAccountTool),
  registerTool(octaneCustomerLookupTool),
  registerTool(octaneCardStatusTool),
  registerTool(octaneTransactionSearchTool),
  registerTool(partnerDriverLookupTool),
  registerTool(partnerFleetSummaryTool),
  registerTool(zohoPeopleSearchEmployeesTool),
];

export const toolRegistry = new ToolRegistry(allTools);

export { ToolRegistry, registerTool };
