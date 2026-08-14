import { useRef, useState } from 'react';
import { Button } from '../../ds/Button/Button';
import {
  downloadVerificationCaseAttachment,
  generateVerificationPlaidLink,
  getVerificationCase,
  parseVerificationBankStatements,
  uploadVerificationCaseFiles,
  type VerificationCaseAttachment,
  type VerificationCaseDetail,
} from '../../api/verificationCases';
import { attachmentScopeLabel, groupAttachments } from './verificationCaseDesk';

const FILE_SK = 3;

function FileRow({
  caseId,
  file,
  busy,
}: {
  caseId: string;
  file: VerificationCaseAttachment;
  busy: string | null;
}) {
  return (
    <li className="vf-file">
      <span className="vf-file-name">{file.fileName}</span>
      <span className="vf-file-meta">
        {attachmentScopeLabel(file.scope)} · {Math.max(1, Math.round(file.byteSize / 1024))} KB
      </span>
      <Button
        variant="ghost"
        size="sm"
        disabled={Boolean(busy)}
        onClick={() => void downloadVerificationCaseAttachment(caseId, file.id, file.fileName)}
      >
        Download
      </Button>
    </li>
  );
}

export function VerificationCaseDocuments({
  caseId,
  detail,
  busy,
  pending,
  onAct,
}: {
  caseId: string;
  detail: VerificationCaseDetail | null;
  busy: string | null;
  pending: boolean;
  onAct: (label: string, fn: () => Promise<VerificationCaseDetail>) => Promise<void>;
}) {
  const fileRef = useRef<HTMLInputElement>(null);
  const lastFiles = useRef<VerificationCaseAttachment[]>([]);
  const [uploadHint, setUploadHint] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  if (detail?.attachments) lastFiles.current = detail.attachments;
  const attachments = detail?.attachments ?? lastFiles.current;
  const groups = groupAttachments(attachments);
  const statements = attachments.filter((file) => file.scope === 'sales_bank_statement');
  const row = detail?.case;
  const plaidUrl = row?.plaidLinkUrl?.trim() || '';

  const onFiles = async (files: FileList | null): Promise<void> => {
    if (!files?.length) return;
    setUploadHint(null);
    await onAct('upload', async () => {
      await uploadVerificationCaseFiles(caseId, Array.from(files));
      return getVerificationCase(caseId);
    });
    setUploadHint(`${files.length} file${files.length === 1 ? '' : 's'} queued for the desk.`);
  };

  const copyLink = async (): Promise<void> => {
    if (!plaidUrl) return;
    try {
      await navigator.clipboard.writeText(plaidUrl);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  };

  return (
    <>
      <section className="vf-section">
        <h3 className="vf-section-title">Plaid</h3>
        <div className="vf-card-chips">
          <span className={`vf-pill ${row?.plaidStatus ? 'is-info' : 'is-mute'}`}>
            {row?.plaidStatus ? row.plaidStatus.replaceAll('_', ' ') : 'No link yet'}
          </span>
          {row?.plaidMode ? <span className="vf-pill is-mute">{row.plaidMode.replaceAll('_', ' ')}</span> : null}
        </div>
        {plaidUrl ? (
          <div className="vf-plaid-url">
            <input className="vf-plaid-input" readOnly value={plaidUrl} aria-label="Plaid link URL" />
            <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
              {copied ? 'Copied' : 'Copy'}
            </Button>
          </div>
        ) : (
          <p className="vf-stage-note">Generate a hosted Plaid link. Tracking redirects stay hidden.</p>
        )}
        <div className="vf-stage-btns">
          <Button
            variant="secondary"
            size="sm"
            disabled={Boolean(busy) || !row?.requestId}
            loading={busy === 'plaid'}
            onClick={() =>
              void onAct('plaid', async () => {
                await generateVerificationPlaidLink(caseId, Boolean(plaidUrl));
                return getVerificationCase(caseId);
              })
            }
          >
            {plaidUrl ? 'Regenerate link' : 'Generate Plaid link'}
          </Button>
        </div>
      </section>

      <section className="vf-section">
        <h3 className="vf-section-title">Documents</h3>
        <p className="vf-stage-note">
          Bank statements come from Sales write-back. Analyst notes stay on the desk upload path.
        </p>
        {pending && attachments.length === 0 ? (
          <ul className="vf-files" aria-busy="true">
            <span className="sr-only" role="status">
              Loading files
            </span>
            {Array.from({ length: FILE_SK }, (_, i) => (
              <li key={i} className="vf-sk vf-sk-file" aria-hidden="true" />
            ))}
          </ul>
        ) : attachments.length === 0 ? (
          <div className="vf-empty vf-empty-inline">
            <div className="vf-empty-title">No files yet</div>
            <p>Upload a bank statement to parse, or add an analyst note from Decision Desk.</p>
          </div>
        ) : (
          groups.map((group) =>
            group.files.length ? (
              <div key={group.id} className="vf-file-group">
                <h4 className="vf-file-group-title">{group.label}</h4>
                <ul className="vf-files">
                  {group.files.map((file) => (
                    <FileRow key={file.id} caseId={caseId} file={file} busy={busy} />
                  ))}
                </ul>
              </div>
            ) : null,
          )
        )}
        <div className="vf-stage-btns">
          <input
            ref={fileRef}
            type="file"
            multiple
            className="sr-only"
            aria-label="Upload bank statements"
            onChange={(event) => {
              void onFiles(event.target.files);
              event.target.value = '';
            }}
          />
          <Button
            variant="secondary"
            size="sm"
            disabled={Boolean(busy) || !row?.requestId}
            loading={busy === 'upload'}
            onClick={() => fileRef.current?.click()}
          >
            Upload statements
          </Button>
          <Button
            variant="secondary"
            size="sm"
            disabled={Boolean(busy) || !row?.requestId || statements.length === 0}
            loading={busy === 'parse'}
            onClick={() =>
              void onAct('parse', () =>
                parseVerificationBankStatements(
                  caseId,
                  statements.map((file) => Number(file.id)).filter((n) => Number.isInteger(n) && n > 0),
                ),
              )
            }
          >
            Parse statements
          </Button>
        </div>
        {uploadHint ? <p className="vf-cached">{uploadHint}</p> : null}
      </section>
    </>
  );
}
