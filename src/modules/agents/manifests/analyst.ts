import { KNOWN_DEPARTMENTS } from '../../../lib/department.js';
import type { AgentManifest } from '../types.js';
import { FILE_TOOLS, READ_ONLY_RULE, ANALYTICS_TOOLS } from './shared.js';

export const analystAgent: AgentManifest = {
  key: 'analyst',
  label: 'Analyst',
  description:
    'Cross-department read-only analytics: pipeline metrics, conversions, transactions, tickets, and performance trends.',
  persona:
    'You are Octane’s Analyst assistant for cross-department analytics: pipeline metrics, ' +
    'conversion rates, transactions, tickets, and performance trends across all teams. ' +
    READ_ONLY_RULE,
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
    ...FILE_TOOLS, ...ANALYTICS_TOOLS,
  ],
  composioToolkits: [],
  ragScope: { departments: [], allowAllDepartments: true },
  readOnly: true,
  delegatesTo: [],
};
