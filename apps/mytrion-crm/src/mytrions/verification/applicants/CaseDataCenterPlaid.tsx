/**
 * Data Center Plaid — sandbox Link-token mint. Not a billed Check /get.
 */
import { useState, type FormEvent } from 'react';
import { Button, Input } from '@/ds';
import { createPlaidLinkToken, type PlaidLinkTokenResult } from '@/api/verificationPlaid';
import { flattenVendorPayload } from './caseDataCenterModel';
import { ExpandRow } from './CaseDataCenterBlacklist';
import { ResultsSkeleton } from './CaseDataCenterVendors';

export function PlaidPanel() {
  const [clientUserId, setClientUserId] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<PlaidLinkTokenResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    void createPlaidLinkToken(clientUserId.trim() ? { clientUserId: clientUserId.trim() } : {})
      .then(setResult)
      .catch((err: unknown) => {
        setResult(null);
        setError(err instanceof Error ? err.message : 'Plaid did not answer.');
      })
      .finally(() => setBusy(false));
  };

  const line = error ?? (result && !result.available ? result.error ?? 'Plaid did not answer.' : null);
  const data = result?.available ? result.data : null;

  return (
    <div className="va-dc-panel">
      <p className="va-dc-meta">Sandbox Link token. Not a Check /get — that billed path is not shipped.</p>
      <form className="va-dc-vendor" onSubmit={submit}>
        <label className="va-dc-field">
          <span className="va-dc-field-label">Client user id</span>
          <Input
            value={clientUserId}
            onChange={(e) => setClientUserId(e.currentTarget.value)}
            aria-label="Client user id"
            message="Optional. A test id is minted when blank."
            autoComplete="off"
            fullWidth
          />
        </label>
        <Button type="submit" variant="primary" loading={busy}>
          Mint Link token
        </Button>
      </form>
      {line ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {line}
        </p>
      ) : null}
      {busy && result === null ? <ResultsSkeleton label="Minting Link token" /> : null}
      {data ? (
        <div className="va-dc-list">
          <ExpandRow
            title="Link token"
            facts={[data.env, data.expiration]}
            badge="Not billed"
            badgeIntent="neutral"
            details={flattenVendorPayload({
              link_token: data.linkToken,
              expiration: data.expiration,
              hosted_link_url: data.hostedLinkUrl,
              request_id: data.requestId,
              ...data.payload,
            })}
          />
        </div>
      ) : null}
    </div>
  );
}
