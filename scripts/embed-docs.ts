import 'dotenv/config';
import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';
import { closeDb } from '../src/db/client.js';
import { logger } from '../src/lib/logger.js';
import { ingestDocument } from '../src/modules/knowledge/ingestService.js';
import { scopesForRole } from '../src/modules/auth/permissions.js';
import type { TenantContext } from '../src/types/tenantContext.js';

/** A synthetic admin context for the CLI (internal tenant). */
function cliContext(tenantId: string): TenantContext {
  return {
    tenantId,
    userId: 'cli',
    audience: 'internal',
    role: 'admin',
    scopes: scopesForRole('admin'),
    requestId: 'cli-embed-docs',
  };
}

function guessMime(file: string): string {
  switch (extname(file).toLowerCase()) {
    case '.md':
      return 'text/markdown';
    case '.txt':
      return 'text/plain';
    case '.json':
      return 'application/json';
    default:
      return 'text/plain';
  }
}

async function main(): Promise<void> {
  const files = process.argv.slice(2);
  if (files.length === 0) {
    logger.error('usage: pnpm tsx scripts/embed-docs.ts <file> [file...]');
    process.exit(1);
  }
  const ctx = cliContext(DEFAULT_TENANT_ID);
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    const result = await ingestDocument(ctx, {
      title: basename(file),
      content,
      source: file,
      mimeType: guessMime(file),
    });
    logger.info({ file, ...result }, 'ingested');
  }
}

main()
  .then(() => closeDb())
  .then(() => process.exit(0))
  .catch(async (err) => {
    logger.error({ err }, 'embed-docs failed');
    await closeDb().catch(() => undefined);
    process.exit(1);
  });
