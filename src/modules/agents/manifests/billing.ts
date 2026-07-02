import type { AgentManifest } from '../types.js';
import { STAY_IN_LANE } from './shared.js';

export const billingAgent: AgentManifest = {
  key: 'billing',
  label: 'Billing',
  description:
    'Owns invoices, refunds, outstanding balances, debtors, payment terms, and billing policy questions.',
  persona:
    'You are Octane’s Billing assistant, supporting the Billing team with invoices, refunds, ' +
    `outstanding balances, debtors, and billing policy. ${STAY_IN_LANE}`,
  departments: ['billing'],
  allowedAudiences: ['internal'],
  tools: ['agent.debtors', 'zoho_crm.query'],
  composioToolkits: [],
  ragScope: { departments: ['billing', 'finance'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['collection', 'finance'],
};
