/**
 * Attachments inside the Full Details modal — list, preview, download, add, remove.
 *
 * The aside already previews and uploads; it cannot remove. This is the desk's complete file
 * surface. Preview uses `openDocument` (bytes, inline). Download uses the same bytes through
 * `deliverExport` so Telegram still gets a send rather than a dead `<a download>`.
 */
import { useState } from 'react';
import { Button, ConfirmDialog, EmptyState, Icon, Select } from '@/ds';
import {
  fetchDocumentBytes,
  openDocument,
  uploadDeskDocuments,
  type VerificationDeskDetail,
  type VerificationDocType,
  type VerificationDocument,
} from '@/api/verificationFlow';
import { deleteDeskDocument } from '@/api/verificationDeskWrites';
import { DOC_ACCEPT, DOC_ACCEPT_HINT, rejectionFor } from '../../_shared/verificationDocUpload';
import { deliverExport } from '@/lib/deliverExport';

const DOC_TYPES: ReadonlyArray<{ value: VerificationDocType; label: string }> = [
  { value: 'bank_statement', label: 'Bank statement' },
  { value: 'drivers_license', label: "Driver's licence" },
  { value: 'ssn_card', label: 'SSN card' },
  { value: 'lease_agreement', label: 'Lease agreement' },
  { value: 'corporate_guarantee', label: 'Corporate guarantee' },
  { value: 'insurance', label: 'Insurance certificate' },
  { value: 'authority', label: 'Operating authority' },
  { value: 'other', label: 'Something else' },
];

const DOC_LABEL: Record<string, string> = Object.fromEntries(
  DOC_TYPES.map((d) => [d.value, d.label]),
);

const DOC_TYPE_OPTIONS = DOC_TYPES.map((d) => ({ value: d.value, label: d.label }));

function sizeOf(bytes: number | null): string | null {
  if (bytes == null) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function shortDate(value: string | null): string | null {
  if (!value) return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function docName(doc: VerificationDocument): string {
  return doc.fileName ?? doc.label ?? DOC_LABEL[doc.docType] ?? 'Document';
}

export function CaseFullDetailsAttachments({
  caseId,
  documents,
  canEdit,
  onUpdated,
}: {
  caseId: string;
  documents: VerificationDocument[];
  canEdit: boolean;
  onUpdated: (next: VerificationDeskDetail) => void;
}) {
  const [attachType, setAttachType] = useState<VerificationDocType>('other');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VerificationDocument | null>(null);
  const received = documents.filter((d) => d.status === 'received').length;

  const run = async (id: string, fn: () => Promise<void>): Promise<void> => {
    setBusyId(id);
    setError(null);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'That file action could not be completed.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="va-full-attach">
      <div className="va-pane-head">
        <h3 className="t-eyebrow va-pane-kicker">Attachments</h3>
        <span className="va-pane-note">
          {documents.length === 0 ? 'None' : `${received} of ${documents.length} received`}
        </span>
      </div>

      {documents.length === 0 ? (
        <EmptyState
          size="panel"
          icon="draft"
          title="Nothing attached"
          description="Nothing from Sales, and no Plaid connection."
        />
      ) : (
        <ul className="va-full-docs">
          {documents.map((doc) => {
            const pending = doc.status !== 'received';
            const name = docName(doc);
            const meta = pending
              ? `Requested${shortDate(doc.requestedAt) ? ` ${shortDate(doc.requestedAt)}` : ''} · not received`
              : [DOC_LABEL[doc.docType] ?? doc.docType, sizeOf(doc.sizeBytes), shortDate(doc.createdAt)]
                  .filter(Boolean)
                  .join(' · ');
            const rowBusy = busyId === doc.id;
            return (
              <li key={doc.id} className="va-full-doc" data-pending={pending || undefined}>
                <span className="va-doc-glyph" aria-hidden="true">
                  <Icon name={pending ? 'schedule' : 'description'} size="sm" />
                </span>
                <span className="va-doc-text">
                  <span className="va-doc-name">{name}</span>
                  <span className="va-doc-meta">{meta}</span>
                </span>
                <span className="va-full-doc-actions">
                  {pending ? null : (
                    <>
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="visibility"
                        aria-label={`Preview ${name}`}
                        disabled={rowBusy}
                        onClick={() =>
                          void run(doc.id, () => openDocument('verification', caseId, doc.id, name))
                        }
                      />
                      <Button
                        variant="ghost"
                        size="sm"
                        icon="download"
                        aria-label={`Download ${name}`}
                        disabled={rowBusy}
                        onClick={() =>
                          void run(doc.id, async () => {
                            await deliverExport(
                              await fetchDocumentBytes('verification', caseId, doc.id),
                              name,
                            );
                          })
                        }
                      />
                    </>
                  )}
                  {canEdit ? (
                    <Button
                      variant="ghost"
                      size="sm"
                      icon="delete"
                      aria-label={`Remove ${name}`}
                      disabled={rowBusy}
                      onClick={() => setPendingDelete(doc)}
                    />
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      )}

      {canEdit ? (
        <div className="va-full-attach-add">
          <Select
            label="Attach as"
            size="sm"
            value={attachType}
            onChange={(v) => setAttachType((v ?? 'other') as VerificationDocType)}
            disabled={uploading}
            options={DOC_TYPE_OPTIONS}
          />
          <label className="va-doc-attach" data-disabled={uploading} data-busy={uploading || undefined}>
            <Icon name={uploading ? 'cloud_upload' : 'attach_file'} size="sm" />
            {uploading
              ? 'Uploading…'
              : attachType === 'other'
                ? 'Attach a file'
                : `Attach ${DOC_LABEL[attachType]?.toLowerCase() ?? 'a file'}`}
            <input
              type="file"
              accept={DOC_ACCEPT}
              disabled={uploading}
              onChange={(e) => {
                const file = e.target.files?.[0];
                e.target.value = '';
                if (!file) return;
                const refused = rejectionFor(file);
                if (refused) {
                  setError(refused);
                  return;
                }
                setUploading(true);
                setError(null);
                void uploadDeskDocuments(caseId, [file], { docType: attachType })
                  .then(onUpdated)
                  .catch((err: unknown) => {
                    setError(err instanceof Error ? err.message : 'Could not attach that file.');
                  })
                  .finally(() => setUploading(false));
              }}
            />
          </label>
          <p className="va-aside-note">{DOC_ACCEPT_HINT}</p>
        </div>
      ) : null}

      {error ? (
        <p className="va-aside-error" role="alert">
          <Icon name="error" size="sm" />
          <span>{error}</span>
        </p>
      ) : null}

      <ConfirmDialog
        open={pendingDelete !== null}
        tone="danger"
        title="Remove this file?"
        body={
          pendingDelete
            ? `Remove ${docName(pendingDelete)} from this case. This cannot be undone.`
            : ''
        }
        confirmLabel="Remove"
        confirming={busyId === pendingDelete?.id}
        onClose={() => setPendingDelete(null)}
        onConfirm={() => {
          const doc = pendingDelete;
          if (!doc) return;
          void run(doc.id, async () => {
            onUpdated(await deleteDeskDocument(caseId, doc.id));
            setPendingDelete(null);
          });
        }}
      />
    </section>
  );
}
