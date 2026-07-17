import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import { AdminToastHost, adminToast } from './toast';

afterEach(() => {
  vi.useRealTimers();
});

describe('AdminToastHost', () => {
  // The bug the inline banners had: a live region that mounts with its text already inside is
  // typically never announced. The region has to be in the DOM before the message arrives.
  it('keeps the live region mounted while empty', () => {
    render(<AdminToastHost />);

    const region = screen.getByRole('status');
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toBeEmptyDOMElement();
  });

  it('shows a toast with its title and message', () => {
    render(<AdminToastHost />);

    act(() => adminToast.success('Invite link copied', 'Paste it into Telegram.'));

    expect(screen.getByText('Invite link copied')).toBeInTheDocument();
    expect(screen.getByText('Paste it into Telegram.')).toBeInTheDocument();
  });

  it('auto-dismisses, and gives errors longer on screen than successes', () => {
    vi.useFakeTimers();
    render(<AdminToastHost />);

    act(() => adminToast.success('Saved'));
    act(() => adminToast.error('Revoke failed'));

    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.queryByText('Saved')).not.toBeInTheDocument();
    expect(screen.getByText('Revoke failed')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(2000));
    expect(screen.queryByText('Revoke failed')).not.toBeInTheDocument();
  });

  it('honours an explicit duration', () => {
    vi.useFakeTimers();
    render(<AdminToastHost />);

    act(() => adminToast.error('Copy failed', 'https://t.me/bot?start=abc', 15000));

    act(() => void vi.advanceTimersByTime(6000));
    expect(screen.getByText('Copy failed')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(9000));
    expect(screen.queryByText('Copy failed')).not.toBeInTheDocument();
  });

  it('dismisses on click', async () => {
    render(<AdminToastHost />);
    act(() => adminToast.info('Heads up'));

    const close = screen.getByRole('button', { name: 'Dismiss notification' });
    await act(async () => close.click());

    expect(screen.queryByText('Heads up')).not.toBeInTheDocument();
  });

  it('caps the stack so a burst of failures cannot wall off the screen', () => {
    render(<AdminToastHost />);

    act(() => {
      for (let i = 1; i <= 6; i++) adminToast.error(`Failure ${i}`);
    });

    expect(screen.queryByText('Failure 1')).not.toBeInTheDocument();
    expect(screen.queryByText('Failure 2')).not.toBeInTheDocument();
    expect(screen.getByText('Failure 3')).toBeInTheDocument();
    expect(screen.getByText('Failure 6')).toBeInTheDocument();
  });

  it('drops its listener on unmount', () => {
    const { unmount } = render(<AdminToastHost />);
    unmount();

    expect(() => adminToast.success('after unmount')).not.toThrow();
  });
});
