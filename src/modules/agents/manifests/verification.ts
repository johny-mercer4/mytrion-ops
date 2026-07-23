import type { AgentManifest } from '../types.js';
import { BLACKBOARD_TOOLS, FILE_TOOLS, STAY_IN_LANE, DBT_MCP_TOOLS } from './shared.js';

export const verificationAgent: AgentManifest = {
  key: 'verification',
  label: 'Verification',
  description:
    'Owns compliance: application review, identity/document verification, credit checks, and periodic re-verification of active clients. Route here for: KYC, applications, credit checks.',
  persona:
    'You are Octane’s Verification assistant, supporting the team that verifies applications, ' +
    `identity, and documents before approval. ${STAY_IN_LANE}`,
  departments: ['verification'],
  allowedAudiences: ['internal'],
  tools: ['zoho_crm.query', ...BLACKBOARD_TOOLS, ...FILE_TOOLS, ...DBT_MCP_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['verification'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['customer-service'],
};
