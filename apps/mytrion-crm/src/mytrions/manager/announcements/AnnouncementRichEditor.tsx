import Image from '@tiptap/extension-image';
import { TableKit } from '@tiptap/extension-table';
import TextAlign from '@tiptap/extension-text-align';
import { EditorContent, useEditor, useEditorState, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { uploadAnnouncementAsset } from '../../../api/announcements';
import { Button } from '../../../ds/Button/Button';
import { Icon, type IconName } from '../../../ds/Icon/Icon';
import './announcementRichEditor.css';

interface AnnouncementRichEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

interface ToolbarButtonProps {
  label: string;
  icon?: IconName;
  text?: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
}

const MIN_IMAGE_WIDTH = 120;

export function durableFileUrl(fileId: string): string {
  return `/v1/files/${encodeURIComponent(fileId)}/content`;
}

function ToolbarButton({ label, icon, text, active, disabled, onClick }: ToolbarButtonProps) {
  return (
    <button
      type="button"
      className="an-tiptap-tool"
      aria-label={label}
      aria-pressed={active || undefined}
      title={label}
      disabled={disabled}
      onClick={onClick}
    >
      {icon ? <Icon name={icon} /> : <span className="an-tiptap-glyph">{text}</span>}
    </button>
  );
}

function askForLink(editor: Editor): void {
  const current = editor.getAttributes('link')['href'] as string | undefined;
  const href = window.prompt('Link URL', current ?? 'https://');
  if (href === null) return;
  if (!href.trim()) {
    editor.chain().focus().extendMarkRange('link').unsetLink().run();
    return;
  }
  editor.chain().focus().extendMarkRange('link').setLink({ href: href.trim() }).run();
}

export function AnnouncementRichEditor({
  id,
  value,
  onChange,
  placeholder,
}: AnnouncementRichEditorProps) {
  const imageInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploading, setUploading] = useState<'image' | 'file' | null>(null);
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [2, 3] },
        link: {
          autolink: true,
          defaultProtocol: 'https',
          HTMLAttributes: { rel: 'noopener noreferrer', target: '_blank' },
        },
      }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({
        allowBase64: false,
        resize: {
          enabled: true,
          directions: ['top-left', 'top-right', 'bottom-left', 'bottom-right'],
          minWidth: MIN_IMAGE_WIDTH,
          minHeight: 80,
          alwaysPreserveAspectRatio: true,
        },
      }),
      TableKit.configure({ table: { resizable: true, allowTableNodeSelection: true } }),
    ],
    content: value,
    editorProps: {
      attributes: {
        id,
        role: 'textbox',
        'aria-label': 'Rich text editor',
        'aria-multiline': 'true',
        class: 'an-tiptap-content',
        'data-placeholder': placeholder ?? '',
      },
    },
    onUpdate: ({ editor: nextEditor }) => {
      const html = nextEditor.getHTML();
      onChange(html);
      setStatus(
        html.length > 10_000 ? 'The announcement is over the 10,000 character limit.' : null,
      );
    },
  });

  useEffect(() => {
    if (editor && value !== editor.getHTML()) editor.commands.setContent(value, { emitUpdate: false });
  }, [editor, value]);

  const toolbar = useEditorState({
    editor,
    selector: ({ editor: current }) => ({
      heading: current?.isActive('heading', { level: 2 })
        ? '2'
        : current?.isActive('heading', { level: 3 })
          ? '3'
          : 'paragraph',
      bold: current?.isActive('bold') ?? false,
      italic: current?.isActive('italic') ?? false,
      underline: current?.isActive('underline') ?? false,
      strike: current?.isActive('strike') ?? false,
      bulletList: current?.isActive('bulletList') ?? false,
      orderedList: current?.isActive('orderedList') ?? false,
      blockquote: current?.isActive('blockquote') ?? false,
      link: current?.isActive('link') ?? false,
      alignLeft: current?.isActive({ textAlign: 'left' }) ?? false,
      alignCenter: current?.isActive({ textAlign: 'center' }) ?? false,
      alignRight: current?.isActive({ textAlign: 'right' }) ?? false,
      table: current?.isActive('table') ?? false,
      canUndo: current?.can().chain().undo().run() ?? false,
      canRedo: current?.can().chain().redo().run() ?? false,
    }),
  });
  const state = toolbar ?? {
    heading: 'paragraph',
    bold: false,
    italic: false,
    underline: false,
    strike: false,
    bulletList: false,
    orderedList: false,
    blockquote: false,
    link: false,
    alignLeft: false,
    alignCenter: false,
    alignRight: false,
    table: false,
    canUndo: false,
    canRedo: false,
  };

  const uploadImage = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editor) return;
    setUploading('image');
    setStatus(`Uploading ${file.name}…`);
    try {
      const asset = await uploadAnnouncementAsset(file);
      editor.chain().focus().setImage({
        src: durableFileUrl(asset.fileId),
        alt: asset.name || file.name,
      }).run();
      setStatus(`${asset.name || file.name} added.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
    } finally {
      setUploading(null);
    }
  };

  const attachFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !editor) return;
    setUploading('file');
    setStatus(`Uploading ${file.name}…`);
    try {
      const asset = await uploadAnnouncementAsset(file);
      editor.chain().focus().insertContent({
        type: 'text',
        text: asset.name || file.name,
        marks: [{ type: 'link', attrs: { href: durableFileUrl(asset.fileId) } }],
      }).run();
      setStatus(`${asset.name || file.name} attached.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
    } finally {
      setUploading(null);
    }
  };

  const setHeading = (level: string): void => {
    if (!editor) return;
    if (level === '2' || level === '3') {
      editor.chain().focus().setHeading({ level: Number(level) as 2 | 3 }).run();
    } else {
      editor.chain().focus().setParagraph().run();
    }
  };

  return (
    <div className="an-tiptap" data-ready={editor ? 'true' : 'false'}>
      <div className="an-tiptap-toolbar" role="toolbar" aria-label="Announcement formatting">
        <div className="an-tiptap-group">
          <ToolbarButton label="Undo" icon="undo" disabled={!state.canUndo} onClick={() => editor?.chain().focus().undo().run()} />
          <ToolbarButton label="Redo" text="↷" disabled={!state.canRedo} onClick={() => editor?.chain().focus().redo().run()} />
        </div>
        <label className="an-tiptap-heading">
          <span className="sr-only">Text style</span>
          <select value={state.heading} onChange={(event) => setHeading(event.target.value)}>
            <option value="paragraph">Paragraph</option>
            <option value="2">Heading 2</option>
            <option value="3">Heading 3</option>
          </select>
          <Icon name="expand_more" />
        </label>
        <div className="an-tiptap-group">
          <ToolbarButton label="Bold" icon="format_bold" active={state.bold} onClick={() => editor?.chain().focus().toggleBold().run()} />
          <ToolbarButton label="Italic" icon="format_italic" active={state.italic} onClick={() => editor?.chain().focus().toggleItalic().run()} />
          <ToolbarButton label="Underline" text="U" active={state.underline} onClick={() => editor?.chain().focus().toggleUnderline().run()} />
          <ToolbarButton label="Strikethrough" text="S" active={state.strike} onClick={() => editor?.chain().focus().toggleStrike().run()} />
          <ToolbarButton label="Clear formatting" text="T×" onClick={() => editor?.chain().focus().unsetAllMarks().clearNodes().run()} />
        </div>
        <div className="an-tiptap-group">
          <ToolbarButton label="Bulleted list" icon="list" active={state.bulletList} onClick={() => editor?.chain().focus().toggleBulletList().run()} />
          <ToolbarButton label="Numbered list" icon="format_list_numbered" active={state.orderedList} onClick={() => editor?.chain().focus().toggleOrderedList().run()} />
          <ToolbarButton label="Block quote" text="❝" active={state.blockquote} onClick={() => editor?.chain().focus().toggleBlockquote().run()} />
        </div>
        <div className="an-tiptap-group">
          <ToolbarButton label="Align left" text="≡" active={state.alignLeft} onClick={() => editor?.chain().focus().setTextAlign('left').run()} />
          <ToolbarButton label="Align center" text="≣" active={state.alignCenter} onClick={() => editor?.chain().focus().setTextAlign('center').run()} />
          <ToolbarButton label="Align right" text="≡" active={state.alignRight} onClick={() => editor?.chain().focus().setTextAlign('right').run()} />
        </div>
        <div className="an-tiptap-group">
          <ToolbarButton label="Link" icon="link" active={state.link} onClick={() => editor && askForLink(editor)} />
          <ToolbarButton label="Upload image" icon="photo_camera" disabled={uploading != null} onClick={() => imageInputRef.current?.click()} />
          <ToolbarButton label="Insert table" icon="table" onClick={() => editor?.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} />
          <ToolbarButton label="Horizontal rule" text="—" onClick={() => editor?.chain().focus().setHorizontalRule().run()} />
        </div>
      </div>

      {state.table ? (
        <div className="an-tiptap-table-tools" role="toolbar" aria-label="Table controls">
          <Button size="sm" variant="ghost" onClick={() => editor?.chain().focus().addRowAfter().run()}>Add row</Button>
          <Button size="sm" variant="ghost" onClick={() => editor?.chain().focus().addColumnAfter().run()}>Add column</Button>
          <Button size="sm" variant="ghost" onClick={() => editor?.chain().focus().deleteRow().run()}>Delete row</Button>
          <Button size="sm" variant="ghost" onClick={() => editor?.chain().focus().deleteColumn().run()}>Delete column</Button>
          <Button size="sm" variant="ghost" onClick={() => editor?.chain().focus().deleteTable().run()}>Delete table</Button>
        </div>
      ) : null}

      <EditorContent editor={editor} />
      <div className="an-tiptap-foot">
        <Button
          size="sm"
          variant="ghost"
          icon="attach_file"
          loading={uploading === 'file'}
          disabled={uploading != null}
          onClick={() => fileInputRef.current?.click()}
        >
          Attach file
        </Button>
        <span role="status">{status}</span>
        <span>{value.length.toLocaleString()} / 10,000 HTML characters</span>
      </div>
      <input ref={imageInputRef} className="an-editor-hidden-input" type="file" accept="image/jpeg,image/png,image/gif,image/webp" tabIndex={-1} aria-hidden="true" onChange={(event) => void uploadImage(event)} />
      <input ref={fileInputRef} className="an-editor-hidden-input" type="file" tabIndex={-1} aria-hidden="true" onChange={(event) => void attachFile(event)} />
    </div>
  );
}
