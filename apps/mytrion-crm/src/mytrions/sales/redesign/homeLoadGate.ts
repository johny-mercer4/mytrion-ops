/**
 * Sales Home opens snapshot + activity + announcements + inbox together. Snapshot is the
 * Money Owed path (Billing-aligned debtor filter) and must start immediately; the others wait
 * until that first wave finishes so Telegram WebView / Render HTTP/2 is not slammed.
 *
 * `/v1/sales/bootstrap` is not used here: its debtor totals skip `filterDebtors`.
 */

let inflight = 0;
let gate: Promise<void> = Promise.resolve();
let release: (() => void) | null = null;

export async function withHomeSnapshotGate<T>(fn: () => Promise<T>): Promise<T> {
  if (inflight === 0) {
    gate = new Promise<void>((resolve) => {
      release = resolve;
    });
  }
  inflight += 1;
  try {
    return await fn();
  } finally {
    inflight -= 1;
    if (inflight === 0) {
      release?.();
      release = null;
    }
  }
}

export function afterHomeSnapshot<T>(fn: () => Promise<T>): Promise<T> {
  return gate.then(fn, fn);
}
