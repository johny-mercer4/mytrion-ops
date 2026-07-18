/**
 * Zapier webhook wrapper — card replacement / account reactivation email tickets.
 * The self-service widget posts straight to the catch-hook; Ops proxies the same
 * payload so the CRM never embeds the webhook URL or fires cross-origin from the browser.
 */
import { env } from '../config/env.js';
import { fetchWithTimeout } from '../lib/http.js';
import { BaseWrapper } from './core/base.js';

export class ZapierHttpError extends Error {
  readonly status: number;
  readonly bodyText: string;

  constructor(status: number, bodyText: string) {
    const truncated = bodyText.slice(0, 300);
    super(`[zapier] POST webhook → HTTP ${status}: ${truncated}`);
    this.name = 'ZapierHttpError';
    this.status = status;
    this.bodyText = truncated;
  }
}

export class ZapierWrapper extends BaseWrapper {
  readonly name = 'zapier';
  readonly kind = 'http' as const;

  isConfigured(): boolean {
    return Boolean(env.ZAPIER_TICKET_WEBHOOK_URL);
  }

  /** POST JSON to the configured ticket-email catch-hook. Throws ZapierHttpError on non-2xx. */
  async postTicketEmail(body: Record<string, unknown>): Promise<unknown> {
    const url = env.ZAPIER_TICKET_WEBHOOK_URL;
    if (!url) throw new Error('[zapier] ZAPIER_TICKET_WEBHOOK_URL is not configured');
    const res = await fetchWithTimeout(
      url,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      },
      env.OUTBOUND_HTTP_TIMEOUT_MS,
    );
    const text = await res.text();
    if (!res.ok) throw new ZapierHttpError(res.status, text);
    return text ? (JSON.parse(text) as unknown) : {};
  }
}

export const zapier = new ZapierWrapper();
