/**
 * One-shot governed platform/Sales Mytrion knowledge sync.
 * Usage: corepack pnpm knowledge:sync-platform
 */
import 'dotenv/config';
import { closeDb } from '../src/db/client.js';
import { buildSystemContext } from '../src/modules/jobs/systemContext.js';
import { syncPlatformKnowledge } from '../src/modules/knowledge/platformSync.js';

async function main(): Promise<void> {
  const context = buildSystemContext([], { allDepartmentAccess: true });
  const result = await syncPlatformKnowledge(context);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

main()
  .then(() => closeDb())
  .catch(async (error: unknown) => {
    process.stderr.write(
      `${error instanceof Error ? (error.stack ?? error.message) : String(error)}\n`,
    );
    await closeDb().catch(() => undefined);
    process.exitCode = 1;
  });
