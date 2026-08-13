import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  AnnouncementContent,
  parseAnnouncementContent,
  sanitizeAnnouncementHtml,
} from './AnnouncementContent';

const getAnnouncementAssetDownload = vi.fn();

vi.mock('../../../api/announcements', () => ({
  getAnnouncementAssetDownload: (id: string) => getAnnouncementAssetDownload(id),
}));

beforeEach(() => {
  vi.clearAllMocks();
  getAnnouncementAssetDownload.mockResolvedValue({
    id: 'file_map',
    name: 'Map image.png',
    mime: 'image/png',
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

  it('sanitizes rich editor HTML and only permits governed image URLs', () => {
    const html = sanitizeAnnouncementHtml(
      '<h2 style="text-align:right;color:red" onclick="bad()">News</h2>' +
        '<img src="https://tracker.test/pixel.png" onerror="bad()">' +
        '<img src="/v1/files/file_safe/content"><script>bad()</script>',
    );
    expect(html).toContain('<h2 style="text-align: right;">News</h2>');
    expect(html).toContain('/v1/files/file_safe/content');
    expect(html).not.toContain('tracker.test');
    expect(html).not.toContain('script');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('color:');
  });

  it('resolves rich-editor images through the authenticated download API', async () => {
    render(
      <AnnouncementContent
        text={'<p><img src="/v1/files/file_map/content" alt="Route map"></p>'}
      />,
    );
    await waitFor(() =>
      expect(screen.getByRole('img', { name: 'Route map' })).toHaveAttribute(
        'src',
        'https://example.test/map.png',
      ),
    );
    expect(getAnnouncementAssetDownload).toHaveBeenCalledWith('file_map');
  });

  it('upgrades legacy image attachments from filename links to visible images', async () => {
    render(
      <AnnouncementContent
        text={'<p><a href="/v1/files/file_map/content">Map image.png</a></p>'}
      />,
    );
    expect(await screen.findByRole('img', { name: 'Map image.png' })).toHaveAttribute(
      'src',
      'https://example.test/map.png',
    );
    expect(screen.queryByRole('link', { name: 'Map image.png' })).not.toBeInTheDocument();
  });
});
