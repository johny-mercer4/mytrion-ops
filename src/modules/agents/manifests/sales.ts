import type { AgentManifest } from '../types.js';
import { STAY_IN_LANE } from './shared.js';

export const salesAgent: AgentManifest = {
  key: 'sales',
  label: 'Sales',
  description:
    'Owns leads, deals, pipeline activity, fuel-card demos, and per-agent sales performance (snapshots, activity, leaderboards).',
  persona:
    'You are Octane’s Sales assistant, supporting the Sales team with leads, deals, fuel-card ' +
    `demos, pipeline activity, and sales performance. ${STAY_IN_LANE}`,
  departments: ['sales'],
  allowedAudiences: ['internal'],
  tools: ['agent.sales_snapshot', 'agent.activity', 'zoho_crm.query'],
  composioToolkits: [],
  ragScope: { departments: ['sales'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['verification', 'billing', 'customer-service'],
};
