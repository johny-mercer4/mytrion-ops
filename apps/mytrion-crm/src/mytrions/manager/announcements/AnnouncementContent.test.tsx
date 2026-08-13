import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AnnouncementContent, parseAnnouncementContent } from './AnnouncementContent';

const getAnnouncementAssetDownload = vi.fn();

vi.mock('../../../api/announcements', () => ({
  getAnnouncementAssetDownload: (id: string) => getAnnouncementAssetDownload(id),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getAnnouncementAssetDownload.mockResolvedValue({
    id: 'file_map',
    name: 'Map image.png',
    url: 'https://example.test/map.png',
    expiresAt: '2026-08-13T23:00:00.000Z',
  });
});

describe('AnnouncementContent', () => {
  it('parses aligned blocks and durable attachment tokens', () => {
    expect(
      parseAnnouncementContent(
        'Intro\n\n:::align-right\n**Read this**\n[[file:file_guide|Driver%20guide.pdf]]\n:::',
      ),
    ).toEqual([
      { kind: 'markdown', text: 'Intro', align: 'left' },
      { kind: 'markdown', text: '**Read this**', align: 'right' },
      { kind: 'file', fileId: 'file_guide', name: 'Driver guide.pdf', align: 'right' },
    ]);
  });

  it('resolves a fresh signed URL when an image is displayed', async () => {
    render(<AnnouncementContent text="[[image:file_map|Map%20image.png]]" />);
    expect(await screen.findByRole('img', { name: 'Map image.png' })).toHaveAttribute(
      'src',
      'https://example.test/map.png',
    );
    expect(getAnnouncementAssetDownload).toHaveBeenCalledWith('file_map');
  });
});
