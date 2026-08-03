/**
 * Privacy-bounded message history. By default only inbound messages that reached the model and
 * outbound bot replies are retained. Ordinary group chatter is never copied into bot storage.
 *
 * Storage: data/messages-YYYY-MM.jsonl — monthly files so nothing needs rotation logic and a
 * month is a natural analysis unit (the 54k-message study was month-bucketed too). One JSON
 * object per line:
 *   { ts, chatId, msgId?, userId, name, dir: 'in'|'out', text, photo?, engaged? }
 * `engaged` marks inbound messages that actually reached the model (passed both gates) — the
 * "bot hal qildi / e'tiborsiz qoldi" KPI falls straight out of it.
 *
 * Failure policy: history must never break the bot — every write is fire-and-forget.
 */
import { createHash } from 'node:crypto';
import { readdir, stat, unlink } from 'node:fs/promises';
import { config } from './config.js';
import { createBufferedJsonlWriter } from './bufferedJsonl.js';
import { maskSensitiveDigitRuns } from './messagePrivacy.js';
import { supportBotHeaders } from './octaneClient.js';

export interface MessageLogEntry {
  ts: string;
  carrierId: string;
  chatId: number;
  msgId?: number;
  userId: number;
  name: string;
  dir: 'in' | 'out';
  text: string;
  photo?: boolean;
  engaged?: boolean;
}

function monthFile(): string {
  const d = new Date();
  return `data/messages-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.jsonl`;
}

const localWriter = createBufferedJsonlWriter();

export function logMessage(e: MessageLogEntry): void {
  if (config.messageLogMode === 'off') return;
  if (e.dir === 'in' && config.messageLogMode === 'engaged' && e.engaged !== true) return;
  const safe = sanitizeEntry(e);
  if (config.messageLogLocalEnabled) localWriter.append(monthFile(), safe);
  enqueueCentral(safe);
}

function sanitizeEntry(e: MessageLogEntry): MessageLogEntry {
  const name =
    e.dir === 'out' || config.messageLogStoreNames
      ? e.name.slice(0, 200)
      : `user:${createHash('sha256')
          .update(`${e.carrierId}:${e.userId}`)
          .digest('hex')
          .slice(0, 12)}`;
  // Mask likely PAN/account-number runs while retaining enough suffix for support correlation.
  const text = maskSensitiveDigitRuns(e.text).slice(0, config.messageLogMaxChars);
  return { ...e, name, text };
}

/**
 * Central copy — batched into mytrion's support_bot_messages table (hamroh-v1 parity, but in
 * the shared Postgres: one table across every future group instance, SQL for the analysts).
 * JSONL above stays the never-fails local record; this path is allowed to be down. Batches of
 * up to 200, flushed every 15s or at 50 buffered; on failure the batch returns to the buffer
 * (capped at 2000 — beyond that the oldest entries are dropped WITH a log line, never silently).
 */
const BUFFER_MAX = 2_000;
const FLUSH_AT = 50;
const FLUSH_MS = 15_000;
const buffer: MessageLogEntry[] = [];
let flushing = false;

function enqueueCentral(e: MessageLogEntry): void {
  buffer.push(e);
  if (buffer.length > BUFFER_MAX) {
    buffer.splice(0, buffer.length - BUFFER_MAX);
    console.error(`[messageLog] central buffer overflow — oldest entries dropped (mytrion down too long?)`);
  }
  if (buffer.length >= FLUSH_AT) void flushCentral();
}

async function flushCentral(): Promise<void> {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer.splice(0, 200);
  try {
    const res = await fetch(`${config.octaneBase}/v1/support-bot/messages`, {
      method: 'POST',
      headers: supportBotHeaders(true),
      body: JSON.stringify({
        messages: batch.map((e) => ({
          carrierId: e.carrierId,
          ts: e.ts,
          chatId: e.chatId,
          ...(e.msgId != null ? { msgId: e.msgId } : {}),
          userId: e.userId,
          name: e.name,
          dir: e.dir,
          text: e.text.slice(0, 8000),
          ...(e.photo ? { photo: true } : {}),
          ...(e.engaged ? { engaged: true } : {}),
        })),
      }),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
  } catch (err) {
    buffer.unshift(...batch); // retry on the next tick — JSONL already has them regardless
    if (buffer.length > BUFFER_MAX) buffer.splice(0, buffer.length - BUFFER_MAX);
    console.error('[messageLog] central flush failed (will retry)', err instanceof Error ? err.message : err);
  } finally {
    flushing = false;
  }
}

setInterval(() => void flushCentral(), FLUSH_MS).unref();

async function pruneLocalHistory(): Promise<void> {
  if (!config.messageLogLocalEnabled) return;
  const cutoff = Date.now() - config.messageLogRetentionDays * 86_400_000;
  try {
    const entries = await readdir('data', { withFileTypes: true });
    await Promise.all(
      entries
        .filter((entry) => entry.isFile() && /^messages-\d{4}-\d{2}\.jsonl$/u.test(entry.name))
        .map(async (entry) => {
          const path = `data/${entry.name}`;
          if ((await stat(path)).mtimeMs < cutoff) await unlink(path);
        }),
    );
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : '';
    if (code !== 'ENOENT') console.error('[messageLog] local retention cleanup failed');
  }
}

void pruneLocalHistory();
setInterval(() => void pruneLocalHistory(), 24 * 60 * 60_000).unref();
process.once('beforeExit', () => void localWriter.flush());

export async function flushMessageLogs(): Promise<void> {
  // Drain every bounded batch during graceful shutdown. Stop after a failed/no-progress attempt;
  // the local JSONL copy (when enabled) remains the never-fails fallback.
  while (flushing) await new Promise((resolve) => setTimeout(resolve, 10));
  for (let attempt = 0; buffer.length > 0 && attempt < Math.ceil(BUFFER_MAX / 200); attempt += 1) {
    const before = buffer.length;
    await flushCentral();
    if (buffer.length >= before) break;
  }
  await localWriter.flush();
}
