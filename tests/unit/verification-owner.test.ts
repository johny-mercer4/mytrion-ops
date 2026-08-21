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
  resolveVerificationCaseOwnerIds,
  resolveVerificationManagerId,
  SARVAR,
  VERIFICATION_CASE_OWNER_NAME,
} from '../../src/modules/verification/verificationOwner.js';

const listUsers = vi.mocked(zohoCrm.listUsersForNameResolution);

describe('verification case owner', () => {
  const previous = env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID;

  beforeEach(() => {
    resetVerificationOwnerCache();
    // BOTH keys, and the manager: these are mutated in place on the shared `env` object, so a value
    // left behind by one test silently steers the next one down a different branch.
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID = '';
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_IDS = '';
    env.VERIFICATION_MANAGER_ID = '';
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
    await expect(resolveVerificationCaseOwnerId()).rejects.toThrow(/not a numeric Zoho id/);
  });

  /**
   * The desk has more than one credit agent, so the env value is a LIST. The deployed .env writes it
   * under the old singular key WITH a space after the comma, and the previous single-id validator
   * rejected that outright — `ingestVerificationDeals` resolves this on its first line, so one comma
   * stopped every new verification case from being created.
   */
  it('reads a comma-separated list, from either key, in order', async () => {
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_ID = '6227679000088272001, 6227679000076980006';
    await expect(resolveVerificationCaseOwnerIds()).resolves.toEqual([
      '6227679000088272001',
      '6227679000076980006',
    ]);
    // `_IDS` wins when both are set.
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_IDS = '11111,22222';
    await expect(resolveVerificationCaseOwnerIds()).resolves.toEqual(['11111', '22222']);
    // And the single-owner accessor keeps working for the ingest's fallback stand-in.
    await expect(resolveVerificationCaseOwnerId()).resolves.toBe('11111');
  });

  it('drops duplicates and keeps declaration order — order is the routing tie-break', async () => {
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_IDS = '  222 , 111 ,222 ';
    await expect(resolveVerificationCaseOwnerIds()).resolves.toEqual(['222', '111']);
  });

  it('rejects the whole list when ONE entry is not an id, rather than routing at a typo', async () => {
    env.VERIFICATION_CASE_OWNER_ZOHO_USER_IDS = '6227679000088272001,sarvar';
    await expect(resolveVerificationCaseOwnerIds()).rejects.toThrow(/not a numeric Zoho id/);
  });

  it('reads the manager id, and null when there is none', () => {
    env.VERIFICATION_MANAGER_ID = '6227679000198540001';
    expect(resolveVerificationManagerId()).toBe('6227679000198540001');
    env.VERIFICATION_MANAGER_ID = '';
    // Null, never a silent fallback to an agent — an escalation with no destination must refuse.
    expect(resolveVerificationManagerId()).toBeNull();
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
