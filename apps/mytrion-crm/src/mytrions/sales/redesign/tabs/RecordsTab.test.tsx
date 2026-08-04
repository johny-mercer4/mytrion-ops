import { fireEvent, render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const sales = vi.hoisted(() => ({
  openClient: vi.fn(),
  openLead: vi.fn(),
  openDeal: vi.fn(),
  pushToast: vi.fn(),
}));

vi.mock('../ctx', () => ({ useSales: () => sales }));
vi.mock('@/api/impersonation', () => ({ getImpersonation: () => null }));
vi.mock('../dcCache', () => ({
  useCachedLoad: () => ({
    data: [],
    loading: false,
    revalidating: false,
    error: null,
    reload: vi.fn(),
    cachedAt: null,
  }),
  formatCachedAt: () => '',
}));

const { RecordsTab } = await import('./RecordsTab');

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
});
