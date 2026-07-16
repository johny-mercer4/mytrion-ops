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
import { ringcentral } from '../../integrations/ringcentral.js';
import { NotFoundError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireSalesAccess(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'sales', 'RingCentral phone');
}

export async function ringcentralRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey] };

  app.get('/ringcentral/embed-config', guard, async (request) => {
    const ctx = requireSalesAccess(request);
    if (!ringcentral.isConfigured()) {
      throw new NotFoundError(
        'RingCentral is not configured (set FF_RINGCENTRAL_ENABLED=1 and RINGCENTRAL_CLIENT_ID/SECRET/JWT).',
      );
    }

    const { browserCreds, ...config } = ringcentral.embedConfig();
    if (browserCreds) {
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
    return config;
  });
}
