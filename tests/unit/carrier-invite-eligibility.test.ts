import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchAgentClients = vi.hoisted(() => vi.fn());

vi.mock('../../src/integrations/dwhClientRoster.js', async (importOriginal) => {
  const original = await importOriginal<typeof import('../../src/integrations/dwhClientRoster.js')>();
  return { ...original, fetchAgentClients };
});

import type { AgentClientRow } from '../../src/integrations/dwhClientRoster.js';
import { AppError, RBACError } from '../../src/lib/errors.js';
import { assertCarrierInviteEligible } from '../../src/modules/tools/serverCrmScope.js';
import { makeContext } from '../fixtures/seed.js';

const AGENT_ID = '6227679000000676062';

function agentContext() {
  return makeContext({
    role: 'worker',
    userId: `zoho:${AGENT_ID}`,
    userName: 'Daniel Brown',
    departments: ['sales'],
    allDepartmentAccess: false,
    sessionVerified: true,
  });
}

function client(overrides: Partial<AgentClientRow> = {}): AgentClientRow {
  return {
    carrierId: '5785947',
    companyName: 'David Kolhelly',
    contact: 'David Kolhelly',
    agentName: 'Daniel Brown',
    phone: '—',
    producedCards: 4,
    activeCards: 4,
    lastTierName: 'Gold',
    moneyCode: '—',
    dot: '3642739',
    trucks: 4,
    isLocSuspended: false,
    computedIsActive: true,
    computedDebt: 0,
    computedDebtDays: 0,
    cycleGallons: 1000,
    gallonsThisMonth: 1000,
    inNetworkGallonsThisMonth: 900,
    activeCardsThisMonth: 4,
    transactionsThisMonth: 20,
    gallonsPrevMonth: 800,
    inNetworkGallonsPrevMonth: 700,
    activeCardsPrevMonth: 4,
    ...overrides,
  };
}

beforeEach(() => {
  fetchAgentClients.mockReset();
  fetchAgentClients.mockResolvedValue([client()]);
});

describe('assertCarrierInviteEligible', () => {
  it('allows an active, non-debtor client in the sales agent roster', async () => {
    await expect(assertCarrierInviteEligible(agentContext(), '5785947')).resolves.toMatchObject({
      carrierId: '5785947',
      companyName: 'David Kolhelly',
      agentName: 'Daniel Brown',
    });
    expect(fetchAgentClients).toHaveBeenCalledWith(AGENT_ID, 'Daniel Brown', {
      force: true,
      allowStaleOnError: false,
    });
  });

  it('denies a debtor before an invitation can be created', async () => {
    fetchAgentClients.mockResolvedValue([client({ computedDebt: 4256, computedDebtDays: 4 })]);
    const error = await assertCarrierInviteEligible(agentContext(), '5785947').catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 409, code: 'CARRIER_INVITE_DEBTOR' });
  });

  it('treats a suspended line of credit as debtor status, matching the Clients tab', async () => {
    fetchAgentClients.mockResolvedValue([client({ isLocSuspended: true })]);
    await expect(assertCarrierInviteEligible(agentContext(), '5785947')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CARRIER_INVITE_DEBTOR',
    });
  });

  it('denies an inactive client', async () => {
    fetchAgentClients.mockResolvedValue([client({ computedIsActive: false })]);
    await expect(assertCarrierInviteEligible(agentContext(), '5785947')).rejects.toMatchObject({
      statusCode: 409,
      code: 'CARRIER_INVITE_INACTIVE',
    });
  });

  it('denies a carrier outside the sales agent roster', async () => {
    fetchAgentClients.mockResolvedValue([]);
    await expect(assertCarrierInviteEligible(agentContext(), '5785947')).rejects.toBeInstanceOf(
      RBACError,
    );
  });

  it('fails closed when fresh DWH eligibility cannot be confirmed', async () => {
    fetchAgentClients.mockRejectedValue(new Error('warehouse offline'));
    const error = await assertCarrierInviteEligible(agentContext(), '5785947').catch(
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(AppError);
    expect(error).toMatchObject({ statusCode: 502, code: 'DWH_ERROR' });
  });

  it('keeps the existing administrator/system bypass', async () => {
    const admin = makeContext({ role: 'admin', allDepartmentAccess: true });
    await expect(assertCarrierInviteEligible(admin, '5785947')).resolves.toBeUndefined();
    expect(fetchAgentClients).not.toHaveBeenCalled();
  });
});
