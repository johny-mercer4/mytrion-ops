/**
 * Documents on a collection case — the agency letter, the court filing, the USPS proof.
 *
 * The desk could record that a case was filed in small claims but not hold the filing, which is
 * the difference between a checkbox and evidence. Zoho carried an Attachments list on every
 * record; this is that, on the same object-storage seam CS Maintenance uses.
 *
 * A KIND is asked for on upload, not inferred from the filename. "scan_003.pdf" tells the next
 * collector nothing; "Court filing" tells them whether the case is provable.
 */
import { useCallback, useRef, useState } from 'react';
import { Badge, Button, Select, useToast } from '@/ds';
import {
  COLLECTION_ATTACHMENT_KINDS,
  deleteCaseAttachment,
  getCaseAttachmentUrl,
  listCaseAttachments,
  uploadCaseAttachment,
  type CollectionAttachmentKind,
} from '@/api/collectionDesk';
import { useCachedLoad } from '../../../_shared/swrCache';
import { fmtDate } from '../../collectionFormat';

const KIND_LABEL: Record<CollectionAttachmentKind, string> = {
  agency_letter: 'Agency letter',
  court_filing: 'Court filing',
  usps_proof: 'USPS proof',
  payment_proof: 'Payment proof',
  correspondence: 'Correspondence',
  other: 'Other',
};

/** Bytes as a person reads them. Files here are letters and scans, so KB/MB is the whole range. */
export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function CaseFiles({ caseId, readOnly }: { caseId: string; readOnly: boolean }) {
  const { toast } = useToast();
  const load = useCallback(() => listCaseAttachments(caseId), [caseId]);
  const feed = useCachedLoad(`collection:case:${caseId}:files`, load);
  const items = feed.data?.items ?? [];

  const fileInput = useRef<HTMLInputElement>(null);
  const [kind, setKind] = useState<CollectionAttachmentKind>('correspondence');
  const [busy, setBusy] = useState(false);

  const upload = async (file: File): Promise<void> => {
    setBusy(true);
    try {
      await uploadCaseAttachment(caseId, file, kind);
      toast({ intent: 'success', title: 'Attached', description: file.name });
      await feed.reload();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not attach the file', description: String(err) });
    } finally {
      setBusy(false);
      if (fileInput.current) fileInput.current.value = '';
    }
  };

  const download = async (id: string): Promise<void> => {
    try {
      const { url } = await getCaseAttachmentUrl(caseId, id);
      // A signed URL that expires: opening it is the only way the bytes reach the browser, and
      // they never travel back through the API.
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch (err) {
      toast({ intent: 'error', title: 'Could not open the file', description: String(err) });
    }
  };

  const remove = async (id: string, name: string): Promise<void> => {
    setBusy(true);
    try {
      await deleteCaseAttachment(caseId, id);
      toast({ intent: 'success', title: 'Removed', description: name });
      await feed.reload();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not remove the file', description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cc-pane ct-pane">
      {/* The kind picker used to sit up here beside the title. `ds/Select` puts its label above the
          control, so the panel header grew to two lines and the count, a labelled dropdown and a
          button competed for the same row. The picker belongs with the act of attaching, not with
          the heading — it moved into the strip below. */}
      <header className="cc-pane-head">
        <h2 className="cc-pane-title">Documents</h2>
        {items.length > 0 ? (
          <span className="cc-pane-meta">
            {items.length} file{items.length === 1 ? '' : 's'}
          </span>
        ) : null}
      </header>

      {readOnly ? null : (
        <div className="ct-add">
          <Select
            size="sm"
            label="Kind"
            value={kind}
            onChange={(v) => setKind((v as CollectionAttachmentKind | null) ?? 'other')}
            options={COLLECTION_ATTACHMENT_KINDS.map((k) => ({ value: k, label: KIND_LABEL[k] }))}
          />
          <Button
            variant="secondary"
            size="sm"
            icon="attach_file"
            loading={busy}
            disabled={busy}
            onClick={() => fileInput.current?.click()}
          >
            Attach a file
          </Button>
        </div>
      )}

      <input
        ref={fileInput}
        type="file"
        className="co-sr"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file) void upload(file);
        }}
      />

      {feed.error ? (
        <p className="ct-empty">Could not load the documents on this case.</p>
      ) : items.length === 0 ? (
        <p className="ct-empty">
          Nothing attached yet — the agency letter, the court filing, the proof of mailing.
        </p>
      ) : (
        <ul className="ct-list">
          {items.map((f) => (
            <li key={f.id} className="ct-row" data-status="open">
              <span className="ct-row-main">
                <span className="ct-row-title">{f.fileName}</span>
                <span className="ct-row-meta">
                  {fileSize(f.sizeBytes)} · {fmtDate(f.createdAt)}
                  {f.uploadedByName ? ` · ${f.uploadedByName}` : ''}
                </span>
              </span>
              {f.kind ? (
                <Badge size="sm" intent="neutral">
                  {KIND_LABEL[f.kind]}
                </Badge>
              ) : null}
              <span className="ct-row-actions">
                <Button variant="ghost" size="sm" icon="download" onClick={() => void download(f.id)}>
                  Open
                </Button>
                {readOnly ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    icon="delete"
                    disabled={busy}
                    onClick={() => void remove(f.id, f.fileName)}
                  >
                    Remove
                  </Button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
