/**
 * WHO THE SALES AGENT IS on a verification case. One definition, for both desks.
 *
 * A `verification_cases` row carries TWO owners and they are not the same person:
 *
 *   `zoho_owner_id` / `zoho_owner_name`   the DEAL's owner in Zoho — the Sales agent. Null when
 *                                         nobody owns the Deal.
 *   `owner_zoho_user_id` / `owner_name`   the row's ASSIGNEE. `createApplicationFromDeal` falls back
 *                                         to the Verification case owner
 *                                         (`VERIFICATION_CASE_OWNER_NAME`, a credit agent) whenever a
 *                                         Deal arrives unowned, so this names somebody who has never
 *                                         worked in Sales on those rows.
 *
 * Reading the assignee as "the Sales owner" is the bug this module exists to end: on live data three
 * of twenty-three cases attribute the case to the Verification desk's own agent, and the desk would
 * chase the wrong person for intake it does not owe.
 *
 * It lives in `_shared` because BOTH Mytrions need it — the Verification desk names the agent it is
 * waiting on, and the Sales tab names the owner when a case reached an agent through someone else's
 * Deal — and neither Mytrion may import from the other.
 *
 * A null owner is reported, never papered over. `zohoDealIngest` already logs it loudly, because an
 * unowned Deal produces an application nobody in Sales will ever see; showing the assignee's name
 * instead would hide exactly that.
 */

/** The columns this reads. A structural type, so both `VerificationCaseRow` and a case detail fit. */
export interface HasSalesOwner {
  zohoOwnerId?: string | null;
  zohoOwnerName?: string | null;
  ownerZohoUserId?: string | null;
  ownerName?: string | null;
}

export const UNASSIGNED_SALES_OWNER = 'Unassigned in Zoho';

/** The Sales agent's name, or null when Zoho has nobody on the Deal. */
export function salesOwnerName(row: HasSalesOwner): string | null {
  return row.zohoOwnerName?.trim() || null;
}

/** The Sales agent's Zoho id, or null. What owner-scoped comparisons must use. */
export function salesOwnerId(row: HasSalesOwner): string | null {
  return row.zohoOwnerId?.trim() || null;
}

/** The Sales agent as a label — the name, or the honest absence of one. */
export function salesOwnerLabel(row: HasSalesOwner): string {
  return salesOwnerName(row) ?? UNASSIGNED_SALES_OWNER;
}

/**
 * The VERIFICATION agent on a case — the credit agent, never a Sales name.
 *
 * TWO sources, in order, because nothing in the schema records a per-case underwriter:
 *
 *   1. the row's assignee, but ONLY when it is somebody other than the Sales agent. `owner_*` holds
 *      a credit agent only as the ingest fallback — when a Deal arrives unowned, the row goes to
 *      `VERIFICATION_CASE_OWNER_NAME` instead. When the Deal has an owner, `owner_*` merely mirrors
 *      it, so returning it there would print a Sales agent under a Verification heading: the same
 *      misattribution as reading `owner_name` for the Sales owner, pointing the other way. Matched on
 *      both id and name, so one of the two being absent cannot leak the name through.
 *
 *   2. `deskOwner` — the tenant's configured Verification agent, from the policy payload. This is the
 *      answer for almost every case, and it is not a guess: that agent is notified about every
 *      application and is who an unowned Deal falls back to. `decided_by` is unwritten on every case
 *      and all 210 phase rows, case events carry no actor, `cp_owner_username` is null and
 *      `distribute_type` is `shared` — there is no finer-grained truth to read yet. When per-phase
 *      deciders start being recorded, THAT becomes source 1 and this is the one place to change.
 *
 * Null only when the desk owner has not loaded or could not be resolved. Callers render nothing then,
 * rather than a placeholder word: "Desk pool" under a Sales agent's name read as if it described HIM.
 */
export function verificationOwnerName(row: HasSalesOwner, deskOwner: string | null): string | null {
  const assignee = row.ownerName?.trim();
  const assigneeId = row.ownerZohoUserId?.trim() || null;
  const dealId = salesOwnerId(row);
  const mirrorsSales =
    (assigneeId != null && dealId != null && assigneeId === dealId) ||
    (assignee != null && assignee === salesOwnerName(row));
  if (assignee && !mirrorsSales) return assignee;
  return deskOwner?.trim() || null;
}
