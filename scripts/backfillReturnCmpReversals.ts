/**
 * One-shot: resolve + reverse CMP payments for returns already matched in `payment_returns` whose
 * original MX transaction was never mapped in our system (`is_invoice_mapped=false`), so the live
 * `/billing/returns/:id/match` route's old code never even attempted a CMP lookup for them. See
 * src/modules/billing/returnsCmpReversal.ts for why this is possible (MX charges are often paid
 * straight through the CMP portal and auto-applied to an invoice there, independent of whether our
 * system ever resolved a carrier) and src/routes/v1/billing.routes.ts for the now-fixed live path —
 * this script only backfills the backlog that already exists.
 *
 * Usage:
 *   corepack pnpm exec tsx scripts/backfillReturnCmpReversals.ts                  # dry-run
 *   corepack pnpm exec tsx scripts/backfillReturnCmpReversals.ts --apply          # write + reverse
 *   corepack pnpm exec tsx scripts/backfillReturnCmpReversals.ts --limit=20       # bound the batch
 *
 * Real money moves in --apply mode (a resolved payment is DELETED in CMP). Always run the dry-run
 * first and review the bucketed report before ever passing --apply.
 */
import 'dotenv/config';
import { databaseUrl } from '../src/config/env.js';
import { audit } from '../src/modules/audit/auditLogger.js';
import { resolveReturnCmpReversal } from '../src/modules/billing/returnsCmpReversal.js';
import { paymentReturnRepo } from '../src/repos/paymentReturnRepo.js';
import { paymentTransactionRepo } from '../src/repos/paymentTransactionRepo.js';
import { DEFAULT_TENANT_ID } from '../src/config/constants.js';

const APPLY = process.argv.includes('--apply');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? Math.max(1, parseInt(limitArg.split('=')[1] ?? '', 10) || 500) : 500;
const RESOLVED_BY = 'CMP backfill script';
const CONSECUTIVE_FAILURE_ABORT = 3; // providerGuard trips servercrm at 5 — stop well before that.
const NETWORK_FAILURE_NOTE = 'CMP lookup failed — reconcile manually';

async function main(): Promise<void> {
  const host = new URL(databaseUrl).hostname;
  console.log(`DB ${host} · ${APPLY ? 'APPLY' : 'DRY-RUN'} · limit ${LIMIT}`);

  const candidates = await paymentReturnRepo.listStuckUnreversed(LIMIT);
  console.log(`\nMatched + not-yet-reversed returns: ${candidates.length}`);

  const buckets = {
    resolved: 0,
    ambiguous: 0,
    attemptedNoReversal: 0,
    noSignal: 0,
    nonMx: 0,
    alreadyMappedOrRefd: 0,
    noLinkedPayment: 0,
  };
  const resolvedRows: Array<{ returnId: number; amount: string | null; carrierId: string; senderName: string | null }> = [];
  const failedRows: Array<{ returnId: number; message: string | undefined }> = [];
  // Actionable — a human can resolve these in seconds (pick the right carrier), unlike a genuine
  // resolver miss. Reported separately so they don't get lost among real dead ends.
  const ambiguousRows: Array<{ returnId: number; senderName: string | null; candidateCount: number | undefined }> = [];

  let consecutiveNetworkFailures = 0;
  for (const { ret, tx } of candidates) {
    if (!tx) {
      buckets.noLinkedPayment += 1;
      continue;
    }
    if (tx.source !== 'mx') {
      buckets.nonMx += 1;
      continue;
    }
    if (tx.cmpRef) {
      // Only `cmpRef` means "already resolved" — `isInvoiceMapped` alone does NOT: a transaction can
      // have a known carrier (via the ingest-time auto-map job, or a plain manual map) while its CMP
      // payment was never checked or reversed. resolveReturnCmpReversal already prefers tx.carrierId
      // when present (cheap, skips discovery) and still attempts the real CMP resolution — so a
      // mapped-but-unreffed row must still be attempted here, not skipped.
      buckets.alreadyMappedOrRefd += 1;
      continue;
    }

    const resolution = await resolveReturnCmpReversal(tx, { dryRun: !APPLY });

    if (resolution.matchNote === NETWORK_FAILURE_NOTE) {
      consecutiveNetworkFailures += 1;
      failedRows.push({ returnId: ret.id, message: resolution.detail.resolveMessage });
      if (consecutiveNetworkFailures >= CONSECUTIVE_FAILURE_ABORT) {
        console.error(
          `\nAborting: ${CONSECUTIVE_FAILURE_ABORT} consecutive servercrm/CMP failures — ` +
            `stopping before the shared circuit breaker trips and blocks live billing agents too.`,
        );
        break;
      }
      continue;
    }
    consecutiveNetworkFailures = 0;

    if (!resolution.detail.attempted) {
      buckets.noSignal += 1;
      continue;
    }

    if (resolution.wouldSucceed) {
      buckets.resolved += 1;
      resolvedRows.push({
        returnId: ret.id,
        amount: tx.amount,
        carrierId: resolution.mappingPatch?.carrierId ?? '',
        senderName: tx.senderName ?? tx.name,
      });
      // APPLY=false → dryRun=true was passed above, so resolveReturnCmpReversal already stopped
      // short of the actual CMP delete; isReversed is only ever true on a real, applied run.
      if (APPLY && resolution.isReversed) {
        if (resolution.mappingPatch) {
          await paymentTransactionRepo.applyMapping(tx.id, {
            ...resolution.mappingPatch,
            isInvoiceMapped: true,
            mappedBy: RESOLVED_BY,
            mappedAt: new Date(),
          });
        }
        await paymentReturnRepo.recordCmpReversal(ret.id, {
          matchNote: resolution.matchNote,
          isReversed: true,
          resolvedBy: RESOLVED_BY,
        });
        await audit({
          tenantId: DEFAULT_TENANT_ID,
          action: 'billing.returns.cmp-backfill',
          status: 'ok',
          audience: 'internal',
          userName: RESOLVED_BY,
          resourceType: 'payment_return',
          resourceId: String(ret.id),
          detail: { transactionId: tx.id, ...resolution.detail },
        });
      }
    } else if (resolution.detail.candidateCount != null) {
      buckets.ambiguous += 1;
      ambiguousRows.push({ returnId: ret.id, senderName: tx.senderName ?? tx.name, candidateCount: resolution.detail.candidateCount });
      if (APPLY) {
        await paymentReturnRepo.recordCmpReversal(ret.id, {
          matchNote: resolution.matchNote,
          isReversed: false,
          resolvedBy: RESOLVED_BY,
        });
      }
    } else {
      buckets.attemptedNoReversal += 1;
      failedRows.push({ returnId: ret.id, message: resolution.detail.resolveMessage });
      if (APPLY) {
        await paymentReturnRepo.recordCmpReversal(ret.id, {
          matchNote: resolution.matchNote,
          isReversed: false,
          resolvedBy: RESOLVED_BY,
        });
      }
    }
  }

  console.log('\nBuckets:');
  console.table(buckets);

  if (resolvedRows.length) {
    console.log(`\n${APPLY ? 'Reversed' : 'Would reverse'} (${resolvedRows.length}):`);
    console.table(resolvedRows.slice(0, 50));
    if (resolvedRows.length > 50) console.log(`  … + ${resolvedRows.length - 50} more`);
  }
  if (ambiguousRows.length) {
    console.log(`\nAmbiguous — a human can pick the carrier in seconds (${ambiguousRows.length}):`);
    console.table(ambiguousRows.slice(0, 50));
    if (ambiguousRows.length > 50) console.log(`  … + ${ambiguousRows.length - 50} more`);
  }
  if (failedRows.length) {
    console.log(`\nAttempted but not reversed (${failedRows.length}) — reconcile manually:`);
    console.table(failedRows.slice(0, 50));
    if (failedRows.length > 50) console.log(`  … + ${failedRows.length - 50} more`);
  }

  console.log(
    APPLY
      ? `\nDone. ${buckets.resolved} reversed, ${buckets.ambiguous} ambiguous (pick manually), ` +
        `${buckets.attemptedNoReversal} flagged for manual reconciliation.`
      : '\nDry-run only. Re-run with --apply to write + reverse in CMP.',
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
