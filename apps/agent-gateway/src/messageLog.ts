/**
 * Full message history — what turns.jsonl is NOT. Every inbound group message (BEFORE the
 * caveman gates, so ordinary chatter is kept too, exactly like hamroh v1's SQLite did) and
 * every outbound bot reply, full text, append-only.
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
import { appendFileSync, mkdirSync } from 'node:fs';
import { config } from './config.js';

export interface MessageLogEntry {
  ts: string;
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

export function logMessage(e: MessageLogEntry): void {
  try {
    mkdirSync('data', { recursive: true });
    appendFileSync(monthFile(), JSON.stringify(e) + '\n');
  } catch (err) {
    console.error('[messageLog] append failed', err);
  }
  enqueueCentral(e);
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
      headers: { Authorization: `Bearer ${config.octaneKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        carrierId: config.carrierId,
        messages: batch.map((e) => ({
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
    console.error('[messageLog] central flush failed (will retry)', err instanceof Error ? err.message : err);
  } finally {
    flushing = false;
  }
}

setInterval(() => void flushCentral(), FLUSH_MS).unref();
