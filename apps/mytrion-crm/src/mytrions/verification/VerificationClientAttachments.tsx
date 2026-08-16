/**
 * Attachment tab on the existing-client modal. Files are keyed to this carrier id at upload —
 * the same Dropbox verification root the underwriting documents use, a different table so a
 * client with no verification case still has a place for files.
 *
 * Fetch is owned by the parent (`useCarrierAttachments`, enabled only on this tab). The SWR
 * cache makes a return visit instant — no remount skeleton. An unmigrated table is an
 * unavailable empty, not a "run migrate" panic.
 */
import { useRef, useState } from 'react';
import { Download, Paperclip, Trash2, Upload } from 'lucide-react';
import {
  deleteCarrierAttachment,
  getCarrierAttachmentDownloadUrl,
  uploadCarrierAttachment,
  type VerificationCarrierAttachment,
} from '../../api/verificationClients';
import { requestBlob } from '../../api/transport';
import { Button, ConfirmDialog } from '@/ds';
import { openSignedFile } from '../../lib/openSignedFile';
import { deliverExport } from '../../lib/deliverExport';
import { isTelegramWebView } from '../../telegram/webApp';
import { invalidateSwrCache, type CachedLoad } from '../_shared/swrCache';
import { attachmentsCacheKey, type CarrierAttachmentsLoad } from './verificationData';

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function VerificationClientAttachments({
  carrierId,
  load,
}: {
  carrierId: string;
  load: CachedLoad<CarrierAttachmentsLoad>;
}) {
  const [uploading, setUploading] = useState(false);
  const [actionError, setActionError] = useState('');
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<VerificationCarrierAttachment | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const unavailable = load.data?.status === 'unavailable';
  const rows = load.data?.status === 'ok' ? load.data.attachments : [];
  const canUpload = !unavailable && !uploading;

  function refresh(): void {
    invalidateSwrCache(attachmentsCacheKey(carrierId));
    load.reload();
  }

  async function onFilesPicked(list: FileList | null): Promise<void> {
    if (!list?.length || !canUpload) return;
    setUploading(true);
    setActionError('');
    try {
      for (const file of Array.from(list)) {
        await uploadCarrierAttachment(carrierId, file);
      }
      refresh();
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Upload failed');
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  }

  async function onDownload(att: VerificationCarrierAttachment): Promise<void> {
    setActionError('');
    setOpeningId(att.id);
    try {
      /**
       * The tab is claimed inside `openSignedFile` BEFORE the link request goes out. This used to
       * be `await getCarrierAttachmentDownloadUrl(...)` and then `window.open(url)`, which Safari
       * and Firefox discard because the popup is no longer attributable to the click — the file
       * opened in Chrome and silently did nothing elsewhere.
       */
      await openSignedFile(
        async () => (await getCarrierAttachmentDownloadUrl(carrierId, att.id)).url,
        {
          shouldUseFallback: isTelegramWebView,
          fallback: async () => {
            const blob = await requestBlob(
              `/verification/roster/${encodeURIComponent(carrierId)}/attachments/${encodeURIComponent(att.id)}/bytes`,
            );
            await deliverExport(blob, att.fileName);
          },
        },
      );
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Could not open that file.');
    } finally {
      setOpeningId(null);
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
      setActionError(e instanceof Error ? e.message : 'Delete failed');
    } finally {
      setDeleting(false);
    }
  }

  const listError = actionError || (load.error && !load.data ? load.error : '');

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
          disabled={!canUpload}
          onClick={() => fileInput.current?.click()}
        >
          <Upload size={14} aria-hidden="true" />
          {uploading ? 'Uploading…' : 'Upload'}
        </Button>
      </div>

      {listError && !unavailable ? (
        <p className="vf-banner-error" role="alert">
          {listError}
        </p>
      ) : null}

      {unavailable ? (
        <div className="vf-empty-inline">
          <Paperclip size={20} aria-hidden="true" />
          <p>Attachments aren’t available on this database. Details still work.</p>
        </div>
      ) : load.loading && rows.length === 0 ? (
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
                {/* Resolving a Dropbox link is a real network round trip, so the control says so
                    — without it a slow link looks like a dead button and gets clicked again. */}
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={openingId === a.id}
                  onClick={() => void onDownload(a)}
                >
                  <Download size={14} aria-hidden="true" />
                  {openingId === a.id ? 'Opening…' : 'Open'}
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
