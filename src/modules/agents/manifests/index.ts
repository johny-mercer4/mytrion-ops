/**
 * Child-agent manifests, in AGENT_KEYS order. This list is the single source of truth
 * for the multi-agent core; departmentAgents.ts (the /v1/chat persona + tool-policy shim) and
 * the agent registry are both derived from it.
 */
import { AGENT_KEYS, type AgentKey, type AgentManifest } from '../types.js';
import { analystAgent } from './analyst.js';
import { billingAgent } from './billing.js';
import { collectionAgent } from './collection.js';
import { customerServiceAgent } from './customerService.js';
import { dataCenterAgent } from './dataCenter.js';
import { financeAgent } from './finance.js';
import { managerAgent } from './manager.js';
import { marketingAgent } from './marketing.js';
import { retentionAgent } from './retention.js';
import { salesAgent } from './sales.js';
import { verificationAgent } from './verification.js';

const byKey: Record<AgentKey, AgentManifest> = {
  'customer-service': customerServiceAgent,
  billing: billingAgent,
  verification: verificationAgent,
  retention: retentionAgent,
  sales: salesAgent,
  'data-center': dataCenterAgent,
  marketing: marketingAgent,
  finance: financeAgent,
  analyst: analystAgent,
  manager: managerAgent,
  collection: collectionAgent,
};

export const ALL_AGENT_MANIFESTS: AgentManifest[] = AGENT_KEYS.map((key) => byKey[key]);
