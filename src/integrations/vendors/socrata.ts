/**
 * Socrata placements — descriptors wrap the existing exports. Client bodies
 * (`socrataGet`, `unavailable`, `FROZEN`, the four fetch functions) stay where they are.
 *
 * Free, no kill switch. `configured` names `SOCRATA_BASE_URL` so a blank env fails closed
 * at the dispatcher before a call is issued.
 */
import {
  fetchCensusByDot,
  searchCensusByName,
  type SocrataCensusResult,
  type SocrataCensusSearchResult,
} from '../socrataFmcsa.js';
import {
  fetchInsuranceByDot,
  fetchProcessAgentsByDot,
  type SocrataInsuranceResult,
  type SocrataProcessAgentResult,
} from '../socrataFmcsaFilings.js';
import { isSocrataConfigured } from '../socrataClient.js';
import type { FreeVendorDescriptor } from './types.js';

function socrataConfigured(): { ok: true } | { ok: false; missing: string } {
  return isSocrataConfigured() ? { ok: true } : { ok: false, missing: 'SOCRATA_BASE_URL' };
}

const free = { cost: 'free' as const, killSwitch: () => false, configured: socrataConfigured };

export const socrataCensus: FreeVendorDescriptor<{ dot: string }, SocrataCensusResult> = {
  ...free,
  id: 'socrata.census',
  call: ({ dot }) => fetchCensusByDot(dot),
};

export const socrataCensusName: FreeVendorDescriptor<
  { name: string; limit?: number },
  SocrataCensusSearchResult
> = {
  ...free,
  id: 'socrata.census.name',
  call: ({ name, limit }) =>
    limit === undefined ? searchCensusByName(name) : searchCensusByName(name, limit),
};

export const socrataInsurance: FreeVendorDescriptor<
  { dot: string; now?: Date },
  SocrataInsuranceResult
> = {
  ...free,
  id: 'socrata.insurance',
  call: ({ dot, now }) => (now === undefined ? fetchInsuranceByDot(dot) : fetchInsuranceByDot(dot, now)),
};

export const socrataProcessAgents: FreeVendorDescriptor<{ dot: string }, SocrataProcessAgentResult> =
  {
    ...free,
    id: 'socrata.process_agents',
    call: ({ dot }) => fetchProcessAgentsByDot(dot),
  };
