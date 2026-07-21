/**
 * Spanish desk bypasses RoundRobin when env + is_spanish_desk are set.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_TENANT_ID } from '../../src/config/constants.js';
import type { TenantContext } from '../../src/types/tenantContext.js';

vi.mock('../../src/config/env.js', async (importOriginal) => {
  const mod = await importOriginal<typeof import('../../src/config/env.js')>();
  return {
    ...mod,
    env: {
      ...mod.env,
      RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS: 'u1,u2',
      RETENTION_CS_SPANISH_ZOHO_USER_ID: 'jean-paul',
    },
  };
});

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  listActiveUsers: vi.fn(async () => [
    {
      zohoUserId: 'jean-paul',
      name: 'Jean Paul Escudero',
      email: null,
      profile: null,
      role: null,
      isOnline: true,
    },
    {
      zohoUserId: 'u1',
      name: 'A',
      email: null,
      profile: null,
      role: null,
      isOnline: true,
    },
  ]),
}));

vi.mock('../../src/modules/retention/csCaps.js', () => ({
  assertUnderDailyCap: vi.fn(async () => 0),
  CS_MAX_DEALS_PER_DAY: 40,
}));

vi.mock('../../src/modules/retention/zohoOwnership.js', () => ({
  transferDealOwnershipToClaimant: vi.fn(async () => ({
    dealId: 'd1',
    contactId: null,
    accountId: null,
    dealUpdated: true,
    contactUpdated: false,
    accountUpdated: false,
    warnings: [],
  })),
  setDealStageClosedLost: vi.fn(async () => undefined),
}));

import { enrichHandoffWithRoundRobin } from '../../src/modules/retention/csRoundRobin.js';
import { RETENTION_PHASE } from '../../src/db/schema/index.js';

function ctx(): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:sys',
    audience: 'internal',
    role: 'worker',
    scopes: ['*'],
    departments: ['customer-service'],
    allDepartmentAccess: false,
    requestId: 't',
  };
}

describe('enrichHandoffWithRoundRobin Spanish desk', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('assigns Jean Paul when isSpanishDesk', async () => {
    const patch = await enrichHandoffWithRoundRobin(
      ctx(),
      {
        phaseCode: RETENTION_PHASE.retention,
        statusCode: 'p2_new',
        eventType: 'status_change',
        eventNotes: 'Handed to Retention',
      },
      { isSpanishDesk: true },
    );
    expect(patch.assignedAgentZohoUserId).toBe('jean-paul');
    expect(patch.statusCode).toBe('p2_working');
    expect(patch.eventNotes).toMatch(/Spanish desk/);
    expect(patch.eventNotes).toMatch(/jean-paul/);
  });

  it('uses RoundRobin when not Spanish', async () => {
    const { db } = await import('../../src/db/client.js');
    const dbMock = vi.mocked(db, true);
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ lastZohoUserId: null }]),
        }),
      }),
    } as never);
    dbMock.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as never);

    const patch = await enrichHandoffWithRoundRobin(
      ctx(),
      {
        phaseCode: RETENTION_PHASE.retention,
        statusCode: 'p2_new',
        eventType: 'status_change',
        eventNotes: 'Handed to Retention',
      },
      { isSpanishDesk: false },
    );
    expect(patch.assignedAgentZohoUserId).toBe('u1');
    expect(patch.eventNotes).toMatch(/RR assign/);
  });
});
