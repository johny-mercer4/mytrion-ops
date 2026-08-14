import { createInboxMessage } from '../inbox/service.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { VERIFICATION_CASE_OWNER_NAME } from './verificationOwner.js';

export const VERIFICATION_INBOX_TAG = 'verification';

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
