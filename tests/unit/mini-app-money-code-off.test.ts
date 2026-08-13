import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * Money code draws sit behind FF_MINIAPP_MONEY_CODE_ENABLED, which is off. The catalog has to agree
 * with the backend: while the item carried a live action the sheet opened and the first call came
 * back 503 "not enabled here yet" — a dead end dressed as a service.
 *
 * Read as source text rather than imported: `serviceCatalog.ts` pulls the mini-app's React icon
 * module in, and this is a backend test project with no DOM lib or JSX. The same trick the Sales
 * dashboard's CSS contract tests use.
 */
const CATALOG = readFileSync(
  join(process.cwd(), 'apps/mini-app/src/lib/serviceCatalog.ts'),
  'utf8',
);

function itemLine(key: string): string {
  const line = CATALOG.split('\n').find((l) => l.includes(`key: '${key}'`));
  if (!line) throw new Error(`no catalog item for ${key}`);
  return line;
}

describe('mini-app money code is switched off', () => {
  it('offers money code as a soon item, not a live action', () => {
    expect(itemLine('fin-money-code')).toMatch(/action:\s*null/);
    expect(itemLine('drv-money-code')).toMatch(/action:\s*null/);
    // No catalog ITEM may point at the sheet (the prose above the entry still names it).
    const live = CATALOG.split('\n').filter((l) => l.includes("key: '") && /action:\s*'moneycode'/.test(l));
    expect(live).toEqual([]);
  });

  it('leaves the other finance services alone', () => {
    expect(itemLine('fin-balance')).toMatch(/action:\s*'balance'/);
    expect(itemLine('fin-txn-reports')).toMatch(/action:\s*'txns'/);
    expect(itemLine('fin-invoice-view')).toMatch(/action:\s*'invoices'/);
    expect(itemLine('fin-payment-status')).toMatch(/action:\s*'payment'/);
  });

  it('does not pin a service nobody can open', () => {
    const ownerPins = /:\s*\[('[^']+',?\s*)+\];/.exec(
      CATALOG.slice(CATALOG.indexOf('export function defaultPinned')),
    )?.[0] ?? '';
    expect(ownerPins).not.toContain('fin-money-code');
    expect(ownerPins).toContain('fin-balance');
  });

  it('keeps money code visible so owners know it is coming', () => {
    // Still in the catalog — an owner should see it is coming, not wonder where it went.
    expect(CATALOG).toContain("key: 'fin-money-code'");
    // Soon items sit below the live ones: this catalog's own stated ordering rule.
    expect(CATALOG.indexOf("key: 'fin-money-code'")).toBeGreaterThan(
      CATALOG.indexOf("key: 'fin-payment-status'"),
    );
  });
});
