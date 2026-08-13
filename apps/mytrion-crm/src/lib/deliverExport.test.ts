import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { requestMultipart, isTelegramWebView, toastSuccess, toastError } = vi.hoisted(() => ({
  requestMultipart: vi.fn(),
  isTelegramWebView: vi.fn(() => false),
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock('@/api/transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/api/transport')>();
  return { ...actual, requestMultipart };
});

vi.mock('@/telegram/webApp', () => ({
  isTelegramWebView,
}));

vi.mock('sonner', () => ({
  toast: { success: toastSuccess, error: toastError },
}));

import { ApiError } from '@/api/transport';
import { deliverBlob, deliverExport } from './deliverExport';

describe('deliverExport', () => {
  const anchorClick = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

  beforeEach(() => {
    requestMultipart.mockReset();
    isTelegramWebView.mockReturnValue(false);
    toastSuccess.mockReset();
    toastError.mockReset();
    anchorClick.mockClear();
    URL.createObjectURL = vi.fn(() => 'blob:mock');
    URL.revokeObjectURL = vi.fn();
    delete window.MytrionDownload;
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete window.MytrionDownload;
  });

  it('downloads via <a download> on desktop and does not POST to Horizon', async () => {
    const blob = new Blob(['hello'], { type: 'text/csv' });
    await expect(deliverExport(blob, 'report.csv')).resolves.toBe('downloaded');
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(requestMultipart).not.toHaveBeenCalled();
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('uses the vendor MytrionDownload hook on desktop when present', async () => {
    const vendor = vi.fn();
    window.MytrionDownload = { deliverBlob: vendor, isMobileWebView: () => false };
    const blob = new Blob(['x'], { type: 'application/pdf' });
    await deliverExport(blob, 'inv.pdf');
    expect(vendor).toHaveBeenCalledWith(blob, 'inv.pdf');
    expect(anchorClick).not.toHaveBeenCalled();
    expect(requestMultipart).not.toHaveBeenCalled();
  });

  it('POSTs the file to Horizon inside Telegram WebView and does not download', async () => {
    isTelegramWebView.mockReturnValue(true);
    requestMultipart.mockResolvedValueOnce({ ok: true, sent: true });
    const blob = new Blob(['xlsx'], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    await expect(deliverExport(blob, 'board.xlsx')).resolves.toBe('sent');
    expect(requestMultipart).toHaveBeenCalledWith(
      '/horizon/telegram/export-send',
      expect.any(FormData),
      expect.objectContaining({ impersonate: false }),
    );
    const form = requestMultipart.mock.calls[0]?.[1] as FormData;
    const file = form.get('file');
    expect(file).toBeInstanceOf(Blob);
    expect(anchorClick).not.toHaveBeenCalled();
    expect(toastSuccess).toHaveBeenCalledWith('Sent — check your Horizon bot chat');
  });

  it('does not claim a download when Telegram is unlinked', async () => {
    isTelegramWebView.mockReturnValue(true);
    requestMultipart.mockRejectedValueOnce(
      new ApiError(
        'Telegram is not linked. Open the Mini App after Zoho login to link your Horizon bot chat.',
        'TELEGRAM_CHAT_UNLINKED',
        409,
      ),
    );
    await expect(deliverExport(new Blob(['a']), 'a.csv')).rejects.toThrow(/Open the Mini App after Zoho login/i);
    expect(anchorClick).not.toHaveBeenCalled();
    expect(toastError).toHaveBeenCalledWith(
      'Telegram is not linked. Open the Mini App after Zoho login to link your Horizon bot chat.',
    );
    expect(toastSuccess).not.toHaveBeenCalled();
  });

  it('deliverBlob stays a desktop download even if Telegram is open (callers must use deliverExport)', () => {
    isTelegramWebView.mockReturnValue(true);
    deliverBlob(new Blob(['a']), 'a.txt');
    expect(anchorClick).toHaveBeenCalledOnce();
    expect(requestMultipart).not.toHaveBeenCalled();
  });
});
