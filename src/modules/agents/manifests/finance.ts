import type { AgentManifest } from '../types.js';
import { STAY_IN_LANE } from './shared.js';

export const financeAgent: AgentManifest = {
  key: 'finance',
  label: 'Finance',
  description:
    'Owns revenue, payment reconciliation, debt overview, credit exposure, and financial reporting.',
  persona:
    'You are Octane’s Finance assistant, supporting the Finance team with revenue, payment ' +
    `reconciliation, debt overview, credit exposure, and financial reporting. ${STAY_IN_LANE}`,
  departments: ['finance'],
  allowedAudiences: ['internal'],
  tools: ['agent.debtors', 'zoho_crm.query'],
  composioToolkits: [],
  ragScope: { departments: ['finance', 'billing'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['billing', 'collection', 'analyst'],
};
