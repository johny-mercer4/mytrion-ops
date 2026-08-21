/**
 * Verification vendor descriptors. This file is the catalog — no route or service imports.
 *
 * Free Socrata lookups stay unpaid. `isoftpull` is the first metered placement — its `call` is
 * real and spend-gated. Plaid Link-token mint is unpaid and is not registered. Highway is an
 * HTML parse with no vendor HTTP, so it is not registered. Plaid `/get` stays off this list
 * until a session table exists.
 */
import { isoftpull } from './isoftpull.js';
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
  isoftpull,
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
