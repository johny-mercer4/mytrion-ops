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
