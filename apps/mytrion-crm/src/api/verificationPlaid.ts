/**
 * Data Center → Plaid Link-token mint. Not a Check /get. View-only.
 */
import { request } from './transport';

export interface PlaidLinkTokenResult {
  available: boolean;
  error: string | null;
  reason: string | null;
  data: {
    env: 'sandbox' | 'development' | 'production';
    billed: false;
    product: 'link_token';
    linkToken: string | null;
    expiration: string | null;
    hostedLinkUrl: string | null;
    requestId: string | null;
    payload: Record<string, unknown>;
  } | null;
}

export async function createPlaidLinkToken(body: { clientUserId?: string } = {}): Promise<PlaidLinkTokenResult> {
  return (await request('POST', '/verification/flow/plaid/link-token', { body })) as PlaidLinkTokenResult;
}
