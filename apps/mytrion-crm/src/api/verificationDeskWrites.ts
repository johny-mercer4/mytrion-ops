/**
 * Verification-desk writes that live next to `verificationFlow` without growing that file.
 * Same `/verification/flow/cases` door — not the Sales `/verification/applications` routes.
 */
import { request } from './transport';
import type { VerificationDeskDetail } from './verificationFlow';

export interface BrokerSnapshotMatch {
  matchedOn: 'phone' | 'dot' | 'email';
  dotNumber: string | null;
  ownerFullName: string | null;
  physicalAddress: string | null;
  phoneNumber: string | null;
  email: string | null;
  powerUnits: number | null;
  truckSize: number | null;
  operatingStatus: string | null;
  authorityAddedOn: string | null;
}

export async function getDeskBrokerSnapshot(
  id: string,
): Promise<{ match: BrokerSnapshotMatch | null }> {
  return (await request('GET', `/verification/flow/cases/${id}/snapshot`)) as {
    match: BrokerSnapshotMatch | null;
  };
}

/**
 * Phase 4's register lookup. POST because it spends an outbound call and writes the phase findings.
 *
 * Returns the whole detail, like every other desk write — `CaseView.run` replaces the detail wholesale.
 */
export async function runAuthorityLookup(id: string): Promise<VerificationDeskDetail> {
  return (await request(
    'POST',
    `/verification/flow/cases/${id}/authority/run`,
  )) as VerificationDeskDetail;
}

/**
 * Phase 8 — the Highway operational review, typed by hand.
 *
 * Lands on the phase's own `findings`, which is where the underwriting summary already looks for its
 * "Highway findings" line. No table, because that column is already the summary's source.
 */
export async function saveHighwayReview(
  id: string,
  body: Record<string, unknown>,
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/highway-review`, {
    body,
  })) as VerificationDeskDetail;
}

export async function addDeskPrincipal(
  id: string,
  body: { fullName: string },
): Promise<VerificationDeskDetail> {
  return (await request('POST', `/verification/flow/cases/${id}/principals`, {
    body,
  })) as VerificationDeskDetail;
}

export async function removeDeskPrincipal(
  id: string,
  principalId: string,
): Promise<VerificationDeskDetail> {
  return (await request(
    'DELETE',
    `/verification/flow/cases/${id}/principals/${principalId}`,
  )) as VerificationDeskDetail;
}
