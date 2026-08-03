import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { createBufferedJsonlWriter } from '../src/bufferedJsonl.js';

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })),
  );
});

describe('buffered JSONL persistence', () => {
  it('flushes queued records asynchronously in append order', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'octane-jsonl-'));
    temporaryDirectories.push(directory);
    const file = join(directory, 'events.jsonl');
    const writer = createBufferedJsonlWriter({ flushAt: 100, flushMs: 60_000 });

    writer.append(file, { sequence: 1 });
    writer.append(file, { sequence: 2 });
    expect(writer.pending()).toBe(2);
    await writer.flush();

    const records = (await readFile(file, 'utf8'))
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line) as { sequence: number });
    expect(records).toEqual([{ sequence: 1 }, { sequence: 2 }]);
    expect(writer.pending()).toBe(0);
  });
});
