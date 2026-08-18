import { createInboxMessage } from '../inbox/service.js';
import { errorMessage } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { publishInboxEvent } from '../realtime/hub.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { VERIFICATION_CASE_OWNER_NAME } from './verificationOwner.js';

export const VERIFICATION_INBOX_TAG = 'verification';

export const APPLICATION_DOCUMENTS_UPLOADED = 'verification.application.documents_uploaded';
export const APPLICATION_UPDATED = 'verification.application.updated';

/**
 * Live refresh for a Sales write — not an inbox MESSAGE.
 *
 * Attaching a file must not spam the desk. Same `verification` tag / `verification.*` type the
 * Verification inbox already listens for, published on the credit agent's topic plus the admin
 * firehose (`publishInboxEvent`). `detail` carries `caseId=` so an open case can ignore everyone
 * else's attach.
 */
export function publishVerificationApplicationEvent(input: {
  caseId: string;
  type: string;
  verificationOwnerZohoUserId?: string | null | undefined;
  title: string;
}): number {
  const now = new Date().toISOString();
  const ownerId = (input.verificationOwnerZohoUserId ?? '').trim() || 'verification';
  return publishInboxEvent({
    id: `vf:${input.caseId}:${input.type}:${now}`,
    type: input.type,
    tag: VERIFICATION_INBOX_TAG,
    ownerKind: 'worker',
    ownerId,
    title: input.title,
    detail: `caseId=${input.caseId}`,
    priority: 'low',
    readAt: null,
    createdAt: now,
    updatedAt: now,
  });
}

export interface ApplicationCreatedRecipients {
  caseId: string;
  /** The Deal owner in Zoho — the agent who has to complete intake. */
  salesOwnerZohoUserId: string | null | undefined;
  salesOwnerName?: string | null | undefined;
  /** The credit agent Stage-0 routing picked. Empty when none is configured — then nobody is told. */
  verificationOwnerZohoUserId: string;
  /** Their directory name, for the message's `ownerName`. Falls back to the configured constant. */
  verificationOwnerName?: string | null | undefined;
  companyName: string;
  zohoDealId: string;
}

/**
 * Announce a new application to BOTH desks.
 *
 * Two messages, not one: they are addressed to different people with different jobs, and the inbox
 * is per-owner. Sales is told what they owe; Verification is told what has arrived. Sending only
 * one would leave whichever desk was omitted discovering the application by chance.
 *
 * `zohoRecordId` is unique per tenant, so the two rows are suffixed by role. That uniqueness is
 * also the idempotency guard: a re-run of the poller cannot double-post either message.
 */
export async function notifyApplicationCreated(
  ctx: TenantContext,
  input: ApplicationCreatedRecipients,
): Promise<void> {
  const company = input.companyName.trim() || `Deal ${input.zohoDealId}`;
  const salesOwner = (input.salesOwnerZohoUserId ?? '').trim();
  const verificationOwner = input.verificationOwnerZohoUserId.trim();

  // Best-effort per recipient: failing to reach one inbox must not cost the other its message, and
  // neither is worth failing the ingest over — the application row already exists.
  const post = async (
    who: string,
    message: Parameters<typeof createInboxMessage>[1],
  ): Promise<void> => {
    try {
      await createInboxMessage(ctx, message);
    } catch (err) {
      logger.warn(
        { err: errorMessage(err), who, caseId: input.caseId, dealId: input.zohoDealId },
        'verification application inbox notify failed',
      );
    }
  };

  if (salesOwner) {
    await post('sales', {
      ownerZohoUserId: salesOwner,
      ownerName: (input.salesOwnerName ?? '').trim() || company,
      subject: `Application to complete · ${company}`,
      name: company,
      content:
        `An application was created from Zoho Deal ${input.zohoDealId}. ` +
        'Verification cannot start until the intake details and documents are filled in.',
      type: 'verification.application.awaiting_intake',
      priority: 'medium',
      tag: VERIFICATION_INBOX_TAG,
      sourceUrl: `/sales/verification/${input.caseId}`,
      zohoRecordId: `vc:${input.caseId}:sales`,
    });
  } else {
    // No Deal owner means no Sales agent to tell. Said out loud rather than silently halved.
    logger.warn(
      { caseId: input.caseId, dealId: input.zohoDealId },
      'verification application has no Deal owner — only the Verification desk was notified',
    );
  }

  // The desk is told even while the case is red: "what is coming" is worth knowing before it is
  // workable, and it is how an unowned application gets noticed at all.
  if (verificationOwner && verificationOwner !== salesOwner) {
    await post('verification', {
      ownerZohoUserId: verificationOwner,
      // The agent the rotation actually picked. The constant is only the fallback for when the
      // directory could not name them — it used to be the answer for every case, because every case
      // went to the same person.
      ownerName: (input.verificationOwnerName ?? '').trim() || VERIFICATION_CASE_OWNER_NAME,
      subject: `New application · ${company}`,
      name: company,
      content: salesOwner
        ? `Created from Zoho Deal ${input.zohoDealId}. Waiting on Sales to complete intake before underwriting can begin.`
        : `Created from Zoho Deal ${input.zohoDealId}. The Deal has NO owner in Zoho, so no Sales agent has been asked to complete intake.`,
      type: 'verification.application.created',
      priority: salesOwner ? 'medium' : 'high',
      tag: VERIFICATION_INBOX_TAG,
      sourceUrl: `/verification/applicants/${input.caseId}`,
      zohoRecordId: `vc:${input.caseId}:verification`,
    });
  }
}

export async function notifyVerificationCaseCreated(
  ctx: TenantContext,
  input: {
    caseId: string;
    ownerZohoUserId: string;
    companyName: string;
    zohoDealId: string;
  },
): Promise<void> {
  const company = input.companyName.trim() || `Deal ${input.zohoDealId}`;
  await createInboxMessage(ctx, {
    ownerZohoUserId: input.ownerZohoUserId,
    ownerName: VERIFICATION_CASE_OWNER_NAME,
    subject: `New verification case · ${company}`,
    name: company,
    content: `A new verification case was ingested from Zoho Deal ${input.zohoDealId}.`,
    type: 'verification.case.created',
    priority: 'medium',
    tag: VERIFICATION_INBOX_TAG,
    sourceUrl: `/verification/cases/${input.caseId}`,
    zohoRecordId: `vc:${input.caseId}`,
  });
}
