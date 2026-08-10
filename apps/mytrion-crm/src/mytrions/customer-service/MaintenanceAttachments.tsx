/**
 * Attachments tab — the CRM has this on every record (invoices, etc.); the Postgres-backed
 * Maintenance case didn't (CS feedback 2026-07-31). Upload + list + download + remove — unlike the
 * case itself, a single file carries no accounting weight, so removing one is a real delete, not a
 * status change.
 */
import { useEffect, useRef, useState } from 'react';

import {
  deleteMaintenanceAttachment,
  getMaintenanceAttachmentDownloadUrl,
  listMaintenanceAttachments,
  uploadMaintenanceAttachment,
  type MaintenanceAttachment,
} from '@/api/cs';
import { ConfirmDialog } from '@/ds';

const TRASH_PATH =
  'M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function MaintenanceAttachments({ caseId }: { caseId: string }) {
  const [rows, setRows] = useState<MaintenanceAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<MaintenanceAttachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function load() {
    setLoading(true);
    listMaintenanceAttachments(caseId)
      .then((r) => setRows(r.attachments))
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load attachments'))
      .finally(() => setLoading(false));
  }

  useEffect(load, [caseId]);

  async function onFilePicked(file: File | undefined) {
    if (!file) return;
    setUploading(true);
    setError('');
    try {
      await uploadMaintenanceAttachment(caseId, file);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onDownload(att: MaintenanceAttachment) {
    try {
      const { url } = await getMaintenanceAttachmentDownloadUrl(caseId, att.id);
      window.open(url, '_blank', 'noopener');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  async function remove() {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteMaintenanceAttachment(caseId, pendingDelete.id);
      setPendingDelete(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      {error ? <div className="cs-form-error">{error}</div> : null}

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '0.75rem' }}>
        <input
          ref={fileInput}
          type="file"
          style={{ display: 'none' }}
          onChange={(e) => onFilePicked(e.target.files?.[0])}
        />
        <button
          type="button"
          className="cs-btn cs-btn-primary"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          {uploading ? 'Uploading…' : 'Add'}
        </button>
      </div>

      {loading ? (
        <div className="cs-home-empty">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="cs-home-empty">No attachments yet</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          {rows.map((a) => (
            <div
              key={a.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.6rem 0.8rem',
                border: '1px solid var(--check-border)',
                borderRadius: '8px',
              }}
            >
              <button
                type="button"
                onClick={() => onDownload(a)}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  flex: 1,
                  minWidth: 0,
                  textAlign: 'left',
                  border: 'none',
                  background: 'transparent',
                  cursor: 'pointer',
                  padding: 0,
                }}
              >
                <span>
                  <div style={{ fontWeight: 600 }}>{a.fileName}</div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
                    {fmtBytes(a.sizeBytes)} · {a.uploadedByName || 'Unknown'} ·{' '}
                    {new Date(a.createdAt).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      year: 'numeric',
                    })}
                  </div>
                </span>
                <span style={{ color: 'var(--cs-sky)', fontSize: '0.85rem' }}>Download</span>
              </button>
              <button
                type="button"
                aria-label={`Remove ${a.fileName}`}
                onClick={() => setPendingDelete(a)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  border: 'none',
                  background: 'transparent',
                  color: 'var(--text-muted)',
                  cursor: 'pointer',
                  padding: '0.3rem',
                }}
              >
                <svg width="15" height="15" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={TRASH_PATH} />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          open
          tone="danger"
          title="Remove this attachment?"
          body={`"${pendingDelete.fileName}" will be permanently removed from this case.`}
          confirmLabel="Remove"
          confirming={deleting}
          onConfirm={remove}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
