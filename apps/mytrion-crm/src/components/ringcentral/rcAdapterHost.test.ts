import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('./rcCapability', () => ({
  inAppCallingSupported: vi.fn(),
}));

import { inAppCallingSupported } from './rcCapability';
import { mountAdapter, rcAdapterPresent, teardownAdapter } from './rcAdapterHost';

const here = dirname(fileURLToPath(import.meta.url));

afterEach(() => {
  teardownAdapter();
  vi.mocked(inAppCallingSupported).mockReset();
});

describe('mountAdapter', () => {
  it('does not inject adapter.js when in-app calling is unsupported', async () => {
    vi.mocked(inAppCallingSupported).mockReturnValue(false);
    await mountAdapter(
      'https://apps.ringcentral.com/integration/ringcentral-embeddable/latest/adapter.js',
      { cancelled: () => false, onLoadError: () => undefined },
    );
    expect(rcAdapterPresent()).toBe(false);
    expect(document.getElementById('mytrion-rc-embeddable-adapter')).toBeNull();
    expect(document.getElementById('rc-widget')).toBeNull();
  });
});

describe('Telegram calling chrome', () => {
  it('does not mount a persistent calling notice from RingCentralPhone', () => {
    const src = readFileSync(join(here, 'RingCentralPhone.tsx'), 'utf8');
    expect(src).not.toContain('TelegramCallingNotice');
  });
});
