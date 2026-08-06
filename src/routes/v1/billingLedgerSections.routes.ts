/**
 * Billing Ledger — the five computed sections, the drill-down statement, and the TZ §9 control points
 * (/v1/billing/ledger/{sections/:section, statement, summary, variances, aging/*, control-sums,
 * recompute}).
 *
 * A third route file because ./billingLedger.routes.ts is already ~490 lines against the 600-line cap.
 * Same conventions as its siblings: thrown `AppError`s, module-level zod, and **`endDate` INCLUSIVE** —
 * converted to the repo layer's exclusive convention once, inside `computeSection`, so no handler here
 * re-interprets it.
 *
 * TWO DIFFERENT READ PATHS, deliberately:
 *   • `/sections/:section` and `/statement` compute LIVE from the DWH + Postgres feeds, so an agent can
 *     pick any period and get an answer for it. That is genuinely expensive over a wide window, hence
 *     `PERIOD_MAX_DAYS` and the mandatory page cap.
 *   • `/summary` and `/variances` read the nightly snapshot table instead — instant, and the only place
 *     the reconciliation status is exposed, because reconciling against an external source cannot happen
 *     inside a page load.
 *
 * `/recompute` is the one write here: it queues the snapshot job.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  arAging,
  controlSums,
  unbilledOverCycle,
  untoppedAging,
} from '../../modules/billing/ledger/aging.js';
import { listLedgerCarriers, resolveLedgerCarriers } from '../../modules/billing/ledger/clientType.js';
import { computeSection, sectionTotals, shiftYmd } from '../../modules/billing/ledger/compute.js';
import { requireLedgerSchema } from '../../modules/billing/ledger/readiness.js';
import { LEDGER_SECTIONS, LEDGER_SECTION_IDS, getLedgerSection } from '../../modules/billing/ledger/sections.js';
import { buildCarrierStatement } from '../../modules/billing/ledger/statement.js';
import { billingLedgerSnapshotJob } from '../../modules/jobs/catalog.js';
import { enqueue } from '../../modules/jobs/queue.js';
import { ledgerSnapshotRepo } from '../../repos/ledgerSnapshotRepo.js';
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';
import type { LedgerSnapshotStatus } from '../../db/schema/index.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireLedgerRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'billing', 'Billing Ledger');
}

function requireLedgerWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'billing', 'Billing Ledger');
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

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd')
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'not a real calendar date');

const sectionParam = z.object({ section: z.enum(LEDGER_SECTION_IDS) });

/**
 * `PERIOD_MAX_DAYS` caps a single request's window. Not arbitrary: without the snapshot table, a
 * request computes every feed over the window AND rolls each carrier's opening forward from its anchor,
 * so a multi-year window over 2,000 carriers is a DWH-hammering query. A clear 400 beats a timeout.
 */
const PERIOD_MAX_DAYS = 400;

const sectionQuery = z.object({
  startDate: ymd,
  endDate: ymd,
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
  /** Free text over carrier id + company name, applied before the page is cut. */
  search: z.string().max(120).optional(),
  /** Show only rows that still have no opening balance — the migration worklist. */
  missingOpeningOnly: z.coerce.boolean().optional(),
  sort: z.enum(['company', 'carrier', 'closing', 'debit', 'credit']).default('company'),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

const statementQuery = z.object({
  carrierId: z.string().min(1).max(60),
  section: z.enum(LEDGER_SECTION_IDS),
  startDate: ymd,
  endDate: ymd,
});

const summaryQuery = z.object({
  asOfDate: ymd.optional(),
  section: z.enum(LEDGER_SECTION_IDS).optional(),
});
const varianceQuery = z.object({
  asOfDate: ymd.optional(),
  section: z.enum(LEDGER_SECTION_IDS).optional(),
  status: z.enum(['variance', 'source_unavailable', 'stale_external', 'no_opening', 'ok']).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
});
const agingListQuery = z.object({
  limit: z.coerce.number().int().positive().max(500).default(100),
});
const controlQuery = z.object({ startDate: ymd.optional(), endDate: ymd.optional() });
const paymentsQuery = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
  startDate: ymd.optional(),
  endDate: ymd.optional(),
  source: z.enum(['mx', 'zelle', 'chase', 'stripe']).optional(),
  /** 'matched' | 'unmatched' — the TZ's two outcomes for an incoming payment. */
  match: z.enum(['matched', 'unmatched']).optional(),
});
const recomputeBody = z
  .object({
    asOfDate: ymd.optional(),
    sections: z.array(z.enum(LEDGER_SECTION_IDS)).max(5).optional(),
  })
  .default({});

/**
 * Which sub-ledger a payment landed in, from its PG mapping columns.
 *
 * `mapping_type` is written by the Transactions tab's own mapping writes, so this is a read of a
 * decision already made — the ledger does not re-derive it, it reports it.
 */
function paymentDestination(
  isMapped: boolean,
  mappingType: string | null,
  clientType: 'LOC' | 'Prepay' | null,
): { state: 'matched' | 'unmatched'; target: string | null; label: string } {
  if (!isMapped) {
    // Money received and attributed to nobody. For a Prepay carrier it is sitting in Un Top-Upped;
    // with no carrier at all it is the §7 unmatched queue — the "lost money" case.
    if (!clientType) return { state: 'unmatched', target: null, label: 'Unmatched — no carrier' };
    return clientType === 'Prepay'
      ? { state: 'unmatched', target: 'untopped', label: 'Awaiting top-up' }
      : { state: 'unmatched', target: null, label: 'Unmatched' };
  }
  const t = (mappingType ?? '').toLowerCase();
  if (t.includes('prepay')) return { state: 'matched', target: 'cb-prepay', label: 'Top-up applied' };
  if (t.includes('split')) return { state: 'matched', target: 'ar', label: 'Split across invoices' };
  return { state: 'matched', target: 'ar', label: 'Applied to AR' };
}

function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number) as [number, number, number];
  const [by, bm, bd] = b.split('-').map(Number) as [number, number, number];
  return Math.round((Date.UTC(by, bm - 1, bd) - Date.UTC(ay, am - 1, ad)) / 86_400_000);
}

function assertPeriod(startDate: string, endDate: string): void {
  if (startDate > endDate) {
    throw new ValidationError('The period start must not be after its end.', {
      code: 'LEDGER_PERIOD_INVERTED',
      details: { startDate, endDate },
    });
  }
  const span = daysBetween(startDate, endDate) + 1;
  if (span > PERIOD_MAX_DAYS) {
    throw new ValidationError(
      `That period spans ${span} days; the maximum is ${PERIOD_MAX_DAYS}. Narrow the range.`,
      { code: 'LEDGER_PERIOD_TOO_WIDE', details: { days: span, max: PERIOD_MAX_DAYS } },
    );
  }
}

export async function billingLedgerSectionsRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey], preHandler: [requireLedgerSchema] };

  /**
   * One sub-ledger over a period: Opening / Debit / Credit / Closing per carrier.
   *
   * Sorting and paging happen AFTER the compute because the compute is set-based over the whole
   * in-scope carrier set for that client type — there is no cheaper way to know a carrier's Closing
   * than to compute it, so paging the DWH query would not save the work.
   */
  app.get('/billing/ledger/sections/:section', guard, async (request) => {
    requireLedgerRead(request);
    const { section } = sectionParam.parse(request.params);
    const q = sectionQuery.parse(request.query);
    assertPeriod(q.startDate, q.endDate);

    const def = getLedgerSection(section);
    const scope = await listLedgerCarriers({ clientType: def.clientType });

    const rows = await computeSection({
      section,
      startDate: q.startDate,
      endDate: q.endDate,
      carriers: scope.carriers,
    });

    let view = rows;
    const needle = q.search?.trim().toLowerCase();
    if (needle) {
      view = view.filter(
        (r) =>
          r.carrierId.toLowerCase().includes(needle) || r.companyName.toLowerCase().includes(needle),
      );
    }
    if (q.missingOpeningOnly) view = view.filter((r) => r.opening === null);

    const dir = q.dir === 'desc' ? -1 : 1;
    view = [...view].sort((a, b) => {
      let cmp: number;
      switch (q.sort) {
        case 'carrier':
          cmp = a.carrierId.localeCompare(b.carrierId);
          break;
        case 'closing':
          // Nulls last regardless of direction — an unknown balance is not "the smallest".
          if (a.closing === null && b.closing === null) cmp = 0;
          else if (a.closing === null) return 1;
          else if (b.closing === null) return -1;
          else cmp = a.closing - b.closing;
          break;
        case 'debit':
          cmp = a.debit - b.debit;
          break;
        case 'credit':
          cmp = a.credit - b.credit;
          break;
        default:
          cmp = (a.companyName || a.carrierId).localeCompare(b.companyName || b.carrierId);
      }
      // Always end on a total tiebreak so paging cannot skip or repeat a row.
      return cmp !== 0 ? cmp * dir : a.carrierId.localeCompare(b.carrierId);
    });

    const total = view.length;
    const offset = (q.page - 1) * q.limit;
    const paged = view.slice(offset, offset + q.limit);

    return {
      section,
      label: def.label,
      clientType: def.clientType,
      externalSource: def.externalSource,
      shouldTrendToZero: def.shouldTrendToZero,
      /** Echoed so the client can detect a reply for a period it is no longer showing. */
      period: { startDate: q.startDate, endDate: q.endDate },
      rows: paged,
      /** Totals over the FILTERED view, so they agree with what the agent is looking at. */
      totals: sectionTotals(view),
      page: q.page,
      limit: q.limit,
      total,
      hasMore: offset + paged.length < total,
      /** An excluded carrier is simply absent, which is indistinguishable from a bug unless we say so. */
      excluded: scope.excluded,
    };
  });

  /**
   * The drill-down: one carrier's lines for one section over the period, with a server-computed running
   * balance. `closing === lines[last].running` by construction — see the statement module's header.
   */
  app.get('/billing/ledger/statement', guard, async (request) => {
    requireLedgerRead(request);
    const q = statementQuery.parse(request.query);
    assertPeriod(q.startDate, q.endDate);
    try {
      return await buildCarrierStatement(q);
    } catch (e) {
      if (e instanceof AppError) throw e;
      throw new AppError((e as Error).message || 'Could not build the statement.', {
        statusCode: 422,
        code: 'LEDGER_STATEMENT_UNAVAILABLE',
        expose: true,
      });
    }
  });

  // ─── Control points (TZ §9) ────────────────────────────────────────────────────────────────

  /**
   * The snapshot summary for a day: per-section reconciliation status counts.
   *
   * Reads `ledger_daily_snapshots` — instant, and the ONLY place the nightly job's work is exposed.
   * `computedFor` is echoed so a stale cache is labelled rather than silently served as today's truth.
   */
  app.get('/billing/ledger/summary', guard, async (request) => {
    requireLedgerRead(request);
    const q = summaryQuery.parse(request.query);
    const asOfDate = q.asOfDate ?? ledgerToday();
    const [counts, latest] = await Promise.all([
      ledgerSnapshotRepo.statusCounts(asOfDate, q.section),
      ledgerSnapshotRepo.latestComputedDate(),
    ]);

    const bySection = new Map<string, Record<string, { carriers: number; varianceTotal: number }>>();
    for (const c of counts) {
      const bag = bySection.get(c.section) ?? {};
      bag[c.status] = { carriers: c.carriers, varianceTotal: c.varianceTotal };
      bySection.set(c.section, bag);
    }

    return {
      asOfDate,
      /** null until the job has ever run. The UI must say "not computed yet", not show zeros. */
      latestComputedDate: latest,
      stale: latest !== null && latest < asOfDate,
      sections: LEDGER_SECTIONS.filter((s) => !q.section || s.id === q.section).map((s) => {
        const bag = bySection.get(s.id) ?? {};
        const pick = (k: string): number => bag[k]?.carriers ?? 0;
        return {
          section: s.id,
          label: s.label,
          clientType: s.clientType,
          externalSource: s.externalSource,
          counts: {
            ok: pick('ok'),
            variance: pick('variance'),
            noOpening: pick('no_opening'),
            sourceUnavailable: pick('source_unavailable'),
            staleExternal: pick('stale_external'),
          },
          varianceTotal: bag['variance']?.varianceTotal ?? 0,
        };
      }),
    };
  });

  /** The variance queue for a day — worst first. This is the work list the module produces. */
  app.get('/billing/ledger/variances', guard, async (request) => {
    requireLedgerRead(request);
    const q = varianceQuery.parse(request.query);
    const asOfDate = q.asOfDate ?? ledgerToday();
    const statuses = (q.status ? [q.status] : ['variance', 'source_unavailable', 'stale_external']) as LedgerSnapshotStatus[];
    const { rows, total } = await ledgerSnapshotRepo.listByStatus({
      asOfDate,
      section: q.section,
      statuses,
      limit: q.limit,
      offset: (q.page - 1) * q.limit,
    });
    return {
      asOfDate,
      rows: rows.map((r) => ({
        carrierId: r.carrierId,
        section: r.section,
        clientType: r.clientType,
        opening: r.opening === null ? null : Number(r.opening),
        debit: Number(r.debit),
        credit: Number(r.credit),
        closing: r.closing === null ? null : Number(r.closing),
        externalValue: r.externalValue === null ? null : Number(r.externalValue),
        externalSource: r.externalSource,
        variance: r.variance === null ? null : Number(r.variance),
        status: r.status,
        computedAt: r.computedAt.toISOString(),
      })),
      total,
      page: q.page,
      limit: q.limit,
      hasMore: (q.page - 1) * q.limit + rows.length < total,
    };
  });

  /** AR aging — the TZ's buckets plus `current` and `no_due_date` (see arRules.ts for why). */
  app.get('/billing/ledger/aging/ar', guard, async (request) => {
    requireLedgerRead(request);
    return arAging();
  });

  /**
   * Spend that should already have been invoiced — the Unbilled control point. Flagged per carrier
   * against that carrier's own last invoiced-through date, not calendar arithmetic on billing_cycle.
   */
  app.get('/billing/ledger/aging/unbilled', guard, async (request) => {
    requireLedgerRead(request);
    const q = agingListQuery.parse(request.query);
    const rows = await unbilledOverCycle(q.limit);
    return {
      rows,
      total: rows.length,
      totalAmount: Math.round(rows.reduce((n, r) => n + r.amount, 0) * 100) / 100,
    };
  });

  /** Un Top-Upped aging — the TZ's 24-hour alarm on money received but not yet loaded. */
  app.get('/billing/ledger/aging/untopped', guard, async (request) => {
    requireLedgerRead(request);
    return untoppedAging();
  });

  /** The top-level control sum. Ships the CMP-internal leg only — see aging.ts for why. */
  app.get('/billing/ledger/control-sums', guard, async (request) => {
    requireLedgerRead(request);
    const q = controlQuery.parse(request.query);
    const endDate = q.endDate ?? ledgerToday();
    const startDate = q.startDate ?? shiftYmd(endDate, -6);
    assertPeriod(startDate, endDate);
    return {
      period: { startDate, endDate },
      checks: await controlSums({ startDate, endDateExclusive: shiftYmd(endDate, 1) }),
    };
  });

/**
   * The payments journal in LEDGER framing (TZ §7).
   *
   * Deliberately NOT a second copy of the Transactions tab. That tab answers "what came in and how do I
   * map it"; this one answers the ledger question — WHICH SUB-LEDGER did each payment land in. A matched
   * invoice payment is an AR credit; a matched prepay payment is a Customer Balance top-up; an unmatched
   * one is money we are holding and have attributed to nobody, which is the "lost money" case §7 exists
   * to prevent. None of that is visible on the Transactions tab.
   *
   * Period-independent by default: an unmatched payment from three weeks ago is exactly the row an agent
   * needs to see today, so scoping this to the ledger's period would hide the problem it reports.
   */
  app.get('/billing/ledger/payments', guard, async (request) => {
    requireLedgerRead(request);
    const q = paymentsQuery.parse(request.query);
    if (q.startDate && q.endDate) assertPeriod(q.startDate, q.endDate);

    const page = await paymentTransactionRepo.listPage({
      page: q.page,
      limit: q.limit,
      ...(q.source ? { source: q.source } : {}),
      ...(q.match ? { isMapped: q.match === 'matched' } : {}),
      ...(q.startDate ? { dateFrom: q.startDate } : {}),
      // listPage's dateTo is inclusive-of-instant; shift so a whole end day is covered.
      ...(q.endDate ? { dateTo: shiftYmd(q.endDate, 1) } : {}),
    });

    const carriers = await resolveLedgerCarriers(
      page.rows.map((r) => r.carrierId).filter((c): c is string => Boolean(c)),
    );

    return {
      rows: page.rows.map((r) => {
        const carrier = r.carrierId ? carriers.get(r.carrierId) : undefined;
        return {
          id: String(r.id),
          date: r.occurredAt ? r.occurredAt.toISOString().slice(0, 10) : null,
          source: r.source,
          amount: Number(r.amount) || 0,
          carrierId: r.carrierId,
          companyName: carrier?.companyName ?? null,
          clientType: carrier?.clientType ?? null,
          senderName: r.senderName,
          isReturned: r.isReturned,
          match: paymentDestination(r.isInvoiceMapped, r.mappingType, carrier?.clientType ?? null),
          mappedBy: r.mappedBy,
          mappedAt: r.mappedAt ? r.mappedAt.toISOString() : null,
        };
      }),
      page: page.page,
      limit: page.limit,
      total: page.total,
      hasMore: page.hasMore,
    };
  });

  /**
   * Queue a snapshot recompute. Write-gated because it consumes DWH capacity and rewrites a day's
   * reconciliation status.
   *
   * Enqueues directly rather than through `triggerCatalogJob`, which is admin-only — a billing agent
   * with write access should be able to recompute their own day.
   */
  app.post('/billing/ledger/recompute', guard, async (request) => {
    const ctx = requireLedgerWrite(request);
    const b = recomputeBody.parse(request.body ?? {});
    const asOfDate = b.asOfDate ?? ledgerToday();
    if (asOfDate > ledgerToday()) {
      throw new ValidationError('Cannot recompute a future day.', { code: 'LEDGER_RECOMPUTE_FUTURE' });
    }
    const jobId = await enqueue(billingLedgerSnapshotJob, {
      asOfDate,
      trigger: 'manual',
      ...(b.sections?.length ? { sections: b.sections } : {}),
    });
    await auditFromContext(ctx, {
      action: 'billing.ledger.recompute',
      status: 'ok',
      resourceType: 'ledger_daily_snapshot',
      resourceId: asOfDate,
      detail: { asOfDate, sections: b.sections ?? null, jobId },
    });
    return { jobId, asOfDate, queue: billingLedgerSnapshotJob.name };
  });
}
