/**
 * Billing Ledger — reads, opening balances and client-type overrides (/v1/billing/ledger/*).
 *
 * The accounting layer from the TZ: five sub-ledgers, each `Closing = Opening + Debit − Credit`,
 * each reconciled against an independent source. This file owns the opening-balance surface (the
 * launch requirement — migrating accumulated balances out of CMP) and the client-type override that
 * decides which carriers are in scope. The Excel bulk path lives in ./billingLedgerImport.routes.ts;
 * the computed sections and the statement drill-down arrive with the compute layer.
 *
 * A NEW file rather than an addition to ./billing.routes.ts, which is already 535 lines against the
 * 600-line cap in CLAUDE.md.
 *
 * TWO CONVENTIONS DIFFER DELIBERATELY from ./billing.routes.ts:
 *   • Errors are THROWN AppErrors, normalized by the error handler into
 *     `{error:{code,message,requestId}}`. That file's `{status:'success'|'partial'|'error'}` envelope
 *     exists for legacy zoho-octane widget parity (see its own comment) — the Ledger has no legacy
 *     twin and a brand-new frontend, so it uses the modern convention.
 *   • `endDate` is INCLUSIVE on every ledger endpoint. Billing is inconsistent today (list endpoints
 *     exclusive, /billing/prepay/ledger inclusive, which is why the Prepay panel shifts back a day).
 *     The ledger accepts what the agent typed and converts ONCE, here, via `toExclusive`.
 *
 * Identity for writes is always the verified session, never the client. Every write is audited,
 * including the failure path before an error is returned.
 */
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { NotFoundError, ValidationError } from '../../lib/errors.js';
import { auditFromContext } from '../../modules/audit/auditLogger.js';
import {
  clearLedgerScopeCache,
  listLedgerCarriers,
  lookupLedgerCarrier,
  normalizeClientType,
  resolveLedgerCarriers,
} from '../../modules/billing/ledger/clientType.js';
import { requireLedgerSchema } from '../../modules/billing/ledger/readiness.js';
import {
  LEDGER_SECTIONS,
  LEDGER_SECTION_IDS,
  getLedgerSection,
} from '../../modules/billing/ledger/sections.js';
import { assertTransitionAllowed } from '../../modules/billing/ledger/transitionRules.js';
import { toOpeningWire, toOverrideWire } from '../../modules/billing/ledger/wire.js';
import { ledgerClientTypeRepo } from '../../repos/ledgerClientTypeRepo.js';
import { ledgerOpeningBalanceRepo } from '../../repos/ledgerOpeningBalanceRepo.js';
import type { TenantContext } from '../../types/tenantContext.js';
import { requireDepartment, requireMytrionWrite } from './helpers.js';

function requireLedgerRead(request: FastifyRequest): TenantContext {
  return requireDepartment(request, 'billing', 'Billing Ledger');
}

/** Enter the Ledger in write mode (blocks read-only billing grants). Admins always pass. */
function requireLedgerWrite(request: FastifyRequest): TenantContext {
  return requireMytrionWrite(request, 'billing', 'Billing Ledger');
}

/** Actor label for created_by / superseded_by — always the verified session. */
function actor(ctx: TenantContext): string {
  return ctx.userName ?? 'A billing agent';
}

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'expected yyyy-mm-dd')
  /**
   * Reject a calendar-invalid day. `new Date('2026-02-30')` rolls over to March 2 rather than
   * failing, so a typo'd as-of date would silently anchor a balance to the wrong month.
   */
  .refine((v) => {
    const [y, m, d] = v.split('-').map(Number) as [number, number, number];
    const dt = new Date(Date.UTC(y, m - 1, d));
    return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
  }, 'not a real calendar date');

const sectionEnum = z.enum(LEDGER_SECTION_IDS);
const carrierIdParam = z.object({ carrierId: z.string().min(1).max(60) });
const revisionIdParam = z.object({ id: z.string().min(1).max(60) });

const openingListQuery = z.object({
  section: sectionEnum.optional(),
  carrierId: z.string().max(60).optional(),
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().positive().max(500).default(100),
});

const openingHistoryQuery = z.object({ section: sectionEnum.optional() });

const openingUpsertBody = z.object({
  carrierId: z.string().min(1).max(60),
  section: sectionEnum,
  asOfDate: ymd,
  amount: z.coerce.number().finite(),
  note: z.string().max(500).optional(),
  /** The live revision id the agent was looking at — 409s when it has moved. */
  expectedRevisionId: z.string().max(60).nullable().optional(),
});

const clientTypeQuery = z.object({ carrierId: z.string().max(60).optional() });
const clientTypeBody = z.object({
  clientType: z.enum(['LOC', 'Prepay']),
  reason: z.string().min(3).max(500),
  effectiveFrom: ymd.optional(),
});
const clientTypeDeleteBody = z
  .object({ reason: z.string().max(500).optional() })
  .optional()
  .default({});

/** Today in the ledger's reporting zone (America/Chicago) as yyyy-mm-dd. */
function ledgerToday(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}

export async function billingLedgerRoutes(app: FastifyInstance): Promise<void> {
  const guard = { onRequest: [app.sessionOrApiKey], preHandler: [requireLedgerSchema] };

  // ─── Catalog ──────────────────────────────────────────────────────────────────────────────

  /**
   * The section catalog. The frontend builds its sub-nav from this rather than hardcoding a parallel
   * list, so the two cannot drift on a section's name, owning client type or reconciliation source.
   */
  app.get('/billing/ledger/sections', guard, async (request) => {
    requireLedgerRead(request);
    return {
      sections: LEDGER_SECTIONS.map((s) => ({
        id: s.id,
        label: s.label,
        clientType: s.clientType,
        debit: s.debit,
        credit: s.credit,
        positiveMeans: s.positiveMeans,
        externalSource: s.externalSource,
        shouldTrendToZero: s.shouldTrendToZero,
        description: s.description,
      })),
    };
  });

  // ─── Opening balances ─────────────────────────────────────────────────────────────────────

  /** Saved opening balances (live revisions only), paged, with company names attached. */
  app.get('/billing/ledger/opening-balances', guard, async (request) => {
    requireLedgerRead(request);
    const q = openingListQuery.parse(request.query);
    const { rows, total } = await ledgerOpeningBalanceRepo.listLive({
      section: q.section,
      carrierId: q.carrierId,
      limit: q.limit,
      offset: (q.page - 1) * q.limit,
    });
    const carriers = await resolveLedgerCarriers(rows.map((r) => r.carrierId));
    return {
      rows: rows.map((r) => toOpeningWire(r, carriers.get(r.carrierId))),
      total,
      page: q.page,
      limit: q.limit,
      hasMore: q.page * q.limit < total,
    };
  });

  /**
   * One carrier's live opening balances plus its resolved identity.
   *
   * Returns the carrier even when NO opening balance is saved — that is the manual-entry lookup, and
   * the reason codes are distinct on purpose: "no carrier found for 5762019" and "WEX-Funded carriers
   * are out of scope" are different messages and the agent needs to know which applies.
   */
  app.get('/billing/ledger/opening-balances/:carrierId', guard, async (request) => {
    requireLedgerRead(request);
    const { carrierId } = carrierIdParam.parse(request.params);
    const lookup = await lookupLedgerCarrier(carrierId);
    const { rows } = await ledgerOpeningBalanceRepo.listLive({
      carrierId,
      limit: LEDGER_SECTION_IDS.length,
      offset: 0,
    });

    if (!lookup.found || !lookup.carrier) {
      return {
        found: false,
        reason: lookup.reason ?? 'not-found',
        companyName: lookup.companyName ?? null,
        dwhValue: lookup.dwhValue ?? null,
        isWexFunded: lookup.isWexFunded ?? false,
        // Surfaced even for an out-of-scope carrier: a stale balance from before a type change
        // should be visible rather than silently orphaned.
        openings: rows.map((r) => toOpeningWire(r)),
      };
    }

    const carrier = lookup.carrier;
    return {
      found: true,
      carrier: {
        carrierId: carrier.carrierId,
        companyName: carrier.companyName,
        clientType: carrier.clientType,
        billingCycle: carrier.billingCycle,
        typeSource: carrier.source,
        dwhValue: carrier.dwhValue,
        isActive: carrier.isActive,
      },
      /** Only the sections that apply to this client type may be edited. */
      applicableSections: LEDGER_SECTIONS.filter((s) => s.clientType === carrier.clientType).map(
        (s) => s.id,
      ),
      openings: rows.map((r) => toOpeningWire(r, carrier)),
    };
  });

  /** The full revision chain for a carrier — the audit view. */
  app.get('/billing/ledger/opening-balances/:carrierId/history', guard, async (request) => {
    requireLedgerRead(request);
    const { carrierId } = carrierIdParam.parse(request.params);
    const q = openingHistoryQuery.parse(request.query);
    const rows = await ledgerOpeningBalanceRepo.listHistory(carrierId, q.section);
    return { carrierId, revisions: rows.map((r) => toOpeningWire(r)) };
  });

  /**
   * Manual single-carrier write — upsert semantics: it supersedes the live revision and inserts the
   * next one in one transaction.
   *
   * POST, not PUT, even though it is idempotent by (carrier, section) from the caller's view: PUT is
   * used by no route in this codebase and the frontend's `request()` transport does not accept the
   * verb, so a PUT here would be the sole exception plus a widening of shared transport.
   */
  app.post('/billing/ledger/opening-balances', guard, async (request, reply) => {
    const ctx = requireLedgerWrite(request);
    const b = openingUpsertBody.parse(request.body);

    if (b.asOfDate > ledgerToday()) {
      throw new ValidationError('An opening balance cannot be dated in the future.', {
        code: 'LEDGER_OB_FUTURE_DATE',
        details: { asOfDate: b.asOfDate, today: ledgerToday() },
      });
    }

    const lookup = await lookupLedgerCarrier(b.carrierId);
    if (!lookup.found || !lookup.carrier) {
      await auditFromContext(ctx, {
        action: 'billing.ledger.opening_balance.upsert',
        status: 'error',
        resourceType: 'ledger_opening_balance',
        resourceId: `${b.carrierId}:${b.section}`,
        detail: { reason: lookup.reason, amount: b.amount },
      });
      throw new ValidationError(
        lookup.reason === 'wex-funded'
          ? 'WEX-Funded carriers are outside the Billing Ledger.'
          : lookup.reason === 'no-type'
            ? 'This carrier has no LOC/Prepay type set — record a client-type override first.'
            : `No carrier found for ${b.carrierId}.`,
        { code: 'LEDGER_OB_CARRIER_INELIGIBLE', details: { reason: lookup.reason ?? 'not-found' } },
      );
    }

    const section = getLedgerSection(b.section);
    if (section.clientType !== lookup.carrier.clientType) {
      await auditFromContext(ctx, {
        action: 'billing.ledger.opening_balance.upsert',
        status: 'error',
        resourceType: 'ledger_opening_balance',
        resourceId: `${b.carrierId}:${b.section}`,
        detail: { carrierType: lookup.carrier.clientType, sectionType: section.clientType },
      });
      throw new ValidationError(
        `${section.label} applies to ${section.clientType} carriers; ${b.carrierId} is ${lookup.carrier.clientType}.`,
        { code: 'LEDGER_OB_SECTION_MISMATCH' },
      );
    }

    const upsertInput = {
      carrierId: b.carrierId,
      section: b.section,
      asOfDate: b.asOfDate,
      amount: b.amount,
      source: 'manual' as const,
      note: b.note ?? null,
      createdByUserId: ctx.userId,
      createdByName: actor(ctx),
      ...(b.expectedRevisionId !== undefined ? { expectedRevisionId: b.expectedRevisionId } : {}),
    };

    let result;
    try {
      result = await ledgerOpeningBalanceRepo.upsert(upsertInput);
    } catch (e) {
      // Audit the failure BEFORE it surfaces, so a rejected 409 is still in the record.
      await auditFromContext(ctx, {
        action: 'billing.ledger.opening_balance.upsert',
        status: 'error',
        resourceType: 'ledger_opening_balance',
        resourceId: `${b.carrierId}:${b.section}`,
        detail: {
          amount: b.amount,
          error: e instanceof Error ? e.message : String(e),
        },
      });
      throw e;
    }

    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.upsert',
      status: 'ok',
      resourceType: 'ledger_opening_balance',
      resourceId: result.row.id,
      detail: {
        carrierId: b.carrierId,
        section: b.section,
        asOfDate: b.asOfDate,
        previousAmount: result.previous ? Number(result.previous.amount) : null,
        amount: b.amount,
        revision: result.row.revision,
      },
    });

    return reply.code(result.previous ? 200 : 201).send({
      row: toOpeningWire(result.row, lookup.carrier),
      previous: result.previous ? toOpeningWire(result.previous) : null,
    });
  });

  /**
   * Restore a superseded revision as a NEW revision. Never un-supersedes in place — a revert is
   * itself an auditable event, not an erasure of one.
   */
  app.post('/billing/ledger/opening-balances/:id/revert', guard, async (request) => {
    const ctx = requireLedgerWrite(request);
    const { id } = revisionIdParam.parse(request.params);
    const target = await ledgerOpeningBalanceRepo.findById(id);
    if (!target) throw new NotFoundError(`Opening-balance revision ${id} not found`);

    const result = await ledgerOpeningBalanceRepo.revertToRevision(id, {
      userId: ctx.userId,
      name: actor(ctx),
    });
    await auditFromContext(ctx, {
      action: 'billing.ledger.opening_balance.revert',
      status: 'ok',
      resourceType: 'ledger_opening_balance',
      resourceId: result.row.id,
      detail: {
        carrierId: target.carrierId,
        section: target.section,
        restoredFromRevision: target.revision,
        amount: Number(target.amount),
        revision: result.row.revision,
      },
    });
    return { row: toOpeningWire(result.row), restoredFrom: toOpeningWire(target) };
  });

  /** Migration progress: recorded vs in-scope carriers, per section. */
  app.get('/billing/ledger/opening-balances-coverage', guard, async (request) => {
    requireLedgerRead(request);
    const [coverage, scope] = await Promise.all([
      ledgerOpeningBalanceRepo.coverageBySection(),
      listLedgerCarriers(),
    ]);
    const recorded = new Map(coverage.map((c) => [c.section, c.recorded]));
    const eligible = (clientType: 'LOC' | 'Prepay'): number =>
      scope.carriers.filter((c) => c.clientType === clientType).length;

    return {
      sections: LEDGER_SECTIONS.map((s) => {
        const total = eligible(s.clientType);
        const have = recorded.get(s.id) ?? 0;
        return { section: s.id, label: s.label, recorded: have, eligible: total, missing: Math.max(0, total - have) };
      }),
      excluded: scope.excluded,
    };
  });

  // ─── Client type ──────────────────────────────────────────────────────────────────────────

  /** Resolved client type — one carrier, or the whole in-scope book with exclusion counts. */
  app.get('/billing/ledger/client-types', guard, async (request) => {
    requireLedgerRead(request);
    const q = clientTypeQuery.parse(request.query);

    if (q.carrierId) {
      const [lookup, override] = await Promise.all([
        lookupLedgerCarrier(q.carrierId),
        ledgerClientTypeRepo.findOpen(q.carrierId),
      ]);
      return {
        carrierId: q.carrierId,
        resolved: lookup.carrier?.clientType ?? null,
        source: lookup.carrier?.source ?? null,
        companyName: lookup.companyName ?? null,
        dwhValue: lookup.dwhValue ?? null,
        normalizedDwhValue: normalizeClientType(lookup.dwhValue),
        isWexFunded: lookup.isWexFunded ?? false,
        reason: lookup.found ? null : (lookup.reason ?? 'not-found'),
        override: override ? toOverrideWire(override) : null,
      };
    }

    const scope = await listLedgerCarriers();
    return {
      carriers: scope.carriers.map((c) => ({
        carrierId: c.carrierId,
        companyName: c.companyName,
        clientType: c.clientType,
        source: c.source,
        dwhValue: c.dwhValue,
        billingCycle: c.billingCycle,
      })),
      total: scope.carriers.length,
      excluded: scope.excluded,
    };
  });

  /** Full override history for a carrier (the deferred effective-dated phase reads this too). */
  app.get('/billing/ledger/client-types/:carrierId/history', guard, async (request) => {
    requireLedgerRead(request);
    const { carrierId } = carrierIdParam.parse(request.params);
    const rows = await ledgerClientTypeRepo.listHistory(carrierId);
    return { carrierId, overrides: rows.map(toOverrideWire) };
  });

  /** Record a client-type override. Closes any open one and opens the new one atomically. */
  app.post('/billing/ledger/client-types/:carrierId', guard, async (request) => {
    const ctx = requireLedgerWrite(request);
    const { carrierId } = carrierIdParam.parse(request.params);
    const b = clientTypeBody.parse(request.body);
    const effectiveFrom = b.effectiveFrom ?? ledgerToday();

    const lookup = await lookupLedgerCarrier(carrierId);
    if (lookup.reason === 'not-found') throw new NotFoundError(`No carrier found for ${carrierId}.`);
    if (lookup.isWexFunded) {
      throw new ValidationError('WEX-Funded carriers are outside the Billing Ledger.', {
        code: 'LEDGER_TYPE_WEX_FUNDED',
      });
    }

    const from = lookup.carrier?.clientType ?? null;
    // Phase-1 no-op seam. The three deferred TZ §8 rules hook in here — see the module header.
    await assertTransitionAllowed({ carrierId, from, to: b.clientType, effectiveFrom });

    const { row, previous } = await ledgerClientTypeRepo.openOverride({
      carrierId,
      clientType: b.clientType,
      effectiveFrom,
      reason: b.reason,
      dwhValueAtWrite: lookup.dwhValue ?? null,
      createdByUserId: ctx.userId,
      createdByName: actor(ctx),
    });

    // The scope cache keyed this carrier's type; drop it so the change is visible immediately.
    clearLedgerScopeCache();

    await auditFromContext(ctx, {
      action: 'billing.ledger.client_type.override',
      status: 'ok',
      resourceType: 'ledger_client_type_override',
      resourceId: row.id,
      detail: {
        carrierId,
        from,
        to: b.clientType,
        effectiveFrom,
        dwhValueAtWrite: lookup.dwhValue ?? null,
        replacedOverrideId: previous?.id ?? null,
        reason: b.reason,
      },
    });
    return { row: toOverrideWire(row), previous: previous ? toOverrideWire(previous) : null };
  });

  /** Drop the override — the carrier reverts to DWH truth. */
  app.delete('/billing/ledger/client-types/:carrierId', guard, async (request) => {
    const ctx = requireLedgerWrite(request);
    const { carrierId } = carrierIdParam.parse(request.params);
    const b = clientTypeDeleteBody.parse(request.body);

    const closed = await ledgerClientTypeRepo.closeOpen(carrierId, { closedByName: actor(ctx) });
    if (!closed) throw new NotFoundError(`No open client-type override for ${carrierId}.`);

    clearLedgerScopeCache();

    await auditFromContext(ctx, {
      action: 'billing.ledger.client_type.clear',
      status: 'ok',
      resourceType: 'ledger_client_type_override',
      resourceId: closed.id,
      detail: { carrierId, clearedType: closed.clientType, reason: b.reason ?? null },
    });
    return { cleared: toOverrideWire(closed) };
  });
}
