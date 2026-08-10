import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ClientManagePanel } from './ClientManagePanel';

const carrierApi = vi.hoisted(() => ({
  createCarrierInvitation: vi.fn(),
  getCarrierRegistrations: vi.fn(),
  listCards: vi.fn(),
  listSupportBotChats: vi.fn(),
  searchClients: vi.fn(),
  setSupportBotChat: vi.fn(),
}));

vi.mock('@/api/carrierUsers', () => carrierApi);
vi.mock('./ctx', () => ({
  useSales: () => ({ pushToast: vi.fn() }),
}));

describe('ClientManagePanel registration eligibility', () => {
  beforeEach(() => {
    carrierApi.createCarrierInvitation.mockReset();
    carrierApi.getCarrierRegistrations.mockReset().mockResolvedValue({
      owner: null,
      managers: [],
      drivers: [],
      pendingResets: [],
    });
    carrierApi.listCards.mockReset().mockResolvedValue([]);
    carrierApi.listSupportBotChats.mockReset().mockResolvedValue([]);
    carrierApi.searchClients.mockReset().mockResolvedValue([]);
    carrierApi.setSupportBotChat.mockReset();
  });

  it('does not offer registration links to debtors', async () => {
    render(
      <ClientManagePanel
        carrierId="5783748"
        companyName="TYNYBEK KOCHROV"
        clientStatus="debtor"
      />,
    );

    await screen.findByText('No owner user yet');
    expect(screen.getByText('Debtor — registration links are blocked.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Generate registration link' })).not.toBeInTheDocument();
    // Support bot stays available (secondary) even when invite generate is blocked.
    expect(screen.getByText('Support bot group')).toBeInTheDocument();
  });

  it('offers registration links to active clients', async () => {
    render(
      <ClientManagePanel
        carrierId="5813583"
        companyName="TIGERS TEAM CORP"
        clientStatus="active"
      />,
    );

    await screen.findByText('No owner user yet');
    expect(screen.getByRole('button', { name: 'Generate registration link' })).toBeEnabled();
    expect(screen.getByText('Registration link')).toBeInTheDocument();
    expect(screen.getByText('Registered users')).toBeInTheDocument();
    expect(screen.getByText('Pending password resets')).toBeInTheDocument();
  });
});
