/**
 * Data Center → first-party iSoftPull pull. View-only: the CRM never writes Phase 6 findings.
 */
import { request } from './transport';

export type IsoftpullBureau = 'equifax' | 'transunion' | 'experian';

export interface IsoftpullPullInput {
  confirm: true;
  bureau: IsoftpullBureau;
  firstName: string;
  lastName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  ssn?: string;
  dateOfBirth?: string;
}

export interface IsoftpullPullResult {
  available: boolean;
  error: string | null;
  reason: string | null;
  data: {
    bureau: IsoftpullBureau;
    httpStatus: number;
    payload: Record<string, unknown>;
  } | null;
}

export async function pullIsoftPull(body: IsoftpullPullInput): Promise<IsoftpullPullResult> {
  return (await request('POST', '/verification/flow/isoftpull/pull', { body })) as IsoftpullPullResult;
}
