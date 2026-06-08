import 'dotenv/config';
import { drizzle } from 'drizzle-orm/postgres-js';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import postgres from 'postgres';
import { dbSslOption } from '../src/db/client.js';
import { databaseUrl } from '../src/config/env.js';
import { logger } from '../src/lib/logger.js';

/**
 * Apply committed SQL migrations programmatically (no drizzle-kit needed at runtime).
 * Use as a Render release step: `tsx scripts/migrate.ts`. The first migration creates
 * the pgvector extension before the vector column, so this is self-sufficient.
 */
async function main(): Promise<void> {
  const sql = postgres(databaseUrl, { max: 1, ssl: dbSslOption(databaseUrl) });
  try {
    const db = drizzle(sql);
    logger.info('applying migrations...');
    await migrate(db, { migrationsFolder: './src/db/migrations' });
    logger.info('migrations applied');
  } finally {
    await sql.end();
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    logger.error({ err }, 'migration failed');
    process.exit(1);
  });
