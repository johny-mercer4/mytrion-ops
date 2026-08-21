/**
 * Verification vendor descriptors. This file is the catalog — no route or service imports.
 *
 * Step 0 is the contract only. Free Octane vendors (Socrata, FMCSA, DWH) register in later
 * steps. Billable vendors (iSoftPull, Plaid, Highway) are NOT registered here: cost class,
 * kill switches, and wiring are a separate discussion.
 */
import type { VendorDescriptor } from './types.js';

export const VENDOR_REGISTRY: Readonly<Record<string, VendorDescriptor<unknown, unknown>>> = {};

export function getVendor(id: string): VendorDescriptor<unknown, unknown> | undefined {
  return VENDOR_REGISTRY[id];
}

export function registeredVendorIds(): string[] {
  return Object.keys(VENDOR_REGISTRY);
}
