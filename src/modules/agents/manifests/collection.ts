import type { AgentManifest } from '../types.js';
import { FILE_TOOLS, STAY_IN_LANE, ANALYTICS_TOOLS } from './shared.js';

export const collectionAgent: AgentManifest = {
  key: 'collection',
  label: 'Collection',
  description:
    'Owns overdue accounts and debt recovery: debtors, aging, outstanding balances, and follow-up.',
  persona:
    'You are Octane’s Collections assistant, supporting the team that follows up on overdue ' +
    `accounts and outstanding balances. ${STAY_IN_LANE}`,
  departments: ['collection'],
  allowedAudiences: ['internal'],
  tools: ['agent.debtors', 'zoho_crm.query', ...FILE_TOOLS, ...ANALYTICS_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['collection', 'billing'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['billing', 'retention'],
};
