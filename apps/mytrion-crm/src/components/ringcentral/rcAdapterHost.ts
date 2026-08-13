import { fetchRingCentralEmbedConfig } from '@/api/ringcentral';
import { installRcConsoleFilter } from './rcConsoleFilter';
import { inAppCallingSupported } from './rcCapability';
import {
  RC_ADAPTER_SCRIPT_ID,
  dockRingCentralWidget,
} from './ringcentralDial';
import { ringcentralStylesDataUri } from './ringcentralEmbedStyles';
import { resetRingCentralLoginState } from './ringcentralEvents';

installRcConsoleFilter();

const FRAME_WAIT_MS = 12_000;
const FRAME_POLL_MS = 200;

function withStylesUri(adapterUrl: string): string {
  try {
    const u = new URL(adapterUrl);
    u.searchParams.set('stylesUri', ringcentralStylesDataUri());
    return u.toString();
  } catch {
    return adapterUrl;
  }
}

function forceRcFrameCursor(frame: HTMLElement): void {
  frame.style.setProperty('cursor', 'pointer', 'important');
}

export function rcFrame(): HTMLElement | null {
  return document.getElementById('rc-widget-adapter-frame');
}

function rcWidgetRoot(): HTMLElement | null {
  return document.getElementById('rc-widget');
}

export function rcAdapterPresent(): boolean {
  return (
    document.getElementById(RC_ADAPTER_SCRIPT_ID) !== null ||
    rcWidgetRoot() !== null ||
    rcFrame() !== null
  );
}

export function teardownAdapter(): void {
  resetRingCentralLoginState();
  document.getElementById(RC_ADAPTER_SCRIPT_ID)?.remove();
  rcWidgetRoot()?.remove();
  rcFrame()?.remove();
  try {
    window.RCAdapterDispose?.();
  } catch {
    /* vendor teardown is best-effort */
  }
  delete window.RCAdapter;
}

function waitForRcFrame(timeoutMs: number): Promise<HTMLElement | null> {
  const existing = rcFrame();
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve) => {
    const started = Date.now();
    const tick = (): void => {
      const frame = rcFrame();
      if (frame) {
        resolve(frame);
        return;
      }
      if (Date.now() - started >= timeoutMs) {
        resolve(null);
        return;
      }
      window.setTimeout(tick, FRAME_POLL_MS);
    };
    tick();
  });
}

export async function mountAdapter(
  adapterUrl: string,
  opts: { cancelled: () => boolean; onLoadError: () => void },
): Promise<void> {
  if (!inAppCallingSupported()) {
    teardownAdapter();
    return;
  }
  const nextSrc = withStylesUri(adapterUrl);
  const existing = document.getElementById(RC_ADAPTER_SCRIPT_ID) as HTMLScriptElement | null;
  const frame = rcFrame();

  if (existing && frame && existing.src.includes('stylesUri=data')) {
    forceRcFrameCursor(frame);
    dockRingCentralWidget();
    return;
  }

  if (rcAdapterPresent()) teardownAdapter();
  if (opts.cancelled()) return;

  installRcConsoleFilter();

  await new Promise<void>((resolve) => {
    const script = document.createElement('script');
    script.id = RC_ADAPTER_SCRIPT_ID;
    script.src = nextSrc;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      console.warn('[ringcentral] Embeddable adapter failed to load');
      script.remove();
      opts.onLoadError();
      resolve();
    };
    document.body.appendChild(script);
  });

  if (opts.cancelled()) return;

  const ready = await waitForRcFrame(FRAME_WAIT_MS);
  if (opts.cancelled()) return;
  if (ready) {
    forceRcFrameCursor(ready);
    dockRingCentralWidget();
  } else {
    console.warn('[ringcentral] Embeddable iframe did not appear after adapter inject');
  }
}

export async function bootAdapter(
  cachedUrl: string | null,
  opts: { cancelled: () => boolean; onLoadError: () => void },
): Promise<string | null> {
  let adapterUrl = cachedUrl;
  if (!adapterUrl) {
    const cfg = await fetchRingCentralEmbedConfig();
    if (opts.cancelled() || !cfg.enabled || !cfg.adapterUrl) return adapterUrl;
    adapterUrl = cfg.adapterUrl;
  }
  if (opts.cancelled() || !adapterUrl) return adapterUrl;
  await mountAdapter(adapterUrl, opts);
  return adapterUrl;
}

export function lockRcCursor(): void {
  const frame = rcFrame();
  if (frame) forceRcFrameCursor(frame);
}
