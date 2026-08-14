/**
 * Verification kill-switches — the credit_platform desk is parked, not deleted.
 *
 * The new-era flow (`src/modules/verificationFlow/`) owns underwriting on Mytrion's own Postgres.
 * Everything that reached the external `credit_platform` Postgres and HTTP API is quarantined here:
 * logic stays in place, its tests stay green, and flipping a flag to `true` restores it.
 *
 * Deleting it was considered and rejected — 16 test files and 8 integration modules encode how that
 * system behaves, and that knowledge is worth more parked than lost. The frontend mirror of these
 * flags lives in `apps/mytrion-crm/src/mytrions/verification/legacyDesk.ts`; the two are read
 * independently, so both must be flipped to bring the old desk back.
 */

/**
 * The legacy Decision Desk surfaces: Inbox, Decision rules, Verification cases (credit-platform
 * mirror), stop-factors / strategies, and the Mytrion-owned first-run sequence.
 *
 * When false the routes answer 503 `VERIFICATION_LEGACY_DISABLED` rather than reaching a database
 * this deployment is no longer meant to touch.
 */
export const VERIFICATION_LEGACY_DESK_ENABLED = false;

/**
 * Zoho Deals → `verification_cases` ingest. Already parked in `DISABLED_JOB_QUEUES`; this states the
 * intent in code so the two cannot drift. Cases now originate in Sales.
 */
export const VERIFICATION_ZOHO_INGEST_ENABLED = false;

/**
 * Write-back into `kxd.sales_agent_*` on the credit_platform Postgres. Separate from the desk flag
 * because a read-only legacy desk is a coherent state to want; writing into a system we no longer
 * own is not.
 */
export const VERIFICATION_CP_WRITEBACK_ENABLED = false;
