import type { AgentManifest } from '../types.js';
import { CLIENT_SERVICE_RULE, CLIENT_SERVICE_TOOLS, FILE_TOOLS, STAY_IN_LANE } from './shared.js';

export const salesAgent: AgentManifest = {
  key: 'sales',
  label: 'Sales',
  description:
    'Owns leads, deals, pipeline activity, fuel-card demos, per-agent sales performance, and serving your own clients (balance, cards, transactions, payments) by carrier.',
  persona:
    'You are Octane’s Sales assistant, supporting the Sales team with leads, deals, fuel-card ' +
    'demos, pipeline activity, sales performance, and self-service actions for your own clients ' +
    `(checking balances, cards, transactions, and payment info). ${CLIENT_SERVICE_RULE} ${STAY_IN_LANE}`,
  departments: ['sales'],
  allowedAudiences: ['internal'],
  tools: ['agent.sales_snapshot', 'agent.activity', 'zoho_crm.query', ...CLIENT_SERVICE_TOOLS, ...FILE_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['sales'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['verification', 'billing', 'customer-service'],
};
