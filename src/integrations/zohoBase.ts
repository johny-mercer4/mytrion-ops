/**
 * ZohoWrapper — shared HTTP base for the Zoho vendor wrappers (CRM / Desk / People).
 * Auth headers + base URL come from ZohoAuthService per platform (Desk's mandatory orgId
 * header included); a 401 invalidates that service's cached token and retries exactly once.
 * All requests inherit fetchWithTimeout via HttpWrapper — Desk/People historically used bare
 * fetch and could hang a turn.
 */
import { HttpWrapper } from './core/base.js';
import { resolveZohoConfig, type ZohoService } from './zoho.js';
import {
  authHeaders as zohoAuthHeaders,
  baseUrl as zohoBaseUrl,
  invalidateZohoToken,
  type ZohoPlatform,
} from './zohoAuth.js';

export abstract class ZohoWrapper extends HttpWrapper {
  protected constructor(protected readonly platform: ZohoPlatform) {
    super();
  }

  protected get service(): ZohoService {
    return this.platform.slice('zoho_'.length) as ZohoService;
  }

  isConfigured(): boolean {
    try {
      resolveZohoConfig(this.service);
      return Boolean(this.baseUrl());
    } catch {
      return false;
    }
  }

  protected baseUrl(): string {
    return zohoBaseUrl(this.platform);
  }

  protected authHeaders(): Promise<Record<string, string>> {
    return zohoAuthHeaders(this.platform);
  }

  protected override onUnauthorized(): Promise<boolean> {
    invalidateZohoToken(this.service);
    return Promise.resolve(true);
  }
}
