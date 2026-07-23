/**
 * Ownership transfer audit — deal/contact names + from→to persist payload.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const insertOwnershipTransfer = vi.hoisted(() => vi.fn(async (_input?: unknown) => undefined));

vi.mock('../../src/repos/retentionOwnershipTransferRepo.js', () => ({
  insertOwnershipTransfer,
}));

vi.mock('../../src/integrations/zohoCrmRecords.js', () => ({
  zohoCrmRecords: {
    getRecord: vi.fn(async () => ({
      id: '111',
      Deal_Name: 'Acme LLC',
      Owner: { id: '222', name: 'Agent From' },
      Contact_Name: { id: '333', name: 'Pat Contact' },
      Account_Name: { id: '444', name: 'Acme Co' },
    })),
    updateRecord: vi.fn(async () => undefined),
  },
}));

import { zohoCrmRecords } from '../../src/integrations/zohoCrmRecords.js';
import { transferDealOwnershipToClaimant } from '../../src/modules/retention/zohoOwnership.js';
import { OWNERSHIP_TRANSFER_REASON } from '../../src/db/schema/retention_ownership_transfers.js';

describe('transferDealOwnershipToClaimant audit log', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('persists from→to plus deal/contact/company names', async () => {
    const result = await transferDealOwnershipToClaimant('111', '999', {
      tenantId: 'octane',
      reason: OWNERSHIP_TRANSFER_REASON.adminManual,
      actorZohoUserId: '555',
      actorName: 'Admin',
      toOwnerName: 'Agent To',
    });

    expect(result).toMatchObject({
      dealUpdated: true,
      contactUpdated: true,
      accountUpdated: true,
      fromOwnerZohoUserId: '222',
      fromOwnerName: 'Agent From',
    });
    expect(zohoCrmRecords.updateRecord).toHaveBeenCalledWith('Deals', '111', {
      Owner: { id: '999' },
    });
    expect(insertOwnershipTransfer).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 'octane',
        reason: 'admin_manual',
        result: 'success',
        zohoDealId: '111',
        dealName: 'Acme LLC',
        contactName: 'Pat Contact',
        companyName: 'Acme Co',
        fromOwnerZohoUserId: '222',
        fromOwnerName: 'Agent From',
        toOwnerZohoUserId: '999',
        toOwnerName: 'Agent To',
        actorZohoUserId: '555',
        actorName: 'Admin',
        dealUpdated: true,
        contactUpdated: true,
        accountUpdated: true,
      }),
    );
  });
});
