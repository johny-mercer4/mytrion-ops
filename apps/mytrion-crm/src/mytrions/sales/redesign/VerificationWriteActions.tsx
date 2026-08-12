/**
 * Sales verification WRITE actions: edit the applicant's identity fields and upload bank statements
 * for the Plaid stage. Both post to owner-scoped /v1/verification write endpoints, which queue the
 * change into credit_platform's inbox for Verification to apply — nothing here mutates the case
 * directly, and uploads are attach-only (Verification runs the Plaid parse manually).
 */
import { useState, type ReactNode } from 'react';
import { editApplicant, uploadBankStatements, type PipelineApplicant } from '@/api/verification';
import { s } from './dc';
import { Icon } from './icons';
import { DetailSheet } from './dataCenterSheet';

function inputStyle(disabled: boolean): React.CSSProperties {
  return s(
    `width:100%;min-height:40px;padding:9px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;outline:none;opacity:${disabled ? '.6' : '1'}`,
  );
}

const APPLICANT_FIELDS: ReadonlyArray<{ id: keyof PipelineApplicant; label: string; type?: string }> = [
  { id: 'firstName', label: 'First name' },
  { id: 'lastName', label: 'Last name' },
  { id: 'dateOfBirth', label: 'Date of birth', type: 'date' },
  { id: 'email', label: 'Email', type: 'email' },
  { id: 'phone', label: 'Phone' },
  { id: 'address', label: 'Address' },
  { id: 'city', label: 'City' },
  { id: 'state', label: 'State' },
  { id: 'zipCode', label: 'ZIP code' },
  { id: 'dotNumber', label: 'DOT number' },
  { id: 'mcNumber', label: 'MC number' },
];

const FOOT_BTN = 'height:38px;padding:0 18px;border-radius:var(--radius-md);font-weight:700;font-size:14px;cursor:pointer;display:flex;align-items:center;gap:7px';
const PRIMARY_BTN = `${FOOT_BTN};border:none;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent)`;
const GHOST_BTN = `${FOOT_BTN};border:1px solid var(--border);background:var(--alt);color:var(--text)`;

function SheetAvatar({ children }: { children: ReactNode }) {
  return <div className="ss-vf-avatar">{children}</div>;
}

export function EditApplicantPanel({
  requestId,
  dealId,
  initial,
}: {
  requestId: string;
  dealId: string | null;
  initial?: PipelineApplicant | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [values, setValues] = useState<Record<string, string>>(() =>
    Object.fromEntries(APPLICANT_FIELDS.map((f) => [f.id, initial?.[f.id] ?? ''])),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = (): void => {
    if (saving) return;
    setOpen(false);
    setError(null);
  };

  const submit = async (): Promise<void> => {
    if (!dealId) {
      setError('This application has no Zoho Deal id.');
      return;
    }
    const changes: Record<string, string> = {};
    for (const field of APPLICANT_FIELDS) {
      const value = values[field.id]?.trim();
      if (value) changes[field.id] = value;
    }
    if (!Object.keys(changes).length) {
      setError('Enter at least one field to update.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await editApplicant({ requestId, dealId, changes });
      setOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not queue the applicant update.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => { setOpen(true); setError(null); }}
        disabled={!dealId}
        className="ss-vf-edit-btn"
      >
        <Icon name="edit" size={14} /> Edit applicant
      </button>

      {open ? (
        <DetailSheet
          accent="var(--accent)"
          title="Edit applicant"
          subtitle="Only the fields you fill are updated. Verification applies the change."
          avatar={<SheetAvatar><Icon name="edit" size={20} /></SheetAvatar>}
          onClose={close}
          saving={saving}
          maxWidth={820}
          ariaLabel="Edit applicant"
          footer={
            <div className="ss-vf-sheet-foot">
              <button type="button" onClick={close} disabled={saving} style={s(`${GHOST_BTN};opacity:${saving ? '.6' : '1'}`)}>
                Cancel
              </button>
              <button type="button" onClick={() => { void submit(); }} disabled={saving} style={s(`${PRIMARY_BTN};opacity:${saving ? '.7' : '1'}`)}>
                <Icon name={saving ? 'spinner' : 'check'} size={15} />
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          }
        >
          <div className="ss-vf-edit-grid">
            {APPLICANT_FIELDS.map((field) => (
              <label key={field.id}>
                <span className="ss-vf-tile-lbl">{field.label}</span>
                <input
                  type={field.type ?? 'text'}
                  value={values[field.id] ?? ''}
                  disabled={saving}
                  placeholder={`Enter ${field.label.toLowerCase()}`}
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  style={inputStyle(saving)}
                />
              </label>
            ))}
          </div>
          {error ? <div role="alert" className="ss-vf-edit-err">{error}</div> : null}
        </DetailSheet>
      ) : null}
    </>
  );
}

export function PlaidLinkShare({ url }: { url: string | null | undefined }) {
  const [copied, setCopied] = useState(false);
  if (!url) return null;
  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <div style={s('padding:14px 16px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)')}>
      <div style={s('font-size:12px;font-weight:800;text-transform:uppercase;letter-spacing:.06em;color:var(--muted)')}>Plaid link</div>
      <div style={s('font-size:12px;color:var(--muted);margin-top:3px')}>Send this link to the applicant so they can connect their bank.</div>
      <div style={s('display:flex;align-items:flex-start;gap:8px;margin-top:10px;flex-wrap:wrap')}>
        <div style={s('flex:1;min-width:220px;font-size:13px;font-weight:700;font-family:JetBrains Mono,monospace;color:var(--text);word-break:break-all;user-select:all;padding:9px 11px;border:1px solid var(--border);border-radius:9px;background:var(--surface)')}>
          {url}
        </div>
        <button
          type="button"
          onClick={copy}
          title="Copy the Plaid link"
          style={s(
            `flex-shrink:0;height:38px;padding:0 14px;border:1px solid var(--border);border-radius:9px;background:${copied ? 'color-mix(in srgb,var(--ok) 12%,var(--surface))' : 'var(--surface)'};color:${copied ? 'var(--ok)' : 'var(--text)'};font-size:13px;font-weight:800;display:inline-flex;align-items:center;gap:6px;cursor:pointer`,
          )}
        >
          <Icon name={copied ? 'check' : 'copy'} size={14} /> {copied ? 'Copied' : 'Copy'}
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          style={s('flex-shrink:0;height:38px;padding:0 14px;border:1px solid var(--border);border-radius:9px;background:var(--surface);color:var(--text);font-size:13px;font-weight:800;display:inline-flex;align-items:center;gap:6px;text-decoration:none')}
        >
          <Icon name="link" size={14} /> Open
        </a>
      </div>
    </div>
  );
}

function fileKey(f: File): string {
  return `${f.name}:${f.size}:${f.lastModified}`;
}

export function BankStatementUpload({
  requestId,
  dealId,
  onUploaded,
}: {
  requestId: string;
  dealId: string | null;
  onUploaded?: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [uploadedNames, setUploadedNames] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

  const addFiles = (incoming: FileList | File[] | null): void => {
    const list = Array.from(incoming ?? []);
    if (!list.length) return;
    setFiles((current) => {
      const seen = new Set(current.map(fileKey));
      return [...current, ...list.filter((f) => !seen.has(fileKey(f)))];
    });
    setUploadedNames([]);
    setError(null);
  };
  const removeFile = (index: number): void => setFiles((current) => current.filter((_, i) => i !== index));

  const submit = async (): Promise<void> => {
    if (!dealId) {
      setError('This application has no Zoho Deal id.');
      return;
    }
    if (!files.length) {
      setError('Choose at least one bank statement.');
      return;
    }
    setSaving(true);
    setError(null);
    const names = files.map((f) => f.name);
    try {
      await uploadBankStatements({ requestId, dealId, files });
      setUploadedNames(names);
      setFiles([]);
      onUploaded?.();
      window.setTimeout(() => onUploaded?.(), 5000);
      window.setTimeout(() => onUploaded?.(), 10000);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload the statements.');
    } finally {
      setSaving(false);
    }
  };

  const busy = saving || !files.length;
  const idle = !saving && !files.length;
  return (
    <div style={s('padding:16px;border:1px solid var(--border2);border-radius:var(--radius-md);background:var(--alt)')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:13px;font-weight:800')}>Bank statements</div>
          <div style={s('font-size:12px;color:var(--muted);margin-top:3px')}>
            Upload the statements for the Plaid / Bank Statement stage. Verification reviews them.
          </div>
        </div>
      </div>

      <label
        onDragOver={(e) => { e.preventDefault(); if (!saving) setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!saving) addFiles(e.dataTransfer.files); }}
        style={s(
          `margin-top:12px;min-height:84px;padding:16px;border:1.5px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'};border-radius:12px;background:${dragOver ? 'color-mix(in srgb,var(--accent) 8%,var(--surface))' : 'var(--surface)'};display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;text-align:center;cursor:${saving ? 'not-allowed' : 'pointer'};transition:border-color .12s,background .12s`,
        )}
      >
        <Icon name="upload" size={20} />
        <div style={s('font-size:13px;font-weight:700;color:var(--text2)')}>
          Drag &amp; drop bank statements here, or <span style={s('color:var(--accent)')}>browse</span>
        </div>
        <div style={s('font-size:11px;color:var(--muted)')}>PDF or images · up to 20 files</div>
        <input
          type="file"
          multiple
          disabled={saving}
          style={{ display: 'none' }}
          onChange={(event) => { addFiles(event.target.files); event.target.value = ''; }}
        />
      </label>

      {files.length ? (
        <div style={s('display:flex;flex-direction:column;gap:6px;margin-top:12px')}>
          {files.map((file, index) => (
            <div key={fileKey(file)} style={s('display:flex;align-items:center;gap:8px;font-size:12px;color:var(--text2);padding:6px 8px;border:1px solid var(--border2);border-radius:8px;background:var(--surface)')}>
              <Icon name="file" size={14} />
              <span style={s('min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{file.name}</span>
              <span style={s('margin-left:auto;color:var(--muted);white-space:nowrap')}>{Math.max(1, Math.round(file.size / 1024))} KB</span>
              <button
                type="button"
                onClick={() => removeFile(index)}
                disabled={saving}
                aria-label={`Remove ${file.name}`}
                title="Remove"
                style={s(`display:inline-flex;align-items:center;justify-content:center;width:22px;height:22px;border:0;border-radius:6px;background:transparent;color:var(--muted);cursor:${saving ? 'not-allowed' : 'pointer'};flex-shrink:0`)}
              >
                <Icon name="close" size={14} strokeWidth={2.4} />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {error ? <div role="alert" style={s('font-size:12px;color:var(--danger);margin-top:10px')}>{error}</div> : null}
      {uploadedNames.length ? (
        <div style={s('margin-top:10px;padding:10px 12px;border:1px solid color-mix(in srgb,var(--ok) 35%,var(--border2));border-radius:10px;background:color-mix(in srgb,var(--ok) 7%,var(--surface))')}>
          <div style={s('font-size:12px;color:var(--ok);font-weight:800')}>
            {uploadedNames.length} file{uploadedNames.length === 1 ? '' : 's'} uploaded ✓ — Verification will review them.
          </div>
          <div style={s('display:flex;flex-direction:column;gap:4px;margin-top:8px')}>
            {uploadedNames.map((name) => (
              <div key={name} style={s('display:flex;align-items:center;gap:7px;font-size:12px;color:var(--text2)')}>
                <Icon name="file" size={13} /> {name}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <div style={s('display:flex;justify-content:flex-end;align-items:center;gap:10px;margin-top:14px')}>
        {files.length ? <span style={s('font-size:12px;color:var(--muted)')}>{files.length} file{files.length === 1 ? '' : 's'} ready</span> : null}
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          style={s(
            `height:38px;padding:0 17px;border:${idle ? '1px solid var(--border2)' : '0'};border-radius:10px;background:${idle ? 'var(--alt)' : 'var(--accent-strong)'};color:${idle ? 'var(--muted)' : 'var(--on-accent)'};font-size:13px;font-weight:800;display:flex;align-items:center;gap:8px;cursor:${busy ? (saving ? 'wait' : 'not-allowed') : 'pointer'};opacity:${saving ? '.8' : '1'}`,
          )}
        >
          <Icon name={saving ? 'spinner' : 'upload'} size={15} /> {saving ? 'Uploading…' : 'Save & upload'}
        </button>
      </div>
    </div>
  );
}
