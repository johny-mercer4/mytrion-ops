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
import { env } from '../../config/env.js';
import { safeEqual } from '../../lib/crypto.js';
import { AppError, AuthError } from '../../lib/errors.js';
import type { NewPaymentTransaction } from '../../db/schema/index.js';
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';

const SECRET_HEADER = 'x-ingest-secret';

/** One inbound payment from a Zapier email parser. Only `source` + `sourceRecordId` are required;
 *  everything else is best-effort. Unknown extra fields are preserved in `raw`. */
const ingestBody = z.object({
  source: z.enum(['zelle', 'stripe', 'chase']),
  // Stable rail id for idempotency: Stripe charge/payment-intent id, Zelle confirmation number.
  sourceRecordId: z.string().min(1).max(120),
  // Tolerant of formatted amounts from email parsers ("$1,277.00", "1 277,00 " → 1277).
  // An unparseable amount becomes undefined (row still saved, amount null) rather than a 400.
  amount: z.preprocess((v) => {
    if (v === null || v === undefined || v === '') return undefined;
    if (typeof v === 'number') return v;
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    return Number.isFinite(n) ? n : undefined;
  }, z.number().optional()),
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

export async function paymentsIngestRoutes(app: FastifyInstance): Promise<void> {
  app.post('/billing/ingest/payment', async (request: FastifyRequest, reply: FastifyReply) => {
    // ── shared-secret auth (Zapier can't present a session/JWT) ──
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
}
