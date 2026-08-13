import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsBlock } from './AnnouncementsBlock';

const listManagerAnnouncements = vi.fn();
const publishManagerAnnouncement = vi.fn();
const uploadAnnouncementAsset = vi.fn();
const getAnnouncementAssetDownload = vi.fn();

vi.mock('@ckeditor/ckeditor5-react', () => ({
  CKEditor: ({ data, onChange, config }: {
    data: string;
    onChange: (event: unknown, editor: { getData: () => string }) => void;
    config: { placeholder?: string };
  }) => (
    <textarea
      aria-label="Rich text editor"
      value={data}
      placeholder={config.placeholder}
      onChange={(event) => onChange(event, { getData: () => event.target.value })}
    />
  ),
}));

vi.mock('../../../api/announcements', () => ({
  listManagerAnnouncements: () => listManagerAnnouncements(),
  publishManagerAnnouncement: (input: unknown) => publishManagerAnnouncement(input),
  uploadAnnouncementAsset: (file: File) => uploadAnnouncementAsset(file),
  getAnnouncementAssetDownload: (id: string) => getAnnouncementAssetDownload(id),
}));

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
    fireEvent.change(screen.getByRole('textbox', { name: 'Rich text editor' }), {
      target: { value: '<p>Target raised to <strong>12,000 gallons</strong>.</p>' },
    });

    const preview = within(screen.getByLabelText('Live targeted-agent preview'));
    expect(preview.getByRole('heading', { name: 'Q3 Sales Target Update' })).toBeVisible();
    expect(preview.getByText('12,000 gallons')).toBeVisible();
  });

  it('publishes a targeted announcement and reloads the published list', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Maintenance' } });
    fireEvent.change(screen.getByRole('textbox', { name: 'Rich text editor' }), {
      target: { value: '<p>CRM maintenance starts at 8 PM.</p>' },
    });
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

  it('previews CKEditor headings and alignment from safe HTML', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    fireEvent.change(screen.getByRole('textbox', { name: 'Rich text editor' }), {
      target: {
        value: '<h2 style="text-align:center">Important route change</h2><script>alert(1)</script>',
      },
    });
    const heading = within(screen.getByLabelText('Live targeted-agent preview')).getByRole(
      'heading',
      { name: 'Important route change' },
    );
    expect(heading).toHaveStyle({ textAlign: 'center' });
    expect(screen.queryByText('alert(1)')).not.toBeInTheDocument();
  });
});
