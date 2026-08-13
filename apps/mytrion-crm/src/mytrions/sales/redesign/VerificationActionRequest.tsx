import { useMemo, useState } from 'react';
import {
  sendVerificationResponse,
  type PipelineRequirement,
} from '@/api/verification';
import { FieldProceedFlag, fieldProceedHint } from './verificationFields';
import { Icon } from './icons';

interface Props {
  requestId: string;
  dealId: string | null;
  requirement: PipelineRequirement;
  onSent: () => void;
}

export function VerificationActionRequest({ requestId, dealId, requirement, onSent }: Props) {
  const initial = useMemo(
    () => Object.fromEntries(requirement.fields.map((field) => [field.id, ''])),
    [requirement.fields],
  );
  const [values, setValues] = useState<Record<string, string>>(initial);
  const [note, setNote] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fieldHints = requirement.fields
    .map((field) => fieldProceedHint(field))
    .filter((hint): hint is string => Boolean(hint));
  const headerDetail =
    requirement.detail && !fieldHints.includes(requirement.detail) ? requirement.detail : null;

  if (requirement.response) {
    return (
      <div className="ss-vf-approved">
        <div className="ss-vf-approved-head">
          <span className="ss-vf-approved-icon">
            <Icon name="checkCircle" size={18} />
          </span>
          <div>
            <div className="ss-vf-approved-val">Response sent</div>
            <div className="ss-vf-req-meta">
              {new Date(requirement.response.sentAt).toLocaleString()}
              {requirement.response.attachmentName ? ` · ${requirement.response.attachmentName}` : ''}
            </div>
          </div>
        </div>
        {requirement.response.warning ? (
          <div className="ss-vf-plaid-err" style={{ marginTop: 8 }}>
            {requirement.response.warning}
          </div>
        ) : null}
      </div>
    );
  }

  const submit = async (): Promise<void> => {
    if (!dealId) {
      setError('This application does not have a Zoho Deal id.');
      return;
    }
    const missing = requirement.fields.filter((field) => field.required && !values[field.id]?.trim());
    if (missing.length) {
      setError(`Complete ${missing.map((field) => field.label).join(', ')}.`);
      return;
    }
    if (requirement.attachmentRequired && !file) {
      setError('Add the requested attachment.');
      return;
    }
    setSending(true);
    setError(null);
    try {
      await sendVerificationResponse({
        requestId,
        dealId,
        externalEventId: requirement.eventId,
        values,
        note,
        file,
      });
      onSent();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not send the response.');
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="ss-vf-req">
      <div className="ss-vf-req-head">
        <span className="ss-vf-req-icon">
          <Icon name="warn" size={18} />
        </span>
        <div className="ss-vf-req-copy">
          <div className="ss-vf-req-title">{requirement.title}</div>
          <div className="ss-vf-req-meta">
            Verification needs your response · {new Date(requirement.createdAt).toLocaleString()}
          </div>
          {headerDetail ? <div className="ss-vf-req-detail">{headerDetail}</div> : null}
        </div>
      </div>

      {requirement.fields.length ? (
        <div className="ss-vf-req-fields">
          {requirement.fields.map((field) => {
            const hint = fieldProceedHint(field);
            const flagId = `vf-flag-${requirement.id}-${field.id}`;
            const flagged = Boolean(hint);
            const setValue = (value: string) =>
              setValues((current) => ({ ...current, [field.id]: value }));
            return (
              <label key={field.id} className={field.type === 'textarea' ? 'is-wide' : undefined}>
                <span className="ss-vf-field-lbl">
                  {field.label}{' '}
                  {field.required ? <span style={{ color: 'var(--danger)' }}>*</span> : null}
                </span>
                {field.type === 'textarea' ? (
                  <textarea
                    value={values[field.id] ?? ''}
                    onChange={(event) => setValue(event.target.value)}
                    rows={3}
                    aria-invalid={flagged}
                    aria-describedby={hint ? flagId : undefined}
                    className={`ss-vf-input${flagged ? ' is-flagged' : ''}`}
                    style={{ resize: 'vertical' }}
                  />
                ) : field.type === 'select' ? (
                  <select
                    value={values[field.id] ?? ''}
                    onChange={(event) => setValue(event.target.value)}
                    aria-invalid={flagged}
                    aria-describedby={hint ? flagId : undefined}
                    className={`ss-vf-input${flagged ? ' is-flagged' : ''}`}
                  >
                    <option value="">Select…</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option} value={option}>{option}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={field.type}
                    value={values[field.id] ?? ''}
                    onChange={(event) => setValue(event.target.value)}
                    aria-invalid={flagged}
                    aria-describedby={hint ? flagId : undefined}
                    className={`ss-vf-input${flagged ? ' is-flagged' : ''}`}
                  />
                )}
                {hint ? <FieldProceedFlag id={flagId} text={hint} /> : null}
              </label>
            );
          })}
        </div>
      ) : null}

      <div className="ss-vf-req-extra">
        <label>
          <span className="ss-vf-field-lbl">
            Attachment {requirement.attachmentRequired ? <span style={{ color: 'var(--danger)' }}>*</span> : '(optional)'}
          </span>
          <span className="ss-vf-file-pick">
            <Icon name="attach" size={15} />
            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {file?.name ?? requirement.attachmentLabel ?? 'Choose a file (max 20 MB)'}
            </span>
            <input type="file" onChange={(event) => setFile(event.target.files?.[0] ?? null)} />
          </span>
        </label>
        <label>
          <span className="ss-vf-field-lbl">Note (optional)</span>
          <input
            value={note}
            onChange={(event) => setNote(event.target.value)}
            placeholder="Add context for Verification"
            className="ss-vf-input"
          />
        </label>
      </div>

      {error ? <div role="alert" className="ss-vf-edit-err">{error}</div> : null}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
        <button
          type="button"
          onClick={submit}
          disabled={sending}
          className="ss-vf-plaid-btn"
          style={{ opacity: sending ? 0.7 : 1, cursor: sending ? 'wait' : 'pointer' }}
        >
          <Icon name={sending ? 'spinner' : 'send'} size={15} />
          {sending ? 'Sending…' : 'Send to Verification'}
        </button>
      </div>
    </div>
  );
}
