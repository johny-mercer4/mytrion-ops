import type { AgentManifest } from '../types.js';
import { CLIENT_SERVICE_RULE, CLIENT_SERVICE_TOOLS, BLACKBOARD_TOOLS, FILE_TOOLS, STAY_IN_LANE, DBT_MCP_TOOLS } from './shared.js';

export const customerServiceAgent: AgentManifest = {
  key: 'customer-service',
  label: 'Customer Service',
  description:
    'Owns support tickets, customer inquiries, contact lookups, and client self-service by carrier (balance, account status, cards, transactions, payments). Route here for: money codes, cards, fraud, and active driver support.',
  persona:
    'You are Octane’s Customer Service assistant, supporting the support team with tickets, ' +
    'customer inquiries, contact lookups, and client self-service actions (balance, account ' +
    `status, cards, transactions, payment info). ${CLIENT_SERVICE_RULE} ${STAY_IN_LANE}`,
  departments: ['customer-service'],
  allowedAudiences: ['internal'],
  tools: ['zoho_desk.search_tickets', 'zoho_crm.query', ...CLIENT_SERVICE_TOOLS, ...BLACKBOARD_TOOLS, ...FILE_TOOLS, ...DBT_MCP_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['customer-service'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['billing', 'verification', 'retention'],
};
