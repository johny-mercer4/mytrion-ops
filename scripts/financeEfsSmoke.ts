/**
 * Finance EFS / money-code readers smoke (LIVE, read-only) — exercises the four readers behind the
 * client modal's EFS and Money Codes tabs against prod servercrm, and asserts that no redeemable
 * money-code digits survive into the payload.
 *
 *   pnpm tsx scripts/financeEfsSmoke.ts [carrierId]
 *
 * Nothing here writes: no load, no issue, no void. Sibling of scripts/financePanelSmoke.ts.
 */
import 'dotenv/config';
import {
  fetchCarrierMoneyCodes,
  fetchEfsLoads,
  fetchEfsSnapshot,
  fetchMoneyCodeDetail,
} from '../src/modules/finance/financeEfs.js';

const carrierId = process.argv[2] ?? '5816754';

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = ''): void {
  if (ok) {
    pass += 1;
    console.log(`  ✓ ${label}${detail ? ` — ${detail}` : ''}`);
  } else {
    fail += 1;
    console.error(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

console.log(`Finance EFS smoke — carrier ${carrierId}`);
console.log('='.repeat(64));

console.log('\n▶ carrier snapshot');
const t0 = Date.now();
const snap = await fetchEfsSnapshot(carrierId);
console.log(
  `  balance $${snap.totalBalance} · ${snap.contracts.length} contract(s) · ${snap.cardCount} card(s) (${Date.now() - t0}ms)`,
);
check('contracts carry an id', snap.contracts.every((c) => c.contractId !== ''));
check('no card detail error', snap.cardDetailError === null, snap.cardDetailError ?? '');

console.log('\n▶ fund movements (30d)');
const t1 = Date.now();
const loads = await fetchEfsLoads(carrierId, 30);
console.log(
  `  ${loads.summary.total} movement(s): ${loads.summary.topupCount} topup / ${loads.summary.sweepCount} sweep, net $${loads.summary.net} (${Date.now() - t1}ms)`,
);
check('window clamped to the ask', loads.window.days === 30);
check(
  'every row is TOPUP or SWEEP',
  loads.loads.every((l) => l.direction === 'TOPUP' || l.direction === 'SWEEP'),
);
check(
  'sweeps carry a negative amount',
  loads.loads.filter((l) => l.direction === 'SWEEP').every((l) => l.amount < 0),
);

console.log('\n▶ money codes (60d, ALL)');
const t2 = Date.now();
const mc = await fetchCarrierMoneyCodes(carrierId, 60, 'ALL');
console.log(
  `  ${mc.summary.total} code(s): ${mc.summary.openCount} open / ${mc.summary.usedCount} used / ${mc.summary.voidedCount} voided · fees $${mc.summary.feeTotal} (${Date.now() - t2}ms)`,
);
// The masking is the security property of this whole surface — assert it on the real payload.
const raw = JSON.stringify(mc);
check('no `code` / `alphaCode` field in the payload', !/"(code|alphaCode)"\s*:/.test(raw));
check('codeLast4 is never longer than 4', mc.codes.every((c) => c.codeLast4.length <= 4));
check(
  'no epoch-sentinel void dates leaked through',
  mc.codes.every((c) => !(c.voidedAt ?? '').startsWith('1970')),
);

console.log('\n▶ custom date range (last calendar month, both ends inclusive)');
const now = new Date();
const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
const monthEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 0));
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const custom = await fetchEfsLoads(carrierId, { from: ymd(monthStart), to: ymd(monthEnd) });
console.log(
  `  ${ymd(monthStart)} → ${ymd(monthEnd)} (${custom.window.days}d): ${custom.summary.total} movement(s), net $${custom.summary.net}`,
);
check('window reports itself as custom', custom.window.custom === true);
// Rows are stamped Central; the bounds are built in Central too, so the row's OWN local date must
// fall inside the picked days. Comparing a zoned string against a UTC bound is what hid the
// timezone bug this check was written to catch.
check(
  'every row’s Central date falls inside the picked range',
  custom.loads.every((l) => {
    const day = (l.when ?? '').slice(0, 10);
    return !day || (day >= ymd(monthStart) && day <= ymd(monthEnd));
  }),
);
// A range EFS cannot serve must be refused by us, not by a SOAP fault.
let refused = false;
try {
  await fetchEfsLoads(carrierId, { from: '2026-01-01', to: ymd(now) });
} catch (err) {
  refused = /keeps only 90 days/.test(String(err));
}
check('an over-wide range is refused locally', refused);

const first = mc.codes[0];
if (first) {
  console.log(`\n▶ money-code detail (id ${first.id})`);
  const t3 = Date.now();
  const detail = await fetchMoneyCodeDetail(first.id);
  console.log(
    `  status ${detail.status} · $${detail.amountUsed} of $${detail.amount} used across ${detail.uses.length} draw(s) (${Date.now() - t3}ms)`,
  );
  check('detail is the code we asked for', detail.id === first.id);
  check('detail also hides the digits', !/"(code|alphaCode)"\s*:/.test(JSON.stringify(detail)));
} else {
  console.log('\n▶ money-code detail — skipped (no codes in the window)');
}

console.log(`\n${'='.repeat(64)}\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
