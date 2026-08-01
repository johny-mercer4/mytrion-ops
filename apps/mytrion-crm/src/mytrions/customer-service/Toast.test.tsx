/**
 * The toast's auto-dismiss countdown.
 *
 * This is a regression test for a bug that was invisible in code review and hard to catch by eye:
 * every caller passes an inline `onDismiss={() => setToast(null)}`, so the handler is a new function
 * on each parent render. With it in the effect's dependency list, the effect re-ran on every
 * re-render — clearing the pending timeout and starting a fresh 3.5s one.
 *
 * That matters because of WHEN toasts are raised: a save calls notify() and then refreshAll(), so
 * three background reloads land underneath the toast over the next second or two, each re-rendering
 * the panel and pushing the dismissal back. And a toast raised while an agent is typing in the search
 * box never dismissed at all — every keystroke restarted it.
 */
import { render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { Toast, type ToastState } from './Toast';

const TOAST: ToastState = { id: 1, kind: 'success', message: 'Case updated for ACME' };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('auto-dismiss', () => {
  it('fires once after 3.5s', () => {
    const onDismiss = vi.fn();
    render(<Toast toast={TOAST} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(3499);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('still dismisses on time when the parent re-renders with a NEW handler identity', () => {
    // The bug: each re-render restarted the countdown, so this toast never reached 3.5s.
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast toast={TOAST} onDismiss={() => onDismiss()} />);

    // Simulate a panel that re-renders every 500ms — a background reload landing, or someone typing.
    for (let i = 0; i < 6; i++) {
      vi.advanceTimersByTime(500);
      rerender(<Toast toast={TOAST} onDismiss={() => onDismiss()} />);
    }
    // 3000ms of re-renders: not yet due.
    expect(onDismiss).not.toHaveBeenCalled();

    vi.advanceTimersByTime(500); // 3500ms total
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('calls the LATEST handler, not the one captured on mount', () => {
    // The ref must not go stale — dismissing has to clear the toast the parent currently owns.
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = render(<Toast toast={TOAST} onDismiss={first} />);
    rerender(<Toast toast={TOAST} onDismiss={second} />);

    vi.advanceTimersByTime(3500);
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('restarts the countdown for a genuinely NEW toast', () => {
    // Identity change is the one thing that SHOULD reset the timer — a second notification deserves
    // its own full 3.5s rather than inheriting the remainder of the first.
    const onDismiss = vi.fn();
    const { rerender } = render(<Toast toast={TOAST} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(3000);
    rerender(<Toast toast={{ ...TOAST, id: 2, message: 'Case created for BETA' }} onDismiss={onDismiss} />);

    vi.advanceTimersByTime(3499);
    expect(onDismiss).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('cancels the timer on unmount so a dismissed toast cannot fire later', () => {
    const onDismiss = vi.fn();
    const { unmount } = render(<Toast toast={TOAST} onDismiss={onDismiss} />);
    unmount();
    vi.advanceTimersByTime(10_000);
    expect(onDismiss).not.toHaveBeenCalled();
  });
});

describe('rendering', () => {
  it('shows the message and the severity class', () => {
    const { container } = render(<Toast toast={TOAST} onDismiss={vi.fn()} />);
    const el = container.querySelector('.cs-toast');
    expect(el?.textContent).toBe('Case updated for ACME');
    expect(el?.className).toContain('cs-toast-success');
  });

  it('carries the kind through for every severity', () => {
    for (const kind of ['success', 'info', 'error', 'warning'] as const) {
      const { container } = render(<Toast toast={{ ...TOAST, kind }} onDismiss={vi.fn()} />);
      expect(container.querySelector('.cs-toast')?.className).toContain(`cs-toast-${kind}`);
    }
  });
});
