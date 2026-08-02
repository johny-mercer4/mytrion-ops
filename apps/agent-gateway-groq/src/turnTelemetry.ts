import { logMessage } from './messageLog.js';
import { recordTurn } from './monitor.js';
import { HIGH_DEMAND_TEXT } from './overload.js';
import type { TurnStats } from './sessions.js';
import { sendMessage } from './telegram.js';

const REPORT_ELAPSED_OVER_MS = Number(process.env['REPORT_ELAPSED_OVER_MS'] ?? '120000');

function fmtElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  return minutes > 0 ? `${minutes} min ${seconds} s` : `${seconds} s`;
}

export function stampElapsed(text: string, startedAt: number): string {
  const elapsed = Date.now() - startedAt;
  return elapsed > REPORT_ELAPSED_OVER_MS ? `${text}\n\n⏱ ${fmtElapsed(elapsed)}` : text;
}

export function logTurn(
  kind: 'message' | 'button',
  chatId: number,
  userId: number,
  name: string,
  question: string,
  enqueuedAt: number,
  replyRef: { text: string },
): (stats: TurnStats) => void {
  return (stats) => {
    const usageNumber = (key: string): number => Number(stats.usage?.[key] ?? 0) || 0;
    recordTurn({
      ts: new Date(enqueuedAt).toISOString(),
      chatId,
      userId,
      name,
      kind,
      question: question.slice(0, 300),
      reply:
        stats.isError && stats.errMsg
          ? `⚠ ${stats.errMsg}`.slice(0, 300)
          : replyRef.text.slice(0, 300),
      waitMs: stats.queueWaitMs ?? Math.max(0, Date.now() - enqueuedAt - stats.durationMs),
      execMs: stats.durationMs,
      ...(stats.totalMs !== undefined ? { totalMs: stats.totalMs } : {}),
      ...(stats.sendMs !== undefined ? { sendMs: stats.sendMs } : {}),
      numTurns: stats.numTurns,
      inTok: usageNumber('input_tokens'),
      outTok: usageNumber('output_tokens'),
      cacheRead: usageNumber('cache_read_input_tokens'),
      cacheWrite: usageNumber('cache_creation_input_tokens'),
      isError: stats.isError,
    });
  };
}

export async function sendOverloadReply(input: {
  kind: 'message' | 'button';
  chatId: number;
  carrierId: string;
  userId: number;
  name: string;
  question: string;
  receivedAt: number;
  replyToMessageId: number;
}): Promise<void> {
  const reply = { text: HIGH_DEMAND_TEXT };
  const stats = logTurn(
    input.kind,
    input.chatId,
    input.userId,
    input.name,
    input.question,
    input.receivedAt,
    reply,
  );
  await sendMessage(input.chatId, HIGH_DEMAND_TEXT, input.replyToMessageId).catch(() => undefined);
  logMessage({
    ts: new Date().toISOString(),
    carrierId: input.carrierId,
    chatId: input.chatId,
    userId: 0,
    name: 'bot',
    dir: 'out',
    text: HIGH_DEMAND_TEXT,
  });
  stats({
    durationMs: 0,
    numTurns: 0,
    usage: null,
    isError: true,
    errMsg: 'gateway overloaded',
  });
}
