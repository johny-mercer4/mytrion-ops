import { useMemo, useState } from 'react';
import {
  sendVerificationResponse,
  type PipelineRequirement,
} from '@/api/verification';
import { s } from './dc';
import { Icon } from './icons';

interface Props {
  requestId: string;
  dealId: string | null;
  requirement: PipelineRequirement;
  onSent: () => void;
}

function inputStyle(): React.CSSProperties {
  return s(
    'width:100%;min-height:42px;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px;outline:none',
  );
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

  if (requirement.response) {
    return (
      <div
        style={s(
          'padding:16px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--ok) 35%,var(--border));background:color-mix(in srgb,var(--ok) 7%,var(--surface))',
        )}
      >
        <div style={s('display:flex;align-items:center;gap:10px;color:var(--ok);font-weight:800')}>
          <Icon name="checkCircle" size={18} /> Response sent
        </div>
        <div style={s('margin-top:6px;font-size:12px;color:var(--text2)')}>
          {new Date(requirement.response.sentAt).toLocaleString()}
          {requirement.response.attachmentName ? ` · ${requirement.response.attachmentName}` : ''}
        </div>
        {requirement.response.warning ? (
          <div style={s('margin-top:8px;font-size:12px;color:var(--warn)')}>
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
    <div
      style={s(
        'padding:18px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 42%,var(--border));background:color-mix(in srgb,var(--danger) 6%,var(--surface));box-shadow:0 12px 32px rgba(10,16,30,.08)',
      )}
    >
      <div style={s('display:flex;align-items:flex-start;gap:12px')}>
        <span
          style={s(
            'width:34px;height:34px;border-radius:10px;display:grid;place-items:center;flex:0 0 auto;background:color-mix(in srgb,var(--danger) 15%,transparent);color:var(--danger)',
          )}
        >
          <Icon name="warn" size={18} />
        </span>
        <div style={s('min-width:0')}>
          <div style={s('font-size:15px;font-weight:800;color:var(--danger)')}>{requirement.title}</div>
          <div style={s('font-size:12px;color:var(--muted);margin-top:3px')}>
            Verification needs your response · {new Date(requirement.createdAt).toLocaleString()}
          </div>
          {requirement.detail ? (
            <div style={s('font-size:13px;color:var(--text2);line-height:1.55;margin-top:8px')}>
              {requirement.detail}
            </div>
          ) : null}
        </div>
      </div>

      {requirement.fields.length ? (
        <div style={s('display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px;margin-top:16px')}>
          {requirement.fields.map((field) => (
            <label key={field.id} style={s(field.type === 'textarea' ? 'grid-column:1/-1' : '')}>
              <span style={s('display:block;font-size:12px;font-weight:750;color:var(--text2);margin-bottom:6px')}>
                {field.label} {field.required ? <span style={s('color:var(--danger)')}>*</span> : null}
              </span>
              {field.type === 'textarea' ? (
                <textarea
                  value={values[field.id] ?? ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
                  rows={3}
                  style={{ ...inputStyle(), resize: 'vertical' }}
                />
              ) : field.type === 'select' ? (
                <select
                  value={values[field.id] ?? ''}
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  style={inputStyle()}
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
                  onChange={(event) => setValues((current) => ({ ...current, [field.id]: event.target.value }))}
                  placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
                  style={inputStyle()}
                />
              )}
            </label>
          ))}
        </div>
      ) : null}

      <div style={s('display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:12px;margin-top:12px')}>
        <label>
          <span style={s('display:block;font-size:12px;font-weight:750;color:var(--text2);margin-bottom:6px')}>
            Attachment {requirement.attachmentRequired ? <span style={s('color:var(--danger)')}>*</span> : '(optional)'}
          </span>
          <span
            style={s(
              'min-height:42px;padding:0 12px;border-radius:10px;border:1px dashed var(--border);background:var(--surface);display:flex;align-items:center;gap:8px;font-size:13px;color:var(--text2);cursor:pointer;overflow:hidden',
            )}
          >
            <Icon name="attach" size={15} />
            <span style={s('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>
              {file?.name ?? requirement.attachmentLabel ?? 'Choose a file (max 20 MB)'}
            </span>
            <input
              type="file"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              style={{ display: 'none' }}
            />
          </span>
        </label>
        <label>
          <span style={s('display:block;font-size:12px;font-weight:750;color:var(--text2);margin-bottom:6px')}>
            Note (optional)
          </span>
          <input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Add context for Verification" style={inputStyle()} />
        </label>
      </div>

      {error ? <div role="alert" style={s('font-size:12px;color:var(--danger);margin-top:10px')}>{error}</div> : null}
      <div style={s('display:flex;justify-content:flex-end;margin-top:14px')}>
        <button
          type="button"
          onClick={submit}
          disabled={sending}
          style={s(
            `height:40px;padding:0 17px;border:0;border-radius:10px;background:var(--accent);color:white;font-size:13px;font-weight:800;display:flex;align-items:center;gap:8px;cursor:${sending ? 'wait' : 'pointer'};opacity:${sending ? '.7' : '1'}`,
          )}
        >
          <Icon name={sending ? 'spinner' : 'send'} size={15} />
          {sending ? 'Sending…' : 'Send to Verification'}
        </button>
      </div>
    </div>
  );
}
