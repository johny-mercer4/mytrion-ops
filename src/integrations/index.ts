/**
 * Platform integration wrappers. One CLASS per vendor (extending core/base.ts's BaseWrapper /
 * HttpWrapper / SqlWrapper), exported as a lazy singleton; the historical free functions
 * remain as deprecated 1-line facades during the consumer migration.
 *
 *   zohoAuth  : shared Zoho token layer (per-service OAuth refresh, cached + deduped)
 *   zohoCrm / zohoDesk / zohoPeople : Zoho vendor wrappers (ZohoWrapper base)
 *   dwh       : read-only Data Warehouse Postgres (SqlWrapper, '$n' placeholders)
 *   cmpDb     : external CMP AWS RDS/Aurora MySQL (SqlWrapper, '?' placeholders, read-only)
 *   cmp       : CMP custom server — login/password -> bearer (sandbox by default)
 *   efs       : EFS CardManagement SOAP — parent + child session tokens
 *   serverCrm : our servercrm node server's agent API (proxy path; static x-api-key)
 *   internalDb: app Postgres, HEALTH-ONLY (queries go through repos/ — hard rule 2)
 *   ringcentral : Embeddable bootstrap config (the "Custom Wrapper" reference example)
 *   zohoFunctions : Zoho custom-function (Deluge) executor — the legacy mytrion* functions
 *
 * Composio is deliberately NOT exported here — its SDK must never load at boot; it registers
 * with the health registry via a lazy handle (core/registerAll.ts) and is lazy-imported by
 * its consumers.
 *
 * Adding a NEW integration (the "Custom Wrapper" recipe):
 *   1. Create src/integrations/<vendor>.ts: `class XWrapper extends HttpWrapper` implementing
 *      name / isConfigured / baseUrl / authHeaders (+ onUnauthorized / httpError / probe as
 *      needed); `export const x = new XWrapper()`. Constructors read no env, open no sockets.
 *   2. Add its env vars to config/env.ts (namespaced, with defaults).
 *   3. Register the singleton in core/registerAll.ts (lazy handle if the import is heavy).
 *   4. Tools call the singleton's methods from their ToolManifest handlers; direct routes may
 *      too, but RBAC/audit stay in the route/dispatcher layer.
 *   See ringcentral.ts for the smallest real example.
 */
export * as zoho from './zohoAuth.js';
export * as dwh from './dwh.js';
export * as awsMysql from './awsMysql.js';
export * as cmp from './cmp.js';
export * as efs from './efs.js';
export * as serverCrm from './serverCrm.js';
export * as zohoFunctions from './zohoFunctions.js';

// Wrapper singletons (the migration target — prefer these over the namespace free functions).
export { zohoCrm } from './zohoCrm.js';
export { zohoDesk } from './zohoDesk.js';
export { zohoPeople } from './zohoPeople.js';
export { dwh as dwhWrapper } from './dwh.js';
export { cmpDb } from './awsMysql.js';
export { cmp as cmpWrapper } from './cmp.js';
export { serverCrm as serverCrmWrapper } from './serverCrm.js';
export { internalDb } from './internalDb.js';
export { ringcentral } from './ringcentral.js';
