import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementsBlock } from './AnnouncementsBlock';

const listManagerAnnouncements = vi.fn();
const publishManagerAnnouncement = vi.fn();
const uploadAnnouncementAsset = vi.fn();
const getAnnouncementAssetDownload = vi.fn();

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
    fireEvent.change(screen.getByPlaceholderText('Share the update and any next steps…'), {
      target: { value: 'Target raised to **12,000 gallons**.' },
    });

    const preview = within(screen.getByLabelText('Live targeted-agent preview'));
    expect(preview.getByRole('heading', { name: 'Q3 Sales Target Update' })).toBeVisible();
    expect(preview.getByText('12,000 gallons')).toBeVisible();
  });

  it('publishes a targeted announcement and reloads the published list', async () => {
    render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Maintenance' } });
    fireEvent.change(screen.getByPlaceholderText('Share the update and any next steps…'), {
      target: { value: 'CRM maintenance starts at 8 PM.' },
    });
    fireEvent.click(screen.getByRole('checkbox', { name: 'Sales' }));
    fireEvent.click(screen.getByRole('radio', { name: 'High priority' }));
    fireEvent.click(screen.getByRole('button', { name: 'Publish announcement' }));

    await waitFor(() =>
      expect(publishManagerAnnouncement).toHaveBeenCalledWith({
        title: 'Maintenance',
        body: 'CRM maintenance starts at 8 PM.',
        targetDepartments: ['sales'],
        priority: 'high',
      }),
    );
    await waitFor(() => expect(listManagerAnnouncements).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('status')).toHaveTextContent('Published to Sales.');
  });

  it('formats aligned content and inserts a durable image attachment', async () => {
    const { container } = render(<AnnouncementsBlock />);
    await screen.findByText('No announcements published');

    const editor = screen.getByPlaceholderText('Share the update and any next steps…');
    fireEvent.change(editor, { target: { value: 'Important route change' } });
    fireEvent.select(editor, { target: { selectionStart: 0, selectionEnd: 22 } });
    fireEvent.click(screen.getByRole('button', { name: 'Align center' }));
    expect(editor).toHaveValue(':::align-center\nImportant route change\n:::');

    const imageInput = container.querySelector<HTMLInputElement>('input[accept="image/*"]');
    expect(imageInput).not.toBeNull();
    const image = new File(['image'], 'route-map.png', { type: 'image/png' });
    fireEvent.change(imageInput!, { target: { files: [image] } });

    await waitFor(() => expect(uploadAnnouncementAsset).toHaveBeenCalledWith(image));
    await waitFor(() =>
      expect((editor as HTMLTextAreaElement).value).toContain('[[image:file_1|route-map.png]]'),
    );
    expect(await screen.findByRole('img', { name: 'route-map.png' })).toHaveAttribute(
      'src',
      'https://example.test/fresh.png',
    );
  });
});
