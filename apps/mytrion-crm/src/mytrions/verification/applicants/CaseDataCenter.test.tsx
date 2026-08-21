import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FmcsaSearchResult } from '@/api/verificationFmcsa';
import type { MotusSearchResult } from '@/api/verificationMotus';
import type { BrokerSnapshotSearchResult } from '@/api/verificationBrokerSnapshot';
import type { BlacklistSearchResult } from '@/api/verificationBlacklist';
import type { CitiSearchResult } from '@/api/verificationCiti';

const searchFmcsa = vi.fn();
const searchMotus = vi.fn();
const searchBrokerSnapshot = vi.fn();
const searchBlacklist = vi.fn();
const searchCiti = vi.fn();
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
vi.mock('@/api/verificationBlacklist', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationBlacklist')>();
  return { ...actual, searchBlacklist };
});
vi.mock('@/api/verificationCiti', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/verificationCiti')>();
  return { ...actual, searchCiti };
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
    pagination: { page: 1, pageSize: 50, hasMore: false },
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

function blacklistHit(over: Partial<BlacklistSearchResult> = {}): BlacklistSearchResult {
  return {
    matchedOn: 'dot',
    ban: {
      available: true,
      error: null,
      ownAvailable: true,
      platformAvailable: true,
      hits: [
        {
          list: 'own',
          entryType: 'usdot',
          display: '987654',
          reason: 'Fraud',
          sourceCaseId: 'vc_banned',
          date: '2026-08-01T00:00:00.000Z',
          fields: { reason: 'Fraud', source_case_id: 'vc_banned' },
        },
      ],
    },
    duplicates: {
      available: true,
      error: null,
      casesAvailable: true,
      dealsAvailable: true,
      hits: [],
    },
    debtors: {
      available: true,
      error: null,
      records: [],
      truncated: false,
      pagination: { page: 1, pageSize: 50, hasMore: false },
    },
    ...over,
  };
}

function citiHit(over: Partial<CitiSearchResult> = {}): CitiSearchResult {
  return {
    available: true,
    error: null,
    matchedOn: 'dot',
    notFound: false,
    truncated: false,
    pagination: { page: 1, pageSize: 200, hasMore: false },
    records: [
      {
        dealId: '6227679000111111111',
        dealName: 'Kaiser Freight LLC',
        dotNumber: '3921884',
        mcNumber: '778211',
        stage: 'Application Filled',
        citifuelStatus: 'yes',
        citifuelVerdict: 'flagged',
        fields: { Email: 'ops@kaiser.test', citifuel_Status: 'yes', Stage: 'Application Filled' },
      },
    ],
    ...over,
  };
}

beforeEach(() => {
  searchFmcsa.mockReset();
  searchMotus.mockReset();
  searchBrokerSnapshot.mockReset();
  searchBlacklist.mockReset();
  searchCiti.mockReset();
  searchFmcsa.mockResolvedValue(hit());
  searchMotus.mockResolvedValue(motusHit());
  searchBrokerSnapshot.mockResolvedValue(brokerHit());
  searchBlacklist.mockResolvedValue(blacklistHit());
  searchCiti.mockResolvedValue(citiHit());
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

  it('lists CITI Fuel live with Motus, Broker snapshot, and Blacklist', () => {
    render(<CaseDataCenter caseRow={{}} />);
    expect(screen.getByRole('tab', { name: 'FMCSA' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Motus' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('tab', { name: 'Broker snapshot' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('tab', { name: 'Blacklist' })).not.toHaveAttribute('aria-disabled');
    expect(screen.getByRole('tab', { name: 'CITI Fuel' })).not.toHaveAttribute('aria-disabled');
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

  it('loads the next snapshot page instead of capping silently', async () => {
    searchBrokerSnapshot
      .mockResolvedValueOnce(
        brokerHit({
          matchedOn: 'name',
          truncated: true,
          pagination: { page: 1, pageSize: 50, hasMore: true },
        }),
      )
      .mockResolvedValueOnce(
        brokerHit({
          matchedOn: 'name',
          records: [
            {
              id: 'row-2',
              dotNumber: '100',
              ownerFullName: 'Ada Cole',
              phoneNumber: null,
              email: null,
              physicalAddress: null,
              operatingStatus: 'AUTHORIZED FOR PROPERTY',
              powerUnits: null,
              truckSize: null,
              addDate: null,
              changeDate: null,
              isActive: true,
            },
          ],
          pagination: { page: 2, pageSize: 50, hasMore: false },
        }),
      );
    render(<CaseDataCenter caseRow={{ firstName: 'Ada', lastName: 'Cole' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Broker snapshot' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Abdirehin Ahmed')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(searchBrokerSnapshot).toHaveBeenLastCalledWith({
        by: 'name',
        q: 'Ada Cole',
        page: 2,
        pageSize: 50,
      }),
    );
    expect(await screen.findByText('Ada Cole')).toBeInTheDocument();
    expect(screen.getByText('Abdirehin Ahmed')).toBeInTheDocument();
  });
});

describe('CaseDataCenter Blacklist search', () => {
  it('is a live tab with USDOT / MC / Email / Phone / Name keys', () => {
    render(<CaseDataCenter caseRow={{}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Blacklist' }));
    expect(screen.getByRole('tab', { name: 'Blacklist' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'USDOT' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'MC' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Phone' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Name' })).toBeInTheDocument();
    expect(searchBlacklist).not.toHaveBeenCalled();
  });

  it('prefills USDOT and searches on submit', async () => {
    render(<CaseDataCenter caseRow={{ dot: '987654', email: 'ops@kaiser.test' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Blacklist' }));
    expect(screen.getByRole('searchbox', { name: 'USDOT' })).toHaveValue('987654');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchBlacklist).toHaveBeenCalledWith({ by: 'dot', q: '987654' }));
  });

  it('keeps all three sections when only Ban hits', async () => {
    render(<CaseDataCenter caseRow={{ dot: '987654' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Blacklist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('region', { name: 'Ban list' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Duplicates' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Debtors' })).toBeInTheDocument();
    expect(screen.getByText('987654')).toBeInTheDocument();
    expect(screen.getByText('No duplicate case or Deal.')).toBeInTheDocument();
    expect(screen.getByText('No debtor over $100.')).toBeInTheDocument();
  });

  it('keeps Ban and Duplicates visible when only Debtors hits', async () => {
    searchBlacklist.mockResolvedValue(
      blacklistHit({
        ban: { available: true, error: null, ownAvailable: true, platformAvailable: true, hits: [] },
        debtors: {
          available: true,
          error: null,
          truncated: false,
          pagination: { page: 1, pageSize: 50, hasMore: false },
          records: [
            {
              carrierId: '4421',
              companyName: 'Kaiser Freight',
              computedDebt: 150.25,
              computedDebtDays: 11,
              openInvoices: 2,
              fields: { deal_email: 'ops@kaiser.test' },
            },
          ],
        },
      }),
    );
    render(<CaseDataCenter caseRow={{ dot: '987654' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Blacklist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Kaiser Freight')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ban list' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Duplicates' })).toBeInTheDocument();
    expect(screen.getByText('No ban-list match.')).toBeInTheDocument();
    expect(screen.getByText('No duplicate case or Deal.')).toBeInTheDocument();
  });

  it('shows a down Credit Platform probe without hiding other sections', async () => {
    searchBlacklist.mockResolvedValue(
      blacklistHit({
        ban: {
          available: false,
          error: 'VERIFICATION_DATABASE_URL is not configured',
          ownAvailable: true,
          platformAvailable: false,
          hits: [],
        },
      }),
    );
    render(<CaseDataCenter caseRow={{ dot: '987654' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'Blacklist' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Credit Platform list is not configured.')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Duplicates' })).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Debtors' })).toBeInTheDocument();
  });
});

describe('CaseDataCenter CITI Fuel search', () => {
  it('is a live tab with USDOT / MC / Email / Name keys and no Phone', () => {
    render(<CaseDataCenter caseRow={{}} />);
    fireEvent.click(screen.getByRole('tab', { name: 'CITI Fuel' }));
    expect(screen.getByRole('tab', { name: 'CITI Fuel' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'USDOT' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'MC' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Email' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Name' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Phone' })).not.toBeInTheDocument();
    expect(searchCiti).not.toHaveBeenCalled();
  });

  it('prefills USDOT and searches on submit', async () => {
    render(<CaseDataCenter caseRow={{ dot: '3921884', email: 'ops@kaiser.test' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'CITI Fuel' }));
    expect(screen.getByRole('searchbox', { name: 'USDOT' })).toHaveValue('3921884');
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    await waitFor(() => expect(searchCiti).toHaveBeenCalledWith({ by: 'dot', q: '3921884' }));
    expect(await screen.findByText('Kaiser Freight LLC')).toBeInTheDocument();
    expect(screen.getByText('USDOT 3921884')).toBeInTheDocument();
    expect(screen.getByText('MC 778211')).toBeInTheDocument();
    expect(screen.getByText('yes')).toBeInTheDocument();
  });

  it('searches by email on Enter', async () => {
    render(<CaseDataCenter caseRow={{ email: 'ops@kaiser.test' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'CITI Fuel' }));
    fireEvent.submit(screen.getByRole('searchbox', { name: 'Email' }).closest('form')!);
    await waitFor(() => expect(searchCiti).toHaveBeenCalledWith({ by: 'email', q: 'ops@kaiser.test' }));
  });

  it('shows a one-line miss', async () => {
    searchCiti.mockResolvedValue(citiHit({ notFound: true, records: [] }));
    render(<CaseDataCenter caseRow={{ dot: '111111' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'CITI Fuel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('No matching Deal.')).toBeInTheDocument();
  });

  it('shows a one-line Zoho error', async () => {
    searchCiti.mockResolvedValue(citiHit({ available: false, error: '[zoho-crm] COQL HTTP 500', records: [] }));
    render(<CaseDataCenter caseRow={{ dot: '3921884' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'CITI Fuel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/COQL HTTP 500/);
  });

  it('expands a row for leftover Deal fields', async () => {
    render(<CaseDataCenter caseRow={{ dot: '3921884' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'CITI Fuel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const toggle = await screen.findByRole('button', { name: /Kaiser Freight LLC/ });
    fireEvent.click(toggle);
    expect(screen.getByText('citifuel_Status')).toBeInTheDocument();
    expect(screen.getByText('ops@kaiser.test')).toBeInTheDocument();
  });

  it('loads the next Deal page when Zoho says more remain', async () => {
    searchCiti
      .mockResolvedValueOnce(
        citiHit({ truncated: true, pagination: { page: 1, pageSize: 200, hasMore: true } }),
      )
      .mockResolvedValueOnce(
        citiHit({
          records: [
            {
              dealId: '6227679000222222222',
              dealName: 'Second Deal LLC',
              dotNumber: '3921884',
              mcNumber: '778211',
              stage: 'Application Filled',
              citifuelStatus: 'no',
              citifuelVerdict: 'clear',
            },
          ],
          pagination: { page: 2, pageSize: 200, hasMore: false },
        }),
      );
    render(<CaseDataCenter caseRow={{ dot: '3921884' }} />);
    fireEvent.click(screen.getByRole('tab', { name: 'CITI Fuel' }));
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    expect(await screen.findByText('Kaiser Freight LLC')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Load more' }));
    await waitFor(() =>
      expect(searchCiti).toHaveBeenLastCalledWith({
        by: 'dot',
        q: '3921884',
        page: 2,
        pageSize: 200,
      }),
    );
    expect(await screen.findByText('Second Deal LLC')).toBeInTheDocument();
  });
});
