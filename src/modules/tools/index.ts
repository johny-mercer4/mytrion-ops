import { env } from '../../config/env.js';
import { applyDepartmentPolicy } from '../agents/departmentAgents.js';
import { registerTool, ToolRegistry } from './registry.js';
import type { RegisteredTool } from './types.js';
import { knowledgeSearchTool } from './definitions/knowledge_search.js';
import { zohoPeopleSearchEmployeesTool } from './definitions/zoho_people_search_employees.js';
import { zohoCrmQueryTool } from './definitions/zoho_crm_query.js';
import { zohoDeskSearchTicketsTool } from './definitions/zoho_desk_search_tickets.js';
import { agentSalesSnapshotTool } from './definitions/agent_sales_snapshot.js';
import { agentDebtorsTool } from './definitions/agent_debtors.js';
import { agentActivityTool } from './definitions/agent_activity.js';
import {
  telegramGetChatTool,
  telegramGetMeTool,
  telegramGetUpdatesTool,
  telegramSendDocumentTool,
  telegramSendMessageTool,
  telegramSendPhotoTool,
} from './definitions/telegram.js';

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
  // Native Telegram toolkit (flag-gated). Sends are write-risk → admin-gated by the dispatcher.
  ...(env.FF_TELEGRAM_ENABLED
    ? [
        registerTool(telegramSendMessageTool),
        registerTool(telegramSendPhotoTool),
        registerTool(telegramSendDocumentTool),
        registerTool(telegramGetMeTool),
        registerTool(telegramGetUpdatesTool),
        registerTool(telegramGetChatTool),
      ]
    : []),
];

// Stamp each tool's allowedDepartments from the department-agent registry (RBAC enforced in
// toolDispatcher): department tools → their dept(s), universal tools → open, the rest → admin-only.
applyDepartmentPolicy(allTools);

export const toolRegistry = new ToolRegistry(allTools);

export { ToolRegistry, registerTool };
