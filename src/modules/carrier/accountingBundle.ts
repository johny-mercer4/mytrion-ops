/**
 * Accounting bundle — the weekly ritual ("fuel and EFS report for period X–Y, both retail and
 * with discount, pdf and xlsx" — ROLLING's "Accounting SOS" writes this verbatim every week;
 * fuel report 136 / Excel 92 / retail-discount pair 91 / EFS report 72 asks in the chat data)
 * as ONE action: up to six branded documents delivered to the owner's bot chat.
 *
 * Files: Fuel×{discount,retail}×{xlsx,pdf} + EFS money codes×{xlsx,pdf}. Empty halves are
 * skipped, never sent as empty documents. Owner-only at both call sites (route + weekly cron):
 * the discount variant and money codes are company finances.
 *
 * runWeeklyStatements is Phase-2 T3: every Monday (JOBS_CRON_TZ) each pilot carrier's owners get
 * last week's bundle plus a `statement` notification (Inbox row + dedupe — the outbox key
 * `statement:<carrierId>:<weekStart>` also makes a re-run harmless on the text side).
 */
import { and, eq, ne } from 'drizzle-orm';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { db } from '../../db/client.js';
import { registeredMiniAppCompanies } from '../../db/schema/index.js';
import { listDwhTransactions } from '../../integrations/dwhTransactions.js';
import { escapeTelegramHtml, sendDocument } from '../../integrations/telegramCarrierBot.js';
import { logger } from '../../lib/logger.js';
import { notifyMiniApp } from '../notifications/service.js';
import { pilotCarriers } from '../notifications/pollers.js';
import { buildMoneyCodeReport, listMoneyCodeDraws } from './moneyCodeReport.js';
import { buildTxnReport, type BuiltTxnReport } from './txnReport.js';

/** Concrete NY-date window for the money-code journal query; the fuel read resolves presets
 *  itself, so this only needs to agree with the label, not with the mart's SQL. */
export function rangeToDates(range?: string, from?: string, to?: string): { from: string; to: string } {
  if (from && to) return { from, to };
  const days = range === 'day' ? 1 : range === 'week' ? 7 : range === 'quarter' ? 92 : 31;
  const now = new Date();
  const past = new Date(now.getTime() - days * 86_400_000);
  const f = (d: Date) => d.toISOString().slice(0, 10);
  return { from: f(past), to: f(now) };
}

export interface BundleOpts {
  carrierId: string;
  chatId: string | number;
  companyName: string;
  range?: string | undefined;
  from?: string | undefined;
  to?: string | undefined;
}

export async function sendAccountingBundle(opts: BundleOpts): Promise<{ files: number; txns: number; draws: number; rangeLabel: string }> {
  const txns = await listDwhTransactions({
    carrierId: opts.carrierId,
    range: opts.range,
    from: opts.from,
    to: opts.to,
    limit: 5000,
  });
  const rangeLabel = txns.range.from ? `${txns.range.from} → ${txns.range.to}` : String(txns.range.preset);
  const mcWindow = rangeToDates(opts.range, txns.range.from ?? opts.from, txns.range.to ?? opts.to);
  const draws = await listMoneyCodeDraws(opts.carrierId, mcWindow.from, mcWindow.to);

  const files: BuiltTxnReport[] = [];
  const meta = { company: opts.companyName, range: rangeLabel, cardLast4: opts.carrierId, scopedToCard: false };
  if (txns.data.length > 0) {
    for (const priceMode of ['discount', 'retail'] as const) {
      for (const format of ['xlsx', 'pdf'] as const) {
        files.push(await buildTxnReport(txns.data, format, { ...meta, priceMode }));
      }
    }
  }
  if (draws.length > 0) {
    for (const format of ['xlsx', 'pdf'] as const) {
      files.push(await buildMoneyCodeReport(draws, format, { company: opts.companyName, range: rangeLabel }));
    }
  }

  let first = true;
  for (const file of files) {
    // Caption once, on the first document — the rest arrive as a silent stack under it.
    const caption = first
      ? [
          `<b>Octane · Accounting Bundle</b>`,
          `${escapeTelegramHtml(opts.companyName)} · ${rangeLabel}`,
          ``,
          `${txns.data.length} fuel line items · ${draws.length} money code draw(s)`,
          `Fuel with &amp; without discount (Excel + PDF)${draws.length > 0 ? ' · EFS money codes' : ''}`,
        ].join('\n')
      : undefined;
    await sendDocument({
      chatId: opts.chatId,
      fileName: file.fileName,
      contentType: file.contentType,
      bytes: file.bytes,
      ...(caption ? { caption, parseMode: 'HTML' as const } : {}),
    });
    first = false;
  }
  return { files: files.length, txns: txns.data.length, draws: draws.length, rangeLabel };
}

/** Previous Monday→Sunday in America/New_York (the range vocabulary accounting actually uses). */
function lastWeekRangeNY(): { from: string; to: string } {
  const nowNY = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
  const dow = (nowNY.getDay() + 6) % 7; // Monday = 0
  const monThis = new Date(nowNY);
  monThis.setDate(nowNY.getDate() - dow);
  const monPrev = new Date(monThis);
  monPrev.setDate(monThis.getDate() - 7);
  const sunPrev = new Date(monThis);
  sunPrev.setDate(monThis.getDate() - 1);
  const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { from: f(monPrev), to: f(sunPrev) };
}

/** Phase-2 T3 — Monday cron: last week's accounting bundle to every pilot carrier's owners. */
export async function runWeeklyStatements(): Promise<{ carriers: number; sent: number }> {
  const carriers = pilotCarriers();
  const week = lastWeekRangeNY();
  let sent = 0;
  for (const carrierId of carriers) {
    try {
      const owners = await db
        .select()
        .from(registeredMiniAppCompanies)
        .where(
          and(
            eq(registeredMiniAppCompanies.tenantId, DEFAULT_TENANT_ID),
            eq(registeredMiniAppCompanies.carrierId, carrierId),
            // 'manager' is owner-equivalent everywhere (see the schema comment) — only drivers are excluded.
            ne(registeredMiniAppCompanies.profile, 'driver'),
            eq(registeredMiniAppCompanies.status, 'active'),
          ),
        );
      if (owners.length === 0) continue;
      let delivered = false;
      for (const owner of owners) {
        const chatId = owner.telegramChatId ?? owner.telegramUserId;
        const res = await sendAccountingBundle({
          carrierId,
          chatId,
          companyName: owner.companyName ?? 'Octane',
          range: 'custom',
          from: week.from,
          to: week.to,
        });
        if (res.files > 0) {
          delivered = true;
          sent += 1;
        }
      }
      if (delivered) {
        // Inbox row + bot text via the outbox; the dedupe key makes a manual re-run text-safe.
        void notifyMiniApp({
          type: 'statement',
          tenantId: DEFAULT_TENANT_ID,
          carrierId,
          dedupeKey: `statement:${carrierId}:${week.from}`,
          payload: { from: week.from, to: week.to },
        });
      }
    } catch (err) {
      // One carrier's upstream hiccup must not starve the rest of the pilot.
      logger.warn({ err, carrierId }, 'weekly statement failed for carrier');
    }
  }
  return { carriers: carriers.length, sent };
}
