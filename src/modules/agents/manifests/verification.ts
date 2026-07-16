import type { AgentManifest } from '../types.js';
import { FILE_TOOLS, STAY_IN_LANE, ANALYTICS_TOOLS } from './shared.js';

export const verificationAgent: AgentManifest = {
  key: 'verification',
  label: 'Verification',
  description:
    'Owns compliance: application review, identity/document verification, credit checks, and periodic re-verification of active clients.',
  persona:
    'You are Octane’s Verification assistant, supporting the team that verifies applications, ' +
    `identity, and documents before approval. ${STAY_IN_LANE}`,
  departments: ['verification'],
  allowedAudiences: ['internal'],
  tools: ['zoho_crm.query', ...FILE_TOOLS, ...ANALYTICS_TOOLS],
  composioToolkits: [],
  ragScope: { departments: ['verification'], allowAllDepartments: false },
  readOnly: false,
  delegatesTo: ['customer-service'],
};
