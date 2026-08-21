/**
 * Metered iSoftPull placement. One bureau per approved call. Live HTTP is killed unless
 * VERIFICATION_PAID_VENDORS_ENABLED or ISOFTPULL_LIVE_ENABLED is on.
 */
import {
  isoftpullConfiguredMissing,
  isoftpullLiveEnabled,
  pullIsoftPullReport,
  type IsoftpullPullArgs,
  type IsoftpullPullData,
} from '../isoftpullClient.js';
import type { MeteredVendorDescriptor } from './types.js';

export const isoftpull: MeteredVendorDescriptor<IsoftpullPullArgs, IsoftpullPullData> = {
  id: 'isoftpull',
  cost: 'metered',
  auditAction: 'verification.vendor.isoftpull',
  killSwitch: () => !isoftpullLiveEnabled(),
  configured: () => {
    const missing = isoftpullConfiguredMissing();
    return missing ? { ok: false, missing } : { ok: true };
  },
  call: (args) => pullIsoftPullReport(args),
};
