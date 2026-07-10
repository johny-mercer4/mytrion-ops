/**
 * Touchpoints live smoke (READ-ONLY) — verifies the Deluge executor's token flow +
 * output parsing and the servercrm wrapper against the real services. No writes.
 *
 *   pnpm tsx scripts/touchpointsSmoke.ts [carrierId]
 */
import 'dotenv/config';
import { executeZohoFunction, zohoFunctionsBaseUrl } from '../src/integrations/zohoFunctions.js';
import { serverCrmGet, serverCrmPost } from '../src/integrations/serverCrm.js';

const carrierId = process.argv[2] ?? '5796646';

function preview(v: unknown, n = 400): string {
  return JSON.stringify(v)?.slice(0, n) ?? String(v);
}

async function main(): Promise<void> {
  console.log('functions base:', zohoFunctionsBaseUrl());

  console.log('\n--- deluge: mytrionfetchannouncements (read) ---');
  try {
    const out = await executeZohoFunction('mytrionfetchannouncements', {});
    console.log('OK:', preview(out));
  } catch (err) {
    console.error('FAILED:', err instanceof Error ? err.message : err);
  }

  console.log(`\n--- servercrm: carrier-balance/${carrierId} (read) ---`);
  try {
    const out = await serverCrmGet(`/api/agent/dwh/carrier-balance/${carrierId}`);
    console.log('OK:', preview(out));
  } catch (err) {
    console.error('FAILED:', err instanceof Error ? err.message : err);
  }

  console.log(`\n--- servercrm: transactions/${carrierId}?range=month (range-vocab fix) ---`);
  try {
    const out = await serverCrmGet(`/api/agent/dwh/transactions/${carrierId}`, { range: 'month', limit: 3 });
    console.log('OK:', preview(out, 240));
  } catch (err) {
    console.error('FAILED:', err instanceof Error ? err.message : err);
  }

  console.log(`\n--- servercrm: efs/cards (camelCase cardNumber fix) ---`);
  try {
    const out = await serverCrmPost('/api/efs/cards', { carrierId });
    const first = (out as { data?: unknown[] })?.data?.[0];
    console.log('OK first card:', preview(first, 240));
  } catch (err) {
    console.error('FAILED:', err instanceof Error ? err.message : err);
  }
}

await main();
