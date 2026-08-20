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
 * Zoho Deals → `verification_cases` ingest.
 *
 * ON, and it is now the ONLY way an application comes into existence — neither desk hand-creates
 * one. The poller writes the new-era shared record (`verificationFlow/dealIntake.ts`), not the
 * credit_platform mirror it used to; the legacy steps were removed from that path rather than
 * flagged, because they belong to the quarantined desk above.
 */
export const VERIFICATION_ZOHO_INGEST_ENABLED = true;

/**
 * Write-back into `kxd.sales_agent_*` on the credit_platform Postgres. Separate from the desk flag
 * because a read-only legacy desk is a coherent state to want; writing into a system we no longer
 * own is not.
 */
export const VERIFICATION_CP_WRITEBACK_ENABLED = false;

/**
 * Write-back of CONFIRMED BANS into `public.blacklist_entries` on the credit_platform Postgres.
 *
 * SEPARATE from the switch above, and on, because it is not the same concern. That one governs the
 * legacy Decision Desk's `kxd.sales_agent_*` inbox — a system we no longer own. This governs the
 * shared ban list that OUR OWN Check A reads on every applicant: the credit-platform team confirmed
 * nothing over there writes back to it on decline, so a Decline + Blacklist that stops at our table
 * bans the applicant on this desk and nowhere else. They come back through any other door.
 *
 * Still subject to the VERIFICATION_WRITE_ENABLED master switch, and insert-only with
 * `on conflict do nothing` — this never edits or removes a ban somebody else added.
 */
export const VERIFICATION_BAN_WRITEBACK_ENABLED = true;
