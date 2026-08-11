import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoyaltyClient } from '../../../api/loyalty';
import { resolveTierForRow } from '../../_shared/loyalty';
import { LoyaltyBonusModal } from './LoyaltyBonusModal';

const saveMock = vi.fn();
const resetMock = vi.fn();
vi.mock('../../../api/loyalty', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../api/loyalty')>()),
  saveLoyaltyOverride: (...args: unknown[]) => saveMock(...args),
  resetLoyaltyOverride: (...args: unknown[]) => resetMock(...args),
}));

const client: LoyaltyClient = {
  carrierId: '123', companyName: 'Acme', agentName: 'Agent', trucks: 1, activeCards: 1,
  lastTierName: '', activeCardsThisMonth: 1, activeCardsPrevMonth: 1,
  gallonsThisMonth: 1200, inNetworkGallonsThisMonth: 1200, cycleGallons: 1200,
  gallonsPrevMonth: 1200, inNetworkGallonsPrevMonth: 1200, computedIsActive: true,
  loyaltyOverride: null,
};

beforeEach(() => {
  saveMock.mockReset();
  resetMock.mockReset();
});

describe('Manager loyalty controls', () => {
  it('keeps untouched rewards automatic instead of creating a redundant checklist', async () => {
    saveMock.mockResolvedValue({
      override: {
        carrierId: '123', enterpriseMode: null, enterpriseGoldTargetGallons: null,
        enabledRewardIds: null, note: null, updatedBy: 'Manager',
        updatedAt: '2026-07-31T12:00:00.000Z',
      },
    });
    render(
      <LoyaltyBonusModal
        client={client}
        tier={resolveTierForRow(client)}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /save controls/i }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith('123', expect.objectContaining({
      enabledRewardIds: null,
    }));
  });

  it('persists the complete explicit checklist after a checkbox change', async () => {
    saveMock.mockResolvedValue({
      override: {
        carrierId: '123', enterpriseMode: null, enterpriseGoldTargetGallons: null,
        enabledRewardIds: ['transaction_fee_waiver', 'credit_score_check', 'money_code_limit', 'loves_rebate'],
        note: null, updatedBy: 'Manager', updatedAt: '2026-07-31T12:00:00.000Z',
      },
    });
    render(
      <LoyaltyBonusModal
        client={client}
        tier={resolveTierForRow(client)}
        onClose={vi.fn()}
        onSaved={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('checkbox', { name: /love's direct rebate/i }));
    fireEvent.click(screen.getByRole('button', { name: /save controls/i }));

    await waitFor(() => expect(saveMock).toHaveBeenCalledTimes(1));
    expect(saveMock).toHaveBeenCalledWith('123', expect.objectContaining({
      enabledRewardIds: [
        'transaction_fee_waiver', 'credit_score_check', 'money_code_limit', 'loves_rebate',
      ],
    }));
  });
});
