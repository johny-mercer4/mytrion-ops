import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsBlock } from './AnnouncementsBlock';

const listManagerAnnouncements = vi.fn();
const publishManagerAnnouncement = vi.fn();
const uploadAnnouncementAsset = vi.fn();
const getAnnouncementAssetDownload = vi.fn();

vi.mock('@tiptap/react', async () => {
  const React = await import('react');
  type EditorOptions = {
    content?: string;
    editorProps?: { attributes?: Record<string, string> };
    onUpdate?: (input: { editor: FakeEditor }) => void;
  };
  type FakeEditor = {
    options: EditorOptions;
    getHTML: () => string;
    getAttributes: () => Record<string, string>;
    isActive: () => boolean;
    chain: () => Record<string, (...args: unknown[]) => unknown>;
    can: () => { chain: () => Record<string, (...args: unknown[]) => unknown> };
    commands: { setContent: (html: string) => void };
  };

  function commandChain(): Record<string, (...args: unknown[]) => unknown> {
    const chain: Record<string, (...args: unknown[]) => unknown> = {};
    const proxy = new Proxy(chain, {
      get: (_, key: string) => (key === 'run' ? () => true : () => proxy),
    });
    return proxy;
  }

  return {
    useEditor: (options: EditorOptions) => {
      const optionsRef = React.useRef(options);
      optionsRef.current = options;
      const editorRef = React.useRef<FakeEditor | null>(null);
      if (!editorRef.current) {
        let html = options.content ?? '';
        const chain = commandChain();
        editorRef.current = {
          options: optionsRef.current,
          getHTML: () => html,
          getAttributes: () => ({}),
          isActive: () => false,
          chain: () => chain,
          can: () => ({ chain: () => chain }),
          commands: {
            setContent: (next: string) => {
              html = next;
            },
          },
        };
      }
      editorRef.current.options = optionsRef.current;
      return editorRef.current;
    },
    useEditorState: ({
      editor,
      selector,
    }: {
      editor: FakeEditor | null;
      selector: (input: { editor: FakeEditor | null }) => unknown;
    }) => selector({ editor }),
    EditorContent: ({ editor }: { editor: FakeEditor | null }) =>
      React.createElement('textarea', {
        role: 'textbox',
        'aria-label': 'Rich text editor',
        value: editor?.getHTML() ?? '',
        onChange: (event: React.ChangeEvent<HTMLTextAreaElement>) => {
          if (!editor) return;
          editor.commands.setContent(event.target.value);
          editor.options.onUpdate?.({ editor });
        },
      }),
  };
});

vi.mock('../../../api/announcements', () => ({
  listManagerAnnouncements: () => listManagerAnnouncements(),
  publishManagerAnnouncement: (input: unknown) => publishManagerAnnouncement(input),
  uploadAnnouncementAsset: (file: File) => uploadAnnouncementAsset(file),
  getAnnouncementAssetDownload: (id: string) => getAnnouncementAssetDownload(id),
}));

function setEditorHtml(html: string): void {
  const editor = screen.getByRole('textbox', { name: 'Rich text editor' });
  fireEvent.change(editor, { target: { value: html } });
}

beforeEach(() => {
  vi.clearAllMocks();
  listManagerAnnouncements.mockResolvedValue([]);
  publishManagerAnnouncement.mockResolvedValue({ id: 'man_1' });
  uploadAnnouncementAsset.mockResolvedValue({
    fileId: 'file_1',
    name: 'route-map.png',
    mime: 'image/png',
    sizeBytes: 42,
    url: 'https://example.test/initial',
    expiresAt: '2026-08-13T23:00:00.000Z',
  });
  getAnnouncementAssetDownload.mockResolvedValue({
    id: 'file_1',
    name: 'route-map.png',
    mime: 'image/png',
    url: 'https://example.test/fresh.png',
    expiresAt: '2026-08-13T23:00:00.000Z',
  });
});

describe('AnnouncementsBlock', () => {
  it('updates the Sales preview as the manager composes', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    fireEvent.change(screen.getByLabelText('Title'), {
      target: { value: 'Q3 Sales Target Update' },
    });
    setEditorHtml('<p>Target raised to <strong>12,000 gallons</strong>.</p>');

    const preview = within(screen.getByLabelText('Live targeted-agent preview'));
    expect(preview.getByRole('heading', { name: 'Q3 Sales Target Update' })).toBeVisible();
    expect(preview.getByText('12,000 gallons')).toBeVisible();
  });

  it('publishes a targeted announcement and reloads the published list', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Maintenance' } });
    setEditorHtml('<p>CRM maintenance starts at 8 PM.</p>');
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sales' }));
    fireEvent.click(screen.getByRole('radio', { name: 'High priority' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));

    await waitFor(() =>
      expect(publishManagerAnnouncement).toHaveBeenCalledWith({
        title: 'Maintenance',
        body: '<p>CRM maintenance starts at 8 PM.</p>',
        targetDepartments: ['sales'],
        priority: 'high',
      }),
    );
    await waitFor(() => expect(listManagerAnnouncements).toHaveBeenCalledTimes(2));
    expect(screen.getByText('Published to Sales.')).toBeVisible();
  });

  it('previews Tiptap headings and alignment from safe HTML', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    setEditorHtml(
      '<h2 style="text-align:center">Important route change</h2><script>alert(1)</script>',
    );
    const heading = within(screen.getByLabelText('Live targeted-agent preview')).getByRole(
      'heading',
      { name: 'Important route change' },
    );
    expect(heading).toHaveStyle({ textAlign: 'center' });
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument();
  });

  it('opens and closes a published announcement with its full content and metadata', async () => {
    listManagerAnnouncements.mockResolvedValue([
      {
        id: 'announcement_old',
        title: 'Quarter policy update',
        body: '<p>Use the <strong>new process</strong>.</p>',
        targetDepartments: ['sales', 'billing'],
        priority: 'normal',
        createdByUserId: 'manager_1',
        publishedAt: '2026-08-13T12:30:00.000Z',
        createdAt: '2026-08-13T12:30:00.000Z',
        viewCount: 14,
      },
    ]);

    render(<AnnouncementsBlock />);
    const row = await screen.findByRole('button', { name: /Quarter policy update/ });
    expect(row).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('new process')).toBeVisible();
    expect(screen.getAllByText('Sales · Billing').length).toBeGreaterThan(0);
    expect(screen.getByText('14', { selector: 'dd' })).toBeVisible();

    fireEvent.click(row);
    expect(screen.queryByText('new process')).not.toBeInTheDocument();
  });
});
