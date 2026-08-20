import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CarrierUsers } from './CarrierUsers';
import { listRegisteredCompanies } from '../../api/carrierUsers';
import type { RegisteredCompany } from '../../api/carrierUsers';

vi.mock('../../api/carrierUsers', () => ({
  listRegisteredCompanies: vi.fn(),
  listInvitations: vi.fn(async () => []),
  listPasswordResets: vi.fn(async () => []),
  listSupportBotChats: vi.fn(async () => []),
  revokeRegistration: vi.fn(),
  cancelInvitation: vi.fn(),
  setSupportBotChat: vi.fn(),
  resolvePasswordReset: vi.fn(),
}));
vi.mock('../../api/transport', () => ({
  ApiError: class ApiError extends Error {
    status = 0;
  },
  request: vi.fn(),
}));
vi.mock('./toast', () => ({
  adminToast: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

const listRegisteredCompaniesMock = vi.mocked(listRegisteredCompanies);

function company(over: Partial<RegisteredCompany> & { id: string; companyName: string }): RegisteredCompany {
  return {
    profile: 'owner',
    carrierId: '5770757',
    applicationId: null,
    cardId: null,
    driverName: null,
    companyType: 'owner-operator',
    cardCount: 1,
    telegramUserId: '1001',
    telegramUsername: 'owner_tg',
    agentName: 'Daniel Brown',
    agentZohoUserId: '6227679000031473048',
    status: 'active',
    revokedAt: null,
    createdAt: '2026-07-18T12:00:00.000Z',
    ...over,
  };
}

describe('CarrierUsers registered companies', () => {
  it('shows which sales agent registered each company', async () => {
    listRegisteredCompaniesMock.mockResolvedValue([
      company({ id: 'rma_1', companyName: 'Acme Transport' }),
      company({
        id: 'rma_2',
        companyName: 'Layla Fleet',
        carrierId: '5763627',
        agentName: 'Frank Harrison',
        agentZohoUserId: '6227679000001',
        telegramUsername: 'dinaoctane',
      }),
    ]);

    render(<CarrierUsers view="registered" />);

    const table = await screen.findByRole('table', { name: 'Registered carrier companies' });
    expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual([
      'Company',
      'Type',
      'Carrier',
      'Sales agent',
      'Telegram',
      'Bot group',
      'Registered',
      'Actions',
    ]);

    const acme = screen.getByText('Acme Transport').closest('[role="row"]') as HTMLElement;
    expect(within(acme).getByText('Daniel Brown')).toBeInTheDocument();
    expect(within(acme).getByTitle('6227679000031473048')).toBeInTheDocument();
    expect(within(acme).getByRole('button', { name: /revoke/i })).toBeInTheDocument();

    const layla = screen.getByText('Layla Fleet').closest('[role="row"]') as HTMLElement;
    expect(within(layla).getByText('Frank Harrison')).toBeInTheDocument();
  });

  it('filters the roster by sales agent name', async () => {
    listRegisteredCompaniesMock.mockResolvedValue([
      company({ id: 'rma_1', companyName: 'Acme Transport' }),
      company({
        id: 'rma_2',
        companyName: 'Layla Fleet',
        carrierId: '5763627',
        agentName: 'Frank Harrison',
      }),
    ]);

    render(<CarrierUsers view="registered" />);
    await screen.findByText('Acme Transport');

    await userEvent.type(screen.getByLabelText('Filter registered companies'), 'frank harrison');

    await waitFor(() => {
      expect(screen.getByText('Layla Fleet')).toBeInTheDocument();
      expect(screen.queryByText('Acme Transport')).not.toBeInTheDocument();
    });
  });

  it('asks before revoking an active company', async () => {
    listRegisteredCompaniesMock.mockResolvedValue([
      company({ id: 'rma_1', companyName: 'Kareem Hauling' }),
    ]);

    render(<CarrierUsers view="registered" />);
    const row = (await screen.findByText('Kareem Hauling')).closest('[role="row"]') as HTMLElement;
    await userEvent.click(within(row).getByRole('button', { name: /revoke/i }));

    expect(screen.getByRole('heading', { name: /revoke kareem hauling's access/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Revoke access' })).toBeInTheDocument();
  });

  it('shows an em dash when the invite never recorded a sales agent', async () => {
    listRegisteredCompaniesMock.mockResolvedValue([
      company({ id: 'rma_3', companyName: 'No Agent Co', agentName: null, agentZohoUserId: null }),
    ]);

    render(<CarrierUsers view="registered" />);
    const row = (await screen.findByText('No Agent Co')).closest('[role="row"]') as HTMLElement;
    expect(within(row).getAllByText('—').length).toBeGreaterThan(0);
  });
});
