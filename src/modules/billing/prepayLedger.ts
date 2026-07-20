/**
 * Prepay ledger (mytrion-ops-owned) — Phase 3.
 *
 * The COMPANIES list is composed here from three sources, matching the servercrm
 * math exactly (loaded = TopUp − RMVE + Maintenance + MoneyCode; payments =
 * Stripe + Zelle + Chase + Merchant; difference = loaded − payments):
 *   • DWH (direct): prepay companies (octane.dim_company) + loads/draws
 *     (public.cmp_billing_history, Central-TZ day bucketing).
 *   • Postgres (direct): Zelle/Chase/Merchant sums from payment_transactions.
 *   • servercrm (GET /api/billing/prepay-externals): EFS money codes + Zoho
 *     Maintenance + CMP Stripe — the pieces whose clients live server-side.
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

  // 4. EFS money codes + Zoho Maintenance + CMP Stripe (servercrm).
  try {
    const res = await serverCrmGet<ExternalsReply>(
      `/api/billing/prepay-externals?startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
    );
    for (const [cid, ext] of Object.entries(res.externals ?? {})) {
      const a = agg.get(cid);
      if (!a) continue;
      a.money_code += Number(ext.money_code) || 0;
      a.maintenance += Number(ext.maintenance) || 0;
      a.stripe += Number(ext.stripe) || 0;
    }
    if (res.warnings?.length) warnings.push(...res.warnings.map((w) => `externals: ${w}`));
  } catch (e) {
    warnings.push(`externals: ${(e as Error).message}`);
  }

  // 5. Assemble rows + totals (servercrm formula).
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

/** Per-carrier daily ledger (modal) — proxied to servercrm for now. */
export async function getPrepayLedgerProxy(carrierId: string, startDate: string, endDate: string): Promise<unknown> {
  return serverCrmGet(
    `/api/billing/prepay-ledger?carrierId=${encodeURIComponent(carrierId)}&startDate=${encodeURIComponent(startDate)}&endDate=${encodeURIComponent(endDate)}`,
  );
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
