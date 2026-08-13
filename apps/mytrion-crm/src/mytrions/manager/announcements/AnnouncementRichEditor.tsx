import { useRef, useState, type ChangeEvent } from 'react';
import { uploadAnnouncementAsset } from '../../../api/announcements';
import { Icon } from '../../../ds/Icon/Icon';
import { AnnouncementContent } from './AnnouncementContent';
import './announcementRichEditor.css';

interface AnnouncementRichEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

type SelectionEdit = { text: string; start: number; end: number };

function selectedLines(value: string, start: number, end: number): [number, number, string] {
  const lineStart = value.lastIndexOf('\n', Math.max(0, start - 1)) + 1;
  const nextBreak = value.indexOf('\n', end);
  const lineEnd = nextBreak === -1 ? value.length : nextBreak;
  return [lineStart, lineEnd, value.slice(lineStart, lineEnd)];
}

function prefixLines(value: string, start: number, end: number, prefix: string): SelectionEdit {
  const [lineStart, lineEnd, block] = selectedLines(value, start, end);
  const replacement = block
    .split('\n')
    .map((line) => (line ? `${prefix}${line.replace(/^(#{1,3}|>|[-*]|\d+\.)\s+/, '')}` : line))
    .join('\n');
  return {
    text: `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
    start: lineStart,
    end: lineStart + replacement.length,
  };
}

function numberedLines(value: string, start: number, end: number): SelectionEdit {
  const [lineStart, lineEnd, block] = selectedLines(value, start, end);
  const replacement = block
    .split('\n')
    .map((line, index) => (line ? `${index + 1}. ${line.replace(/^\d+\.\s+/, '')}` : line))
    .join('\n');
  return {
    text: `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
    start: lineStart,
    end: lineStart + replacement.length,
  };
}

function alignmentEdit(
  value: string,
  start: number,
  end: number,
  align: 'left' | 'center' | 'right',
): SelectionEdit {
  const [lineStart, lineEnd, block] = selectedLines(value, start, end);
  const existing = block.match(/^:::align-(?:left|center|right)\s*\n([\s\S]*?)\n:::\s*$/);
  const content = existing?.[1] ?? block;
  const replacement = align === 'left' ? content : `:::align-${align}\n${content}\n:::`;
  return {
    text: `${value.slice(0, lineStart)}${replacement}${value.slice(lineEnd)}`,
    start: lineStart,
    end: lineStart + replacement.length,
  };
}

export function AnnouncementRichEditor({
  id,
  value,
  onChange,
  placeholder,
}: AnnouncementRichEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [mode, setMode] = useState<'write' | 'preview'>('write');
  const [uploading, setUploading] = useState<'image' | 'file' | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  const applyEdit = (edit: SelectionEdit): void => {
    onChange(edit.text.slice(0, 10_000));
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(edit.start, Math.min(edit.end, 10_000));
    });
  };

  const wrap = (before: string, after: string, fallback: string): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const { selectionStart: start, selectionEnd: end } = textarea;
    const chosen = value.slice(start, end) || fallback;
    const replacement = `${before}${chosen}${after}`;
    applyEdit({
      text: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
      start: start + before.length,
      end: start + before.length + chosen.length,
    });
  };

  const transformLines = (transform: (start: number, end: number) => SelectionEdit): void => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    applyEdit(transform(textarea.selectionStart, textarea.selectionEnd));
  };

  const insertToken = (token: string): void => {
    const textarea = textareaRef.current;
    const start = textarea?.selectionStart ?? value.length;
    const end = textarea?.selectionEnd ?? value.length;
    const leading = start > 0 && value[start - 1] !== '\n' ? '\n' : '';
    const trailing = end < value.length && value[end] !== '\n' ? '\n' : '';
    const replacement = `${leading}${token}${trailing}`;
    applyEdit({
      text: `${value.slice(0, start)}${replacement}${value.slice(end)}`,
      start: start + replacement.length,
      end: start + replacement.length,
    });
  };

  const upload = async (event: ChangeEvent<HTMLInputElement>, kind: 'image' | 'file') => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(kind);
    setStatus(`Uploading ${file.name}…`);
    try {
      const asset = await uploadAnnouncementAsset(file);
      const token = `[[${kind}:${asset.fileId}|${encodeURIComponent(asset.name || file.name)}]]`;
      insertToken(token);
      setStatus(`${asset.name || file.name} added.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
    } finally {
      setUploading(null);
    }
  };

  return (
    <div className="an-editor" data-mode={mode}>
      <div className="an-editor-topbar">
        <div className="an-editor-modes" role="tablist" aria-label="Editor mode">
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'write'}
            onClick={() => setMode('write')}
          >
            Write
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={mode === 'preview'}
            onClick={() => setMode('preview')}
          >
            <Icon name="visibility" size="sm" /> Preview
          </button>
        </div>
        <span className="an-editor-count">{value.length.toLocaleString()} / 10,000</span>
      </div>

      <div className="an-editor-toolbar" role="toolbar" aria-label="Announcement formatting">
        <div className="an-tool-group" aria-label="Text style">
          <button type="button" aria-label="Heading 2" title="Heading 2" onClick={() => transformLines((start, end) => prefixLines(value, start, end, '## '))}>H2</button>
          <button type="button" aria-label="Heading 3" title="Heading 3" onClick={() => transformLines((start, end) => prefixLines(value, start, end, '### '))}>H3</button>
          <button type="button" aria-label="Bold" title="Bold" onClick={() => wrap('**', '**', 'bold text')}><Icon name="format_bold" /></button>
          <button type="button" aria-label="Italic" title="Italic" onClick={() => wrap('_', '_', 'italic text')}><Icon name="format_italic" /></button>
        </div>
        <div className="an-tool-group" aria-label="Structure">
          <button type="button" aria-label="Bulleted list" title="Bulleted list" onClick={() => transformLines((start, end) => prefixLines(value, start, end, '- '))}><Icon name="list" /></button>
          <button type="button" aria-label="Numbered list" title="Numbered list" onClick={() => transformLines((start, end) => numberedLines(value, start, end))}><Icon name="format_list_numbered" /></button>
          <button type="button" aria-label="Quote" title="Quote" onClick={() => transformLines((start, end) => prefixLines(value, start, end, '> '))}>❝</button>
          <button type="button" aria-label="Link" title="Link" onClick={() => wrap('[', '](https://)', 'link text')}><Icon name="link" /></button>
        </div>
        <div className="an-tool-group" aria-label="Alignment">
          {(['left', 'center', 'right'] as const).map((alignment) => (
            <button
              type="button"
              aria-label={`Align ${alignment}`}
              title={`Align ${alignment}`}
              key={alignment}
              onClick={() => transformLines((start, end) => alignmentEdit(value, start, end, alignment))}
            >
              <span className="an-align-glyph" data-align={alignment} aria-hidden="true"><i /><i /><i /></span>
            </button>
          ))}
        </div>
        <div className="an-tool-group an-tool-uploads" aria-label="Insert">
          <button type="button" aria-label="Upload image" title="Upload image" disabled={uploading != null} onClick={() => imageInputRef.current?.click()}>
            <span className="an-tool-image" aria-hidden="true">▧</span> {uploading === 'image' ? 'Uploading…' : 'Image'}
          </button>
          <button type="button" aria-label="Attach file" title="Attach file" disabled={uploading != null} onClick={() => fileInputRef.current?.click()}>
            <Icon name="attach_file" /> {uploading === 'file' ? 'Uploading…' : 'File'}
          </button>
        </div>
      </div>

      <input
        ref={imageInputRef}
        className="an-editor-hidden-input"
        type="file"
        accept="image/*"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void upload(event, 'image')}
      />
      <input
        ref={fileInputRef}
        className="an-editor-hidden-input"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void upload(event, 'file')}
      />

      {mode === 'write' ? (
        <textarea
          ref={textareaRef}
          id={id}
          value={value}
          onChange={(event) => {
            onChange(event.target.value);
            setStatus(null);
          }}
          placeholder={placeholder}
          maxLength={10_000}
          rows={11}
        />
      ) : (
        <div className="an-editor-preview" role="tabpanel" aria-label="Announcement body preview">
          {value.trim() ? <AnnouncementContent text={value} /> : <p>Start writing to preview the announcement.</p>}
        </div>
      )}
      <div className="an-editor-foot">
        {status ? <span role="status">{status}</span> : <span />}
        <span>Images and files are available only to signed-in Mytrion users.</span>
      </div>
    </div>
  );
}
