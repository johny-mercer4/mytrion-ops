import { KNOWN_DEPARTMENTS } from '../../../lib/department.js';
import type { AgentManifest } from '../types.js';
import {
  BLACKBOARD_TOOLS, FILE_TOOLS,
  READ_ONLY_RULE,
  DBT_MCP_TOOLS,
  WAREHOUSE_TOOLS,
  METRICS_ROUTING_RULE,
} from './shared.js';

export const analystAgent: AgentManifest = {
  key: 'analyst',
  label: 'Analyst',
  description:
    'Cross-department read-only analytics: pipeline metrics, conversions, transactions, tickets, and performance trends.',
  persona:
    'You are Octane’s Analyst assistant for cross-department analytics: pipeline metrics, ' +
    'conversion rates, transactions, tickets, and performance trends across all teams. ' +
    READ_ONLY_RULE +
    '\n' +
    METRICS_ROUTING_RULE,
  // Access grant is empty: only allDepartmentAccess (admin/manager-tier) callers may select it.
  departments: [],
  // Once selected, it reads across every known department (still no write access, ever).
  operatingDepartments: [...KNOWN_DEPARTMENTS],
  allowedAudiences: ['internal'],
  tools: [
    'agent.sales_snapshot',
    'agent.debtors',
    'agent.activity',
    'zoho_crm.query',
    'zoho_desk.search_tickets',
    ...BLACKBOARD_TOOLS, ...FILE_TOOLS, ...DBT_MCP_TOOLS, ...WAREHOUSE_TOOLS,
  ],
  composioToolkits: [],
  ragScope: { departments: [], allowAllDepartments: true },
  readOnly: true,
  delegatesTo: [],
};
