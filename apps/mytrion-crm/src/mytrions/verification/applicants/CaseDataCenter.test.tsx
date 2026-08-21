import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FmcsaSearchResult } from '@/api/verificationFmcsa';
import type { MotusSearchResult } from '@/api/verificationMotus';
import type { BrokerSnapshotSearchResult } from '@/api/verificationBrokerSnapshot';

const searchFmcsa = vi.fn();
const searchMotus = vi.fn();
const searchBrokerSnapshot = vi.fn();
vi.mock('@/api/verificationFmcsa', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationFmcsa')>();
  return { ...actual, searchFmcsa };
});
vi.mock('@/api/verificationMotus', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationMotus')>();
  return { ...actual, searchMotus };
});
vi.mock('@/api/verificationBrokerSnapshot', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationBrokerSnapshot')>();
  return { ...actual, searchBrokerSnapshot };
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
      fields: { totalPowerUnits: 12, phyCountry: 'US' },
    },
    candidates: [],
    candidatesTruncated: false,
    notFound: false,
    retrievalDate: '2026-08-21T00:00:00.000Z',
    ...over,
  };
}

function motusHit(over: Partial<MotusSearchResult> = {}): MotusSearchResult {
  const record = {
    dotNumber: '652739',
    legalName: 'STONE EXPRESS INC',
    dbaName: null,
    statusCode: 'A' as const,
    statusLabel: 'Active',
    carrierOperation: 'A' as const,
    carrierOperationLabel: 'Interstate',
    powerUnits: 7,
    totalDrivers: 5,
    addDate: '1996-07-31',
    safetyRating: null,
    dockets: [{ prefix: 'MC', number: '307348', statusCode: 'A', statusLabel: 'Active' }],
    address: { street: '99 DELL GLEN AVE', city: 'LODI', state: 'NJ', zip: '07644' },
    phone: '9737672454',
    fields: { email_address: 'dispatch@stone.example', company_officer_1: 'JOHN STONE' },
  };
  return {
    available: true,
    error: null,
    matchedOn: 'dot',
    notFound: false,
    census: { available: true, error: null, record, records: [record], truncated: false },
    insurance: { available: true, error: null, frozen: true, dataAsOf: '2026-05-14', filings: [] },
    processAgents: { available: true, error: null, frozen: true, dataAsOf: '2026-05-14', agents: [] },
    ...over,
  };
}

function brokerHit(over: Partial<BrokerSnapshotSearchResult> = {}): BrokerSnapshotSearchResult {
  return {
    available: true,
    error: null,
    matchedOn: 'dot',
    notFound: false,
    truncated: false,
    records: [
      {
        id: '16079457811075937970',
        dotNumber: '8844425',
        ownerFullName: 'Abdirehin Ahmed',
        phoneNumber: '6145550110',
        email: 'owner@example.com',
        physicalAddress: '1 Main St',
        operatingStatus: 'AUTHORIZED FOR PROPERTY',
        powerUnits: 3,
        truckSize: 2,
        addDate: '2024-01-15',
        changeDate: '2026-08-01',
        isActive: true,
        fields: { row_hash: 'abc', email: 'owner@example.com', sk: '542539' },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  searchFmcsa.mockReset();
  searchMotus.mockReset();
  searchBrokerSnapshot.mockReset();
  searchFmcsa.mockResolvedValue(hit());
  searchMotus.mockResolvedValue(motusHit());
  searchBrokerSnapshot.mockResolvedValue(brokerHit());
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
    expect(screen.getByText('totalPowerUnits')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
  });

  it('lists remaining sources as Soon and keeps Motus and Broker snapshot live', () => {
    render(<CaseDataCenter caseRow={{}} />);
    expect(screen.getByRole('tab', { name: 'FMCSA' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Motus' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('tab', { name: 'Broker snapshot' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('tab', { name: 'Blacklist' })).toHaveAttribute('aria-disabled', 'true');
    expect(screen.getByRole('tab', { name: 'CITI Fuel' })).toHaveAttribute('aria-disabled', 'true');
    fireEvent.click(screen.getByRole('tab', { name: 'Motus' }));
    expect(screen.getByRole('tab', { name: 'Motus' })).toHaveAttribute('aria-selected', 'true');
  });

  it('searches with no case — empty box, typed query', async () => {
    render(<CaseDataCenter />);
    const box = screen.getByRole('searchbox', { name: 'USDOT' });
    expect(box).toHaveValue('');
    expect(screen.getByRole('button', { name: 'Search' })).toBeDisabled();
    fireEvent.change(box, { target: { value: '11111' } });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchFmcsa).toHaveBeenCalledWith({ by: 'dot', q: '11111' }));
  });
});

describe('CaseDataCenter Motus search', () => {
  it('prefills USDOT and searches Motus on that key', async () => {
    render(<CaseDataCenter caseRow={{ dot: '652739', mc: '307348', companyName: 'STONE EXPRESS INC' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Motus' }));
    expect(screen.getByRole('searchbox', { name: 'USDOT' })).toHaveValue('652739');
    expect(screen.queryByRole('tab', { name: 'MC' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchMotus).toHaveBeenCalledWith({ by: 'dot', q: '652739' }));
    expect(await screen.findByText('STONE EXPRESS INC')).toBeInTheDocument();
    expect(screen.getByText('USDOT 652739')).toBeInTheDocument();
    expect(screen.getByText('MC 307348')).toBeInTheDocument();
  });

  it('searches by name on Enter', async () => {
    render(<CaseDataCenter caseRow={{ companyName: 'STONE EXPRESS INC' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Motus' }));
    fireEvent.submit(screen.getByRole('searchbox', { name: 'Legal name' }).closest('form')!);
    await waitFor(() => expect(searchMotus).toHaveBeenCalledWith({ by: 'name', q: 'STONE EXPRESS INC' }));
  });

  it('shows a one-line miss', async () => {
    searchMotus.mockResolvedValue(motusHit({ notFound: true, census: { available: true, error: null, record: null, records: [], truncated: false } }));
    render(<CaseDataCenter caseRow={{ dot: '111111' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Motus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No carrier in the census.')).toBeInTheDocument();
  });

  it('shows a one-line vendor error', async () => {
    searchMotus.mockResolvedValue(
      motusHit({
        available: false,
        error: 'SOCRATA_BASE_URL is not configured',
        census: { available: false, error: 'SOCRATA_BASE_URL is not configured', record: null, records: [], truncated: false },
        insurance: null,
        processAgents: null,
      }),
    );
    render(<CaseDataCenter caseRow={{ dot: '652739' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Motus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/SOCRATA_BASE_URL/);
  });

  it('expands a census row to leftover Socrata columns', async () => {
    render(<CaseDataCenter caseRow={{ dot: '652739' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Motus' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const toggle = await screen.findByRole('button', { name: /STONE EXPRESS INC/ });
    fireEvent.click(toggle);
    expect(screen.getByText('email_address')).toBeInTheDocument();
    expect(screen.getByText('dispatch@stone.example')).toBeInTheDocument();
  });
});

describe('CaseDataCenter Broker snapshot search', () => {
  it('prefills USDOT and searches the snapshot on that key', async () => {
    render(<CaseDataCenter caseRow={{ dot: '8844425', mc: '307348', firstName: 'Ada', lastName: 'Cole' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Broker snapshot' }));
    expect(screen.getByRole('searchbox', { name: 'USDOT' })).toHaveValue('8844425');
    expect(screen.queryByRole('tab', { name: 'MC' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchBrokerSnapshot).toHaveBeenCalledWith({ by: 'dot', q: '8844425' }));
    expect(await screen.findByText('Abdirehin Ahmed')).toBeInTheDocument();
    expect(screen.getByText('USDOT 8844425')).toBeInTheDocument();
  });

  it('searches by owner name on Enter', async () => {
    render(<CaseDataCenter caseRow={{ firstName: 'Ada', lastName: 'Cole' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Broker snapshot' }));
    fireEvent.submit(screen.getByRole('searchbox', { name: 'Owner name' }).closest('form')!);
    await waitFor(() => expect(searchBrokerSnapshot).toHaveBeenCalledWith({ by: 'name', q: 'Ada Cole' }));
  });

  it('shows a one-line miss', async () => {
    searchBrokerSnapshot.mockResolvedValue(brokerHit({ notFound: true, records: [] }));
    render(<CaseDataCenter caseRow={{ dot: '111111' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Broker snapshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No carrier in the snapshot.')).toBeInTheDocument();
  });

  it('shows a one-line warehouse error', async () => {
    searchBrokerSnapshot.mockResolvedValue(
      brokerHit({
        available: false,
        error: 'DWH_DATABASE_URL is not configured',
        records: [],
      }),
    );
    render(<CaseDataCenter caseRow={{ dot: '8844425' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Broker snapshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/DWH_DATABASE_URL/);
  });

  it('expands a row for leftover warehouse columns', async () => {
    render(<CaseDataCenter caseRow={{ dot: '8844425' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Broker snapshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const toggle = await screen.findByRole('button', { name: /Abdirehin Ahmed/ });
    fireEvent.click(toggle);
    expect(screen.getByText('row_hash')).toBeInTheDocument();
    expect(screen.getByText('abc')).toBeInTheDocument();
  });
});
