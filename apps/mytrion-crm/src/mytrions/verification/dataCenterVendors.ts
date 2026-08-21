/**
 * Frontend mirror of `VERIFICATION_DATA_CENTER_VENDORS_ENABLED`.
 *
 * When false the Data Center source list omits iSoftPull / Plaid / Highway. The API
 * kill is the boundary — this hide is so the UI cannot offer a billed or vendor tab.
 * Both must be flipped to restore those three sources.
 */
export const DATA_CENTER_PAID_VENDORS_ENABLED = false;
