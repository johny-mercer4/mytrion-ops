import { appendFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

interface PendingLine {
  path: string;
  line: string;
}

export interface BufferedJsonlWriter {
  append(path: string, value: unknown): void;
  flush(): Promise<void>;
  pending(): number;
}

/**
 * Bounded, asynchronous JSONL writer. Request handling never waits on disk; bursts collapse into
 * grouped appends and a failed batch is retried without allowing memory to grow forever.
 */
export function createBufferedJsonlWriter(options?: {
  flushAt?: number;
  flushMs?: number;
  maxPending?: number;
}): BufferedJsonlWriter {
  const flushAt = options?.flushAt ?? 50;
  const flushMs = options?.flushMs ?? 250;
  const maxPending = options?.maxPending ?? 5_000;
  const queue: PendingLine[] = [];
  let flushing: Promise<void> | null = null;

  async function writeBatch(batch: PendingLine[]): Promise<void> {
    const grouped = new Map<string, string[]>();
    for (const entry of batch) {
      const lines = grouped.get(entry.path) ?? [];
      lines.push(entry.line);
      grouped.set(entry.path, lines);
    }
    await Promise.all(
      [...grouped].map(async ([path, lines]) => {
        await mkdir(dirname(path), { recursive: true });
        await appendFile(path, lines.join(''), 'utf8');
      }),
    );
  }

  async function flush(): Promise<void> {
    if (flushing) return flushing;
    if (!queue.length) return;
    const batch = queue.splice(0, Math.min(queue.length, 500));
    let failed = false;
    flushing = writeBatch(batch)
      .catch((error: unknown) => {
        failed = true;
        queue.unshift(...batch);
        if (queue.length > maxPending) queue.splice(0, queue.length - maxPending);
        console.error(
          '[jsonl] async flush failed',
          error instanceof Error ? error.message : String(error),
        );
      })
      .finally(() => {
        flushing = null;
        if (!failed && queue.length >= flushAt) void flush();
      });
    return flushing;
  }

  const timer = setInterval(() => void flush(), flushMs);
  timer.unref();

  return {
    append(path: string, value: unknown): void {
      queue.push({ path, line: `${JSON.stringify(value)}\n` });
      if (queue.length > maxPending) {
        const dropped = queue.length - maxPending;
        queue.splice(0, dropped);
        console.error(`[jsonl] buffer overflow — dropped ${dropped} oldest line(s)`);
      }
      if (queue.length >= flushAt) void flush();
    },
    flush,
    pending: () => queue.length,
  };
}
