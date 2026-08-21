/**
 * Verification vendor descriptors. This file is the catalog — no route or service imports.
 *
 * Step 1 registers the four free Socrata lookups. FMCSA and DWH land later. Billable vendors
 * (iSoftPull, Plaid, Highway) are NOT registered here: cost class and wiring are a separate
 * discussion.
 */
import {
  socrataCensus,
  socrataCensusName,
  socrataInsurance,
  socrataProcessAgents,
} from './socrata.js';

export const VENDOR_REGISTRY = {
  'socrata.census': socrataCensus,
  'socrata.census.name': socrataCensusName,
  'socrata.insurance': socrataInsurance,
  'socrata.process_agents': socrataProcessAgents,
} as const;

export type RegisteredVendorId = keyof typeof VENDOR_REGISTRY;

export function getVendor(id: string): (typeof VENDOR_REGISTRY)[RegisteredVendorId] | undefined {
  if (Object.prototype.hasOwnProperty.call(VENDOR_REGISTRY, id)) {
    return VENDOR_REGISTRY[id as RegisteredVendorId];
  }
  return undefined;
}

export function registeredVendorIds(): RegisteredVendorId[] {
  return Object.keys(VENDOR_REGISTRY) as RegisteredVendorId[];
}
