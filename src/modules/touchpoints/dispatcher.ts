/**
 * Touchpoint dispatcher — the single execution path for every catalog entry.
 *
 * Order: resolve key → RBAC gate → validate params → inject session identity → enforce
 * carrier ownership → execute (Deluge | servercrm) → normalize the result/error.
 *
 * Identity is session-authoritative: params that carry a user id / agent name are ALWAYS
 * overwritten via serverCrmScope's resolvers (non-admins locked to self; admins — incl.
 * act-as, which rewrites the ctx upstream — may target others).
 */
import { env } from '../../config/env.js';
import { AppError, NotFoundError, RBACError } from '../../lib/errors.js';
import {
  browserAutomationRequest,
  BrowserAutomationHttpError,
} from '../../integrations/browserAutomation.js';
import { executeZohoFunctionWithFallback } from '../../integrations/zohoFunctions.js';
import { serverCrmRequest, ServerCrmHttpError } from '../../integrations/serverCrm.js';
import { zapier, ZapierHttpError } from '../../integrations/zapier.js';
import {
  assertCarrierOwned,
  resolveAgentName,
  resolveZohoUserId,
} from '../tools/serverCrmScope.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { getTouchpoint, listTouchpoints } from './catalog/index.js';
import type {
  BrowserAutoTouchpoint,
  ServerCrmTouchpoint,
  Touchpoint,
  TouchpointResult,
} from './types.js';

const DEFAULT_DEPARTMENTS = ['sales'] as const;

/** May this caller invoke this touchpoint at all? (audience + department + risk tier) */
export function canInvokeTouchpoint(ctx: TenantContext, tp: Touchpoint): boolean {
  if (ctx.audience !== 'internal') return false;
  const isAdmin = ctx.role === 'admin' || ctx.bypassRbac === true || ctx.allDepartmentAccess;
  if (tp.riskClass === 'destructive' && !isAdmin && !env.FF_TOUCHPOINT_DESTRUCTIVE_SALES) {
    return false;
  }
  if (isAdmin) return true;
  const allowed = tp.departments ?? DEFAULT_DEPARTMENTS;
  return ctx.departments.some((d) => allowed.includes(d));
}

/** The catalog entries this caller may see/invoke (GET /v1/touchpoints). */
export function listTouchpointsFor(ctx: TenantContext): Touchpoint[] {
  return listTouchpoints().filter((tp) => canInvokeTouchpoint(ctx, tp));
}

function assertInvokable(ctx: TenantContext, tp: Touchpoint): void {
  if (ctx.audience !== 'internal') {
    throw new RBACError('Touchpoints are internal-only');
  }
  if (!canInvokeTouchpoint(ctx, tp)) {
    throw new RBACError(
      tp.riskClass === 'destructive'
        ? `Touchpoint '${tp.key}' is restricted (destructive actions are admin-only right now)`
        : `Touchpoint '${tp.key}' requires ${(tp.departments ?? DEFAULT_DEPARTMENTS).join('/')} department access`,
    );
  }
}

/** Overwrite identity-bearing params from the verified session (admin may override). */
function injectIdentity(
  ctx: TenantContext,
  tp: Touchpoint,
  params: Record<string, unknown>,
): void {
  if (tp.identityParam) {
    const override = params[tp.identityParam];
    params[tp.identityParam] = resolveZohoUserId(
      ctx,
      typeof override === 'string' ? override : undefined,
    );
  }
  if (tp.agentNameParam) {
    const override = params[tp.agentNameParam];
    params[tp.agentNameParam] = resolveAgentName(
      ctx,
      typeof override === 'string' ? override : undefined,
    );
  }
}

/**
 * Fill `{placeholder}` segments from params (consuming them); the leftovers become the
 * query (GET) or JSON body (POST). Every placeholder must resolve to a value.
 */
export function buildServerCrmCall(
  tp: Pick<ServerCrmTouchpoint, 'pathTemplate'> | Pick<BrowserAutoTouchpoint, 'pathTemplate'>,
  params: Record<string, unknown>,
): { path: string; leftovers: Record<string, unknown> } {
  const leftovers = { ...params };
  const path = tp.pathTemplate.replace(/\{([a-zA-Z0-9_]+)\}/g, (_m, name: string) => {
    const value = leftovers[name];
    if (value === undefined || value === null || value === '') {
      throw new AppError(`Missing required path param '${name}'`, {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
    const str = String(value);
    // encodeURIComponent leaves '.' intact, and `new URL()` normalizes '..'/'.' segments —
    // a path param of '..' could redirect the call to a different endpoint. Reject them.
    if (str === '.' || str === '..') {
      throw new AppError(`Invalid path param '${name}'`, {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
    delete leftovers[name];
    return encodeURIComponent(str);
  });
  return { path, leftovers };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function executeServerCrm(
  tp: ServerCrmTouchpoint,
  params: Record<string, unknown>,
): Promise<unknown> {
  const { path, leftovers } = buildServerCrmCall(tp, params);
  let data: unknown;
  try {
    if (tp.method === 'GET') {
      const query: Record<string, string> = {};
      for (const [k, v] of Object.entries(leftovers)) {
        if (v !== undefined && v !== null) query[k] = String(v);
      }
      data = await serverCrmRequest('GET', path, { query });
    } else {
      data = await serverCrmRequest('POST', path, { body: leftovers });
    }
  } catch (err) {
    if (err instanceof ServerCrmHttpError) {
      // Client-ish upstream statuses pass through (the message is agent-actionable, e.g.
      // a 422 money-code "insufficient available"); auth/server failures become our 502.
      // 502 included: money-code void fails closed when EFS is unreachable (retryable).
      if ([400, 404, 409, 422, 502].includes(err.status)) {
        throw new AppError(err.bodyText || `servercrm rejected the request (${err.status})`, {
          statusCode: err.status,
          code: 'SERVER_CRM_REJECTED',
          expose: true,
          cause: err,
        });
      }
      throw new AppError('servercrm request failed', {
        statusCode: 502,
        code: 'SERVER_CRM_ERROR',
        expose: true,
        cause: err,
      });
    }
    throw err;
  }
  // servercrm's uniform envelope: {success:false, message} on business rejection.
  if (isRecord(data) && data.success === false) {
    const message =
      typeof data.message === 'string' && data.message
        ? data.message
        : typeof data.error === 'string' && data.error
          ? data.error
          : 'servercrm rejected the request';
    throw new AppError(message, { statusCode: 422, code: 'SERVER_CRM_REJECTED', expose: true });
  }
  return data;
}

async function executeBrowserAuto(
  tp: BrowserAutoTouchpoint,
  params: Record<string, unknown>,
): Promise<unknown> {
  const { path, leftovers } = buildServerCrmCall(tp, params);
  let data: unknown;
  try {
    data = await browserAutomationRequest('POST', path, { body: leftovers });
  } catch (err) {
    if (err instanceof BrowserAutomationHttpError) {
      if ([400, 404, 409, 422].includes(err.status)) {
        throw new AppError(err.bodyText || `browser-automation rejected the request (${err.status})`, {
          statusCode: err.status,
          code: 'BROWSER_AUTO_REJECTED',
          expose: true,
          cause: err,
        });
      }
      throw new AppError('browser-automation request failed', {
        statusCode: 502,
        code: 'BROWSER_AUTO_ERROR',
        expose: true,
        cause: err,
      });
    }
    throw err;
  }
  if (isRecord(data) && data.success === false) {
    const message =
      typeof data.message === 'string' && data.message
        ? data.message
        : typeof data.error === 'string' && data.error
          ? data.error
          : 'browser-automation rejected the request';
    throw new AppError(message, { statusCode: 422, code: 'BROWSER_AUTO_REJECTED', expose: true });
  }
  return data;
}

async function executeZapier(params: Record<string, unknown>): Promise<unknown> {
  let data: unknown;
  try {
    data = await zapier.postTicketEmail(params);
  } catch (err) {
    if (err instanceof ZapierHttpError) {
      if ([400, 404, 409, 422].includes(err.status)) {
        throw new AppError(err.bodyText || `Zapier rejected the request (${err.status})`, {
          statusCode: err.status,
          code: 'ZAPIER_REJECTED',
          expose: true,
          cause: err,
        });
      }
      throw new AppError('Zapier webhook request failed', {
        statusCode: 502,
        code: 'ZAPIER_ERROR',
        expose: true,
        cause: err,
      });
    }
    throw err;
  }
  // Zapier replies { status: "success" }. Treat an explicit non-success as failure.
  if (isRecord(data) && data.status && String(data.status).toLowerCase() !== 'success') {
    const message =
      typeof data.message === 'string' && data.message
        ? data.message
        : typeof data.error === 'string' && data.error
          ? data.error
          : 'Request was not accepted.';
    throw new AppError(message, { statusCode: 422, code: 'ZAPIER_REJECTED', expose: true });
  }
  return data;
}

async function executeTouchpointKind(
  ctx: TenantContext,
  tp: Touchpoint,
  params: Record<string, unknown>,
): Promise<unknown> {
  switch (tp.kind) {
    case 'deluge':
      return executeZohoFunctionWithFallback(tp.functionNames, params, { unwrap: tp.unwrap });
    case 'servercrm':
      return executeServerCrm(tp, params);
    case 'browserauto':
      return executeBrowserAuto(tp, params);
    case 'zapier':
      return executeZapier(params);
    case 'local':
      return tp.handler(ctx, params);
    default: {
      const _exhaustive: never = tp;
      throw new AppError(`Unsupported touchpoint kind`, {
        statusCode: 500,
        code: 'INTERNAL_ERROR',
        expose: false,
        cause: _exhaustive,
      });
    }
  }
}

export async function dispatchTouchpoint(
  ctx: TenantContext,
  key: string,
  rawParams: unknown,
): Promise<TouchpointResult> {
  const tp = getTouchpoint(key);
  if (!tp) throw new NotFoundError(`Unknown touchpoint '${key}'`);
  assertInvokable(ctx, tp);

  const params = tp.paramsSchema.parse(rawParams ?? {}) as Record<string, unknown>;
  injectIdentity(ctx, tp, params);
  if (tp.carrierParam) {
    const carrier = params[tp.carrierParam];
    if (carrier === undefined || carrier === null || carrier === '') {
      throw new AppError(`Missing required param '${tp.carrierParam}'`, {
        statusCode: 400,
        code: 'VALIDATION_ERROR',
        expose: true,
      });
    }
    await assertCarrierOwned(ctx, String(carrier));
  }

  const data = await executeTouchpointKind(ctx, tp, params);
  return { key: tp.key, kind: tp.kind, data };
}
