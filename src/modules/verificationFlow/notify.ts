/**
 * Cross-department signals from the underwriting flow.
 *
 * One today, and it is not optional: the SOP's Phase 3 ends "Decline + Blacklist -> Inform
 * Collections Department". Blacklisting without telling Collections leaves the team that chases
 * money unaware that an applicant was refused for fraud, which is the one group that most needs to
 * know. Reuses `createInboxMessage`, the same seam retention's notifications use.
 *
 * Delivery is best-effort and never blocks the decision — a notification failure must not leave a
 * confirmed fraud case un-declined. It is logged instead.
 */
import { createInboxMessage } from '../inbox/service.js';
import { logger } from '../../lib/logger.js';
import type { TenantContext } from '../../types/tenantContext.js';

export const VERIFICATION_FLOW_INBOX_TAG = 'collection';

/**
 * Tell Collections an applicant was declined and blacklisted.
 *
 * `ownerZohoUserId` is empty on purpose: this is a DEPARTMENT signal, not a personal one, and the
 * inbox treats an unowned tagged message as belonging to the whole desk.
 */
export async function informCollectionsOfBlacklist(
  ctx: TenantContext,
  input: {
    caseId: string;
    applicantName: string;
    identifierCount: number;
    reason?: string | undefined;
    actorName?: string | undefined;
  },
): Promise<void> {
  const name = input.applicantName.trim() || `Application ${input.caseId}`;
  try {
    await createInboxMessage(ctx, {
      ownerZohoUserId: '',
      ownerName: 'Verification',
      subject: `Declined + blacklisted · ${name}`,
      name,
      content: [
        `Verification declined ${name} and added them to the Octane blacklist.`,
        input.reason ? `Reason: ${input.reason}` : null,
        `${input.identifierCount} identifier(s) are now screened against future applications.`,
        input.actorName ? `Decided by ${input.actorName}.` : null,
      ]
        .filter(Boolean)
        .join(' '),
      type: 'verification.case.blacklisted',
      priority: 'high',
      tag: VERIFICATION_FLOW_INBOX_TAG,
      sourceUrl: `/verification/flow/cases/${input.caseId}`,
      zohoRecordId: `vc:${input.caseId}`,
    });
  } catch (err) {
    logger.warn(
      { err, caseId: input.caseId },
      'could not inform Collections of a blacklist decision — the decline itself stands',
    );
  }
}
