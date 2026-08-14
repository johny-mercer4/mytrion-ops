import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { env } from '../../src/config/env.js';
import { zohoCrm } from '../../src/integrations/zohoCrm.js';

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  zohoCrm: {
    listUsersForNameResolution: vi.fn(),
  },
}));

import {
  resetVerificationOwnerCache,
  resolveVerificationCaseOwnerId,
  SARVAR,
  VERIFICATION_CASE_OWNER_NAME,
} from '../../src/modules/verification/verificationOwner.js';

const listUsers = vi.mocked(zohoCrm.listUsersForNameResolution);

describe('verification case owner', () => {
  const previous = env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID;

  beforeEach(() => {
    resetVerificationOwnerCache();
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID = '';
    listUsers.mockReset();
  });

  afterEach(() => {
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID = previous;
    resetVerificationOwnerCache();
  });

  it('names Sarvar Asqarov as the shared owner', () => {
    expect(VERIFICATION_CASE_OWNER_NAME).toBe('Sarvar Asqarov');
    expect(SARVAR).toBe('Sarvar Asqarov');
  });

  it('uses VERIFICATION_CASE_OWNER_ZOHO_USER_ID when it is numeric', async () => {
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID = '622767900000111';
    await expect(resolveVerificationCaseOwnerId()).resolves.toBe('622767900000111');
    expect(listUsers).not.toHaveBeenCalled();
  });

  it('fails loudly when the env override is not a Zoho id', async () => {
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID = 'sarvar';
    await expect(resolveVerificationCaseOwnerId()).rejects.toThrow(/must be a numeric Zoho id/);
  });

  it('resolves the CRM user by exact full name', async () => {
    listUsers.mockResolvedValueOnce([
      { zohoUserId: '99', name: 'Sarvar Asqarov', email: null, profile: null, role: null, isOnline: false },
    ]);
    await expect(resolveVerificationCaseOwnerId()).resolves.toBe('99');
  });

  it('fails when the name is missing or duplicated — no unowned cases', async () => {
    listUsers.mockResolvedValueOnce([]);
    await expect(resolveVerificationCaseOwnerId()).rejects.toThrow(/could not resolve Zoho user/);

    resetVerificationOwnerCache();
    listUsers.mockResolvedValueOnce([
      { zohoUserId: '1', name: 'Sarvar Asqarov', email: null, profile: null, role: null, isOnline: false },
      { zohoUserId: '2', name: 'Sarvar  Asqarov', email: null, profile: null, role: null, isOnline: false },
    ]);
    await expect(resolveVerificationCaseOwnerId()).rejects.toThrow(/multiple Zoho users/);
  });
});
