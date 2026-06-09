/**
 * Platform integration wrappers. One module per vendor, each owning that platform's auth
 * (and, later, its tool calls). Reusable auth is the contract here.
 *
 *   zoho : Zoho OAuth across child services (CRM / Desk / Projects / People) — cached per service
 *   dwh  : read-only Data Warehouse Postgres (pooled)
 *   cmp  : CMP custom server — login/password -> bearer (sandbox by default)
 *   efs       : EFS CardManagement SOAP — parent + child session tokens
 *   serverCrm : our servercrm node server's agent API (proxy path; static x-api-key)
 *
 * Usage:  import { cmp, dwh, efs, serverCrm, zoho } from '../integrations/index.js';
 *         await cmp.cmpAuthHeaders();  await zoho.authHeaders('zoho_crm');
 *         await serverCrm.serverCrmPost('/api/agent/dwh/snapshot', { agentName });
 */
export * as zoho from './wrapper.js';
export * as dwh from './dwh.js';
export * as cmp from './cmp.js';
export * as efs from './efs.js';
export * as serverCrm from './serverCrm.js';
