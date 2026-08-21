/**
 * Data Center Highway — upload a saved page and parse it here. No scrape, no spend.
 */
import { useState, type FormEvent } from 'react';
import { Button } from '@/ds';
import { parseHighwayFile, type HighwayParseResult } from '@/api/verificationHighway';
import { flattenVendorPayload } from './caseDataCenterModel';
import { ExpandRow } from './CaseDataCenterBlacklist';
import { ResultsSkeleton } from './CaseDataCenterVendors';

export function HighwayPanel() {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<HighwayParseResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = (event: FormEvent): void => {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError(null);
    void parseHighwayFile(file)
      .then(setResult)
      .catch((err: unknown) => {
        setResult(null);
        setError(err instanceof Error ? err.message : 'Parse did not finish.');
      })
      .finally(() => setBusy(false));
  };

  return (
    <div className="va-dc-panel">
      <p className="va-dc-meta">Upload a saved Highway page (HTML). PDF text extract is not ported — save as HTML. No highway.com scrape.</p>
      <form className="va-dc-vendor" onSubmit={submit}>
        <label className="va-dc-field">
          <span className="va-dc-field-label">Highway file</span>
          <input
            className="va-dc-file"
            type="file"
            accept=".html,.htm,text/html,.pdf,application/pdf"
            aria-label="Highway file"
            onChange={(event) => setFile(event.currentTarget.files?.[0] ?? null)}
          />
        </label>
        <Button type="submit" variant="primary" loading={busy} disabled={!file}>
          Parse
        </Button>
      </form>
      {error ? (
        <p className="va-dc-status" data-tone="danger" role="alert">
          {error}
        </p>
      ) : null}
      {result?.pdfNoText ? (
        <p className="va-dc-status" role="status">
          PDF text extract is not ported. Save the Highway page as HTML and upload that.
        </p>
      ) : null}
      {busy && result === null ? <ResultsSkeleton label="Parsing Highway" /> : null}
      {result && !result.pdfNoText ? (
        <div className="va-dc-list">
          <ExpandRow
            title={typeof result.fields.carrier_name === 'string' ? result.fields.carrier_name : 'Highway extract'}
            facts={[
              typeof result.fields.dot_number === 'string' ? `USDOT ${result.fields.dot_number}` : null,
              typeof result.fields.mc_number === 'string' ? `MC ${result.fields.mc_number}` : null,
              `${result.blockCount} blocks`,
            ]}
            details={flattenVendorPayload(result.fields)}
          />
        </div>
      ) : null}
    </div>
  );
}
