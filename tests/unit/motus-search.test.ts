/**
 * Data Center Motus search — composition of the four existing Socrata placements.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const fetchCensusByDot = vi.fn();
const searchCensusByName = vi.fn();
const fetchInsuranceByDot = vi.fn();
const fetchProcessAgentsByDot = vi.fn();

vi.mock('../../src/integrations/socrataFmcsa.js', () => ({
  fetchCensusByDot: (...args: unknown[]) => fetchCensusByDot(...args),
  searchCensusByName: (...args: unknown[]) => searchCensusByName(...args),
}));

vi.mock('../../src/integrations/socrataFmcsaFilings.js', () => ({
  fetchInsuranceByDot: (...args: unknown[]) => fetchInsuranceByDot(...args),
  fetchProcessAgentsByDot: (...args: unknown[]) => fetchProcessAgentsByDot(...args),
}));

const { searchMotus } = await import('../../src/modules/verificationFlow/motusSearch.js');

const censusHit = {
  available: true,
  error: null,
  record: {
    dotNumber: '652739',
    legalName: 'STONE EXPRESS INC',
    fields: { email_address: 'dispatch@stone.example' },
  },
};

const insuranceEmpty = {
  available: true,
  error: null,
  frozen: true as const,
  dataAsOf: '2026-05-14',
  filings: [],
};

const agentsEmpty = {
  available: true,
  error: null,
  frozen: true as const,
  dataAsOf: '2026-05-14',
  agents: [],
};

beforeEach(() => {
  fetchCensusByDot.mockReset();
  searchCensusByName.mockReset();
  fetchInsuranceByDot.mockReset();
  fetchProcessAgentsByDot.mockReset();
  fetchCensusByDot.mockResolvedValue(censusHit);
  searchCensusByName.mockResolvedValue({
    available: true,
    error: null,
    records: [censusHit.record],
    truncated: false,
  });
  fetchInsuranceByDot.mockResolvedValue(insuranceEmpty);
  fetchProcessAgentsByDot.mockResolvedValue(agentsEmpty);
});

describe('searchMotus', () => {
  it('fans USDOT out to census, insurance, and process agents', async () => {
    const out = await searchMotus({ by: 'dot', q: '652739' });
    expect(fetchCensusByDot).toHaveBeenCalledWith('652739');
    expect(fetchInsuranceByDot).toHaveBeenCalledWith('652739');
    expect(fetchProcessAgentsByDot).toHaveBeenCalledWith('652739');
    expect(searchCensusByName).not.toHaveBeenCalled();
    expect(out.matchedOn).toBe('dot');
    expect(out.census.record?.fields?.email_address).toBe('dispatch@stone.example');
    expect(out.insurance?.frozen).toBe(true);
    expect(out.processAgents?.frozen).toBe(true);
  });

  it('searches census by name only', async () => {
    const out = await searchMotus({ by: 'name', q: 'STONE EXPRESS' });
    expect(searchCensusByName).toHaveBeenCalledWith('STONE EXPRESS');
    expect(fetchCensusByDot).not.toHaveBeenCalled();
    expect(fetchInsuranceByDot).not.toHaveBeenCalled();
    expect(fetchProcessAgentsByDot).not.toHaveBeenCalled();
    expect(out.matchedOn).toBe('name');
    expect(out.insurance).toBeNull();
    expect(out.processAgents).toBeNull();
    expect(out.census.records[0]?.fields?.email_address).toBe('dispatch@stone.example');
  });

  it('is a miss when every DOT probe is an empty success', async () => {
    fetchCensusByDot.mockResolvedValue({ available: true, error: null, record: null });
    const out = await searchMotus({ by: 'dot', q: '111111' });
    expect(out.available).toBe(true);
    expect(out.notFound).toBe(true);
  });

  it('is unavailable when Socrata is not configured', async () => {
    const missing = {
      available: false,
      error: 'SOCRATA_BASE_URL is not configured',
      record: null,
      records: [],
      truncated: false,
      frozen: true as const,
      dataAsOf: '2026-05-14',
      filings: [],
      agents: [],
    };
    fetchCensusByDot.mockResolvedValue(missing);
    fetchInsuranceByDot.mockResolvedValue(missing);
    fetchProcessAgentsByDot.mockResolvedValue(missing);
    const out = await searchMotus({ by: 'dot', q: '652739' });
    expect(out.available).toBe(false);
    expect(out.error).toMatch(/SOCRATA_BASE_URL/);
  });
});
