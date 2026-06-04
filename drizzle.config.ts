import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  // List table files explicitly (not the index.ts barrel). drizzle-kit 0.24's loader
  // resolves ESM `.js` specifiers literally and cannot remap them to `.ts`; the barrel's
  // value re-exports would fail. Each table file below imports only third-party packages
  // plus elided `import type` — so it loads cleanly. Add new tables here.
  schema: [
    './src/db/schema/tenants.ts',
    './src/db/schema/users.ts',
    './src/db/schema/conversations.ts',
    './src/db/schema/messages.ts',
    './src/db/schema/tool_calls.ts',
    './src/db/schema/knowledge_docs.ts',
    './src/db/schema/knowledge_chunks.ts',
    './src/db/schema/audit_log.ts',
  ],
  out: './src/db/migrations',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL ?? 'postgres://octane:octane@localhost:5432/octane_assistant',
    // Managed Postgres (Render external) requires SSL; local docker does not.
    ssl: /@(localhost|127\.0\.0\.1|postgres)[:/]/.test(
      process.env.DATABASE_URL ?? 'localhost',
    )
      ? undefined
      : { rejectUnauthorized: false },
  },
  strict: true,
  verbose: true,
});
