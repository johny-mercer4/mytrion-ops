/**
 * Prepay ledger (mytrion-ops-owned) — Phase 3.
 *
 * The COMPANIES list is composed here from three sources, matching the servercrm
 * math exactly (loaded = TopUp − RMVE + Maintenance + MoneyCode; payments =
 * Stripe + Zelle + Chase + Merchant; difference = loaded − payments):
 *   • DWH (direct): prepay companies (octane.dim_company) + loads/draws
 *     (public.cmp_billing_history, Central-TZ day bucketing).
 *   • Postgres (direct): Zelle/Chase/Merchant sums from payment_transactions,
 *     and the MAINTENANCE term from maintenance_cases (see below).
 *   • servercrm (GET /api/billing/prepay-externals): EFS money codes + CMP
 *     Stripe — the pieces whose clients live server-side.
 *
 * MAINTENANCE comes from OUR Postgres, not from servercrm's reply. servercrm still
 * computes it from Zoho, and we still call the same endpoint for money codes and
 * Stripe, so its maintenance figure arrives and is deliberately DISCARDED and
 * replaced (see overrideMaintenance). Two reasons:
 *   • Zoho no longer has the whole picture — cases created or edited in the CS
 *     Maintenance tab never reach it, so its number silently under-counts.
 *   • servercrm's Zoho maintenance query cannot simply be deleted: the legacy
 *     zoho-octane billing widget calls /api/billing/prepay-ledger DIRECTLY
 *     (app/billing-mytrion/js/constants.js) and has no route to our database.
 *     Overriding downstream keeps that widget working while making OUR numbers
 *     correct.
 *
 * The per-carrier daily LEDGER (modal) and the EFS RMVE batch are proxied to
 * servercrm for now (their day-bucketing + EFS calls stay server-side); the app
 * still only talks to the mytrion-ops backend.
 *
 * Response shapes mirror the servercrm endpoints so the frontend normalizers are
 * unchanged.
 */
import { dwh } from '../../integrations/dwh.js';
import { serverCrmGet } from '../../integrations/serverCrm.js';
import { maintenanceCaseRepo } from '../../repos/maintenanceCaseRepo.js';
import { paymentTransactionRepo } from '../../repos/paymentTransactionRepo.js';

const round2 = (n: number): number => Math.round((Number(n) || 0) * 100) / 100;

interface CompanyAgg {
  carrier_id: string;
  company_name: string;
  billing_cycle: string;
  top_up: number;
  draws: number;
  money_code: number;
  maintenance: number;
  stripe: number;
  zelle: number;
  chase: number;
  merchant: number;
}

export interface PrepayCompanyRow {
  carrier_id: string;
  company_name: string;
  billing_cycle: string;
  top_up: number;
  rmve: number;
  money_code: number;
  maintenance: number;
  loaded: number;
  payments: number;
  difference: number;
}

export interface PrepayCompaniesResult {
  success: true;
  data: {
    companies: PrepayCompanyRow[];
    total_companies: number;
    total_loaded: number;
    total_payments: number;
    net: number;
  };
  range: { startDate: string; endDate: string };
  warnings: string[];
}

interface ExternalsReply {
  externals?: Record<string, { money_code?: number; maintenance?: number; stripe?: number }>;
  warnings?: string[];
}

/** Compose the prepay companies list. `endDate` is EXCLUSIVE (widget convention). */
export async function getPrepayCompanies(opts: {
  startDate: string;
  endDate: string;
}): Promise<PrepayCompaniesResult> {
  const { startDate, endDate } = opts;
  const warnings: string[] = [];
  const agg = new Map<string, CompanyAgg>();

  // 1. Prepay companies (DWH).
  try {
    const rows = await dwh.query<{ carrier_id: string | number; company_name: string; billing_cycle: string }>(
      `SELECT carrier_id, company_name, billing_cycle
         FROM octane.dim_company
        WHERE payment_terms = 'Prepay'
        ORDER BY company_name`,
    );
    for (const r of rows) {
      agg.set(String(r.carrier_id), {
        carrier_id: String(r.carrier_id),
        company_name: r.company_name,
        billing_cycle: r.billing_cycle,
        top_up: 0,
        draws: 0,
        money_code: 0,
        maintenance: 0,
        stripe: 0,
        zelle: 0,
        chase: 0,
        merchant: 0,
      });
    }
  } catch (e) {
    warnings.push(`companies: ${(e as Error).message}`);
  }

  // 2. Loads + draws (DWH FundStation ledger, Central-TZ day bucketing).
  try {
    const rows = await dwh.query<{ carrier_id: string | number; loads: string; draws: string }>(
      `SELECT carrier_id,
              COALESCE(SUM(CASE WHEN amount > 0 THEN amount END), 0)  AS loads,
              COALESCE(SUM(CASE WHEN amount < 0 THEN -amount END), 0) AS draws
         FROM public.cmp_billing_history
        WHERE create_date >= $1::date - interval '1 day'
          AND create_date <  $2::date + interval '1 day'
          AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::date >= $1::date
          AND (create_date AT TIME ZONE 'UTC' AT TIME ZONE 'America/Chicago')::date <  $2::date
        GROUP BY carrier_id`,
      [startDate, endDate],
    );
    for (const r of rows) {
      const a = agg.get(String(r.carrier_id));
      if (a) {
        a.top_up = Number(r.loads) || 0;
        a.draws = Number(r.draws) || 0;
      }
    }
  } catch (e) {
    warnings.push(`loads: ${(e as Error).message}`);
  }

  // 3. Zelle / Chase / Merchant (Postgres payment_transactions).
  try {
    const sums = await paymentTransactionRepo.sumForPrepay(['mx', 'zelle', 'chase'], startDate, endDate);
    for (const s of sums) {
      const a = agg.get(s.carrierId);
      if (!a) continue;
      if (s.source === 'mx') a.merchant += s.total;
      else if (s.source === 'zelle') a.zelle += s.total;
      else if (s.source === 'chase') a.chase += s.total;
    }
  } catch (e) {
    warnings.push(`payments-pg: ${(e as Error).message}`);
  }

  // NOTE: externals (EFS money codes + Zoho Maintenance + CMP Stripe) are the slow source
  // (~7.2s of an ~8.5s total — CMP Stripe pagination). They are DEFERRED to a separate background
  // call (getPrepayExternalsBatch → GET /billing/prepay/externals) that the frontend fires once
  // this list renders, patching money_code/maintenance/stripe into rows in place — mirroring the
  // lazy EFS-RMVE enrichment. So this endpoint returns from DWH + PG only (~1.3s) and the list
  // shows as fast as the other tabs; the externals fill in a moment later.

  // 5. Assemble rows + totals (servercrm formula). money_code/maintenance/stripe are 0 here and
  // get patched in by the deferred externals batch.
  const companies: PrepayCompanyRow[] = [];
  let totalLoaded = 0;
  let totalPayments = 0;
  let totalNet = 0;
  for (const a of agg.values()) {
    const rmve = round2(a.draws);
    const loaded = round2(a.top_up - rmve + a.maintenance + a.money_code);
    const payments = round2(a.stripe + a.zelle + a.chase + a.merchant);
    const difference = round2(loaded - payments);
    totalLoaded += loaded;
    totalPayments += payments;
    totalNet += difference;
    companies.push({
      carrier_id: a.carrier_id,
      company_name: a.company_name,
      billing_cycle: a.billing_cycle,
      top_up: round2(a.top_up),
      rmve,
      money_code: round2(a.money_code),
      maintenance: round2(a.maintenance),
      loaded,
      payments,
      difference,
    });
  }

  return {
    success: true,
    data: {
      companies,
      total_companies: companies.length,
      total_loaded: round2(totalLoaded),
      total_payments: round2(totalPayments),
      net: round2(totalNet),
    },
    range: { startDate, endDate },
    warnings,
  };
}

/**
 * Deferred externals batch — EFS money codes + Zoho Maintenance + CMP Stripe, per carrier, for the
 * window. Split out of getPrepayCompanies because it's the slow source (CMP Stripe pagination); the
 * frontend fetches it in the background after the base list renders and patches rows in place.
 * `endDate` is EXCLUSIVE (widget convention). Returns servercrm's `{ externals, warnings }` reply.
 */
export async function getPrepayExternalsBatch(startDate: string, endDate: string): Promise<ExternalsReply> {
  // Both legs run concurrently — servercrm's is the slow one (CMP Stripe pagination), so the DB
  // read costs nothing in wall time.
  const [reply, maint] = await Promise.all([
    serverCrmGet<ExternalsReply>(
      `/api/billing/prepay-externals?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
    maintenanceCaseRepo.sumPrepayByCarrier(startDate, endDate),
  ]);

  const externals: NonNullable<ExternalsReply['externals']> = { ...(reply.externals ?? {}) };
  // Zero every carrier servercrm reported, THEN write ours in. Without the zeroing pass a carrier
  // whose only maintenance rows now live in our table would keep servercrm's stale Zoho figure.
  for (const key of Object.keys(externals)) {
    externals[key] = { ...externals[key], maintenance: 0 };
  }
  for (const [carrierId, amount] of maint) {
    externals[carrierId] = { ...(externals[carrierId] ?? {}), maintenance: round2(amount) };
  }
  return { ...reply, externals, warnings: reply.warnings ?? [] };
}

/** One daily ledger row as servercrm builds it (services/prepayLedger.js). */
interface LedgerDay {
  date: string;
  top_up: number;
  rmve: number;
  money_code: number;
  maintenance: number;
  stripe: number;
  zelle: number;
  chase: number;
  merchant: number;
  delta: number;
  difference: number;
}
interface LedgerReply {
  rows?: LedgerDay[];
  totals?: Record<string, number>;
  [key: string]: unknown;
}

/**
 * Per-carrier daily ledger (modal) — proxied to servercrm, with the maintenance/zelle/chase/merchant
 * columns replaced from our Postgres.
 *
 * servercrm's reply still sources zelle/chase from Zoho's `Zelle_Transactions`/`Chase_Transactions`
 * modules directly (services/prepayLedger.js) and merchant is exposed there as `merchant` too — but
 * payments ingested straight into `payment_transactions` since the Postgres migration are never
 * written back into those Zoho modules, so the modal showed real top-ups as unmatched (a growing
 * running Difference) even though the company list's total already counted them correctly via
 * `paymentTransactionRepo.sumForPrepay`. Confirmed live 2026-08-18 for carrier 5788724: the list's
 * Payments (Postgres-sourced) matched the database; the modal's per-day Zelle column did not.
 *
 * `difference` is a RUNNING balance, so swapping a day's maintenance/zelle/chase/merchant invalidates
 * that day and every day after it. The delta formula below is servercrm's, copied verbatim from its
 * row builder; if that formula ever changes there, this recomputation silently diverges — hence the
 * assertion-by-comment.
 */
export async function getPrepayLedgerProxy(
  carrierId: string,
  startDate: string,
  endDate: string,
): Promise<unknown> {
  const [reply, maint, pgSums] = await Promise.all([
    serverCrmGet<LedgerReply>(
      `/api/billing/prepay-ledger?carrierId=${encodeURIComponent(carrierId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    ),
    maintenanceCaseRepo.sumPrepayByDay(carrierId, startDate, endDate),
    paymentTransactionRepo.sumForPrepayByDay(['zelle', 'chase', 'mx'], carrierId, startDate, endDate),
  ]);
  if (!Array.isArray(reply.rows)) return reply;

  // day -> source -> total, so each row looks up its own day once per source.
  const bySource: Record<'zelle' | 'chase' | 'mx', Map<string, number>> = {
    zelle: new Map(),
    chase: new Map(),
    mx: new Map(),
  };
  for (const s of pgSums) {
    if (s.source === 'zelle' || s.source === 'chase' || s.source === 'mx') {
      bySource[s.source].set(s.day, s.total);
    }
  }

  let running = 0;
  let maintTotal = 0;
  let zelleTotal = 0;
  let chaseTotal = 0;
  let merchantTotal = 0;
  const rows = reply.rows.map((r) => {
    const day = String(r.date).slice(0, 10);
    const maintenance = round2(maint.get(day) ?? 0);
    const zelle = round2(bySource.zelle.get(day) ?? 0);
    const chase = round2(bySource.chase.get(day) ?? 0);
    const merchant = round2(bySource.mx.get(day) ?? 0);
    maintTotal += maintenance;
    zelleTotal += zelle;
    chaseTotal += chase;
    merchantTotal += merchant;
    // servercrm: delta = top_up - rmve + maintenance + money_code - stripe - zelle - chase - merchant
    const delta =
      (r.top_up ?? 0) -
      (r.rmve ?? 0) +
      maintenance +
      (r.money_code ?? 0) -
      (r.stripe ?? 0) -
      zelle -
      chase -
      merchant;
    running += delta;
    return { ...r, maintenance, zelle, chase, merchant, delta: round2(delta), difference: round2(running) };
  });

  return {
    ...reply,
    rows,
    totals: {
      ...(reply.totals ?? {}),
      maintenance: round2(maintTotal),
      zelle: round2(zelleTotal),
      chase: round2(chaseTotal),
      merchant: round2(merchantTotal),
      net: round2(running),
    },
  };
}

/** EFS RMVE batch for the visible page — proxied to servercrm (EFS lives server-side). */
export async function getPrepayRmveProxy(
  carrierIds: string,
  startDate: string,
  endDate: string,
  fresh: boolean,
): Promise<unknown> {
  const f = fresh ? '&fresh=1' : '';
  return serverCrmGet(
    `/api/billing/dwh/prepay-rmve?carrierIds=${encodeURIComponent(carrierIds)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}${f}`,
  );
}
