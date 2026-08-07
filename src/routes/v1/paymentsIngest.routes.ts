/**
 * Billing payment-ingest webhook — Zapier → Postgres `payment_transactions`.
 *
 * The forward feed for the sources that aren't pulled from an API on our side: Zapier parses the
 * incoming Stripe / Zelle emails (1 Zelle Zap + 3 Stripe Zaps — CMP only sees 2 of the 3 Stripe
 * accounts, so Zapier is the complete source) and POSTs each transaction here. Chase has no email
 * feed and is added through the app's manual-add form (separate route).
 *
 * Auth: a dedicated shared secret (`BILLING_INGEST_SECRET`) in the `x-ingest-secret` header — NOT
 * the full API_KEY, so a leaked Zapier connection can only POST payments, nothing else.
 *
 * Idempotent: writes via `paymentTransactionRepo.upsertMany`, which conflicts on the natural key
 * (source, source_record_id) and refreshes only the source FACT columns — it NEVER touches the
 * app-owned mapping/returns columns. So a Zap retry or a re-parsed email can't duplicate a row or
 * clobber a mapping an agent already made. Rows land UNMAPPED and appear in the Transactions tab
 * for mapping (fuzzy carrier suggestions come from the learned carrier memory).
 *
 * Pre-mapped feeds: the 3 Stripe Zaps aren't equal — one is the "Invoice payment" account (normal
 * unmapped flow, agent maps it → CMP), the other two are already reconciled and should NOT hit the
 * agent queue. Those two send `preMapped: true`; we then flag the row is_invoice_mapped=true in PG
 * with NO CMP action (mapping happens only in our DB), applied only if still unmapped.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { DEFAULT_TENANT_ID } from '../../config/constants.js';
import { env } from '../../config/env.js';
import { safeEqual } from '../../lib/crypto.js';
import { AppError, AuthError, NotFoundError } from '../../lib/errors.js';
import type { NewPaymentReturn, NewPaymentTransaction } from '../../db/schema/index.js';
import { audit } from '../../modules/audit/auditLogger.js';
import { resolveMxReturnMatch } from '../../modules/billing/mxReturnMatch.js';
import { resolveStripeDisputeMatch } from '../../modules/billing/stripeDisputeMatch.js';
import { paymentReturnRepo } from '../../repos/paymentReturnRepo.js';
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';

const SECRET_HEADER = 'x-ingest-secret';

/** Shared shared-secret check (Zapier can't present a session/JWT) — every route in this file uses
 *  the SAME weaker credential, deliberately: a leaked ingest secret can only reach these endpoints,
 *  never the full API_KEY surface. */
function requireIngestSecret(request: FastifyRequest): void {
  const secret = env.BILLING_INGEST_SECRET;
  if (!secret) {
    throw new AppError('Payment ingest secret is not configured', {
      statusCode: 503,
      code: 'SERVER_MISCONFIGURED',
    });
  }
  const provided = request.headers[SECRET_HEADER];
  if (typeof provided !== 'string' || !safeEqual(provided, secret)) {
    throw new AuthError('Invalid or missing ingest secret');
  }
}

/** Tolerant of formatted amounts from email parsers ("$1,277.00", "1 277,00 " → 1277). An
 *  unparseable amount becomes undefined rather than a 400. Shared by every ingest body below
 *  EXCEPT the dispute body — see `centsAmount`. */
const tolerantAmount = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return undefined;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n : undefined;
}, z.number().optional());

/**
 * Stripe's own API (the dispute Zap uses Zapier's native Stripe trigger, not an email parse) reports
 * `amount` in the smallest currency unit — cents for USD — matching every other Stripe amount field
 * (`charge.amount`, `balance_transaction.amount`, …). Every OTHER ingest source (MX/Chase email
 * parses via `tolerantAmount`, the general payment webhook) already arrives in dollars, so this
 * conversion is scoped to the dispute body alone rather than folded into `tolerantAmount`.
 */
const centsAmount = z.preprocess((v) => {
  if (v === null || v === undefined || v === '') return undefined;
  const n = typeof v === 'number' ? v : Number(String(v).replace(/[^0-9.-]/g, ''));
  return Number.isFinite(n) ? n / 100 : undefined;
}, z.number().optional());

/**
 * One inbound Stripe dispute (chargeback) from Zapier's native Stripe trigger — the dispute twin of
 * the payment webhook below. `disputeId` is the ONLY required id, with no fallback chain: a charge id
 * substituted in its place would collide with a SECOND dispute on the same charge and silently
 * overwrite the first return's amount/date/reason on redelivery (see
 * `paymentReturnRepo.upsertDisputeUnlessMatched`'s docstring). `paymentIntentId` is optional — when
 * the parsed email has it, the dispute auto-links to its Stripe charge (`payment_transactions` is
 * keyed by `pi_…`) and may auto-reverse a CMP payment we created for it
 * (`modules/billing/stripeDisputeMatch.ts`); when absent, the dispute lands unmatched for an agent
 * to match manually in the Returns tab, exactly like an MX return with no automatic signal.
 */
const disputeBody = z.object({
  disputeId: z.string().min(1).max(120),
  paymentIntentId: z.string().max(160).optional(),
  chargeId: z.string().max(160).optional(),
  amount: centsAmount,
  disputeDate: z.string().max(40).optional(),
  reason: z.string().max(500).optional(),
  cardLast4: z.string().max(8).optional(),
  customerName: z.string().max(200).optional(),
  // `payment_returns` has no lifecycle/status column and no reinstatement path (nothing re-applies
  // a CMP payment once deleted) — so only a dispute-CREATED event is processed. A later "won" /
  // "lost" / "closed" email must not collide with or re-reverse the same row; it no-ops (200, so
  // Zapier doesn't retry a benign skip) but the raw payload is still logged for traceability.
  stage: z.string().max(60).optional(),
});

const NON_CREATION_STAGE = /won|lost|clos|refund|resolv/i;

/** One inbound payment from a Zapier email parser. Only `source` + `sourceRecordId` are required;
 *  everything else is best-effort. Unknown extra fields are preserved in `raw`. */
const ingestBody = z.object({
  source: z.enum(['zelle', 'stripe', 'chase']),
  // Stable rail id for idempotency: Stripe charge/payment-intent id, Zelle confirmation number.
  sourceRecordId: z.string().min(1).max(120),
  amount: tolerantAmount,
  currency: z.string().max(8).optional(),
  occurredAt: z.string().max(40).optional(), // ISO or any Date-parseable string
  name: z.string().max(200).optional(),
  senderName: z.string().max(200).optional(),
  memo: z.string().max(1000).optional(),
  description: z.string().max(2000).optional(),
  email: z.string().max(200).optional(),
  cardBrand: z.string().max(40).optional(),
  cardLast4: z.string().max(8).optional(),
  status: z.string().max(60).optional(),
  externalTxnId: z.string().max(160).optional(),
  // Feeds that arrive already reconciled (the 2 non-invoice Stripe accounts) set this so the row
  // lands is_invoice_mapped=true with NO CMP action — it never enters the agent's unmapped queue.
  // The one "Invoice payment" Stripe Zap omits it (or sends false) → normal unmapped flow.
  preMapped: z.preprocess((v) => {
    if (typeof v === 'boolean') return v;
    if (typeof v === 'string') return ['true', '1', 'yes'].includes(v.trim().toLowerCase());
    return undefined;
  }, z.boolean().optional()),
  // Optional label override for the pre-mapped state (defaults to "Stripe (auto)").
  mappingType: z.string().max(60).optional(),
});

/** A carrier resolved by servercrm's ingest-time auto-map job (jobs/mxAutoMapByName.js), which
 *  searches CMP directly by company name — see modules/billing/cmpCarrierDiscovery.ts / returnsCmpReversal.ts
 *  for the same mechanism used by the returns-matching flow. */
const autoMapBody = z.object({
  transactionId: z.coerce.number().int().positive(),
  carrierId: z.string().min(1).max(60),
  // What resolved it ('name' | 'name+invoice' from cmpCarrierByName.js's `via`) — audit-only.
  via: z.string().max(60).optional(),
  companyName: z.string().max(200).optional(),
});

export async function paymentsIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/billing/ingest/payment', async (request: FastifyRequest, reply: FastifyReply) => {
    requireIngestSecret(request);

    const b = ingestBody.parse(request.body ?? {});
    const occurred = b.occurredAt ? new Date(b.occurredAt) : null;

    const row: NewPaymentTransaction = {
      source: b.source,
      sourceModule: 'zapier',
      sourceRecordId: b.sourceRecordId,
      amount: b.amount != null ? (paymentTransactionRepo.money(b.amount) ?? null) : null,
      currency: b.currency || 'USD',
      occurredAt: occurred && !Number.isNaN(occurred.getTime()) ? occurred : null,
      name: b.name ?? b.senderName ?? null,
      status: b.status ?? null,
      externalTxnId: b.externalTxnId ?? null,
      senderName: b.senderName ?? b.name ?? null,
      memo: b.memo ?? null,
      description: b.description ?? null,
      email: b.email ?? null,
      cardBrand: b.cardBrand ?? null,
      cardLast4: b.cardLast4 ?? null,
      // Full original payload (incl. any fields not modelled above) for traceability.
      raw: (request.body ?? {}) as Record<string, unknown>,
      // Mapping/returns columns are intentionally left to their defaults (unmapped).
    };

    await paymentTransactionRepo.upsertMany([row]);
    // Pre-mapped feed (e.g. the non-invoice Stripe accounts): flag it mapped in PG only — no CMP.
    // Applied AFTER the upsert and only if still unmapped, so it never clobbers a local mapping.
    if (b.preMapped) {
      await paymentTransactionRepo.markIngestMapped(b.source, b.sourceRecordId, {
        mappingType: b.mappingType || 'Stripe (auto)',
        mappedBy: 'Zapier (auto)',
      });
    }
    // Financial write audit trail. Secret-authed webhook (no session ctx) → synthetic system actor.
    await audit({
      tenantId: DEFAULT_TENANT_ID,
      action: 'billing.ingest.payment',
      status: 'ok',
      audience: 'internal',
      userName: 'zapier-ingest',
      resourceType: 'payment_transaction',
      resourceId: `${b.source}:${b.sourceRecordId}`,
      detail: { source: b.source, amount: b.amount ?? null, preMapped: !!b.preMapped },
      requestId: request.id,
    });
    request.log.info(
      { source: b.source, sourceRecordId: b.sourceRecordId, preMapped: !!b.preMapped },
      'billing ingest: payment upserted',
    );
    return reply.send({
      status: 'success',
      source: b.source,
      sourceRecordId: b.sourceRecordId,
      mapped: !!b.preMapped,
    });
  });

  /**
   * Stamp a carrier servercrm's ingest-time auto-map job resolved from CMP directly (company-name
   * search — no local fuzzy-memory table involved). Same shared-secret auth as the webhook above
   * (a leaked ingest secret can only touch payment rows, nothing else). Guarded, idempotent: flips
   * only when the row is still unmapped with no carrier on file (`applyMapping`'s repo guard), so a
   * retried POST or a race with an agent's own manual map never clobbers anything — `applied: false`
   * means someone/something else got there first, not an error.
   */
  app.post('/billing/transactions/auto-map', async (request: FastifyRequest, reply: FastifyReply) => {
    requireIngestSecret(request);

    const b = autoMapBody.parse(request.body ?? {});
    const row = await paymentTransactionRepo.applyAutoMap(b.transactionId, {
      carrierId: b.carrierId,
      mappingType: 'Auto-Mapped (CMP)',
      mappedBy: 'CMP auto-map (ingest)',
    });
    const applied = row !== undefined;

    if (applied) {
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        action: 'billing.transactions.auto-map',
        status: 'ok',
        audience: 'internal',
        userName: 'cmp-auto-map',
        resourceType: 'payment_transaction',
        resourceId: String(b.transactionId),
        detail: { carrierId: b.carrierId, via: b.via ?? null, companyName: b.companyName ?? null },
        requestId: request.id,
      });
    }
    request.log.info(
      { transactionId: b.transactionId, carrierId: b.carrierId, applied },
      'billing auto-map: transaction stamped',
    );
    return reply.send({ status: 'success', transactionId: b.transactionId, applied });
  });

  /**
   * Stripe dispute (chargeback) webhook — Zapier → `payment_returns`, auto-linking to the original
   * Stripe charge and auto-reversing its CMP payment when (and only when) we hold a `cmp_ref` we
   * created ourselves. See `modules/billing/stripeDisputeMatch.ts` for why that's the ONLY safe
   * auto-reversal condition on this rail (unlike MX, `mappingType` does not reliably tell us whether
   * CMP holds the money). Same shared-secret auth as the payment webhook above.
   */
  app.post('/billing/ingest/dispute', async (request: FastifyRequest, reply: FastifyReply) => {
    requireIngestSecret(request);

    const b = disputeBody.parse(request.body ?? {});

    if (b.stage && NON_CREATION_STAGE.test(b.stage)) {
      request.log.info(
        { disputeId: b.disputeId, stage: b.stage },
        'billing ingest: dispute lifecycle event ignored (not a creation event)',
      );
      return reply.send({ status: 'success', disputeId: b.disputeId, ignored: true });
    }

    const disputeDate = b.disputeDate ? new Date(b.disputeDate) : null;
    const row: NewPaymentReturn = {
      source: 'stripe-dispute',
      sourceRecordId: b.disputeId,
      returnType: 'Stripe-Dispute',
      customerName: b.customerName ?? null,
      referenceNumber: b.paymentIntentId ?? b.chargeId ?? null,
      last4: b.cardLast4 ?? null,
      amount: b.amount != null ? (paymentTransactionRepo.money(b.amount) ?? null) : null,
      returnDate: disputeDate && !Number.isNaN(disputeDate.getTime()) ? disputeDate : null,
      reason: b.reason ?? null,
      stripeStatus: b.stage ?? null,
      // Full original payload (incl. any fields not modelled above) for traceability.
      raw: (request.body ?? {}) as Record<string, unknown>,
    };
    const ret = await paymentReturnRepo.upsertDisputeUnlessMatched(row);

    if (ret.matched) {
      // Already matched — a retried/redelivered Zap, or an agent got there first in the UI. 200,
      // not 409: Zapier retries on any non-2xx, and this is a benign no-op, not an error.
      request.log.info({ disputeId: b.disputeId, returnId: ret.id }, 'billing ingest: dispute already matched');
      return reply.send({ status: 'success', disputeId: b.disputeId, returnId: ret.id, matched: 'already' });
    }

    const resolution = await resolveStripeDisputeMatch({
      paymentIntentId: b.paymentIntentId,
      amount: b.amount ?? 0,
    });

    let transactionId: number | undefined;
    let isReversed = false;
    if (resolution.originalTransactionId != null) {
      // Claim-then-act: flips matched=true BEFORE touching CMP, so a concurrent redelivery or a
      // human working the same return sees matched=true and backs off rather than both reversing.
      const claimed = await paymentReturnRepo.claimForMatch(ret.id, {
        originalTransactionId: resolution.originalTransactionId,
        matchedBy: 'zapier-ingest',
      });
      if (claimed) {
        transactionId = resolution.originalTransactionId;
        isReversed = resolution.isReversed;
        await paymentReturnRepo.recordCmpReversal(ret.id, {
          matchNote: resolution.matchNote ?? 'reconcile manually',
          isReversed: resolution.isReversed,
          resolvedBy: 'zapier-ingest',
        });
        await paymentTransactionRepo.setReturned(resolution.originalTransactionId, new Date());
      }
      // else: lost the claim race — someone/something else already owns this return; nothing left
      // to do here (never attempt CMP after losing a claim).
    }

    // Financial write audit trail. Secret-authed webhook (no session ctx) → synthetic system actor.
    await audit({
      tenantId: DEFAULT_TENANT_ID,
      action: 'billing.ingest.dispute',
      status: 'ok',
      audience: 'internal',
      userName: 'zapier-ingest',
      resourceType: 'payment_return',
      resourceId: String(ret.id),
      detail: { disputeId: b.disputeId, outcome: resolution.outcome, transactionId: transactionId ?? null, isReversed },
      requestId: request.id,
    });
    if (isReversed && transactionId != null) {
      // A distinct row for the case that matters most if something needs reconciling later: real
      // money was deleted in CMP with no human in the loop.
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        action: 'billing.returns.stripe-auto-reversal',
        status: 'ok',
        audience: 'internal',
        userName: 'zapier-ingest',
        resourceType: 'payment_transaction',
        resourceId: String(transactionId),
        detail: { disputeId: b.disputeId, returnId: ret.id, ...resolution.detail },
        requestId: request.id,
      });
    }
    request.log.info(
      { disputeId: b.disputeId, returnId: ret.id, outcome: resolution.outcome, isReversed },
      'billing ingest: dispute processed',
    );
    return reply.send({
      status: 'success',
      disputeId: b.disputeId,
      returnId: ret.id,
      outcome: resolution.outcome,
      isReversed,
    });
  });

  /**
   * Ingest-time MX return match — called by servercrm's `jobs/mxReturnsSync.js` right after it
   * inserts a NEW `payment_returns` row (the row already exists; this call only attempts to match
   * + reverse it), so an ACH return or card chargeback gets a shot at auto-resolution the moment it
   * lands instead of waiting on the legacy Zoho `automation.processReturnUnmap` workflow. See
   * `modules/billing/mxReturnMatch.ts` for the decision (exact-reference lookup, then the same two
   * branches the manual match route runs) and its docblock for the Zoho-race analysis.
   */
  const mxReturnMatchBody = z.object({ returnId: z.coerce.number().int().positive() });

  app.post('/billing/ingest/mx-return-match', async (request: FastifyRequest, reply: FastifyReply) => {
    requireIngestSecret(request);

    const b = mxReturnMatchBody.parse(request.body ?? {});
    const ret = await paymentReturnRepo.getById(b.returnId);
    if (!ret) throw new NotFoundError(`Return ${b.returnId} not found`);

    if (ret.matched) {
      // Zoho's workflow (or a human) already got there first — benign, not an error.
      request.log.info({ returnId: b.returnId }, 'billing ingest: mx return already matched');
      return reply.send({ status: 'success', returnId: b.returnId, matched: 'already' });
    }

    const resolution = await resolveMxReturnMatch({
      referenceNumber: ret.referenceNumber,
      amount: ret.amount != null ? Number(ret.amount) : 0,
    });

    let transactionId: number | undefined;
    let isReversed = false;
    if (resolution.originalTransactionId != null) {
      const claimed = await paymentReturnRepo.claimForMatch(b.returnId, {
        originalTransactionId: resolution.originalTransactionId,
        matchedBy: 'mytrion-ops (ingest-time auto-match)',
      });
      if (claimed) {
        transactionId = resolution.originalTransactionId;
        isReversed = resolution.isReversed;
        await paymentReturnRepo.recordCmpReversal(b.returnId, {
          matchNote: resolution.matchNote ?? 'reconcile manually',
          isReversed: resolution.isReversed,
          resolvedBy: 'mytrion-ops (ingest-time auto-match)',
        });
        if (resolution.mappingPatch) {
          await paymentTransactionRepo.applyMapping(resolution.originalTransactionId, {
            ...resolution.mappingPatch,
            isInvoiceMapped: true,
            mappedBy: 'mytrion-ops (ingest-time auto-match)',
            mappedAt: new Date(),
          });
        }
        await paymentTransactionRepo.setReturned(resolution.originalTransactionId, new Date());
      }
      // else: lost the claim race (a human or Zoho's sync matched it between our read and the
      // claim) — never attempt CMP after losing a claim.
    }

    await audit({
      tenantId: DEFAULT_TENANT_ID,
      action: 'billing.ingest.mx-return-match',
      status: 'ok',
      audience: 'internal',
      userName: 'mytrion-ops (ingest-time auto-match)',
      resourceType: 'payment_return',
      resourceId: String(b.returnId),
      detail: { outcome: resolution.outcome, transactionId: transactionId ?? null, isReversed },
      requestId: request.id,
    });
    if (isReversed && transactionId != null) {
      await audit({
        tenantId: DEFAULT_TENANT_ID,
        action: 'billing.returns.mx-auto-reversal',
        status: 'ok',
        audience: 'internal',
        userName: 'mytrion-ops (ingest-time auto-match)',
        resourceType: 'payment_transaction',
        resourceId: String(transactionId),
        detail: { returnId: b.returnId, ...resolution.detail },
        requestId: request.id,
      });
    }
    request.log.info(
      { returnId: b.returnId, outcome: resolution.outcome, isReversed },
      'billing ingest: mx return match attempted',
    );
    return reply.send({ status: 'success', returnId: b.returnId, outcome: resolution.outcome, isReversed });
  });
}
