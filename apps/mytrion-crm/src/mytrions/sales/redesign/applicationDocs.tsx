/**
 * The intake form's file surfaces — the named slots and the loose Documents section.
 *
 * Split out of `applicationIntake.tsx`, which was already at 999 lines. Everything here was
 * previously inline there, and all of it was the same shape: a bare `Choose file` link, or — for the
 * loose documents — a raw `<input type="file" multiple>` with the browser's default chrome, which is
 * the only unstyled control left on a page of designed ones.
 *
 * FOUR THINGS THE OLD CONTROLS DID NOT DO, and each of them cost an agent a round trip to find out:
 *
 *  1. **Report their own progress.** A single form-wide `busy` flag meant picking one bank statement
 *     put every button on the page into a loading state at once. Each slot now reports only itself.
 *  2. **Report a refusal.** An unsupported type came back as a 415 that landed in a banner at the
 *     bottom of a long form. The refusal now appears in the slot that caused it — and the common ones
 *     are caught before the upload starts, so a 20 MB file over a tether is not spent to learn that.
 *  3. **Accept a drop.** Bank statements arrive as email attachments; dragging one out of a mail
 *     client is the natural gesture and the form had no target for it.
 *  4. **Open what was uploaded.** Verifying you attached February and not January meant downloading
 *     the file again. The filename is a preview link (see `openDocument`).
 *
 * The Sales-desk idiom throughout: `s()` inline styles and the numeric `Icon`, never `@/ds`. Mixing
 * the two inside one form is what makes a screen look assembled rather than designed — the same
 * reason `applicationFields.tsx` gives.
 */
import { useEffect, useRef, useState } from 'react';
import { s } from './dc';
import { Icon } from './icons';
import { Section } from './applicationFields';
import {
  DOC_ACCEPT,
  DOC_ACCEPT_HINT,
  firstRejection,
  formatBytes,
  rejectionFor,
} from '../../_shared/verificationDocUpload';
import type { VerificationDocType, VerificationDocument } from '@/api/verificationFlow';

export const DOC_LABELS: Record<VerificationDocType, string> = {
  bank_statement: 'Bank statement',
  drivers_license: "Driver's licence",
  ssn_card: 'SSN card',
  lease_agreement: 'Lease agreement',
  corporate_guarantee: 'Corporate guarantee',
  insurance: 'Insurance',
  authority: 'Authority document',
  other: 'Other document',
};

/** Identity + bank-statement slots already cover these — the leftover panel must not. */
export const SLOTTED_DOC_TYPES: ReadonlySet<VerificationDocType> = new Set([
  'bank_statement',
  'drivers_license',
  'ssn_card',
]);

export function isSlottedDocType(type: VerificationDocType): boolean {
  return SLOTTED_DOC_TYPES.has(type);
}

export interface SlotDoc {
  id: string;
  fileName: string | null;
  sizeBytes?: number | null;
}

/** The refusal line. One shape wherever a file is refused, so it always reads the same way. */
function Refusal({ message }: { message: string }) {
  return (
    <span
      role="alert"
      style={s(
        'display:flex;align-items:flex-start;gap:7px;font-size:12px;font-weight:600;color:var(--danger);line-height:1.45',
      )}
    >
      <Icon name="warn" size={13} strokeWidth={2.3} style={{ marginTop: 1 }} />
      <span style={s('min-width:0')}>{message}</span>
    </span>
  );
}

/**
 * ONE named box, ONE file.
 *
 * The three bank statements and the two identity documents are all this: a labelled place for a
 * specific file, so "2 of 3 uploaded" can never leave the agent guessing WHICH month is missing.
 *
 * A drop target as well as a picker — but deliberately not the big dashed panel the loose Documents
 * section uses. These sit five to a column inside a form; five 90px drop panels would be the loudest
 * thing on the page and would bury the fields they belong to. The row IS the target: it takes a drop
 * anywhere on itself and shows it with its own border.
 */
export function DocSlot({
  label,
  doc,
  locked,
  canAttach,
  missing,
  uploading,
  removing,
  error,
  onPick,
  onOpen,
  onRemove,
}: {
  label: string;
  doc: SlotDoc | null;
  /** The application is handed over: no Replace, no Remove. */
  locked: boolean;
  /**
   * A file may still be ADDED. Defaults to `!locked`, and diverges in exactly one state: after
   * submit, when the desk has asked for a document. Adding is not overriding.
   */
  canAttach?: boolean | undefined;
  missing: boolean;
  /** THIS slot's upload, not the form's. */
  uploading: boolean;
  removing: boolean;
  error: string | null;
  onPick: (file: File) => void;
  onOpen: (() => void) | null;
  onRemove: (() => void) | null;
}) {
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const inputId = `stmt-${label.replace(/\s+/g, '-').toLowerCase()}`;
  const busy = uploading || removing;
  const mayAttach = canAttach ?? !locked;
  /**
   * A HANDED-OVER slot that already holds a file takes nothing.
   *
   * `Replace` and `Remove` disappear when the case is locked, but the row is also a drop target — so a
   * drop on a filled slot after submit uploaded a second copy of that document under the desk, which
   * is the same override by a different door. Empty and requested slots still take a file: that is
   * what Pending Documents asks for.
   */
  const mayTake = mayAttach && (!locked || doc == null);
  const disabled = !mayTake || busy;

  /** The server's own refusals, said before the upload rather than after it. */
  const take = (file: File | null | undefined): void => {
    if (!file || disabled) return;
    const reason = rejectionFor(file);
    if (reason) {
      setRefused(reason);
      return;
    }
    setRefused(null);
    onPick(file);
  };

  const border = refused || error
    ? 'var(--danger)'
    : dragging
      ? 'var(--accent)'
      : missing && !doc
        ? 'var(--danger)'
        : 'var(--border)';

  return (
    <div style={s('display:grid;gap:6px')}>
      <div
        onDragOver={(e) => {
          if (disabled) return;
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={(e) => {
          e.preventDefault();
          setDragging(false);
        }}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          take(e.dataTransfer.files?.[0]);
        }}
        /* `position:relative` anchors the hidden `<input>` below. Without it the input resolves
           against whatever ancestor happens to be positioned — the app shell, in the defect this
           replaces — and focusing it scrolls that box. Same pairing as `ds/Checkbox`. */
        style={s(
          `position:relative;display:flex;align-items:center;gap:10px;min-height:52px;padding:8px 12px;border-radius:var(--radius-md);border:1px ${
            doc ? 'solid' : 'dashed'
          } ${border};background:${dragging ? 'rgba(var(--accent-rgb),.07)' : 'var(--alt)'};transition:border-color .15s,background .15s`,
        )}
      >
        <span style={s('min-width:92px;font-size:var(--ss-text-sm);font-weight:800;color:var(--text2)')}>{label}</span>

        {busy ? (
          <>
            {/* ONE affordance for this row: the spinner IS the loader. No overlay, no skeleton. */}
            <Icon name="spinner" size={15} color="var(--accent)" className="ss-spin" />
            <span style={s('flex:1;min-width:0;font-size:var(--ss-text-sm);color:var(--text2)')}>
              {uploading ? 'Uploading…' : 'Removing…'}
            </span>
          </>
        ) : doc ? (
          <>
            <Icon name="checkCircle" size={16} color="var(--ok)" strokeWidth={2.2} />
            {/* The filename OPENS the file. Verifying you attached February and not January should
                not require downloading it again. */}
            <button
              type="button"
              onClick={onOpen ?? undefined}
              disabled={!onOpen}
              title={onOpen ? `Preview ${doc.fileName ?? label}` : undefined}
              style={s(
                `flex:1;min-width:0;display:flex;align-items:baseline;gap:8px;padding:0;border:0;background:none;text-align:left;cursor:${onOpen ? 'pointer' : 'default'}`,
              )}
            >
              <span
                style={s(
                  `min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:var(--ss-text-sm);font-weight:600;color:${onOpen ? 'var(--accent-text)' : 'var(--text)'}`,
                )}
              >
                {doc.fileName ?? 'Uploaded'}
              </span>
              {doc.sizeBytes ? (
                <span style={s('flex-shrink:0;font-size:11px;color:var(--faint)')}>
                  {formatBytes(doc.sizeBytes)}
                </span>
              ) : null}
            </button>
            {!locked ? (
              <span style={s('display:flex;align-items:center;gap:4px;flex-shrink:0')}>
                <label htmlFor={inputId} className="ss-slot-act">
                  Replace
                </label>
                {onRemove ? (
                  <button
                    type="button"
                    onClick={onRemove}
                    className="ss-slot-act"
                    data-tone="danger"
                    aria-label={`Remove ${doc.fileName ?? label}`}
                  >
                    Remove
                  </button>
                ) : null}
              </span>
            ) : null}
          </>
        ) : (
          <>
            <Icon name="upload" size={15} color={missing ? 'var(--danger)' : 'var(--muted)'} />
            <span style={s('flex:1;min-width:0;font-size:12px;color:var(--muted)')}>
              {missing ? 'Needed' : 'Not uploaded'}
              {mayTake ? (
                <span style={s('display:block;font-size:11px;color:var(--faint);margin-top:1px')}>
                  Drop a file here, or
                </span>
              ) : null}
            </span>
            {mayTake ? (
              <label htmlFor={inputId} className="ss-slot-act" data-tone="accent" data-lg="true">
                Choose file
              </label>
            ) : null}
          </>
        )}

        <input
          id={inputId}
          type="file"
          accept={DOC_ACCEPT}
          disabled={disabled}
          className="ss-file-hidden"
          onChange={(e) => {
            take(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
      </div>
      {refused ? <Refusal message={refused} /> : null}
      {error && !refused ? <Refusal message={error} /> : null}
    </div>
  );
}

/**
 * Leftover documents — requested extras and files that have no named slot.
 *
 * Licence, SSN and the three bank statements already have per-slot inputs. This panel is only
 * for what those slots cannot take (insurance, a desk request, an "other"). No type dropdown
 * and no second catch-all sitting under the slots.
 */
export function DocumentsSection({
  documents,
  leftoverType,
  locked,
  canAttach,
  uploading,
  removingId,
  error,
  onUpload,
  onDelete,
  onOpen,
}: {
  /** Own list — never the case-data form blob. Already filtered to non-slot types. */
  documents: readonly VerificationDocument[];
  leftoverType: VerificationDocType;
  /** Handed over: no Remove. */
  locked: boolean;
  /** A file may still be added. Defaults to `!locked` — see `DocSlot`. */
  canAttach?: boolean | undefined;
  uploading: boolean;
  /** WHICH row is being removed, so only that row reports. */
  removingId: string | null;
  error: string | null;
  onUpload: (files: File[]) => void;
  onDelete: (id: string) => void;
  onOpen: (id: string, fileName: string) => void;
}) {
  const [dragging, setDragging] = useState(false);
  const [refused, setRefused] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const mayAttach = canAttach ?? !locked;
  const requested = documents.filter((d) => d.status === 'requested');
  const received = documents.filter((d) => d.status === 'received');
  const showLeftoverUpload = mayAttach && requested.length > 0;

  /**
   * ALL files are checked before ANY is sent.
   *
   * The route uploads them one at a time and throws on the first refusal, so a mixed pick used to
   * store the good files and then return an error — leaving the form showing neither the error's
   * cause nor the files that landed until a reload. Refusing the whole batch up front is the only
   * outcome an agent can act on.
   */
  const take = (list: FileList | null | undefined): void => {
    if (!mayAttach) return;
    const files = Array.from(list ?? []);
    if (files.length === 0) return;
    const reason = firstRejection(files);
    if (reason) {
      setRefused(files.length === 1 ? reason : `${reason} Nothing was uploaded.`);
      return;
    }
    setRefused(null);
    onUpload(files);
  };

  /** Paste while the section can accept files. Uploads in flight do not drop the listener. */
  useEffect(() => {
    if (!mayAttach) return;
    const onPaste = (e: ClipboardEvent): void => {
      const items = e.clipboardData?.files;
      if (!items || items.length === 0) return;
      take(items);
      e.preventDefault();
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mayAttach, leftoverType]);

  return (
    <Section title="Other documents">
      <div style={s('grid-column:1/-1;display:grid;gap:12px')}>
        {requested.length > 0 ? (
          <div
            style={s(
              'display:grid;gap:6px;padding:12px 14px;border-radius:var(--radius-md);background:var(--intent-warning-bg,rgba(251,191,36,.1));border:1px solid var(--intent-warning-bd,rgba(251,191,36,.3))',
            )}
          >
            <span style={s('font-size:13px;font-weight:800;color:var(--text)')}>
              Verification has asked for {requested.length} document{requested.length === 1 ? '' : 's'}
            </span>
            <ul style={s('margin:0;padding-left:18px;display:grid;gap:3px')}>
              {requested.map((d) => (
                <li key={d.id} style={s('font-size:12px;color:var(--text2)')}>
                  {d.label || DOC_LABELS[d.docType]}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {received.length > 0 ? (
          <ul style={s('margin:0;padding:0;list-style:none;display:grid;gap:8px')}>
            {received.map((d) => {
              const removing = removingId === d.id;
              return (
                <li
                  key={d.id}
                  /* `min-width:0` is load-bearing: without it this flex row's incompressible content
                     (filename + type chip) gives it a ~210px floor that scrolls the Sales scroller
                     sideways on a 320px phone. */
                  style={s(
                    'display:flex;align-items:center;justify-content:space-between;gap:12px;min-width:0;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
                  )}
                >
                  {/* The filename PREVIEWS the file — the bytes come back through our own origin with
                      `Content-Disposition: inline`, so the browser renders them. */}
                  <button
                    type="button"
                    onClick={() => onOpen(d.id, d.fileName ?? DOC_LABELS[d.docType])}
                    title={`Preview ${d.fileName ?? DOC_LABELS[d.docType]}`}
                    style={s(
                      'display:flex;align-items:center;gap:9px;min-width:0;flex:1;border:none;background:transparent;padding:0;text-align:left;cursor:pointer',
                    )}
                  >
                    <Icon name="doc" size={16} color="var(--muted)" />
                    <span
                      style={s(
                        'min-width:0;font-size:13px;color:var(--accent-text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap',
                      )}
                    >
                      {d.fileName ?? DOC_LABELS[d.docType]}
                    </span>
                    <span style={s('font-size:11px;color:var(--faint);flex-shrink:0')}>
                      {DOC_LABELS[d.docType]}
                      {d.sizeBytes ? ` · ${formatBytes(d.sizeBytes)}` : ''}
                    </span>
                  </button>
                  {!locked ? (
                    <button
                      type="button"
                      onClick={() => onDelete(d.id)}
                      disabled={removing}
                      className="ss-slot-act"
                      data-tone="danger"
                      aria-label={`Remove ${d.fileName ?? DOC_LABELS[d.docType]}`}
                    >
                      {removing ? 'Removing…' : 'Remove'}
                    </button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        ) : null}

        {showLeftoverUpload ? (
          /* Anchors the hidden multi-file input — see the note on the slot row above. */
          <div style={s('position:relative;display:grid;gap:10px')}>
            <label
              htmlFor="app-docs-input"
              className={`ss-attach${dragging ? ' is-drag' : ''}`}
              aria-busy={uploading || undefined}
              onDragOver={(e) => {
                if (locked) return;
                e.preventDefault();
                if (!dragging) setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                setDragging(false);
              }}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                take(e.dataTransfer.files);
              }}
            >
              <Icon
                name={uploading ? 'spinner' : 'upload'}
                size={26}
                color="var(--accent)"
                strokeWidth={1.8}
                {...(uploading ? { className: 'ss-spin' } : {})}
              />
              <div style={s('font-size:var(--ss-text-md);color:var(--text2)')}>
                <span style={s('color:var(--accent);font-weight:700')}>
                  {uploading ? 'Uploading — add more' : `Attach ${DOC_LABELS[leftoverType].toLowerCase()}`}
                </span>
                {uploading ? null : ', drag & drop, or paste'}
              </div>
              <div style={s('font-size:var(--ss-text-xs);color:var(--muted)')}>{DOC_ACCEPT_HINT}</div>
            </label>
            <input
              id="app-docs-input"
              ref={inputRef}
              type="file"
              multiple
              accept={DOC_ACCEPT}
              disabled={!mayAttach}
              aria-label="Choose documents to upload"
              className="ss-file-hidden"
              onChange={(e) => {
                take(e.currentTarget.files);
                e.currentTarget.value = '';
              }}
            />
            {refused ? <Refusal message={refused} /> : null}
            {error && !refused ? <Refusal message={error} /> : null}
          </div>
        ) : null}
      </div>
    </Section>
  );
}
