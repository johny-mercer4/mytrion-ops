import 'dotenv/config';
/**
 * Live smoke test for the analytics service — computes every dashboard dimension against the
 * real DWH (read-only) and prints the KPI row. Validates the curated SQL against the actual
 * warehouse schema.
 *
 *   pnpm analytics:smoke
 *
 * SKIPs (exit 0) when DWH_DATABASE_URL isn't set; exits 1 if any dimension fails.
 */
import { env } from '../src/config/env.js';
import { closeDwhPool } from '../src/integrations/dwh.js';
import { computeAnalyticsBlock } from '../src/modules/analytics/service.js';
import { ANALYTICS_DIMENSIONS } from '../src/modules/analytics/types.js';

async function main(): Promise<number> {
  // eslint-disable-next-line no-console
  console.log('\n  Analytics DWH smoke test\n  ' + '─'.repeat(52));
  if (!env.DWH_DATABASE_URL) {
    // eslint-disable-next-line no-console
    console.log('  ⚪️  SKIP — DWH_DATABASE_URL not set');
    return 0;
  }
  let failed = false;
  for (const dim of ANALYTICS_DIMENSIONS) {
    const t0 = Date.now();
    try {
      const b = await computeAnalyticsBlock(dim);
      // eslint-disable-next-line no-console
      console.log(
        `  ✅  ${dim.padEnd(12)} ${String(Date.now() - t0).padStart(5)}ms  ` +
          b.kpis.map((k) => `${k.label}=${k.value}`).join(' · '),
      );
      // eslint-disable-next-line no-console
      console.log(
        `      trend=${b.trend.length}d breakdown=${b.breakdown.length} leaders=${b.leaderboard.length}` +
          (b.leaderboard[0] ? ` (top: ${b.leaderboard[0].name})` : ''),
      );
    } catch (err) {
      failed = true;
      // eslint-disable-next-line no-console
      console.log(`  ❌  ${dim}: ${err instanceof Error ? err.message.slice(0, 220) : String(err)}`);
    }
  }
  // eslint-disable-next-line no-console
  console.log('  ' + '─'.repeat(52));
  return failed ? 1 : 0;
}

main()
  .then(async (code) => {
    await closeDwhPool();
    process.exit(code);
  })
  .catch(async (err) => {
    // eslint-disable-next-line no-console
    console.error('analytics-smoke crashed:', err);
    await closeDwhPool().catch(() => undefined);
    process.exit(1);
  });
