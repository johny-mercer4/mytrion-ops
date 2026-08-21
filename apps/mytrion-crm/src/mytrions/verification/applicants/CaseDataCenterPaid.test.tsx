import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const pullIsoftPull = vi.fn();
const createPlaidLinkToken = vi.fn();
const parseHighwayFile = vi.fn();
vi.mock('@/api/verificationIsoftpull', () => ({ pullIsoftPull }));
vi.mock('@/api/verificationPlaid', () => ({ createPlaidLinkToken }));
vi.mock('@/api/verificationHighway', () => ({ parseHighwayFile }));
vi.mock('@/api/verificationFmcsa', () => ({ searchFmcsa: vi.fn() }));
vi.mock('@/api/verificationMotus', () => ({ searchMotus: vi.fn() }));
vi.mock('@/api/verificationBrokerSnapshot', () => ({ searchBrokerSnapshot: vi.fn() }));
vi.mock('@/api/verificationBlacklist', () => ({ searchBlacklist: vi.fn() }));
vi.mock('@/api/verificationCiti', () => ({ searchCiti: vi.fn() }));

const { CaseDataCenter } = await import('./CaseDataCenter');

beforeEach(() => {
  pullIsoftPull.mockReset();
  createPlaidLinkToken.mockReset();
  parseHighwayFile.mockReset();
});

describe('CaseDataCenter paid vendor tabs', () => {
  it('does not auto-run iSoftPull on open or tab switch', () => {
    render(<CaseDataCenter caseRow={{ firstName: 'Ada', lastName: 'Cole' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'iSoftPull' }));
    expect(screen.getByRole('textbox', { name: 'First name' })).toHaveValue('Ada');
    expect(pullIsoftPull).not.toHaveBeenCalled();
  });

  it('asks for billed confirm before the iSoftPull pull', async () => {
    pullIsoftPull.mockResolvedValue({
      available: true,
      error: null,
      reason: null,
      data: { bureau: 'equifax', httpStatus: 200, payload: { success: true, score: 720 } },
    });
    render(<CaseDataCenter />);
    fireEvent.click(screen.getByRole('tab', { name: 'iSoftPull' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'First name' }), { target: { value: 'Ada' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Last name' }), { target: { value: 'Cole' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Address' }), { target: { value: '1 Main' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'City' }), { target: { value: 'Austin' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'State' }), { target: { value: 'Texas' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'ZIP' }), { target: { value: '78701' } });
    fireEvent.click(screen.getByRole('button', { name: 'Pull report' }));
    expect(pullIsoftPull).not.toHaveBeenCalled();
    expect(screen.getByRole('alertdialog')).toHaveTextContent(/this incurs a charge/i);
    fireEvent.click(screen.getByRole('button', { name: 'Pull and bill' }));
    await waitFor(() => expect(pullIsoftPull).toHaveBeenCalledWith(expect.objectContaining({ confirm: true, bureau: 'equifax' })));
    const toggle = await screen.findByRole('button', { name: /equifax report/i });
    fireEvent.click(toggle);
    expect(screen.getByText('score')).toBeInTheDocument();
    expect(screen.getByText('720')).toBeInTheDocument();
  });

  it('mints a Plaid Link token without a billed confirm', async () => {
    createPlaidLinkToken.mockResolvedValue({
      available: true,
      error: null,
      reason: null,
      data: {
        env: 'sandbox',
        billed: false,
        product: 'link_token',
        linkToken: 'link-sandbox-1',
        expiration: null,
        hostedLinkUrl: null,
        requestId: null,
        payload: { link_token: 'link-sandbox-1' },
      },
    });
    render(<CaseDataCenter />);
    fireEvent.click(screen.getByRole('tab', { name: 'Plaid' }));
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Mint Link token' }));
    await waitFor(() => expect(createPlaidLinkToken).toHaveBeenCalled());
    expect(screen.queryByText(/incurs a charge/i)).not.toBeInTheDocument();
  });

  it('parses a Highway upload without spending', async () => {
    parseHighwayFile.mockResolvedValue({
      available: true,
      error: null,
      parser: 'highway_html_v2',
      pdfNoText: false,
      blockCount: 4,
      fields: { carrier_name: 'RIDGEVALE FREIGHT LLC', dot_number: '3921884' },
    });
    render(<CaseDataCenter />);
    fireEvent.click(screen.getByRole('tab', { name: 'Highway' }));
    const input = screen.getByLabelText('Highway file') as HTMLInputElement;
    const file = new File(['<div>x</div>'], 'carrier.html', { type: 'text/html' });
    fireEvent.change(input, { target: { files: [file] } });
    fireEvent.click(screen.getByRole('button', { name: 'Parse' }));
    await waitFor(() => expect(parseHighwayFile).toHaveBeenCalled());
    expect(await screen.findByText('RIDGEVALE FREIGHT LLC')).toBeInTheDocument();
  });
});
