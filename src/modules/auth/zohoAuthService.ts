/**
 * Zoho OAuth worker sign-in orchestration. startLogin() builds the authorize URL + a signed state
 * (CSRF); completeLogin() verifies the state, exchanges the code (server-side, confidential client),
 * reads the worker's CRM user, and mints a Bearer session whose claims carry the VERIFIED identity
 * (so RBAC no longer trusts client-supplied identity). Same session shape a future client
 * login/password path will issue.
 */
import { createId } from '@paralleldrive/cuid2';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import {
  buildAuthorizeUrl,
  exchangeCodeForToken,
  fetchCurrentUser,
  type ZohoWorker,
} from '../../integrations/zohoOAuth.js';
import type { AuthTokens } from './authService.js';
import {
  signAccessToken,
  signOauthState,
  signRefreshToken,
  verifyOauthState,
  type TokenClaims,
  type WorkerIdentity,
} from './jwt.js';
import { workerRoleFor } from './workerRole.js';

export interface PublicWorker {
  zohoUserId: string;
  userName: string | null;
  email: string | null;
  profile: string | null;
  role: string | null;
}

export interface WorkerSession extends AuthTokens {
  worker: PublicWorker;
}

/** Session-token claims for a signed-in worker. The internal role is DERIVED from the verified
 * Zoho profile (workerRoleFor): admin-marker profiles get 'admin' (full scopes); everyone else
 * gets 'worker' (read scopes), which keeps write-risk tools admin-only. The token's role is a
 * hint only — contextFromClaims re-derives it from the embedded worker identity on every verify. */
function claimsFor(worker: ZohoWorker): TokenClaims {
  const identity: WorkerIdentity = { zohoUserId: worker.zohoUserId };
  if (worker.fullName) identity.userName = worker.fullName;
  if (worker.email) identity.email = worker.email;
  if (worker.profile) identity.profile = worker.profile;
  if (worker.role) identity.zohoRole = worker.role;
  return {
    userId: `zoho:${worker.zohoUserId}`,
    tenantId: DEFAULT_TENANT_ID,
    audience: 'internal',
    role: workerRoleFor({
      userName: worker.fullName,
      profile: worker.profile,
      zohoRole: worker.role,
    }),
    worker: identity,
  };
}

export const zohoAuthService = {
  /** Step 1: the URL to send the worker's browser to + the state to echo back. */
  async startLogin(): Promise<{ authorizeUrl: string; state: string }> {
    const state = await signOauthState(createId());
    return { authorizeUrl: buildAuthorizeUrl(state), state };
  },

  /** Step 2: validate state, exchange the code, read the worker, and mint the session. */
  async completeLogin(code: string, state: string): Promise<WorkerSession> {
    await verifyOauthState(state);
    const accessToken = await exchangeCodeForToken(code);
    const worker = await fetchCurrentUser(accessToken);
    const claims = claimsFor(worker);
    const [access, refresh] = await Promise.all([
      signAccessToken(claims),
      signRefreshToken(claims),
    ]);
    return {
      accessToken: access,
      refreshToken: refresh,
      tokenType: 'Bearer',
      worker: {
        zohoUserId: worker.zohoUserId,
        userName: worker.fullName,
        email: worker.email,
        profile: worker.profile,
        role: worker.role,
      },
    };
  },
};
