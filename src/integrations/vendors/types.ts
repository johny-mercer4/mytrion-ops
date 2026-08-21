/**
 * Verification vendor registry contract.
 *
 * Envelope: `available: false` is NEVER an empty success — it is a failed read, with a reason.
 * A successful empty answer (e.g. "not in the register") is `available: true` with empty `data`.
 *
 * SpendAuthorisation is opaque. Only `authoriseSpend` in `./spend.ts` may mint one. Metered
 * descriptors require it at the `runVendor` call site (compile gate); there is no spend ceiling
 * in this step — that is a separate discussion.
 */
export type { SpendAuthorisation } from './spend.js';

export const VENDOR_UNAVAILABLE_REASONS = [
  'not_configured',
  'killed',
  'not_implemented',
  'unauthorised_spend',
  'timeout',
  'remote_error',
] as const;
export type VendorUnavailableReason = (typeof VENDOR_UNAVAILABLE_REASONS)[number];

export type CostClass = 'free' | 'metered';

export type VendorResult<T> =
  | { available: true; error: null; reason: null; data: T }
  | { available: false; error: string; reason: VendorUnavailableReason; data: null };

/** `missing` is the env var name the next reviewer should look for. */
export type VendorConfigured = { ok: true } | { ok: false; missing: string };

export type VendorCall<TArgs, TData> = (args: TArgs) => Promise<TData>;

interface VendorDescriptorBase<TArgs, TData> {
  id: string;
  /** `true` = killed. Checked first. */
  killSwitch: () => boolean;
  configured: () => VendorConfigured;
  call: VendorCall<TArgs, TData> | null;
}

export interface FreeVendorDescriptor<TArgs, TData> extends VendorDescriptorBase<TArgs, TData> {
  cost: 'free';
  auditAction?: string;
}

/** Metered placements require `auditAction` and a `SpendAuthorisation` at the call site. */
export interface MeteredVendorDescriptor<TArgs, TData> extends VendorDescriptorBase<TArgs, TData> {
  cost: 'metered';
  auditAction: string;
}

export type VendorDescriptor<TArgs, TData> =
  | FreeVendorDescriptor<TArgs, TData>
  | MeteredVendorDescriptor<TArgs, TData>;
