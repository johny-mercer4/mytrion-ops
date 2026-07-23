import { env } from '../../../config/env.js';
import type { AgentManifest } from '../types.js';
import {
  BLACKBOARD_TOOLS,
  CLIENT_SERVICE_RULE,
  CLIENT_SERVICE_TOOLS,
  FILE_TOOLS,
  OCTANE_CONTEXT,
  OWNER_SCOPE_RULE,
  RAG_USAGE_RULE,
  STAY_IN_LANE,
  DBT_MCP_TOOLS,
  WAREHOUSE_TOOLS,
} from './shared.js';

/**
 * Sales Data Center copilot — the records workspace (/v1/data-center): owner-scoped leads,
 * deals, clients, gallons, and book lookups. Not a new department tag; access grant is `sales`.
 */
const DC_CAPABILITIES =
  'What you can do NOW (owner-scoped, mostly read):\n' +
  '• My leads / deals / contacts — zoho_crm.query (COQL; get field API names from knowledge_search when unsure).\n' +
  '• My clients by carrier — crm.pick_my_client then crm.carrier_balance / overview / list_cards / ' +
  'transactions / payment_info.\n' +
  '• My gallons / swipes — warehouse.my_gallons; portfolio health — agent.sales_snapshot / agent.activity.\n' +
  'What you CANNOT do: billing portfolio (company-wide), CS deal-billing writes, Desk tickets, fraud holds, ' +
  'card activation, or another agent’s book. Escalate those.';

const DC_ESCALATION =
  'Escalate: general sales strategy / demos beyond records → sales; KYC/apps → verification; ' +
  'invoices/collections → billing; cards/money-code ops beyond your book tools → customer-service.';

export const dataCenterAgent: AgentManifest = {
  key: 'data-center',
  label: 'Data Center',
  description:
    'Owns the sales agent’s book of business records: pipeline leads/deals, client roster, ' +
    'owner-scoped gallons/cards/billing lookup. Route here for: my leads, my deals, my clients, ' +
    'money-code draws context, app streak / Data Center workspace questions.',
  persona:
    'You are Octane’s Data Center assistant for a sales agent’s records workspace. ' +
    'The Orchestrator delegates with a `<Task>` block preceded by `<EnvironmentalContext>` — extract ' +
    '`ZohoUserId` / `Name` to scope tools. ' +
    OCTANE_CONTEXT +
    ' ' +
    DC_CAPABILITIES +
    ' ' +
    OWNER_SCOPE_RULE +
    ' ' +
    CLIENT_SERVICE_RULE +
    ' ' +
    RAG_USAGE_RULE +
    ' ' +
    DC_ESCALATION +
    ' ' +
    STAY_IN_LANE,
  departments: ['sales'],
  allowedAudiences: ['internal'],
  tools: [
    'agent.sales_snapshot',
    'agent.activity',
    'zoho_crm.query',
    'zoho_mcp.*',
    ...DBT_MCP_TOOLS,
    ...CLIENT_SERVICE_TOOLS,
    ...BLACKBOARD_TOOLS,
    ...FILE_TOOLS,
    ...WAREHOUSE_TOOLS,
  ],
  composioToolkits: [],
  ragScope: { departments: ['sales'], allowAllDepartments: false },
  readOnly: false,
  model: env.OPEN_AI_FIVE_O_MINI,
  delegatesTo: ['sales', 'verification', 'billing', 'customer-service'],
};
