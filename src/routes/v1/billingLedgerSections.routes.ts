/**
 * Billing Ledger — the five computed sections and the drill-down statement
 * (/v1/billing/ledger/sections/:section, /v1/billing/ledger/statement).
 *
 * A third route file because ./billingLedger.routes.ts is already ~490 lines against the 600-line cap.
 * Same conventions as its siblings: thrown `AppError`s, `requireLedgerRead`, module-level zod, and
 * **`endDate` INCLUSIVE** — converted to the repo layer's exclusive convention once, inside
 * `computeSection`, so no handler here re-interprets it.
 *
 * Both routes are READS. They compute live from the DWH + Postgres feeds; the nightly snapshot table
 * that makes an arbitrary period O(1) is a later pass, so a wide period over the whole book is
 * genuinely expensive today — hence the mandatory page cap below.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { AppError, ValidationError } from '../../lib/errors.js';
import { listLedgerCarriers } from '../../modules/billing/ledger/clientType.js';
import { computeSection, sectionTotals } from '../../modules/billing/ledger/compute.js';
import { requireLedgerSchema } from '../../modules/billing/ledger/readiness.js';
import { LEDGER_SECTION_IDS, getLedgerSection } from '../../modules/billing/ledger/sections.js';
import { buildCarrierStatement } from '../../modules/billing/ledger/statement.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment } from './helpers.js';

function requireLedgerRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'billing', 'Billing Ledger');
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
}
