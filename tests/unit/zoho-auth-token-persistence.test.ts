import { describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  upsert: vi.fn(),
  invalidate: vi.fn(),
  signAccess: vi.fn(async () => 'mytrion-access'),
  signRefresh: vi.fn(async () => 'mytrion-refresh'),
}));

vi.mock('../../src/integrations/zohoOAuth.js', () => ({
  buildAuthorizeUrl: vi.fn(() => 'https://accounts.zoho.test/oauth/v2/auth'),
  exchangeCodeForToken: vi.fn(async () => ({
    accessToken: 'zoho-access',
    refreshToken: 'zoho-refresh',
  })),
  fetchCurrentUser: vi.fn(async () => ({
    zohoUserId: 'agent-42',
    fullName: 'Sales Agent',
    email: 'agent@example.test',
    profile: 'Sales Agent',
    role: 'Agent',
  })),
}));
vi.mock('../../src/repos/workerZohoTokenRepo.js', () => ({
  workerZohoTokenRepo: { upsert: mocks.upsert, find: vi.fn() },
}));
vi.mock('../../src/integrations/zohoUserAuth.js', () => ({
  invalidateUserToken: mocks.invalidate,
}));
vi.mock('../../src/modules/auth/jwt.js', () => ({
  signAccessToken: mocks.signAccess,
  signRefreshToken: mocks.signRefresh,
  signOauthState: vi.fn(async () => 'state'),
  verifyOauthState: vi.fn(async () => undefined),
}));

import { zohoAuthService } from '../../src/modules/auth/zohoAuthService.js';

describe('Zoho login token persistence', () => {
  it('does not issue a Mytrion session until the per-user refresh token is stored', async () => {
    let release: (() => void) | undefined;
    mocks.upsert.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );

    const login = zohoAuthService.completeLogin('code', 'state');
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.upsert).toHaveBeenCalledWith('octane', 'agent-42', 'zoho-refresh');
    expect(mocks.signAccess).not.toHaveBeenCalled();

    release?.();
    await expect(login).resolves.toMatchObject({
      accessToken: 'mytrion-access',
      refreshToken: 'mytrion-refresh',
      worker: { zohoUserId: 'agent-42' },
    });
    expect(mocks.invalidate).toHaveBeenCalledWith('octane', 'agent-42');
  });
});
