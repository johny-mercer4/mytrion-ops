/**
 * The one behaviour this helper exists for: the tab is claimed BEFORE the URL is resolved.
 *
 * Written as an ordering assertion rather than a snapshot, because the failure mode is invisible in
 * Chrome — the old code worked there and silently did nothing in Safari and Firefox.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { openSignedFile } from './openSignedFile';

const original = { open: window.open, href: window.location.href };
let calls: string[] = [];
let fakeTab: { location: { replace: (u: string) => void }; close: () => void; opener: unknown } | null;

beforeEach(() => {
  calls = [];
  fakeTab = {
    opener: {},
    location: { replace: (u: string) => calls.push(`replace:${u}`) },
    close: () => calls.push('close'),
  };
  window.open = vi.fn(() => {
    calls.push('open');
    return fakeTab as unknown as Window;
  }) as unknown as typeof window.open;
});

afterEach(() => {
  window.open = original.open;
});

describe('openSignedFile', () => {
  /**
   * The regression that made the first version of this helper inert.
   *
   * Per the HTML spec's window-open steps, "if noopener is true, then return null" — and
   * `noreferrer` implies `noopener`. Passing either in the FEATURES string still opens the tab but
   * hands back null, so the handle is useless, the blank tab is orphaned and the code falls through
   * to navigating the user's own tab. A mocked `window.open` that returns a fake handle cannot
   * catch this, which is exactly how it shipped — so this asserts on the ARGUMENTS instead.
   */
  it('passes NO features string, or the handle comes back null in real browsers', async () => {
    await openSignedFile(async () => 'https://dl.example/x');
    const args = (window.open as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] ?? [];
    const features = String(args[2] ?? '');
    expect(features).not.toMatch(/noopener/);
    expect(features).not.toMatch(/noreferrer/);
    expect(args[1]).toBe('_blank');
  });

  it('opens the tab BEFORE resolving the url', async () => {
    await openSignedFile(async () => {
      calls.push('resolve');
      return 'https://dl.example/file.pdf';
    });
    // If `open` ever lands after `resolve`, the popup blocker kills it outside Chrome.
    expect(calls).toEqual(['open', 'resolve', 'replace:https://dl.example/file.pdf']);
  });

  it('uses replace, so the blank page is not a history entry', async () => {
    await openSignedFile(async () => 'https://dl.example/x');
    expect(calls).toContain('replace:https://dl.example/x');
  });

  it('severs opener on the new tab', async () => {
    await openSignedFile(async () => 'https://dl.example/x');
    expect(fakeTab?.opener).toBeNull();
  });

  it('closes the tab when the link cannot be resolved', async () => {
    await expect(
      openSignedFile(async () => {
        throw new Error('403');
      }),
    ).rejects.toThrow('403');
    // A blank tab left open reads as a broken app.
    expect(calls).toEqual(['open', 'close']);
  });

  it('falls back to navigating this tab when the popup is blocked outright', async () => {
    window.open = vi.fn(() => null) as unknown as typeof window.open;
    const assign = vi.fn();
    Object.defineProperty(window, 'location', {
      value: { ...original, set href(v: string) { assign(v); } },
      writable: true,
      configurable: true,
    });
    await openSignedFile(async () => 'https://dl.example/y');
    expect(assign).toHaveBeenCalledWith('https://dl.example/y');
  });

  it('takes the fallback path instead of a tab inside a webview', async () => {
    const fallback = vi.fn(async () => { calls.push('fallback'); });
    await openSignedFile(async () => 'https://dl.example/x', {
      shouldUseFallback: () => true,
      fallback,
    });
    expect(fallback).toHaveBeenCalled();
    expect(calls).toEqual(['fallback']);
    expect(window.open).not.toHaveBeenCalled();
  });

  it('still opens a tab when the webview check says no', async () => {
    await openSignedFile(async () => 'https://dl.example/x', {
      shouldUseFallback: () => false,
      fallback: async () => { calls.push('fallback'); },
    });
    expect(calls).toEqual(['open', 'replace:https://dl.example/x']);
  });
});
