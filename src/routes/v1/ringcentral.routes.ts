/**
 * RingCentral Embeddable bootstrap for Sales Mytrion.
 *
 * GET /v1/ringcentral/embed-config — returns the config needed to load the Embeddable adapter.
 * By default the shared client secret + org JWT are NOT included (the adapter loads; agents
 * sign in via RingCentral's own login). RINGCENTRAL_BROWSER_CREDS_ACK=1 restores the Phase-1
 * JWT auto-login — a deliberate, audited ops decision to ship shared credentials to every
 * sales browser. Secrets must never be baked into the Vite bundle either way.
 *
 * Auth note: JWT login makes every agent the same RingCentral extension (experimental for
 * Embeddable). Switch to per-agent OAuth/PKCE before multi-extension prod.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { env } from '../../config/env.js';
import { NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

const ADAPTER_BASE =
  'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js';

function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'RingCentral phone');
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
    const ctx = requireSalesAccess(request);
    if (!configured()) {
      throw new NotFoundError(
        'RingCentral is not configured (set FF_RINGCENTRAL_ENABLED=1 and RINGCENTRAL_CLIENT_ID/SECRET/JWT).',
      );
    }

    const serverUrl = env.RINGCENTRAL_SERVER_URL.replace(/\/+$/, '');
    const shipCreds = env.RINGCENTRAL_BROWSER_CREDS_ACK;
    const qs = new URLSearchParams({
      clientId: env.RINGCENTRAL_CLIENT_ID,
      ...(shipCreds
        ? { clientSecret: env.RINGCENTRAL_CLIENT_SECRET, jwt: env.RINGCENTRAL_JWT }
        : {}),
      appServer: serverUrl,
      defaultCallWith: 'browser',
      enableErrorReport: 'false',
    });
    if (shipCreds) {
      // Shared org credentials leave the server — keep an audit trail of who fetched them.
      await auditFromContext(ctx, {
        action: 'ringcentral.embed_config',
        status: 'ok',
        resourceType: 'ringcentral',
        detail: { browserCreds: true },
      });
    } else {
      request.log.warn(
        'ringcentral embed-config served WITHOUT browser credentials (JWT auto-login off); ' +
          'set RINGCENTRAL_BROWSER_CREDS_ACK=1 to knowingly restore the Phase-1 behavior',
      );
    }

    return {
      enabled: true,
      clientId: env.RINGCENTRAL_CLIENT_ID,
      serverUrl,
      adapterUrl: `${ADAPTER_BASE}?${qs.toString()}`,
    };
  });
}
