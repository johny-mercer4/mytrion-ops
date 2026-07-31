/**
 * Attachments tab — the CRM has this on every record (invoices, etc.); the Postgres-backed
 * Maintenance case didn't (CS feedback 2026-07-31). Upload + list + download; no delete, matching
 * the CRM reference for this feature.
 */
import { useEffect, useRef, useState } from 'react';

import {
  getMaintenanceAttachmentDownloadUrl,
  listMaintenanceAttachments,
  uploadMaintenanceAttachment,
  type MaintenanceAttachment,
} from '@/api/cs';

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
            <button
              key={a.id}
              type="button"
              onClick={() => onDownload(a)}
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                width: '100%',
                textAlign: 'left',
                padding: '0.6rem 0.8rem',
                border: '1px solid var(--check-border)',
                borderRadius: '8px',
                background: 'transparent',
                cursor: 'pointer',
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
          ))}
        </div>
      )}
    </div>
  );
}
