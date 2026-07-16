/**
 * RingCentral wrapper — the "Custom Wrapper" reference example (see core/base.ts header for
 * the recipe). RingCentral has no server-side API surface in this app yet: the wrapper owns
 * the env access + Embeddable bootstrap config that ringcentral.routes.ts previously built
 * inline, so the route keeps only auth/RBAC/audit.
 */
import { env } from '../config/env.js';
import { BaseWrapper } from './core/base.js';

const ADAPTER_BASE =
  'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js';

export interface RingCentralEmbedConfig {
  enabled: true;
  clientId: string;
  serverUrl: string;
  adapterUrl: string;
  /** True when the shared client secret + org JWT were embedded (RINGCENTRAL_BROWSER_CREDS_ACK). */
  browserCreds: boolean;
}

export class RingCentralWrapper extends BaseWrapper {
  readonly name = 'ringcentral';
  readonly kind = 'http' as const;

  isConfigured(): boolean {
    return Boolean(
      env.FF_RINGCENTRAL_ENABLED &&
        env.RINGCENTRAL_CLIENT_ID &&
        env.RINGCENTRAL_CLIENT_SECRET &&
        env.RINGCENTRAL_JWT,
    );
  }

  /**
   * The Embeddable bootstrap config. Credentials (client secret + org JWT) are only embedded
   * in the adapter URL when ops explicitly acknowledged shipping them to the browser
   * (RINGCENTRAL_BROWSER_CREDS_ACK=1) — the caller must audit that case.
   */
  embedConfig(): RingCentralEmbedConfig {
    const serverUrl = env.RINGCENTRAL_SERVER_URL.replace(/\/+$/, '');
    const browserCreds = env.RINGCENTRAL_BROWSER_CREDS_ACK;
    const qs = new URLSearchParams({
      clientId: env.RINGCENTRAL_CLIENT_ID,
      ...(browserCreds
        ? { clientSecret: env.RINGCENTRAL_CLIENT_SECRET, jwt: env.RINGCENTRAL_JWT }
        : {}),
      appServer: serverUrl,
      defaultCallWith: 'browser',
      enableErrorReport: 'false',
    });
    return {
      enabled: true,
      clientId: env.RINGCENTRAL_CLIENT_ID,
      serverUrl,
      adapterUrl: `${ADAPTER_BASE}?${qs.toString()}`,
      browserCreds,
    };
  }
}

export const ringcentral = new RingCentralWrapper();
