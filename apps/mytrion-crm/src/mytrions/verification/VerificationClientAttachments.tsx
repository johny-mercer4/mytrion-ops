/**
 * Attachment tab on the existing-client modal. Files are keyed to this carrier id at upload —
 * the same Dropbox verification root the underwriting documents use, a different table so a
 * client with no verification case still has a place for files.
 *
 * Fetch starts when this tab mounts (Finance modal's per-tab rule). Upload keeps the list
 * visible; a first-load skeleton is the only loader.
 */
import { useEffect, useRef, useState } from 'react';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  deleteCarrierAttachment,
  getCarrierAttachmentDownloadUrl,
  listCarrierAttachments,
  uploadCarrierAttachment,
  type VerificationCarrierAttachment,
} from '../../api/verificationClients';
import { requestBlob } from '../../api/transport';
import { Button, ConfirmDialog } from '@/ds';
import { deliverExport } from '../../lib/deliverExport';
import { isTelegramWebView } from '../../telegram/webApp';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function VerificationClientAttachments({ carrierId }: { carrierId: string }) {
  const [rows, setRows] = useState<VerificationCarrierAttachment[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const [pendingDelete, setPendingDelete] = useState<VerificationCarrierAttachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  function refresh(): void {
    listCarrierAttachments(carrierId)
      .then((r) => {
        setRows(r.attachments);
        setError('');
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Failed to load attachments'));
  }

  useEffect(() => {
    let cancelled = false;
    setRows([]);
    setLoading(true);
    setError('');
    listCarrierAttachments(carrierId)
      .then((r) => {
        if (cancelled) return;
        setRows(r.attachments);
      })
      .catch((e) => {
        if (cancelled) return;
        setError(e instanceof Error ? e.message : 'Failed to load attachments');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [carrierId]);

  async function onFilesPicked(list: FileList | null): Promise<void> {
    if (!list?.length) return;
    setUploading(true);
    setError('');
    try {
      for (const file of Array.from(list)) {
        await uploadCarrierAttachment(carrierId, file);
      }
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onDownload(att: VerificationCarrierAttachment): Promise<void> {
    try {
      if (!isTelegramWebView()) {
        const { url } = await getCarrierAttachmentDownloadUrl(carrierId, att.id);
        window.open(url, '_blank', 'noopener');
        return;
      }
      const blob = await requestBlob(
        `/verification/roster/${encodeURIComponent(carrierId)}/attachments/${encodeURIComponent(att.id)}/bytes`,
      );
      await deliverExport(blob, att.fileName);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Download failed');
    }
  }

  async function remove(): Promise<void> {
    if (!pendingDelete) return;
    setDeleting(true);
    try {
      await deleteCarrierAttachment(carrierId, pendingDelete.id);
      setPendingDelete(null);
      refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="vf-attach">
      <div className="vf-attach-toolbar">
        <p className="vf-attach-hint">
          Files stay with carrier #{carrierId}. Upload a PDF, image, or any document.
        </p>
        <input
          ref={fileInput}
          type="file"
          multiple
          hidden
          onChange={(e) => void onFilesPicked(e.target.files)}
        />
        <Button
          variant="primary"
          size="sm"
          disabled={uploading}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} aria-hidden="true" />
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
      </div>

      {error ? (
        <p className="vf-banner-error" role="alert">
          {error}
        </p>
      ) : null}

      {loading && rows.length === 0 ? (
        <div className="vf-files" aria-busy="true" aria-label="Loading attachments">
          {Array.from({ length: 3 }, (_, i) => (
            <div key={i} className="vf-sk vf-sk-file" />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="vf-empty-inline">
          <Paperclip size={20} aria-hidden="true" />
          <p>No files attached to this carrier yet.</p>
        </div>
      ) : (
        <ul className="vf-files">
          {rows.map((a) => (
            <li key={a.id} className="vf-file">
              <span className="vf-file-name">{a.fileName}</span>
              <span className="vf-file-meta">
                {fmtBytes(a.sizeBytes)}
                {a.uploadedByName ? ` · ${a.uploadedByName}` : ''}
                {' · '}
                {new Date(a.createdAt).toLocaleDateString('en-US', {
                  month: 'short',
                  day: 'numeric',
                  year: 'numeric',
                })}
              </span>
              <div className="vf-file-actions">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => void onDownload(a)}
                >
                  <Download size={14} aria-hidden="true" />
                  Download
                </Button>
                <button
                  type="button"
                  className="vf-icon-btn"
                  aria-label={`Remove ${a.fileName}`}
                  onClick={() => setPendingDelete(a)}
                >
                  <Trash2 size={14} aria-hidden="true" />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {pendingDelete ? (
        <ConfirmDialog
          open
          tone="danger"
          title="Remove this file?"
          body={`"${pendingDelete.fileName}" will be permanently removed from carrier #${carrierId}.`}
          confirmLabel="Remove"
          confirming={deleting}
          onConfirm={() => void remove()}
          onClose={() => setPendingDelete(null)}
        />
      ) : null}
    </div>
  );
}
