import type { AgentManifest } from '../types.js';
import { BLACKBOARD_TOOLS, FILE_TOOLS, STAY_IN_LANE, DBT_MCP_TOOLS } from './shared.js';

export const marketingAgent: AgentManifest = {
  key: 'marketing',
  label: 'Marketing',
  description:
    'Owns lead-generation channels (Meta, website, brokers), campaign performance, segmentation, and outreach. Can research the public web.',
  persona:
    'You are Octane’s Marketing assistant, supporting the Marketing team with campaigns, ' +
    'lead-generation channels (Meta, website, brokers), audience segmentation, and outreach ' +
    `performance. ${STAY_IN_LANE}`,
  departments: ['marketing', 'sales'],
  allowedAudiences: ['internal'],
  tools: ['zoho_crm.query', ...BLACKBOARD_TOOLS, ...FILE_TOOLS, ...DBT_MCP_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['marketing', 'sales'], allowAllDepartments: false },
  readOnly: false,
  webSearch: true,
  browser: true,
  delegatesTo: ['sales'],
};
