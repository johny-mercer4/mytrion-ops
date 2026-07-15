import 'dotenv/config';
/**
 * Live connectivity smoke test for the dbt MCP client (integrations/dbtMcp.ts). Read-only.
 *
 *   pnpm dbt:smoke
 *
 * Exercises the full headless chain through Mytrion's own client: client_credentials token →
 * initialize → tools/list. SKIPs (exit 0) when the creds aren't set, so it's safe anywhere.
 * Nothing is written; `query`/`run`/`test` are never invoked.
 */
import { env } from '../src/config/env.js';
import { listDbtTools } from '../src/integrations/dbtMcp.js';

async function main(): Promise<void> {
  const required = ['DBT_MCP_URL', 'DBT_MCP_CLIENT_ID', 'DBT_MCP_CLIENT_SECRET'] as const;
  const missing = required.filter((k) => !env[k]);
  // eslint-disable-next-line no-console
  console.log('\n  dbt MCP smoke test\n  ' + '─'.repeat(48));
  if (missing.length > 0) {
    // eslint-disable-next-line no-console
    console.log(`  ⚪️  SKIP — missing env: ${missing.join(', ')}`);
    return;
  }
  const tools = await listDbtTools();
  // eslint-disable-next-line no-console
  console.log(`  ✅  connected — ${tools.length} tool(s):`);
  for (const t of tools) {
    // eslint-disable-next-line no-console
    console.log(`     - ${t.name}: ${t.description.slice(0, 70)}`);
  }
  // eslint-disable-next-line no-console
  console.log('  ' + '─'.repeat(48));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('  ❌  dbt MCP smoke failed:', err instanceof Error ? err.message : err);
    process.exit(1);
  });
