/**
 * RingCentral Embeddable bootstrap for Sales Mytrion.
 *
 * GET /v1/ringcentral/embed-config — returns the credentials needed to load the Embeddable
 * adapter (clientId + secret + JWT + server). Secrets stay in server env and are only handed
 * to authenticated sales/admin callers; they must never be baked into the Vite bundle.
 *
 * Auth note: JWT login makes every agent the same RingCentral extension (experimental for
 * Embeddable). Fine for Phase 1; switch to per-agent OAuth/PKCE before multi-extension prod.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { NotFoundError, RBACError } from '../../lib/errors.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireContext, withDepartmentAccess } from './helpers.js';

const ADAPTER_BASE =
  'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js';

function requireSalesAccess(request: FastifyRequest): TenantContext {
  const base = requireContext(request);
  if (base.audience !== 'internal') {
    throw new RBACError('RingCentral phone is internal-only');
  }
  const ctx = withDepartmentAccess(base, request);
  const ok =
    ctx.role === 'admin' ||
    ctx.bypassRbac === true ||
    ctx.allDepartmentAccess ||
    ctx.departments.includes('sales');
  if (!ok) throw new RBACError('RingCentral phone requires sales department access');
  return ctx;
}

function configured(): boolean {
  return Boolean(
    env.FF_RINGCENTRAL_ENABLED &&
      env.RINGCENTRAL_CLIENT_ID &&
      env.RINGCENTRAL_CLIENT_SECRET &&
      env.RINGCENTRAL_JWT,
  );
}

export async function ringcentralRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/ringcentral/embed-config', guard, async (request) => {
    requireSalesAccess(request);
    if (!configured()) {
      throw new NotFoundError(
        'RingCentral is not configured (set FF_RINGCENTRAL_ENABLED=1 and RINGCENTRAL_CLIENT_ID/SECRET/JWT).',
      );
    }

    const serverUrl = env.RINGCENTRAL_SERVER_URL.replace(/\/+$/, '');
    const qs = new URLSearchParams({
      clientId: env.RINGCENTRAL_CLIENT_ID,
      clientSecret: env.RINGCENTRAL_CLIENT_SECRET,
      jwt: env.RINGCENTRAL_JWT,
      appServer: serverUrl,
      defaultCallWith: 'browser',
      enableErrorReport: 'false',
    });

    return {
      enabled: true,
      clientId: env.RINGCENTRAL_CLIENT_ID,
      serverUrl,
      adapterUrl: `${ADAPTER_BASE}?${qs.toString()}`,
    };
  });
}
