/**
 * One delivery path for every Mytrion export.
 *
 * Desktop / not Telegram WebView → existing `<a download>` / blob / MytrionDownload hook.
 * Telegram Mini App → POST bytes to Horizon export-send (HORIZON_BOT_TOKEN on the API).
 */
import { toast } from 'sonner';
import { ApiError, requestMultipart } from '@/api/transport';
import { isTelegramWebView } from '@/telegram/webApp';

export type DeliverExportResult = 'downloaded' | 'sent';

declare global {
  interface Window {
    MytrionDownload?: {
      deliverBlob: (blob: Blob, filename: string) => void;
      isMobileWebView: () => boolean;
    };
  }
}

const UNLINKED =
  'Telegram is not linked. Open the Mini App after Zoho login to link your Horizon bot chat.';

/** Desktop download. Telegram Mini App must not call this. */
export function deliverBlob(blob: Blob, filename: string): void {
  if (window.MytrionDownload?.deliverBlob) {
    window.MytrionDownload.deliverBlob(blob, filename);
    return;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

async function sendToHorizonBot(blob: Blob, filename: string): Promise<void> {
  const form = new FormData();
  form.append('file', blob, filename);
  try {
    await requestMultipart('/horizon/telegram/export-send', form, {
      impersonate: false,
      timeoutMs: 60_000,
    });
    toast.success('Sent — check your Horizon bot chat');
  } catch (err) {
    if (err instanceof ApiError && err.code === 'TELEGRAM_CHAT_UNLINKED') {
      toast.error(UNLINKED);
      throw new Error(UNLINKED);
    }
    const message = err instanceof Error ? err.message : 'Could not send the file to Telegram.';
    toast.error(message);
    throw err instanceof Error ? err : new Error(message);
  }
}

/**
 * Deliver an export blob. Desktop keeps the current download. Inside Telegram WebView the file
 * is sent to the worker's Horizon bot chat instead — never claimed as a local download.
 */
export async function deliverExport(blob: Blob, filename: string): Promise<DeliverExportResult> {
  if (!isTelegramWebView()) {
    deliverBlob(blob, filename);
    return 'downloaded';
  }
  await sendToHorizonBot(blob, filename);
  return 'sent';
}

/**
 * Vendor PDF helpers call `window.MytrionDownload.deliverBlob` internally. Capture that blob
 * and run it through `deliverExport` so Telegram still gets sendDocument, not a dead download.
 */
export async function deliverVendorDownload(run: () => Promise<void>): Promise<DeliverExportResult> {
  if (!isTelegramWebView() || !window.MytrionDownload) {
    await run();
    return 'downloaded';
  }
  let pending: Promise<DeliverExportResult> | null = null;
  const prev = window.MytrionDownload.deliverBlob;
  window.MytrionDownload.deliverBlob = (blob, filename) => {
    pending = deliverExport(blob, filename);
  };
  try {
    await run();
    if (pending) return pending;
    return 'downloaded';
  } finally {
    window.MytrionDownload.deliverBlob = prev;
  }
}
