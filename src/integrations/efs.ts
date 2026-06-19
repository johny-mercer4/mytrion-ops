/**
 * EFS wrapper — auth only (for now). EFS CardManagement is a SOAP/Axis2 service. Auth is a
 * `login(user, password)` that returns a session "clientId" token (parent scope); child carrier
 * tokens come from CarrierGroupWS `loginAsChild`. The parent token is cached with a session TTL
 * + in-flight dedup (see tokenCache); child tokens are cached per carrier until the parent re-auths.
 *
 * Pattern borrowed from servercrm/services/efs.js (node-soap). Card operations come later — this
 * module only establishes and hands out session tokens.
 */
import { createClientAsync } from 'soap';
import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { createTokenProvider, type TokenProvider } from './tokenCache.js';

// EFS sessions are long-lived; re-login proactively after 30 minutes.
const SESSION_TTL_MS = 30 * 60 * 1000;

interface EfsLoginResult {
  result?: string;
  clientId?: string;
  return?: { clientId?: string };
  loginResponse?: { clientId?: string };
}

/** The subset of the (WSDL-dynamic) node-soap client we use for auth. */
interface EfsSoapClient {
  setEndpoint(endpoint: string): void;
  loginAsync(args: { user: string; password: string }): Promise<[EfsLoginResult]>;
  loginAsChildAsync(args: { clientId: string; childCarrierId: number }): Promise<[EfsLoginResult]>;
}

/** Pull the session token out of EFS's several possible response shapes. */
export function extractEfsToken(res: EfsLoginResult | undefined): string | undefined {
  return res?.result ?? res?.clientId ?? res?.return?.clientId ?? res?.loginResponse?.clientId;
}

/** Derive the CarrierGroupWS WSDL from the CardManagementWS WSDL. */
export function efsGroupWsdlFrom(cardWsdl: string): string {
  return cardWsdl.replace('CardManagementWS', 'CarrierGroupWS');
}

/** WSDL URL → SOAP endpoint (strip the `?wsdl` query, ensure a trailing slash). */
export function wsdlToEndpoint(wsdl: string): string {
  return `${wsdl.replace(/\?.*$/, '').replace(/\/+$/, '')}/`;
}

class EfsAuth {
  private cardClient: EfsSoapClient | null = null;
  private groupClient: EfsSoapClient | null = null;
  private readonly childTokens = new Map<string, string>();
  // Parent session token: cached with TTL + in-flight dedup.
  private readonly parent: TokenProvider<string> = createTokenProvider<string>({
    ttlMs: SESSION_TTL_MS,
    fetch: () => this.doLogin(),
  });

  private cardWsdl(): string {
    if (!env.EFS_WSDL_URL) throw new Error('[efs] EFS_WSDL_URL is not configured');
    return env.EFS_WSDL_URL;
  }

  private groupWsdl(): string {
    return env.EFS_GROUP_WSDL_URL || efsGroupWsdlFrom(this.cardWsdl());
  }

  /** Create the SOAP clients once (downloads the WSDLs). */
  private async init(): Promise<void> {
    if (this.cardClient && this.groupClient) return;
    const cardWsdl = this.cardWsdl();
    const groupWsdl = this.groupWsdl();
    const [card, group] = await Promise.all([
      createClientAsync(cardWsdl),
      createClientAsync(groupWsdl),
    ]);
    // node-soap clients expose WSDL-defined operations dynamically, so the static Client type
    // doesn't include login*/loginAsChild*. Cast to the typed subset we actually call.
    this.cardClient = card as unknown as EfsSoapClient;
    this.groupClient = group as unknown as EfsSoapClient;
    this.cardClient.setEndpoint(wsdlToEndpoint(cardWsdl));
    this.groupClient.setEndpoint(wsdlToEndpoint(groupWsdl));
  }

  private async doLogin(): Promise<string> {
    await this.init();
    const user = env.EFS_LOGIN;
    const password = env.EFS_PASSWORD;
    if (!user || !password) {
      throw new Error('[efs] EFS_LOGIN / EFS_PASSWORD are not configured');
    }
    const client = this.cardClient;
    if (!client) throw new Error('[efs] SOAP client not initialized');
    const [res] = await client.loginAsync({ user, password });
    const token = extractEfsToken(res);
    if (!token) throw new Error('[efs] login returned no client id');
    this.childTokens.clear();
    logger.debug('efs parent login ok');
    return token;
  }

  /** A valid parent session token (cached). */
  getParentToken(): Promise<string> {
    return this.parent.get();
  }

  /** A child carrier session token (cached per carrier until the parent re-auths). */
  async getChildToken(childCarrierId: string | number): Promise<string> {
    const clientId = await this.getParentToken();
    const key = String(childCarrierId);
    const cached = this.childTokens.get(key);
    if (cached) return cached;

    await this.init();
    const client = this.groupClient;
    if (!client) throw new Error('[efs] SOAP group client not initialized');
    const [res] = await client.loginAsChildAsync({ clientId, childCarrierId: Number(childCarrierId) });
    const token = extractEfsToken(res);
    if (!token) throw new Error(`[efs] could not generate token for child carrier ${key}`);
    this.childTokens.set(key, token);
    return token;
  }

  /** Force a fresh parent login (use after a session error). */
  forceRelogin(): Promise<string> {
    this.childTokens.clear();
    return this.parent.forceRefresh();
  }

  /** Drop cached tokens + SOAP clients (tests / forced reconnect). */
  reset(): void {
    this.parent.clear();
    this.childTokens.clear();
    this.cardClient = null;
    this.groupClient = null;
  }
}

export const efsAuth = new EfsAuth();
