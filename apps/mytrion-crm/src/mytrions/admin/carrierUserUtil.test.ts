import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from './carrierUserUtil';

function stubClipboard(writeText: ((text: string) => Promise<void>) | undefined): void {
  Object.defineProperty(navigator, 'clipboard', {
    value: writeText ? { writeText } : undefined,
    configurable: true,
  });
}

function stubExecCommand(result: boolean | (() => never)): void {
  Object.defineProperty(document, 'execCommand', {
    value: typeof result === 'function' ? result : () => result,
    configurable: true,
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('copyToClipboard', () => {
  it('reports success when the clipboard accepts the text', async () => {
    const writeText = vi.fn(async () => undefined);
    stubClipboard(writeText);

    await expect(copyToClipboard('https://t.me/bot?start=abc')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('https://t.me/bot?start=abc');
  });

  // The regression this file exists for: writeText rejects asynchronously (permission denied, or
  // any non-secure context), which the old try/catch around a `void`-ed call could not observe —
  // it leaked an unhandled rejection and the caller still claimed the copy had worked.
  it('falls back and reports the real outcome when writeText rejects', async () => {
    stubClipboard(async () => {
      throw new Error('NotAllowedError');
    });
    stubExecCommand(true);
    await expect(copyToClipboard('link')).resolves.toBe(true);

    stubExecCommand(false);
    await expect(copyToClipboard('link')).resolves.toBe(false);
  });

  it('falls back to execCommand when the clipboard API is absent', async () => {
    stubClipboard(undefined);
    stubExecCommand(true);

    await expect(copyToClipboard('link')).resolves.toBe(true);
  });

  it('reports failure rather than throwing when every path is blocked', async () => {
    stubClipboard(undefined);
    stubExecCommand(() => {
      throw new Error('execCommand is disabled');
    });

    await expect(copyToClipboard('link')).resolves.toBe(false);
  });
});
