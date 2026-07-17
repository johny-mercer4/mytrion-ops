/**
 * Shared Create-tab primitives — field styles, attachment drop-zone, back button.
 */
import { useEffect, useState } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { useSales } from './ctx';

export const LABEL =
  'font-size:11px;font-weight:700;color:var(--muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em';
/** Surface (not alt) — matches Automations picklists; avoids grey wash in light mode. */
export const FIELD =
  'width:100%;height:44px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13.5px';
export const SELECT_BTN =
  'display:flex;align-items:center;justify-content:space-between;gap:10px;width:100%;height:44px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-size:13.5px;cursor:pointer';
export const DROP_PANEL =
  'position:absolute;z-index:9;top:calc(100% + 6px);left:0;right:0;max-height:260px;overflow-y:auto;padding:6px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow)';
export const BTN_PRIMARY =
  'height:46px;padding:0 28px;border-radius:var(--radius-md);border:none;background:var(--accent);color:#fff;font-weight:700;font-size:13.5px;cursor:pointer;box-shadow:0 6px 18px rgba(var(--accent-rgb),.28)';
export const BTN_PRIMARY_BUSY =
  'height:46px;padding:0 28px;border-radius:var(--radius-md);border:none;background:var(--accent);color:#fff;font-weight:700;font-size:13.5px;display:flex;align-items:center;gap:9px;opacity:.88;cursor:wait';
export const BTN_DISABLED =
  'height:46px;padding:0 28px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13.5px;cursor:not-allowed';

const MAX_BYTES = 20 * 1024 * 1024;

export function AttachZone({ id, file, onFile }: { id: string; file: File | null; onFile: (f: File | null) => void }) {
  const [dragging, setDragging] = useState(false);
  const { pushToast } = useSales();
  const take = (f: File | null | undefined): void => {
    if (!f) return;
    if (f.size > MAX_BYTES) {
      pushToast('File too large', 'Attachments must be 20MB or smaller.');
      return;
    }
    onFile(f);
  };
  useEffect(() => {
    if (file) return;
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const it of Array.from(items)) {
        if (it.kind === 'file') {
          const f = it.getAsFile();
          if (f) {
            take(f);
            e.preventDefault();
            break;
          }
        }
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [file]);
  if (file) {
    return (
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;padding:12px 14px;border-radius:var(--radius-md);background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3)')}>
        <div style={s('display:flex;align-items:center;gap:9px;min-width:0')}>
          <Icon name="check" size={18} color="var(--ok)" style={{ flexShrink: 0 }} />
          <span style={s('font-size:12.5px;font-weight:600;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{file.name}</span>
        </div>
        <button type="button" onClick={() => onFile(null)} style={s('flex-shrink:0;border:none;background:transparent;color:var(--danger);font-size:11.5px;font-weight:700;cursor:pointer')}>Remove</button>
      </div>
    );
  }
  return (
    <>
      <label
        htmlFor={id}
        className={`ss-attach${dragging ? ' is-drag' : ''}`}
        onDragOver={(e) => { e.preventDefault(); if (!dragging) setDragging(true); }}
        onDragLeave={(e) => { e.preventDefault(); setDragging(false); }}
        onDrop={(e) => { e.preventDefault(); setDragging(false); take(e.dataTransfer.files?.[0]); }}
      >
        <Icon name="upload" size={26} color="var(--accent)" strokeWidth={1.8} />
        <div style={s('font-size:12.5px;color:var(--text2)')}><span style={s('color:var(--accent);font-weight:700')}>Click to upload</span>, drag &amp; drop, or paste</div>
        <div style={s('font-size:10.5px;color:var(--faint)')}>PNG, JPG, PDF, DOC, XLS, CSV · max 20MB</div>
      </label>
      <input id={id} type="file" onChange={(e) => take(e.currentTarget.files?.[0])} style={{ display: 'none' }} />
    </>
  );
}

export function BackBtn({ onClick }: { onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="ss-ico-btn" style={s('height:46px;padding:0 16px;display:inline-flex;align-items:center;gap:8px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;font-size:12.5px;font-weight:700')}>
      <Icon name="chevronLeft" size={15} strokeWidth={2.2} />Back
    </button>
  );
}
