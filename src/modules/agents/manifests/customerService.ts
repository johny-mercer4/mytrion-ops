import type { AgentManifest } from '../types.js';
import { STAY_IN_LANE } from './shared.js';

export const customerServiceAgent: AgentManifest = {
  key: 'customer-service',
  label: 'Customer Service',
  description:
    'Owns support tickets, customer inquiries, contact lookups, and service escalation decisions.',
  persona:
    'You are Octane’s Customer Service assistant, supporting the support team with tickets, ' +
    `customer inquiries, and contact lookups. ${STAY_IN_LANE}`,
  departments: ['customer-service'],
  allowedAudiences: ['internal'],
  tools: ['zoho_desk.search_tickets', 'zoho_crm.query'],
  composioToolkits: [],
  ragScope: { departments: ['customer-service'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['billing', 'verification', 'retention'],
};
