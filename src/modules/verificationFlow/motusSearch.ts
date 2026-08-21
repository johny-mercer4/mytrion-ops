/**
 * Data Center Motus search — the four free Socrata placements, one request.
 *
 * Motus on this desk is Socrata, not a fifth vendor: `socrata.census` / `socrata.census.name`
 * (live Company Census `az4n-8mr2`) plus the frozen filings (`socrata.insurance` `qh9u-swkp`,
 * `socrata.process_agents` `2emp-mxtb`). Those are the only SODA views we wrap. No Highway,
 * no VIN dataset, no invented MC filter — census name search and the three DOT probes are
 * the keys the clients already accept.
 *
 * USDOT fans out the way Phase 4 already does (census + insurance), and also pulls process
 * agents because that placement exists and Data Center is "everything Socrata has" for the
 * carrier. Name is census-only: insurance and BOC-3 have no name endpoint.
 *
 * READ-ONLY. Never writes findings; Phase 4 `authority/run` still does that.
 */
import {
  fetchCensusByDot,
  searchCensusByName,
  type SocrataCensusRecord,
} from '../../integrations/socrataFmcsa.js';
import {
  fetchInsuranceByDot,
  fetchProcessAgentsByDot,
  type SocrataInsuranceResult,
  type SocrataProcessAgentResult,
} from '../../integrations/socrataFmcsaFilings.js';

export type MotusSearchBy = 'dot' | 'name';

export interface MotusCensusSlice {
  available: boolean;
  error: string | null;
  record: SocrataCensusRecord | null;
  records: SocrataCensusRecord[];
  truncated: boolean;
}

export interface MotusSearchResult {
  available: boolean;
  error: string | null;
  matchedOn: MotusSearchBy | null;
  notFound: boolean;
  census: MotusCensusSlice;
  insurance: SocrataInsuranceResult | null;
  processAgents: SocrataProcessAgentResult | null;
}

function censusSlice(over: Partial<MotusCensusSlice> & Pick<MotusCensusSlice, 'available'>): MotusCensusSlice {
  return {
    error: null,
    record: null,
    records: [],
    truncated: false,
    ...over,
  };
}

export async function searchMotus(query: { by: MotusSearchBy; q: string }): Promise<MotusSearchResult> {
  const q = query.q.trim();

  if (query.by === 'name') {
    const found = await searchCensusByName(q);
    const records = found.records;
    return {
      available: found.available,
      error: found.available ? null : found.error,
      matchedOn: found.available ? 'name' : null,
      notFound: found.available && records.length === 0,
      census: censusSlice({
        available: found.available,
        error: found.error,
        records,
        truncated: found.truncated,
      }),
      insurance: null,
      processAgents: null,
    };
  }

  const [census, insurance, processAgents] = await Promise.all([
    fetchCensusByDot(q),
    fetchInsuranceByDot(q),
    fetchProcessAgentsByDot(q),
  ]);
  const records = census.record === null ? [] : [census.record];
  const available = census.available || insurance.available || processAgents.available;
  const notFound =
    census.available &&
    census.record === null &&
    insurance.available &&
    insurance.filings.length === 0 &&
    processAgents.available &&
    processAgents.agents.length === 0;

  return {
    available,
    error: available ? null : (census.error ?? insurance.error ?? processAgents.error),
    matchedOn: available ? 'dot' : null,
    notFound,
    census: censusSlice({
      available: census.available,
      error: census.error,
      record: census.record,
      records,
    }),
    insurance,
    processAgents,
  };
}
