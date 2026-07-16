import { KNOWN_DEPARTMENTS } from '../../../lib/department.js';
import { AGENT_KEYS, type AgentManifest } from '../types.js';
import {
  FILE_TOOLS,
  READ_ONLY_RULE,
  ANALYTICS_TOOLS,
  WAREHOUSE_TOOLS,
  METRICS_ROUTING_RULE,
} from './shared.js';

export const managerAgent: AgentManifest = {
  key: 'manager',
  label: 'Manager',
  description:
    'Management/C-level oversight: cross-department KPIs, staffing lookups, escalation handling, and coordination. Read-only.',
  persona:
    'You are Octane’s Manager assistant for Management and C-level: cross-department oversight, ' +
    'KPIs, staffing lookups, escalations, and coordination between teams. ' +
    READ_ONLY_RULE +
    '\n' +
    METRICS_ROUTING_RULE,
  departments: ['management', 'c-level'],
  operatingDepartments: [...KNOWN_DEPARTMENTS],
  allowedAudiences: ['internal'],
  tools: [
    'agent.sales_snapshot',
    'agent.debtors',
    'agent.activity',
    'zoho_crm.query',
    'zoho_desk.search_tickets',
    'zoho_people.search_employees',
    ...FILE_TOOLS, ...ANALYTICS_TOOLS, ...WAREHOUSE_TOOLS,
  ],
  composioToolkits: ['ZOHO', 'ZOHO_DESK'],
  ragScope: { departments: [], allowAllDepartments: true },
  readOnly: true,
  delegatesTo: AGENT_KEYS.filter((k) => k !== 'manager'),
};
