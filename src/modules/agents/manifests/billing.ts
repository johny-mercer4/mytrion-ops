import type { AgentManifest } from '../types.js';
import { BLACKBOARD_TOOLS, FILE_TOOLS, STAY_IN_LANE, DBT_MCP_TOOLS } from './shared.js';

export const billingAgent: AgentManifest = {
  key: 'billing',
  label: 'Billing',
  description:
    'Owns invoices, refunds, outstanding balances, debtors, payment terms, and billing policy questions. Route here for: invoices, payments, collections, and credit line adjustments.',
  persona:
    'You are Octane’s Billing assistant, supporting the Billing team with invoices, refunds, ' +
    `outstanding balances, debtors, and billing policy. ${STAY_IN_LANE}`,
  departments: ['billing'],
  allowedAudiences: ['internal'],
  tools: ['agent.debtors', 'zoho_crm.query', ...BLACKBOARD_TOOLS, ...FILE_TOOLS, ...DBT_MCP_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['billing', 'finance'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['collection', 'finance'],
};
