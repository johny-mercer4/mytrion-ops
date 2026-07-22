/**
 * Touchpoint model — one declarative entry per legacy-widget outbound call (Deluge
 * function or servercrm endpoint) or a DB-backed local handler. The catalog is data;
 * the dispatcher is the only code path, so adding a touchpoint = adding an entry,
 * never a route.
 */
import type { ZodTypeAny } from 'zod';
import type { UnwrapMode } from '../../integrations/zohoFunctions.js';
import type { TenantContext } from '../../types/tenantContext.js';

/**
 * read        — pure lookups (balances, invoices, dashboards).
 * write       — creates/updates with normal business impact (leads, tickets, card info).
 * destructive — money movement / card lockout / fraud actions; sales may run them only
 *               while FF_TOUCHPOINT_DESTRUCTIVE_SALES is on (admin always may).
 */
export type TouchpointRisk = 'read' | 'write' | 'destructive';

interface TouchpointBase {
  /** Stable dotted key — the route address: POST /v1/touchpoints/<key>. */
  key: string;
  /** Human label for the discovery listing (GET /v1/touchpoints). */
  title: string;
  riskClass: TouchpointRisk;
  /**
   * Departments allowed besides admin/all-department access. REQUIRED and non-empty — there is
   * deliberately no default: an untagged entry used to silently become sales-invokable, so the
   * compiler now fails closed on any catalog entry that forgets to declare its audience.
   */
  departments: readonly [string, ...string[]];
  /**
   * Params key that carries a Zoho user id. The dispatcher ALWAYS overwrites it with
   * resolveZohoUserId(ctx, clientValue): non-admin callers are locked to their own
   * session identity (client values ignored); admins (incl. act-as) may target others.
   */
  identityParam?: string;
  /** Params key holding a carrier id → assertCarrierOwned for non-admin callers. */
  carrierParam?: string;
  /** Params key carrying an agent display name → resolveAgentName (same authority rules). */
  agentNameParam?: string;
}

export interface DelugeTouchpoint extends TouchpointBase {
  kind: 'deluge';
  /** Primary + fallback casings (the legacy functions exist under inconsistent names). */
  functionNames: readonly [string, ...string[]];
  unwrap: UnwrapMode;
  paramsSchema: ZodTypeAny;
}

export interface ServerCrmTouchpoint extends TouchpointBase {
  kind: 'servercrm';
  method: 'GET' | 'POST';
  /**
   * Path with `{placeholder}` segments filled from validated params (encodeURIComponent)
   * and CONSUMED; leftover params become the query string (GET) or JSON body (POST).
   */
  pathTemplate: string;
  paramsSchema: ZodTypeAny;
}

/** Playwright browser-automation microservice (BOCA / Close Application). */
export interface BrowserAutoTouchpoint extends TouchpointBase {
  kind: 'browserauto';
  method: 'POST';
  pathTemplate: string;
  paramsSchema: ZodTypeAny;
}

/** Zapier catch-hook (card replacement / account reactivation email tickets). */
export interface ZapierTouchpoint extends TouchpointBase {
  kind: 'zapier';
  method: 'POST';
  paramsSchema: ZodTypeAny;
}

/**
 * DB-backed / in-process handler (e.g. retention_cases). Runs after the same
 * RBAC + identity injection as proxy kinds; the handler receives the verified ctx.
 */
export interface LocalTouchpoint extends TouchpointBase {
  kind: 'local';
  paramsSchema: ZodTypeAny;
  handler: (ctx: TenantContext, params: Record<string, unknown>) => Promise<unknown>;
}

export type Touchpoint =
  | DelugeTouchpoint
  | ServerCrmTouchpoint
  | BrowserAutoTouchpoint
  | ZapierTouchpoint
  | LocalTouchpoint;

/** The dispatcher's uniform result envelope (route wraps it as `{ key, data }`). */
export interface TouchpointResult {
  key: string;
  kind: Touchpoint['kind'];
  data: unknown;
}
