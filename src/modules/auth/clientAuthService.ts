/**
 * Carrier-client sign-in (login/password from carrier_users) — the auth path for carrier
 * companies (future Telegram mini-app + the /client web page). Mints the same Bearer
 * session shape as worker sign-in, but the embedded `client` claims derive a LOCKED-DOWN
 * context on every request: audience 'customer' (deny-by-default for tools/agents),
 * viewer role, no scopes, departments = the carrier's own company tags.
 *
 * Profiles: 'owner' (fleet) is tied to carrierId/applicationId and sees every card of the
 * carrier; 'driver' is a CHILD of an owner, tied to one cardId (the card carries the
 * limits) and INHERITS the company scope from its parent at login — a disabled/removed
 * parent therefore locks its drivers out too.
 */
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import type { CarrierUser } from '../../db/schema/index.js';
import { AuthError } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { carrierUserRepo } from '../../repos/carrierUserRepo.js';
import type { AuthTokens } from './authService.js';
import { signAccessToken, signRefreshToken, type ClientIdentity, type TokenClaims } from './jwt.js';
import { verifyPassword } from './password.js';

export interface ClientSession extends AuthTokens {
  client: ClientIdentity;
}

const INVALID_HASH = '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinvalidin';

/**
 * The effective company tie for a row: a driver inherits carrierId/applicationId from its
 * parent (its own values, if ever set, win). Returns null when the parent is missing or
 * disabled — the driver must not get a session then.
 */
async function effectiveIdentity(
  tenantId: string,
  row: CarrierUser,
): Promise<{ carrierId?: string; applicationId?: string } | null> {
  if (row.profile !== 'driver') {
    return {
      ...(row.carrierId ? { carrierId: row.carrierId } : {}),
      ...(row.applicationId ? { applicationId: row.applicationId } : {}),
    };
  }
  const parent = row.parentUserId
    ? await carrierUserRepo.findByIdAny(tenantId, row.parentUserId)
    : undefined;
  if (!parent || parent.status !== 'active') return null;
  const carrierId = row.carrierId ?? parent.carrierId;
  const applicationId = row.applicationId ?? parent.applicationId;
  return {
    ...(carrierId ? { carrierId } : {}),
    ...(applicationId ? { applicationId } : {}),
  };
}

/** Build the signed client identity for a row (driver company scope inherited). */
export async function clientIdentityFor(
  tenantId: string,
  row: CarrierUser,
): Promise<ClientIdentity | null> {
  const effective = await effectiveIdentity(tenantId, row);
  if (effective === null) return null;
  return {
    carrierUserId: row.id,
    clientProfile: row.profile,
    ...effective,
    ...(row.cardId ? { cardId: row.cardId } : {}),
    ...(row.parentUserId ? { parentUserId: row.parentUserId } : {}),
    login: row.login,
  };
}

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
    const client = await clientIdentityFor(tenantId, row);
    if (!client) {
      // Driver whose parent is gone/disabled — same message as any other rejection.
      logger.warn({ carrierUserId: row.id }, 'client login denied: parent owner missing/disabled');
      throw new AuthError('Invalid login or password');
    }
    await carrierUserRepo.updateLastLogin(row.id);

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
