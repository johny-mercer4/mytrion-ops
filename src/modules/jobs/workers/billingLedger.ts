/**
 * Billing Ledger daily snapshot worker — TZ §9's "daily recompute of Closing per section, reconciled
 * against an independent source".
 *
 * Deterministic data job, no LLM. It exists because the reconciliation cannot happen inside a page load:
 * the external figures come from the DWH and (eventually) EFS, and the whole in-scope book is ~2,850
 * carriers × 3 sections. Writing the result to `ledger_daily_snapshots` also makes an arbitrary period
 * cheap for the read path — the opening for any window is the snapshot closing on the day before it.
 *
 * IDEMPOTENT by construction: the snapshot table's unique key is (as_of_date, carrier_id, section) and
 * the repo upserts, so a re-run for the same day replaces rather than duplicating. That matters because
 * recomputing a past day is a legitimate operation — a CMP payment reversal changes history.
 *
 * A failed external source degrades the affected ROWS to `source_unavailable`; it never fails the run.
 * Silently marking them `ok` would be the dangerous alternative.
 */
import type { z } from 'zod';
import { errorMessage } from '../../../lib/errors.js';
import { logger } from '../../../lib/logger.js';
import { auditFromContext } from '../../audit/auditLogger.js';
import { listLedgerCarriers } from '../../billing/ledger/clientType.js';
import { computeSection } from '../../billing/ledger/compute.js';
import { fetchExternal, reconcileRows, reconSummary } from '../../billing/ledger/reconcile.js';
import { LEDGER_SECTIONS, type LedgerSectionId } from '../../billing/ledger/sections.js';
import { ledgerSnapshotRepo } from '../../../repos/ledgerSnapshotRepo.js';
import { billingLedgerSnapshotJob } from '../catalog.js';
import { buildSystemContext } from '../systemContext.js';

export type BillingLedgerSnapshotPayload = z.infer<typeof billingLedgerSnapshotJob.schema>;

export interface SectionRunResult {
  section: LedgerSectionId;
  carriers: number;
  written: number;
  ok: number;
  variance: number;
  noOpening: number;
  sourceUnavailable: number;
  staleExternal: number;
  varianceTotal: number;
}

export interface LedgerSnapshotRunSummary {
  asOfDate: string;
  sections: SectionRunResult[];
  durationMs: number;
  warnings: string[];
}

/** yyyy-mm-dd in the ledger's reporting zone. */
function ledgerToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function runBillingLedgerSnapshot(
  payload: BillingLedgerSnapshotPayload = {},
): Promise<LedgerSnapshotRunSummary> {
  const started = Date.now();
  const today = ledgerToday();
  const asOfDate = payload.asOfDate ?? today;
  const warnings: string[] = [];
  const wanted = new Set<string>(payload.sections ?? LEDGER_SECTIONS.map((s) => s.id));

  const scope = await listLedgerCarriers();
  const results: SectionRunResult[] = [];

  for (const def of LEDGER_SECTIONS) {
    if (!wanted.has(def.id)) continue;

    const carriers = scope.carriers.filter((c) => c.clientType === def.clientType);
    if (!carriers.length) continue;

    try {
      // A single day: start and end are the same, and the compute converts to its exclusive end.
      const movements = await computeSection({
        section: def.id,
        startDate: asOfDate,
        endDate: asOfDate,
        carriers,
      });

      /**
       * Skip carriers with neither an opening balance nor any movement. An all-zero, all-null row is
       * a write with no information, and at ~2,850 carriers × 3 sections × 365 days the difference
       * is millions of rows.
       */
      const worth = movements.filter(
        (m) => m.opening !== null || m.debit !== 0 || m.credit !== 0,
      );
      if (!worth.length) {
        results.push({
          section: def.id,
          carriers: 0,
          written: 0,
          ok: 0,
          variance: 0,
          noOpening: 0,
          sourceUnavailable: 0,
          staleExternal: 0,
          varianceTotal: 0,
        });
        continue;
      }

      const external = await fetchExternal(
        def.id,
        asOfDate,
        today,
        worth.map((m) => m.carrierId),
      );
      if (!external.ok && external.error) {
        warnings.push(`${def.id}: ${external.source} unavailable — ${external.error}`);
      }

      const reconciled = reconcileRows(worth, external);
      const written = await ledgerSnapshotRepo.upsertMany(
        reconciled.map((r) => ({
          asOfDate,
          carrierId: r.carrierId,
          section: r.section,
          clientType: r.clientType,
          opening: r.opening,
          debit: r.debit,
          credit: r.credit,
          closing: r.closing,
          externalValue: r.externalValue,
          externalSource: r.externalSource,
          variance: r.variance,
          status: r.status,
          detail: r.components,
        })),
      );

      const s = reconSummary(reconciled);
      results.push({
        section: def.id,
        carriers: reconciled.length,
        written,
        ok: s.ok,
        variance: s.variance,
        noOpening: s.no_opening,
        sourceUnavailable: s.source_unavailable,
        staleExternal: s.stale_external,
        varianceTotal: s.varianceTotal,
      });
    } catch (e) {
      // One section failing must not lose the others' work.
      const message = errorMessage(e);
      warnings.push(`${def.id}: ${message}`);
      logger.error({ err: message, section: def.id, asOfDate }, 'ledger snapshot: section failed');
    }
  }

  const summary: LedgerSnapshotRunSummary = {
    asOfDate,
    sections: results,
    durationMs: Date.now() - started,
    warnings,
  };

  logger.info(
    {
      asOfDate,
      sections: results.length,
      written: results.reduce((n, r) => n + r.written, 0),
      variances: results.reduce((n, r) => n + r.variance, 0),
      durationMs: summary.durationMs,
    },
    'ledger snapshot: run complete',
  );

  await auditFromContext(buildSystemContext(['billing']), {
    action: 'billing.ledger.snapshot',
    status: warnings.length ? 'error' : 'ok',
    resourceType: 'ledger_daily_snapshot',
    resourceId: asOfDate,
    detail: {
      asOfDate,
      trigger: payload.trigger ?? 'cron',
      written: results.reduce((n, r) => n + r.written, 0),
      variances: results.reduce((n, r) => n + r.variance, 0),
      noOpening: results.reduce((n, r) => n + r.noOpening, 0),
      warnings: warnings.slice(0, 10),
    },
  });

  return summary;
}
