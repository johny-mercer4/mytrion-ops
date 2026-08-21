import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FmcsaSearchResult } from '@/api/verificationFmcsa';

const searchFmcsa = vi.fn();
vi.mock('@/api/verificationFmcsa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationFmcsa')>();
  return { ...actual, searchFmcsa };
});

const { CaseDataCenter } = await import('./CaseDataCenter');

function hit(over: Partial<FmcsaSearchResult> = {}): FmcsaSearchResult {
  return {
    available: true,
    error: null,
    reason: null,
    matchedOn: 'dot',
    carrier: {
      legalName: 'Ridgevale Freight',
      dotNumber: '987654',
      status: 'active',
      allowedToOperate: 'yes',
      phyCity: 'Chicago',
      phyState: 'IL',
      authority: {
        common: { raw: 'A', verdict: 'active' },
        contract: { raw: 'N', verdict: 'none' },
        broker: { raw: 'N', verdict: 'none' },
      },
      insurance: {
        bipd: { raw: '1000', dollars: 1_000_000, onFile: true, required: 'yes', requiredDollars: 750_000 },
        bond: { raw: '0', dollars: 0, onFile: false, required: 'unknown', requiredDollars: null },
        cargo: { raw: '0', dollars: 0, onFile: false, required: 'unknown', requiredDollars: null },
      },
    },
    candidates: [],
    candidatesTruncated: false,
    notFound: false,
    retrievalDate: '2026-08-21T00:00:00.000Z',
    ...over,
  };
}

beforeEach(() => {
  searchFmcsa.mockReset();
  searchFmcsa.mockResolvedValue(hit());
});

describe('CaseDataCenter FMCSA search', () => {
  it('prefills USDOT from the case and searches that key on submit', async () => {
    render(<CaseDataCenter caseRow={{ dot: '987654', mc: '123456', companyName: 'Ridgevale Freight' }} />);
    expect(screen.getByRole('searchbox', { name: 'USDOT' })).toHaveValue('987654');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchFmcsa).toHaveBeenCalledWith({ by: 'dot', q: '987654' }));
    expect(await screen.findByText('Ridgevale Freight')).toBeInTheDocument();
    expect(screen.getByText('USDOT 987654')).toBeInTheDocument();
  });

  it('searches by MC when that key is selected', async () => {
    render(<CaseDataCenter caseRow={{ mc: '123456' }} />);
    expect(screen.getByRole('searchbox', { name: 'MC number' })).toHaveValue('123456');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchFmcsa).toHaveBeenCalledWith({ by: 'mc', q: '123456' }));
  });

  it('submits on Enter', async () => {
    render(<CaseDataCenter caseRow={{ companyName: 'Ridgevale Freight' }} />);
    fireEvent.submit(screen.getByRole('searchbox', { name: 'Legal name' }).closest('form')!);
    await waitFor(() => expect(searchFmcsa).toHaveBeenCalledWith({ by: 'name', q: 'Ridgevale Freight' }));
  });

  it('shows a one-line miss', async () => {
    searchFmcsa.mockResolvedValue(hit({ carrier: null, notFound: true }));
    render(<CaseDataCenter caseRow={{ dot: '11111' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No carrier in the register.')).toBeInTheDocument();
  });

  it('shows a one-line vendor error', async () => {
    searchFmcsa.mockResolvedValue(
      hit({
        available: false,
        error: 'HTTP 403 — this egress IP is denied at the FMCSA edge; permanent, not retried',
        reason: 'blocked',
        carrier: null,
      }),
    );
    render(<CaseDataCenter caseRow={{ dot: '987654' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/denied at the FMCSA edge/);
  });

  it('expands a row for the rest of the payload', async () => {
    render(<CaseDataCenter caseRow={{ dot: '987654' }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const toggle = await screen.findByRole('button', { name: /Ridgevale Freight/ });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('BIPD')).toBeInTheDocument();
  });

  it('lists other sources as Soon and keeps FMCSA selected', () => {
    render(<CaseDataCenter caseRow={{}} />);
    expect(screen.getByRole('tab', { name: 'FMCSA' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Motus' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('tab', { name: 'Broker snapshot' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Motus' }));
    expect(screen.getByRole('tab', { name: 'FMCSA' })).toHaveAttribute('aria-selected', 'true');
  });
});
