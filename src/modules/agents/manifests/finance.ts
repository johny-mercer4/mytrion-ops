import type { AgentManifest } from '../types.js';
import { BLACKBOARD_TOOLS, FILE_TOOLS, STAY_IN_LANE, DBT_MCP_TOOLS } from './shared.js';

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
  tools: ['agent.debtors', 'zoho_crm.query', ...BLACKBOARD_TOOLS, ...FILE_TOOLS, ...DBT_MCP_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['finance', 'billing'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['billing', 'collection', 'analyst'],
};
