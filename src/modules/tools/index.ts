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
  crmCarrierBalanceTool,
  crmCarrierOverviewTool,
  crmListCardsTool,
  crmListMyClientsTool,
  crmPaymentInfoTool,
  crmPickMyClientTool,
  crmTransactionsTool,
} from './definitions/servercrm_client.js';
import { uiRequestChoiceTool } from './definitions/ui_choice.js';
import {
  fileGenerateCsvTool,
  fileGenerateExcelTool,
  fileGeneratePdfTool,
  fileGetLinkTool,
} from './definitions/file_generate.js';
import { fileAnalyzeTool, fileIngestToKnowledgeTool } from './definitions/file_analyze.js';
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
  // servercrm client/carrier self-service READ tools (owner-guarded per-call; map to the
  // self-service widget automation blocks). ui.request_choice = generative-UI elicitation.
  registerTool(crmListMyClientsTool),
  registerTool(crmPickMyClientTool),
  registerTool(crmCarrierBalanceTool),
  registerTool(crmCarrierOverviewTool),
  registerTool(crmListCardsTool),
  registerTool(crmTransactionsTool),
  registerTool(crmPaymentInfoTool),
  registerTool(uiRequestChoiceTool),
  // File generation/analysis (flag-gated; storage = MinIO/S3). generate/analyze are read-class
  // by ratified decision (tenant-scoped, audited artifacts); ingest_to_knowledge stays write.
  ...(env.FF_FILES_ENABLED
    ? [
        registerTool(fileGenerateCsvTool),
        registerTool(fileGenerateExcelTool),
        registerTool(fileGeneratePdfTool),
        registerTool(fileGetLinkTool),
        registerTool(fileAnalyzeTool),
        registerTool(fileIngestToKnowledgeTool),
      ]
    : []),
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
