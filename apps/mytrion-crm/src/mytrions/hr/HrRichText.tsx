/**
 * The department description field — rich text, stored as MARKDOWN.
 *
 * WHY MARKDOWN AND NOT A WYSIWYG. A contenteditable editor stores HTML, and HTML from a user is a
 * sanitizing problem forever — on write, on read, and again in every future consumer (the org canvas
 * node, a Telegram message, a PDF). Markdown is inert text: the value that goes into the column cannot
 * be markup, and rendering already goes through the app's `<Markdown>` component (react-markdown +
 * rehype-sanitize), which is the same path assistant answers take. The toolbar means nobody has to
 * know markdown syntax to get bold text and a bullet list.
 *
 * The Write / Preview switch is deliberate rather than a live side-by-side: at this size (a paragraph
 * or two about what a team does) a split pane halves the writing area for no gain.
 */
import { useRef, useState, type SyntheticEvent } from 'react';
import { Bold, Eye, Italic, Link2, List, ListOrdered, Pencil } from 'lucide-react';
import { Markdown } from '../../features/chat/Markdown';
import './HrRichText.css';

type Wrap = { before: string; after: string };
type LinePrefix = { prefix: string; ordered?: boolean };

const BOLD: Wrap = { before: '**', after: '**' };
const ITALIC: Wrap = { before: '_', after: '_' };
const LINK: Wrap = { before: '[', after: '](https://)' };

export function HrRichText({
  value,
  onChange,
  id,
  placeholder,
  disabled,
  rows = 6,
}: {
  value: string;
  onChange: (next: string) => void;
  id: string;
  placeholder?: string;
  disabled?: boolean;
  rows?: number;
}) {
  const [preview, setPreview] = useState(false);
  const ref = useRef<HTMLTextAreaElement | null>(null);
  const lastSel = useRef<{ start: number; end: number } | null>(null);

  const remember = (ev: SyntheticEvent<HTMLTextAreaElement>): void => {
    const el = ev.currentTarget;
    lastSel.current = { start: el.selectionStart, end: el.selectionEnd };
  };

  /**
   * Where the toolbar applies — NOT `el.selectionStart` on its own.
   *
   * The Preview toggle unmounts the textarea, so returning to Write mounts a fresh node whose
   * selectionStart is 0 and which is not focused (the toggle button holds focus). Reading it directly
   * spliced the markers into the very beginning of a description the writer was halfway through. The
   * remembered selection survives that round trip; with no caret ever placed, the end of the text
   * (append) is the only harmless default — 0 is the one place a marker must not land.
   */
  const caretRange = (el: HTMLTextAreaElement): { start: number; end: number } => {
    if (document.activeElement === el) {
      return { start: el.selectionStart, end: el.selectionEnd };
    }
    return lastSel.current ?? { start: value.length, end: value.length };
  };

  /**
   * Wrap the selection (or insert at the caret) and restore the selection afterwards — an editor that
   * drops your cursor to the end after every Bold is worse than no toolbar at all.
   */
  const wrap = (w: Wrap): void => {
    const el = ref.current;
    if (!el) return;
    const { start, end } = caretRange(el);
    const selected = value.slice(start, end);
    const next = `${value.slice(0, start)}${w.before}${selected}${w.after}${value.slice(end)}`;
    onChange(next);
    const caret = start + w.before.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(caret, caret + selected.length);
    });
  };

  /** Prefix every line the selection touches — how a list button has to behave on a multi-line block. */
  const prefixLines = ({ prefix, ordered }: LinePrefix): void => {
    const el = ref.current;
    if (!el) return;
    const { start, end } = caretRange(el);
    const from = value.lastIndexOf('\n', start - 1) + 1;
    const toIdx = value.indexOf('\n', end);
    const to = toIdx === -1 ? value.length : toIdx;
    const block = value.slice(from, to) || '';
    const lines = block.split('\n');
    const marked = lines
      .map((line, i) => {
        const mark = ordered ? `${i + 1}. ` : prefix;
        return line.startsWith(mark) ? line : `${mark}${line}`;
      })
      .join('\n');
    onChange(`${value.slice(0, from)}${marked}${value.slice(to)}`);
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(from, from + marked.length);
    });
  };

  return (
    <div className="hr-rt" data-preview={preview ? 'on' : undefined}>
      <div className="hr-rt-bar">
        <div className="hr-rt-tools" role="group" aria-label="Formatting">
          <button
            type="button"
            className="hr-rt-icon-btn"
            aria-label="Bold"
            disabled={disabled || preview}
            onClick={() => wrap(BOLD)}
          >
            <Bold size={14} />
          </button>
          <button
            type="button"
            className="hr-rt-icon-btn"
            aria-label="Italic"
            disabled={disabled || preview}
            onClick={() => wrap(ITALIC)}
          >
            <Italic size={14} />
          </button>
          <button
            type="button"
            className="hr-rt-icon-btn"
            aria-label="Bulleted list"
            disabled={disabled || preview}
            onClick={() => prefixLines({ prefix: '- ' })}
          >
            <List size={14} />
          </button>
          <button
            type="button"
            className="hr-rt-icon-btn"
            aria-label="Numbered list"
            disabled={disabled || preview}
            onClick={() => prefixLines({ prefix: '1. ', ordered: true })}
          >
            <ListOrdered size={14} />
          </button>
          <button
            type="button"
            className="hr-rt-icon-btn"
            aria-label="Link"
            disabled={disabled || preview}
            onClick={() => wrap(LINK)}
          >
            <Link2 size={14} />
          </button>
        </div>
        <button
          type="button"
          className="hr-rt-toggle"
          aria-pressed={preview}
          onClick={() => {
            const leavingPreview = preview;
            setPreview(!preview);
            // Write mode mounts a NEW textarea, so put the caret back where the writer left it instead
            // of handing them a node whose selection is 0.
            if (leavingPreview) {
              requestAnimationFrame(() => {
                const el = ref.current;
                const sel = lastSel.current;
                if (!el || !sel) return;
                el.focus();
                el.setSelectionRange(sel.start, sel.end);
              });
            }
          }}
        >
          {preview ? <Pencil size={13} /> : <Eye size={13} />}
          {preview ? 'Write' : 'Preview'}
        </button>
      </div>

      {preview ? (
        <div className="hr-rt-preview">
          {value.trim() ? (
            <Markdown text={value} />
          ) : (
            <p className="hr-rt-empty">Nothing to preview yet.</p>
          )}
        </div>
      ) : (
        <textarea
          id={id}
          ref={ref}
          className="hr-rt-input"
          value={value}
          rows={rows}
          disabled={disabled}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
          onSelect={remember}
          onKeyUp={remember}
          onBlur={remember}
          spellCheck
        />
      )}
    </div>
  );
}
