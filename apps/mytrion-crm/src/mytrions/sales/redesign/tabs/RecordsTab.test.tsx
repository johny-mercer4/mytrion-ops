import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sales = vi.hoisted(() => ({
  openClient: vi.fn(),
  openLead: vi.fn(),
  openDeal: vi.fn(),
  pushToast: vi.fn(),
}));
const state = vi.hoisted(() => ({ clientRows: [] as Array<Record<string, unknown>> }));
const createAgentInvite = vi.hoisted(() => vi.fn());

vi.mock('../ctx', () => ({ useSales: () => sales }));
vi.mock('@/api/impersonation', () => ({ getImpersonation: () => null }));
vi.mock('@/api/carrierUsers', () => ({
  createSalesAgentMiniAppInvitation: createAgentInvite,
}));
vi.mock('../dcCache', () => ({
  useCachedLoad: (key: string) => ({
    data: key.startsWith('sales:clients:') ? state.clientRows : [],
    loading: false,
    revalidating: false,
    error: null,
    reload: vi.fn(),
    cachedAt: null,
  }),
  formatCachedAt: () => '',
}));

const { RecordsTab } = await import('./RecordsTab');

function clientRow(
  computedIsActive: boolean,
  status: 'active' | 'attention' | 'debtor' = 'debtor',
) {
  return {
    id: '5808248',
    name: 'TPO EXPRESS LLC',
    carrier: 'CR-5808248',
    contact: '',
    phone: '',
    cards: 12,
    active: 12,
    trucks: 12,
    gallons: '26,009',
    cycleGallons: 26_009,
    status,
    computedIsActive,
    computedDebt: status === 'debtor' ? 53_027 : 0,
    mc: '',
    dot: '',
    gallonsThisMonth: 4_948,
    inNetworkGallonsThisMonth: 4_948,
    activeCardsThisMonth: 13,
    transactionsThisMonth: 42,
    gallonsPrevMonth: 26_009,
    inNetworkGallonsPrevMonth: 26_009,
    activeCardsPrevMonth: 16,
    lastTierName: 'Enterprise',
    loyaltyOverride: null,
    managerControlled: false,
  };
}

beforeEach(() => {
  state.clientRows = [];
  createAgentInvite.mockReset();
  sales.openClient.mockReset();
  sales.pushToast.mockReset();
});

describe('Sales Data Center pipeline tabs', () => {
  it('keeps Leads and Deals enabled and exposes their complete toolbars', () => {
    render(<RecordsTab />);

    const sections = screen.getByRole('tablist', { name: 'Data Center section' });
    const leads = within(sections).getByRole('tab', { name: 'Leads' });
    const deals = within(sections).getByRole('tab', { name: 'Deals' });

    expect(leads).toBeEnabled();
    expect(deals).toBeEnabled();
    expect(within(sections).queryByText('Soon')).not.toBeInTheDocument();

    fireEvent.click(leads);
    expect(leads).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: /search leads/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter leads by status' })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter leads by source' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Meta' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Leads layout' })).toBeInTheDocument();
    expect(screen.getByText('No leads yet')).toBeInTheDocument();

    fireEvent.click(deals);
    expect(deals).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('textbox', { name: /search deals/i })).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Filter deals by stage' })).toBeInTheDocument();
    expect(screen.getByRole('tablist', { name: 'Deals layout' })).toBeInTheDocument();
    expect(screen.getByText('No deals yet')).toBeInTheDocument();
  });

  it('opens an eligible active company in the Sales-agent mini-app without opening the client modal', async () => {
    state.clientRows = [clientRow(true, 'active')];
    createAgentInvite.mockResolvedValue({
      invitationId: 'sai_1',
      inviteUrl: 'https://t.me/octane_bot/app?startapp=sai_1',
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const replace = vi.fn();
    const close = vi.fn();
    const popup = { opener: window, location: { replace }, close };
    const open = vi.spyOn(window, 'open').mockReturnValue(popup as unknown as Window);

    render(<RecordsTab />);
    fireEvent.click(screen.getByRole('button', { name: 'View TPO EXPRESS LLC mini-app' }));

    await waitFor(() => expect(createAgentInvite).toHaveBeenCalledWith('5808248'));
    expect(replace).toHaveBeenCalledWith('https://t.me/octane_bot/app?startapp=sai_1');
    expect(sales.openClient).not.toHaveBeenCalled();
    open.mockRestore();
  });

  it('keeps mini-app launch disabled for an active debtor', () => {
    state.clientRows = [clientRow(true, 'debtor')];
    render(<RecordsTab />);
    expect(screen.getByRole('button', { name: 'View TPO EXPRESS LLC mini-app' })).toBeDisabled();
    expect(screen.getByText('Mini-app unavailable')).toBeInTheDocument();
  });

  it('keeps mini-app launch disabled when the company is inactive', () => {
    state.clientRows = [clientRow(false, 'active')];
    render(<RecordsTab />);
    expect(screen.getByRole('button', { name: 'View TPO EXPRESS LLC mini-app' })).toBeDisabled();
  });
});
