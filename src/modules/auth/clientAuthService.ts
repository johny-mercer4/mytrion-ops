/**
 * Carrier-client sign-in (login/password from carrier_users) — the auth path for carrier
 * companies (future Telegram mini-app + the /client web page). Mints the same Bearer
 * session shape as worker sign-in, but the embedded `client` claims derive a LOCKED-DOWN
 * context on every request: audience 'customer' (deny-by-default for tools/agents),
 * viewer role, no scopes, departments = the carrier's own company tags.
 */
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { AuthError } from '../../lib/errors.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import type { AuthTokens } from './authService.js';
import { signAccessToken, signRefreshToken, type ClientIdentity, type TokenClaims } from './jwt.js';
import { verifyPassword } from './password.js';

export interface ClientSession extends AuthTokens {
  client: ClientIdentity;
}

const INVALID_HASH = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';

export const clientAuthService = {
  async login(
    login: string,
    password: string,
    tenantId: string = DEFAULT_TENANT_ID,
  ): Promise<ClientSession> {
    const row = await carrierUserRepo.findByLoginForAuth(tenantId, login);
    // Always run a verify so timing is roughly constant whether or not the login exists.
    const ok = await verifyPassword(password, row?.passwordHash ?? INVALID_HASH);
    if (!row || !ok || row.status !== 'active') {
      throw new AuthError('Invalid login or password');
    }
    await carrierUserRepo.updateLastLogin(row.id);

    const client: ClientIdentity = {
      carrierUserId: row.id,
      carrierId: row.carrierId,
      ...(row.applicationId ? { applicationId: row.applicationId } : {}),
      login: row.login,
      ...(row.profile ? { profile: row.profile } : {}),
    };
    const claims: TokenClaims = {
      userId: `client:${row.id}`,
      tenantId,
      audience: 'customer',
      role: 'viewer',
      client,
    };
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(claims),
      signRefreshToken(claims),
    ]);
    return { accessToken, refreshToken, tokenType: 'Bearer', client };
  },
};
