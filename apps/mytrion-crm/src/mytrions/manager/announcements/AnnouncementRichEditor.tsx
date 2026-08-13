import { CKEditor } from '@ckeditor/ckeditor5-react';
import {
  Alignment,
  Autoformat,
  BlockQuote,
  Bold,
  ClassicEditor,
  Essentials,
  FileRepository,
  Heading,
  HorizontalLine,
  Image,
  ImageCaption,
  ImageResize,
  ImageStyle,
  ImageToolbar,
  ImageUpload,
  Italic,
  Link,
  List,
  Paragraph,
  PasteFromOffice,
  RemoveFormat,
  Strikethrough,
  Table,
  TableToolbar,
  Underline,
  type Editor,
  type FileLoader,
  type UploadAdapter,
  type UploadResponse,
} from 'ckeditor5';
import { useMemo, useRef, useState, type ChangeEvent } from 'react';
import { uploadAnnouncementAsset } from '../../../api/announcements';
import { Button } from '../../../ds/Button/Button';
import 'ckeditor5/ckeditor5.css';
import './announcementRichEditor.css';

interface AnnouncementRichEditorProps {
  id: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export function durableFileUrl(fileId: string): string {
  return `/v1/files/${encodeURIComponent(fileId)}/content`;
}

export class MytrionImageUploadAdapter implements UploadAdapter {
  constructor(private readonly loader: FileLoader) {}

  async upload(): Promise<UploadResponse> {
    const file = await this.loader.file;
    if (!file) throw new Error('No image was selected.');
    const asset = await uploadAnnouncementAsset(file);
    return { default: durableFileUrl(asset.fileId) };
  }

  abort(): void {
    // requestMultipart currently has no controller hand-off. Removing an image still removes it
    // from the document; a completed orphan upload remains governed by file retention cleanup.
  }
}

function MytrionUploadAdapterPlugin(editor: Editor): void {
  editor.plugins.get(FileRepository).createUploadAdapter = (loader) =>
    new MytrionImageUploadAdapter(loader);
}

export function AnnouncementRichEditor({
  id,
  value,
  onChange,
  placeholder,
}: AnnouncementRichEditorProps) {
  const editorRef = useRef<Editor | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [uploadingFile, setUploadingFile] = useState(false);
  const configuredKey = import.meta.env.VITE_CKEDITOR_LICENSE_KEY?.trim();
  const licenseKey = configuredKey || (import.meta.env.DEV ? 'GPL' : null);
  const config = useMemo(
    () => ({
      licenseKey: licenseKey ?? 'GPL',
      plugins: [
        Essentials,
        Paragraph,
        Heading,
        Autoformat,
        Bold,
        Italic,
        Underline,
        Strikethrough,
        Link,
        List,
        BlockQuote,
        Alignment,
        HorizontalLine,
        Image,
        ImageCaption,
        ImageStyle,
        ImageResize,
        ImageToolbar,
        ImageUpload,
        Table,
        TableToolbar,
        PasteFromOffice,
        RemoveFormat,
      ],
      extraPlugins: [MytrionUploadAdapterPlugin],
      toolbar: {
        items: [
          'undo',
          'redo',
          '|',
          'heading',
          '|',
          'bold',
          'italic',
          'underline',
          'strikethrough',
          'removeFormat',
          '|',
          'bulletedList',
          'numberedList',
          'blockQuote',
          '|',
          'alignment',
          'link',
          'insertImage',
          'insertTable',
          'horizontalLine',
        ],
        shouldNotGroupWhenFull: false,
      },
      image: {
        toolbar: [
          'imageTextAlternative',
          'toggleImageCaption',
          '|',
          'imageStyle:inline',
          'imageStyle:wrapText',
          'imageStyle:breakText',
          '|',
          'resizeImage',
        ],
      },
      table: { contentToolbar: ['tableColumn', 'tableRow', 'mergeTableCells'] },
      link: {
        addTargetToExternalLinks: true,
        defaultProtocol: 'https://',
      },
      ...(placeholder ? { placeholder } : {}),
    }),
    [licenseKey, placeholder],
  );

  const attachFile = async (event: ChangeEvent<HTMLInputElement>): Promise<void> => {
    const file = event.target.files?.[0];
    event.target.value = '';
    const editor = editorRef.current;
    if (!file || !editor) return;
    setUploadingFile(true);
    setStatus(`Uploading ${file.name}…`);
    try {
      const asset = await uploadAnnouncementAsset(file);
      editor.model.change((writer) => {
        const text = writer.createText(asset.name || file.name, {
          linkHref: durableFileUrl(asset.fileId),
        });
        editor.model.insertContent(text, editor.model.document.selection);
      });
      editor.editing.view.focus();
      setStatus(`${asset.name || file.name} attached.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : `Could not upload ${file.name}.`);
    } finally {
      setUploadingFile(false);
    }
  };

  if (!licenseKey) {
    return (
      <div className="an-editor-license" role="alert">
        CKEditor needs <code>VITE_CKEDITOR_LICENSE_KEY</code> in the production environment.
      </div>
    );
  }

  return (
    <div className="an-ckeditor" id={`${id}-editor`}>
      <CKEditor
        editor={ClassicEditor}
        config={config}
        data={value}
        onReady={(editor) => {
          editorRef.current = editor;
        }}
        onAfterDestroy={() => {
          editorRef.current = null;
        }}
        onChange={(_, editor) => {
          const html = editor.getData();
          onChange(html);
          setStatus(html.length > 10_000 ? 'The announcement is over the 10,000 character limit.' : null);
        }}
        onError={(error) => setStatus(error.message)}
      />
      <div className="an-ckeditor-foot">
        <Button
          size="sm"
          variant="ghost"
          icon="attach_file"
          loading={uploadingFile}
          onClick={() => fileInputRef.current?.click()}
        >
          Attach file
        </Button>
        <span role="status">{status}</span>
        <span>{value.length.toLocaleString()} / 10,000 HTML characters</span>
      </div>
      <input
        ref={fileInputRef}
        className="an-editor-hidden-input"
        type="file"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(event) => void attachFile(event)}
      />
    </div>
  );
}
