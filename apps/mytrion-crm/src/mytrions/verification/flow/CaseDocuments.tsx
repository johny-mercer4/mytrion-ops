/**
 * The files Sales attached, on the Verification desk.
 *
 * The desk could previously see that three bank statements existed and had no way to open one — the
 * bytes went to Dropbox and were unreachable from the product. Every phase from 2 onward is a
 * cross-check against these documents, so this is the underwriting job, not a convenience.
 *
 * Requested-but-not-uploaded rows are shown too, greyed: "what am I still waiting on" is the other
 * half of the same question.
 */
import { useState } from 'react';
import { Download, FileText, Loader2 } from 'lucide-react';
import { openDocument, type VerificationDocument } from '@/api/verificationFlow';

const DOC_LABEL: Record<string, string> = {
  drivers_license: "Driver's licence",
  ssn_card: 'SSN card',
  bank_statement: 'Bank statement',
  lease_agreement: 'Lease agreement',
  corporate_guarantee: 'Corporate guarantee',
  insurance: 'Insurance',
  authority: 'Authority',
  other: 'Other',
};

function sizeOf(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CaseDocuments({
  caseId,
  documents,
}: {
  caseId: string;
  documents: VerificationDocument[];
}) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const received = documents.filter((d) => d.status === 'received');
  const outstanding = documents.filter((d) => d.status === 'requested');

  async function open(id: string): Promise<void> {
    setBusyId(id);
    setError(null);
    try {
      await openDocument('verification', caseId, id);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not open that document.');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section className="vfx-pane">
      <div className="vfx-pane-head">
        <h3 className="vfx-pane-title">Documents from Sales</h3>
        <p className="vfx-pane-sub">
          {received.length === 0
            ? 'Nothing uploaded yet.'
            : `${received.length} file${received.length === 1 ? '' : 's'} on file.`}
          {outstanding.length > 0 ? ` ${outstanding.length} still requested.` : ''}
        </p>
      </div>

      {error ? (
        <div className="vfx-banner" data-tone="bad" role="alert">
          <span className="vfx-banner-title">Could not open the document</span>
          <p className="vfx-banner-body">{error}</p>
        </div>
      ) : null}

      {documents.length === 0 ? (
        <p className="vfx-pane-sub">No documents have been attached or requested.</p>
      ) : (
        <ul className="vfx-docs">
          {received.map((d) => (
            <li key={d.id}>
              <button
                type="button"
                className="vfx-doc"
                disabled={busyId === d.id}
                onClick={() => void open(d.id)}
                aria-label={`Open ${d.fileName ?? DOC_LABEL[d.docType] ?? d.docType}`}
              >
                <FileText size={15} aria-hidden />
                <span className="vfx-doc-name">{d.fileName ?? DOC_LABEL[d.docType] ?? d.docType}</span>
                <span className="vfx-doc-meta">
                  {DOC_LABEL[d.docType] ?? d.docType}
                  {d.sizeBytes ? ` · ${sizeOf(d.sizeBytes)}` : ''}
                  {d.uploadedByName ? ` · ${d.uploadedByName}` : ''}
                </span>
                {busyId === d.id ? (
                  <Loader2 size={14} className="vfx-doc-spin" aria-hidden />
                ) : (
                  <Download size={14} aria-hidden />
                )}
              </button>
            </li>
          ))}

          {outstanding.map((d) => (
            <li key={d.id}>
              <div className="vfx-doc" data-pending="true">
                <FileText size={15} aria-hidden />
                <span className="vfx-doc-name">{d.label ?? DOC_LABEL[d.docType] ?? d.docType}</span>
                <span className="vfx-doc-meta">
                  Requested{d.requestedInPhase ? ` at ${d.requestedInPhase.replace(/^p(\d+)_.*/, 'phase $1')}` : ''} — waiting on Sales
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
