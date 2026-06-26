/**
 * Zoho CRM auth + user context for the widget. On mount we initialize the Embedded App SDK (which
 * rides the user's existing CRM session — no login screen) and read the current user via
 * ZOHO.CRM.CONFIG.getCurrentUser(). The result feeds the backend's department-agent RBAC.
 *
 * Outside CRM (local `vite dev`) the SDK's init() never resolves, so in DEV we fall back to a mock
 * user after a short timeout. In production the widget MUST run inside CRM, so a failure surfaces.
 *
 * getZohoSdk() exposes the initialized SDK to the API layer (org-variable config + HTTP proxy).
 */
import type { ZohoRawUser, ZohoSDK } from './zoho-sdk';

/** The normalized identity the app + backend use. */
export interface ZohoUser {
  id: string;
  name: string;
  email: string;
  profile: string;
  role: string;
}

export interface ZohoContext {
  user: ZohoUser;
  /** The CRM entity the widget opened on (PageLoad), if any. */
  entity: unknown;
  /** Department for the backend RBAC, derived from profile/role (see deriveDepartmentScope). */
  departmentScope: string | null;
  /** True when running on dev mock data (outside CRM). */
  mocked: boolean;
}

const INIT_TIMEOUT_MS = 5000;

const MOCK_USER: ZohoUser = {
  id: 'dev-user',
  name: 'Dev User',
  email: 'dev@octane.local',
  profile: 'Administrator',
  role: 'CEO',
};

function mapUser(u: ZohoRawUser | undefined): ZohoUser {
  return {
    id: u?.id ?? '',
    name: u?.full_name ?? [u?.first_name, u?.last_name].filter(Boolean).join(' ') ?? '',
    email: u?.email ?? '',
    profile: u?.profile?.name ?? '',
    role: u?.role?.name ?? '',
  };
}

/**
 * Map a Zoho profile/role to a backend department key (sales/billing/customer-service/verification/
 * collection/retention). The backend treats admin-marker profiles/roles as unlimited regardless, so
 * this only needs to resolve the department for non-admin operational users.
 *
 * TODO (you own this): replace the example rules below with your real profile/role → department map.
 */
export function deriveDepartmentScope(user: ZohoUser): string | null {
  const hay = `${user.role} ${user.profile}`.toLowerCase();
  if (hay.includes('sales')) return 'sales';
  if (hay.includes('billing')) return 'billing';
  if (hay.includes('customer service') || hay.includes('support')) return 'customer-service';
  if (hay.includes('verification')) return 'verification';
  if (hay.includes('collection')) return 'collection';
  if (hay.includes('retention')) return 'retention';
  return null;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('Zoho init timed out')), ms)),
  ]);
}

// One shared init for the whole app (StrictMode double-mount + identity + API config all share it).
let entity: unknown = null;
let sdkReady: Promise<ZohoSDK | null> | null = null;

function ensureZoho(): Promise<ZohoSDK | null> {
  if (sdkReady) return sdkReady;
  sdkReady = (async () => {
    const sdk = window.ZOHO;
    if (!sdk?.embeddedApp) return null; // not embedded (dev) / SDK script absent
    sdk.embeddedApp.on('PageLoad', (data) => {
      entity = data;
    });
    await withTimeout(sdk.embeddedApp.init(), INIT_TIMEOUT_MS);
    return sdk;
  })();
  return sdkReady;
}

/** The initialized SDK, or null when not embedded (dev). Used by the API layer. */
export async function getZohoSdk(): Promise<ZohoSDK | null> {
  try {
    return await ensureZoho();
  } catch {
    return null;
  }
}

let contextPromise: Promise<ZohoContext> | null = null;

/** Initialize Zoho and resolve the current-user context. Cached; DEV falls back to a mock. */
export function loadZohoContext(): Promise<ZohoContext> {
  if (contextPromise) return contextPromise;
  contextPromise = (async () => {
    let sdk: ZohoSDK | null = null;
    try {
      sdk = await ensureZoho();
    } catch {
      sdk = null;
    }
    if (!sdk) {
      if (import.meta.env.DEV) {
        return { user: MOCK_USER, entity: null, departmentScope: deriveDepartmentScope(MOCK_USER), mocked: true };
      }
      throw new Error('Zoho Embedded App SDK not found — this widget must run inside Zoho CRM.');
    }
    const res = await sdk.CRM.CONFIG.getCurrentUser();
    const user = mapUser(res.users?.[0]);
    return { user, entity, departmentScope: deriveDepartmentScope(user), mocked: false };
  })();
  return contextPromise;
}
