import { render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../api/hrPerson', () => ({ getHrEmployeePhotoLink: vi.fn() }));

import { getHrEmployeePhotoLink } from '../../api/hrPerson';
import { HrAvatar, resetHrAvatarCache } from './HrAvatar';

const linkMock = vi.mocked(getHrEmployeePhotoLink);

const inFourHours = (): string => new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString();

beforeEach(() => {
  resetHrAvatarCache();
  linkMock.mockReset();
});
afterEach(() => {
  resetHrAvatarCache();
});

describe('HrAvatar', () => {
  it('shows initials and asks for nothing when there is no photo', () => {
    render(<HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId={null} />);
    expect(screen.getByText('AL')).toBeInTheDocument();
    expect(linkMock).not.toHaveBeenCalled();
  });

  it('resolves a photo file id into an <img>', async () => {
    linkMock.mockResolvedValue({ url: 'https://dropbox.example/a.jpg', expiresAt: inFourHours() });
    const { container } = render(
      <HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId="file_1" />,
    );

    // Initials first — the link is a round trip, and a blank slot would be worse than a placeholder.
    expect(screen.getByText('AL')).toBeInTheDocument();
    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        'https://dropbox.example/a.jpg',
      ),
    );
    expect(linkMock).toHaveBeenCalledWith('hre_1');
  });

  /**
   * The whole reason the cache exists. The same person appears on a card, in the department modal and
   * on the org canvas; without sharing, one directory render would be one Dropbox round trip per FACE
   * per surface.
   */
  it('makes ONE request for the same photo across several avatars', async () => {
    let resolveLink: (v: { url: string; expiresAt: string }) => void = () => {};
    linkMock.mockReturnValue(
      new Promise((resolve) => {
        resolveLink = resolve;
      }),
    );

    const { container } = render(
      <>
        <HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId="file_1" />
        <HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId="file_1" size="sm" />
        <HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId="file_1" size="lg" />
      </>,
    );

    // Deduped while in flight, not merely after it resolves.
    expect(linkMock).toHaveBeenCalledTimes(1);
    resolveLink({ url: 'https://dropbox.example/a.jpg', expiresAt: inFourHours() });
    await waitFor(() => expect(container.querySelectorAll('img')).toHaveLength(3));
    expect(linkMock).toHaveBeenCalledTimes(1);
  });

  it('falls back to initials when the link cannot be resolved', async () => {
    linkMock.mockRejectedValue(new Error('404 no photo'));
    const { container } = render(
      <HrAvatar name="Grace Hopper" employeeId="hre_2" photoFileId="file_missing" />,
    );
    await waitFor(() => expect(linkMock).toHaveBeenCalled());
    expect(screen.getByText('GH')).toBeInTheDocument();
    expect(container.querySelector('img')).toBeNull();
  });

  /**
   * The bug this replaced: `failed` was never reset, so an instance React reused for a different
   * person stayed on the first person's failure and showed initials for someone who has a photo.
   */
  it('recovers when the same instance is pointed at a different person', async () => {
    linkMock.mockRejectedValueOnce(new Error('gone'));
    const { container, rerender } = render(
      <HrAvatar name="Grace Hopper" employeeId="hre_2" photoFileId="file_missing" />,
    );
    await waitFor(() => expect(screen.getByText('GH')).toBeInTheDocument());

    linkMock.mockResolvedValueOnce({
      url: 'https://dropbox.example/b.jpg',
      expiresAt: inFourHours(),
    });
    rerender(<HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId="file_1" />);

    await waitFor(() =>
      expect(container.querySelector('img')).toHaveAttribute(
        'src',
        'https://dropbox.example/b.jpg',
      ),
    );
  });

  it('ignores a cached link that has already expired', async () => {
    linkMock.mockResolvedValue({
      url: 'https://dropbox.example/stale.jpg',
      // Inside the re-resolve margin, so it must be treated as unusable rather than served.
      expiresAt: new Date(Date.now() + 60_000).toISOString(),
    });
    const first = render(<HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId="file_1" />);
    await waitFor(() => expect(linkMock).toHaveBeenCalledTimes(1));
    first.unmount();

    render(<HrAvatar name="Ada Lovelace" employeeId="hre_1" photoFileId="file_1" />);
    await waitFor(() => expect(linkMock).toHaveBeenCalledTimes(2));
  });
});
