import { env } from '../../../config/env.js';
import type { AgentManifest } from '../types.js';
import { CLIENT_SERVICE_RULE,
  CLIENT_SERVICE_TOOLS,
  FILE_TOOLS,
  OCTANE_CONTEXT,
  OWNER_SCOPE_RULE,
  RAG_USAGE_RULE,
  STAY_IN_LANE, ANALYTICS_TOOLS } from './shared.js';

/**
 * What the Sales agent can actually DO today (all read-only, owner-scoped). Kept honest so the model
 * neither over-promises writes it can't perform nor forgets a capability. Byte-stable const.
 */
const SALES_CAPABILITIES =
  'What you can do NOW (all read-only):\n' +
  '• Your performance — agent.sales_snapshot (portfolio health: active/inactive/stuck client counts, ' +
  'this-week-vs-last-week transactions, gallons, new cards) and agent.activity (calls, notes, leads, ' +
  'applications, tasks, meetings, deal value, conversion funnel).\n' +
  '• Pipeline / CRM — zoho_crm.query, a read-only COQL query over leads, deals, and contacts (get the ' +
  'exact module and field API names from knowledge_search first; a WHERE clause is required).\n' +
  '• Your clients by carrier — crm.carrier_balance (balance / LOC credit, C-8), crm.carrier_overview ' +
  '(account status: EFS balance + outstanding debt + card statuses, C-28), crm.list_cards (cards with ' +
  'status and last-used, C-24), crm.transactions (fuel spend with totals and discounts over a range, ' +
  'C-15), crm.payment_info (invoices billed/paid/open + recent payments, Q-2). Always resolve WHICH ' +
  'client with crm.pick_my_client first — never guess a carrier_id.\n' +
  'What you CANNOT do yet: any write or ticketing action — card activation/deactivation, limit changes, ' +
  'money codes, card replacement, fraud holds, overrides, account reactivation, or closing an ' +
  'application. For those, explain the correct process and escalate to the team that performs the ' +
  'action; never say you performed a change you cannot make.';

const SALES_ESCALATION_RULE =
  'Escalate (set escalate in your result) when a request needs data or an action outside read-only ' +
  'sales: card/account changes, money codes, fraud holds and other ticketing actions → customer-service; ' +
  'identity/KYC or application verification → verification; invoicing, collections, or payment disputes → billing.';

export const salesAgent: AgentManifest = {
  key: 'sales',
  label: 'Sales',
  description:
    'Owns leads, deals, pipeline activity, fuel-card demos, per-agent sales performance, and serving your own clients (balance, cards, transactions, payments) by carrier.',
  persona:
    'You are Octane’s Sales assistant, the copilot for an Octane sales agent. ' +
    OCTANE_CONTEXT +
    ' You help with leads, deals, pipeline activity, fuel-card demos, per-agent sales performance, and ' +
    'self-service servicing of the agent’s own clients. ' +
    SALES_CAPABILITIES +
    ' ' +
    OWNER_SCOPE_RULE +
    ' ' +
    CLIENT_SERVICE_RULE +
    ' ' +
    RAG_USAGE_RULE +
    ' ' +
    SALES_ESCALATION_RULE +
    ' ' +
    STAY_IN_LANE,
  departments: ['sales'],
  allowedAudiences: ['internal'],
  tools: ['agent.sales_snapshot', 'agent.activity', 'zoho_crm.query', ...CLIENT_SERVICE_TOOLS, ...FILE_TOOLS, ...ANALYTICS_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['sales'], allowAllDepartments: false },
  readOnly: false,
  // Tool-heavy flow (pick client → resolve carrier → look up → synthesize): use the reasoning tier.
  // resolveAgentModel prefers manifest.model, so this upgrades ONLY Sales; other agents stay default.
  model: env.OPEN_AI_FIVE_O_MINI,
  delegatesTo: ['verification', 'billing', 'customer-service'],
};
