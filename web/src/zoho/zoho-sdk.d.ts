/**
 * Minimal typings for the Zoho CRM Embedded App SDK (loaded via the script tag in index.html as the
 * global `ZOHO`). Only the surface we use is declared. See:
 * https://s3-us-west-2.amazonaws.com/zohocrm-widget/help/v0.8/index.html
 */

/** A reference object Zoho returns for profile/role ({ id, name }). */
export interface ZohoNamedRef {
  id: string;
  name: string;
}

/** Shape of one user in ZOHO.CRM.CONFIG.getCurrentUser().users[0]. */
export interface ZohoRawUser {
  id: string;
  full_name?: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  profile?: ZohoNamedRef;
  role?: ZohoNamedRef;
  status?: string;
  zuid?: string;
}

export interface ZohoCurrentUserResponse {
  users: ZohoRawUser[];
}

export interface ZohoEmbeddedApp {
  /** Resolves once the widget is initialized inside CRM. */
  init(): Promise<void>;
  /** Register an event listener (e.g. 'PageLoad') BEFORE calling init(). */
  on(event: string, handler: (data: unknown) => void): void;
}

export interface ZohoSDK {
  embeddedApp: ZohoEmbeddedApp;
  CRM: {
    CONFIG: {
      getCurrentUser(): Promise<ZohoCurrentUserResponse>;
      getOrgInfo(): Promise<unknown>;
    };
  };
}

declare global {
  interface Window {
    ZOHO?: ZohoSDK;
  }
}
