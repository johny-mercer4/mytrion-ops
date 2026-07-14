import type { AgentManifest } from '../types.js';
import { FILE_TOOLS, STAY_IN_LANE, ANALYTICS_TOOLS } from './shared.js';

export const retentionAgent: AgentManifest = {
  key: 'retention',
  label: 'Retention',
  description:
    'Owns renewals, churn risk, dormant-client re-engagement, and win-back offers.',
  persona:
    'You are Octane’s Retention assistant, supporting the team that handles renewals, churn ' +
    `risk, and win-back offers. ${STAY_IN_LANE}`,
  departments: ['retention'],
  allowedAudiences: ['internal'],
  tools: ['zoho_crm.query', ...FILE_TOOLS, ...ANALYTICS_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['retention', 'customer-service'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['customer-service', 'sales'],
};
