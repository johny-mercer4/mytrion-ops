import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import { env } from '../../src/config/env.js';
import { authService, contextFromClaims } from '../../src/modules/auth/authService.js';
import {
  signAccessToken,
  signOauthState,
  signRefreshToken,
  verifyOauthState,
  verifyToken,
  type TokenClaims,
} from '../../src/modules/auth/jwt.js';
import { zohoAuthService } from '../../src/modules/auth/zohoAuthService.js';

const baseClaims: Omit<TokenClaims, 'worker'> = {
  userId: 'zoho:555',
  tenantId: DEFAULT_TENANT_ID,
  audience: 'internal',
  role: 'admin',
};

describe('jwt — verified worker identity round-trips through the session token', () => {
  it('preserves every worker field on sign → verify', async () => {
    const claims: TokenClaims = {
      ...baseClaims,
      worker: { zohoUserId: '555', userName: 'Alice Doe', email: 'alice@octane.test', profile: 'Administrator', zohoRole: 'CEO' },
    };
    const verified = await verifyToken(await signAccessToken(claims), 'access');
    expect(verified.userId).toBe('zoho:555');
    expect(verified.worker).toEqual(claims.worker);
  });

  it('keeps a minimal worker (only zohoUserId) and drops empty optionals', async () => {
    const claims: TokenClaims = { ...baseClaims, userId: 'zoho:9', worker: { zohoUserId: '9' } };
    const verified = await verifyToken(await signAccessToken(claims), 'access');
    expect(verified.worker).toEqual({ zohoUserId: '9' });
  });

  it('a non-worker token verifies with no worker claim', async () => {
    const claims: TokenClaims = { userId: 'u1', tenantId: DEFAULT_TENANT_ID, audience: 'internal', role: 'viewer' };
    const verified = await verifyToken(await signAccessToken(claims), 'access');
    expect(verified.worker).toBeUndefined();
  });
});

describe('jwt — signed OAuth state (CSRF for the Zoho redirect)', () => {
  it('a state we signed verifies', async () => {
    await expect(verifyOauthState(await signOauthState('nonce-abc'))).resolves.toBeUndefined();
  });

  it('rejects garbage / tampered state', async () => {
    await expect(verifyOauthState('not-a-jwt')).rejects.toThrow();
  });

  it('rejects a token that is not an oauth-state (wrong `use`)', async () => {
    // A valid ACCESS token must not be accepted as OAuth state — the `use` claim differs.
    const accessToken = await signAccessToken({ ...baseClaims, worker: { zohoUserId: '1' } });
    await expect(verifyOauthState(accessToken)).rejects.toThrow();
  });
});

describe('contextFromClaims — worker branch (session-authoritative RBAC)', () => {
  it('derives all-department access from an admin Zoho profile and marks the session verified', () => {
    const ctx = contextFromClaims(
      { ...baseClaims, worker: { zohoUserId: '555', userName: 'Alice', profile: 'Administrator', zohoRole: 'CEO' } },
      'rq',
    );
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.userId).toBe('zoho:555');
    expect(ctx.userName).toBe('Alice');
    expect(ctx.profiles).toEqual(['Administrator']);
    expect(ctx.callerRole).toBe('CEO');
    expect(ctx.allDepartmentAccess).toBe(true);
    expect(ctx.departments).toEqual([]);
  });

  it('a non-admin Zoho profile does NOT grant all-department access', () => {
    const ctx = contextFromClaims(
      { ...baseClaims, userId: 'zoho:6', worker: { zohoUserId: '6', profile: 'Sales Rep', zohoRole: 'Agent' } },
      'rq',
    );
    expect(ctx.sessionVerified).toBe(true);
    expect(ctx.allDepartmentAccess).toBe(false);
    expect(ctx.profiles).toEqual(['Sales Rep']);
  });

  it('re-derives the role from the verified profile — a stale admin claim yields a worker', () => {
    // baseClaims carries role:'admin' (a pre-fix token); the Sales Rep profile must win.
    const ctx = contextFromClaims(
      { ...baseClaims, userId: 'zoho:6', worker: { zohoUserId: '6', profile: 'Sales Rep', zohoRole: 'Agent' } },
      'rq',
    );
    expect(ctx.role).toBe('worker');
    expect(ctx.scopes).not.toContain('*');
    expect(ctx.scopes).toEqual(
      expect.arrayContaining(['zoho_crm:read', 'servercrm:read', 'zoho_desk:read', 'zoho_people:read']),
    );
  });

  it('an admin-marker profile derives the admin role (full scopes)', () => {
    const ctx = contextFromClaims(
      { ...baseClaims, worker: { zohoUserId: '555', profile: 'Administrator' } },
      'rq',
    );
    expect(ctx.role).toBe('admin');
    expect(ctx.scopes).toEqual(['*']);
  });
});

describe('authService.refresh — worker sessions stay signed in without re-auth', () => {
  it('re-issues a fresh worker session from a refresh token (no users-table lookup)', async () => {
    const claims: TokenClaims = {
      ...baseClaims,
      worker: { zohoUserId: '555', userName: 'Alice', profile: 'Administrator', zohoRole: 'CEO' },
    };
    const result = await authService.refresh(await signRefreshToken(claims));
    expect(result.tokenType).toBe('Bearer');
    expect(result.accessToken).toBeTruthy();
    expect(result.refreshToken).toBeTruthy();
    // WorkerSession (not the users-table LoginResult) — identity comes straight from the token.
    if (!('worker' in result)) throw new Error('expected a worker session');
    expect(result.worker.zohoUserId).toBe('555');
    // The rotated tokens are valid and still carry the verified worker identity.
    expect((await verifyToken(result.accessToken, 'access')).worker?.zohoUserId).toBe('555');
    expect((await verifyToken(result.refreshToken, 'refresh')).worker?.zohoUserId).toBe('555');
  });

  it('rotation re-derives the role: a stale admin token for a non-admin worker rotates to worker', async () => {
    const stale: TokenClaims = {
      ...baseClaims, // role:'admin' — the pre-fix mint
      userId: 'zoho:6',
      worker: { zohoUserId: '6', userName: 'Bob', profile: 'Sales Rep', zohoRole: 'Sales Agent' },
    };
    const result = await authService.refresh(await signRefreshToken(stale));
    if (!('worker' in result)) throw new Error('expected a worker session');
    expect((await verifyToken(result.accessToken, 'access')).role).toBe('worker');
    expect((await verifyToken(result.refreshToken, 'refresh')).role).toBe('worker');
  });

  it('rotation preserves admin for admin-profile workers', async () => {
    const claims: TokenClaims = {
      ...baseClaims,
      worker: { zohoUserId: '555', profile: 'Administrator' },
    };
    const result = await authService.refresh(await signRefreshToken(claims));
    if (!('worker' in result)) throw new Error('expected a worker session');
    expect((await verifyToken(result.accessToken, 'access')).role).toBe('admin');
  });
});

describe('zohoAuthService.startLogin — authorize URL + verifiable state', () => {
  const savedClientId = env.ZOHO_SERVER_CLIENT_ID;
  afterEach(() => {
    env.ZOHO_SERVER_CLIENT_ID = savedClientId;
  });

  it('builds the authorize URL with our params and a state that verifies', async () => {
    env.ZOHO_SERVER_CLIENT_ID = 'test-client-id';
    const { authorizeUrl, state } = await zohoAuthService.startLogin();
    const url = new URL(authorizeUrl);
    expect(url.pathname).toBe('/oauth/v2/auth');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('test-client-id');
    expect(url.searchParams.get('scope')).toBe(env.ZOHO_OAUTH_SCOPES);
    expect(url.searchParams.get('redirect_uri')).toBe(env.ZOHO_OAUTH_REDIRECT_URI);
    expect(url.searchParams.get('state')).toBe(state);
    await expect(verifyOauthState(state)).resolves.toBeUndefined();
  });
});
