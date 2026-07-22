/**
 * Phase 2 CS RoundRobin — online prefer + cursor advance.
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
      RETENTION_CS_ROUND_ROBIN_ZOHO_USER_IDS: 'u1,u2,u3',
    },
    isDev: false,
  };
});

vi.mock('../../src/db/client.js', () => ({
  db: {
    select: vi.fn(),
    insert: vi.fn(),
  },
}));

vi.mock('../../src/integrations/zohoCrm.js', () => ({
  listActiveUsers: vi.fn(),
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

import { db } from '../../src/db/client.js';
import { listActiveUsers } from '../../src/integrations/zohoCrm.js';
import { pickCsRoundRobinAssignee } from '../../src/modules/retention/csRoundRobin.js';
import {
  setDealStageClosedLost,
  transferDealOwnershipToClaimant,
} from '../../src/modules/retention/zohoOwnership.js';
import { afterRetentionPhaseSideEffects } from '../../src/modules/retention/csRoundRobin.js';

const dbMock = vi.mocked(db, true);
const listUsers = vi.mocked(listActiveUsers);
const setStage = vi.mocked(setDealStageClosedLost);
const transferOwner = vi.mocked(transferDealOwnershipToClaimant);

function ctx(): TenantContext {
  return {
    tenantId: DEFAULT_TENANT_ID,
    userId: 'zoho:cs',
    audience: 'internal',
    role: 'worker',
    scopes: ['*'],
    departments: ['customer-service'],
    allDepartmentAccess: false,
    requestId: 't',
  };
}

describe('pickCsRoundRobinAssignee', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    dbMock.select.mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue([{ lastZohoUserId: 'u1' }]),
        }),
      }),
    } as never);
    dbMock.insert.mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    } as never);
  });

  it('prefers online allowlisted users and advances past last cursor', async () => {
    listUsers.mockResolvedValue([
      {
        zohoUserId: 'u1',
        name: 'A',
        email: null,
        profile: null,
        role: null,
        isOnline: false,
      },
      {
        zohoUserId: 'u2',
        name: 'B',
        email: null,
        profile: null,
        role: null,
        isOnline: true,
      },
      {
        zohoUserId: 'u3',
        name: 'C',
        email: null,
        profile: null,
        role: null,
        isOnline: true,
      },
    ]);

    const pick = await pickCsRoundRobinAssignee(ctx());
    // Online pool = u2,u3; last was u1 (not in online) → first online u2
    expect(pick?.zohoUserId).toBe('u2');
    expect(pick?.name).toBe('B');
  });
});

describe('afterRetentionPhaseSideEffects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('sets Closed Lost when entering CITI', async () => {
    await afterRetentionPhaseSideEffects('phase_2_retention', {
      id: '9',
      phaseCode: 'phase_3_citi',
      assignedAgentZohoUserId: null,
      zohoDealId: 'deal-9',
    });
    expect(setStage).toHaveBeenCalledWith('deal-9');
  });

  it('does not transfer Zoho when CS claims an unassigned Phase 2 case', async () => {
    await afterRetentionPhaseSideEffects(
      'phase_2_retention',
      {
        id: '10',
        phaseCode: 'phase_2_retention',
        assignedAgentZohoUserId: 'cs-new',
        zohoDealId: 'deal-10',
      },
      { previousAssigneeZohoUserId: null },
    );
    expect(transferOwner).not.toHaveBeenCalled();
  });

  it('does not transfer Zoho on Sales → Retention handoff assign', async () => {
    await afterRetentionPhaseSideEffects(
      'phase_1_agent',
      {
        id: '11',
        phaseCode: 'phase_2_retention',
        assignedAgentZohoUserId: 'cs-rr',
        zohoDealId: 'deal-11',
      },
      { previousAssigneeZohoUserId: 'sales-1' },
    );
    expect(transferOwner).not.toHaveBeenCalled();
  });
});
