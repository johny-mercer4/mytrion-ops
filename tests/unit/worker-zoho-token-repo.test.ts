import { beforeEach, describe, expect, it, vi } from 'vitest';

const { insertValuesMock, conflictMock, selectLimitMock } = vi.hoisted(() => ({
  insertValuesMock: vi.fn(),
  conflictMock: vi.fn(),
  selectLimitMock: vi.fn(),
}));

vi.mock('../../src/config/env.js', () => ({
  env: { ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64') },
}));

vi.mock('../../src/db/client.js', () => ({
  db: {
    insert: vi.fn(() => ({
      values: (values: unknown) => {
        insertValuesMock(values);
        return { onConflictDoUpdate: conflictMock };
      },
    })),
    select: vi.fn(() => ({
      from: vi.fn(() => ({
        where: vi.fn(() => ({ limit: selectLimitMock })),
      })),
    })),
  },
}));

import { decryptSecret, encryptSecret } from '../../src/lib/crypto.js';
import { workerZohoTokenRepo } from '../../src/repos/workerZohoTokenRepo.js';

describe('workerZohoTokenRepo refresh-token protection', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    conflictMock.mockResolvedValue(undefined);
  });

  it('encrypts refresh tokens before insert and conflict update', async () => {
    await workerZohoTokenRepo.upsert('tenant-a', 'agent-1', 'plain-refresh-token');
    const inserted = insertValuesMock.mock.calls[0]![0] as { refreshToken: string };
    const conflict = conflictMock.mock.calls[0]![0] as { set: { refreshToken: string } };
    expect(inserted.refreshToken).not.toBe('plain-refresh-token');
    expect(decryptSecret(inserted.refreshToken)).toBe('plain-refresh-token');
    expect(conflict.set.refreshToken).toBe(inserted.refreshToken);
  });

  it('decrypts ciphertext when reading a worker token', async () => {
    selectLimitMock.mockResolvedValueOnce([{ refreshToken: encryptSecret('usable-refresh') }]);
    await expect(workerZohoTokenRepo.find('tenant-a', 'agent-1')).resolves.toBe('usable-refresh');
  });

  it('temporarily reads legacy plaintext rows until the worker re-consents', async () => {
    selectLimitMock.mockResolvedValueOnce([{ refreshToken: 'legacy-plaintext' }]);
    await expect(workerZohoTokenRepo.find('tenant-a', 'agent-1')).resolves.toBe('legacy-plaintext');
  });
});
