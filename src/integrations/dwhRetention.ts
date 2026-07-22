/**
 * DWH retention signals — the transaction-frequency layer that feeds retention-case
 * generation. Reads `octane.dim_company` + 90-day mart aggregates + billing debt
 * (`public.cmp_invoice`, same rule as Billing Mytrion / Sales Clients roster).
 *
 * Entry exclusions (RetentionFinal / Sales Agent Phase 1):
 *   - Debtors → Collections (cmp_invoice overdue debt, not stale dim.is_debtor)
 *   - Pre–Card Swiped (Verification / WEX / funded-but-never-used) → no first_swipe_date
 *   - Closed Lost / Out of Business → deal_stage = 'Closed Lost'
 *   - Deactivated → is_active ≠ 1
 *
 * Frequency model:
 *   high   — expected every 2 days
 *   medium — every 5 days
 *   low    — every 7 days
 * Breach when days-inactive exceeds the class threshold.
 */
import type { FrequencyClass } from '../db/schema/index.js';
import { dwhQuery } from './dwh.js';

export const FREQUENCY_THRESHOLD_DAYS: Record<FrequencyClass, number> = {
  high: 2,
  medium: 5,
  low: 7,
};

/** Mirrors Billing / Sales Clients debt rule (`dwhClientRoster.ts`). */
const DEBT_OVERDUE_DAYS = 2;
const DEBT_OPEN_BALANCE_MIN = 1;

/** Closed Lost = CRM terminal for Out of Business / lost (no separate OoB stage in dim). */
export const RETENTION_EXCLUDED_DEAL_STAGES = ['Closed Lost'] as const;

/**
 * Pure eligibility for a deal to enter the Sales Retention case stream.
 * - Must have swiped (`first_swipe_date`) — excludes Verification / WEX / funded-never-used
 *   (Card Swiped in Zoho is the stage; warehouse truth is first swipe).
 * - Must not be Closed Lost / Out of Business.
 * - Must not be a billing debtor (cmp_invoice rule).
 * - Must be active (Verification deactivation → is_active ≠ 1).
 */
export function isRetentionEntryEligible(input: {
  firstSwipeDate: Date | null;
  dealStage: string | null;
  isActive: boolean;
  isBillingDebtor: boolean;
}): { ok: boolean; reason?: string } {
  if (!input.isActive) return { ok: false, reason: 'deactivated' };
  if (input.isBillingDebtor) return { ok: false, reason: 'debtor' };
  if (!input.firstSwipeDate) return { ok: false, reason: 'pre_card_swiped' };
  const stage = (input.dealStage ?? '').trim();
  if (
    (RETENTION_EXCLUDED_DEAL_STAGES as readonly string[]).includes(stage) ||
    /out\s*of\s*business/i.test(stage)
  ) {
    return { ok: false, reason: 'out_of_business' };
  }
  return { ok: true };
}

/** Classify a carrier from its distinct transaction days in the last 90 days. */
export function classifyFrequency(txDays90d: number): {
  frequencyClass: FrequencyClass;
  thresholdDays: number;
} {
  const avgGapDays = txDays90d >= 2 ? 90 / txDays90d : Number.POSITIVE_INFINITY;
  const frequencyClass: FrequencyClass =
    avgGapDays <= FREQUENCY_THRESHOLD_DAYS.high
      ? 'high'
      : avgGapDays <= FREQUENCY_THRESHOLD_DAYS.medium
        ? 'medium'
        : 'low';
  return { frequencyClass, thresholdDays: FREQUENCY_THRESHOLD_DAYS[frequencyClass] };
}

/** Whole days elapsed since a timestamp (floored; never negative). */
export function daysSince(date: Date, now: Date = new Date()): number {
  return Math.max(0, Math.floor((now.getTime() - date.getTime()) / 86_400_000));
}

export interface RetentionCandidate {
  carrierId: string;
  companyName: string | null;
  applicationId: string | null;
  agentName: string | null;
  agentZohoUserId: string | null;
  /** Zoho CRM Deal id from DWH (`octane.agent_deals.id`) — required for Open Pool ownership transfer. */
  zohoDealId: string | null;
  /** Prefer deal_phone, fall back to contact_phone (same as Sales roster / getDwhCompanyDetails). */
  contactPhone: string | null;
  dealStage: string | null;
  activeCards: number | null;
  lastTransactionAt: Date | null;
  daysInactive: number;
  txCount90d: number;
  gallons90d: number;
  frequencyClass: FrequencyClass;
  thresholdDays: number;
  /** True when daysInactive exceeds the class threshold — the case-generation trigger. */
  breached: boolean;
  /** Zoho Main_Language when set; else null. */
  preferredLanguage: string | null;
  /** Spanish Retention desk (Jean Paul): main_language or nationality = Spanish. */
  isSpanishDesk: boolean;
}

interface CandidateRow {
  carrier_id: number;
  company_name: string | null;
  application_id: number | null;
  agent: string | null;
  agent_zoho_user_id: number | null;
  zoho_deal_id: string | number | null;
  deal_phone: string | null;
  contact_phone: string | null;
  deal_stage: string | null;
  total_active_cards: number | string | null;
  last_tx: string | Date | null;
  tx_days_90d: number | string | null;
  gallons_90d: number | string | null;
  nationality: string | null;
  main_language: string | null;
}

/** Prefer CRM main_language; fall back to dim_company.nationality for Spanish desk. */
export function resolveSpanishDesk(input: {
  mainLanguage: string | null | undefined;
  nationality: string | null | undefined;
}): { preferredLanguage: string | null; isSpanishDesk: boolean } {
  const lang = input.mainLanguage?.trim() || null;
  const nat = input.nationality?.trim() || null;
  const langSpanish = Boolean(lang && /^spanish$/i.test(lang));
  const natSpanish = Boolean(nat && /^spanish$/i.test(nat));
  return {
    preferredLanguage: lang ?? (natSpanish ? 'Spanish' : null),
    isSpanishDesk: langSpanish || natSpanish,
  };
}

function toDate(v: string | Date | null): Date | null {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

function toCandidate(row: CandidateRow, now: Date): RetentionCandidate {
  const lastTransactionAt = toDate(row.last_tx);
  const daysInactive = lastTransactionAt ? daysSince(lastTransactionAt, now) : 90;
  const txCount90d = Number(row.tx_days_90d ?? 0);
  const { frequencyClass, thresholdDays } = classifyFrequency(txCount90d);
  const phone = (row.deal_phone ?? row.contact_phone)?.trim() || null;
  const dealId =
    row.zoho_deal_id != null && String(row.zoho_deal_id).trim()
      ? String(row.zoho_deal_id).trim()
      : null;
  const spanish = resolveSpanishDesk({
    mainLanguage: row.main_language,
    nationality: row.nationality,
  });
  return {
    carrierId: String(row.carrier_id),
    companyName: row.company_name,
    applicationId: row.application_id != null ? String(row.application_id) : null,
    agentName: row.agent,
    agentZohoUserId: row.agent_zoho_user_id != null ? String(row.agent_zoho_user_id) : null,
    zohoDealId: dealId,
    contactPhone: phone,
    dealStage: row.deal_stage,
    activeCards: row.total_active_cards != null ? Number(row.total_active_cards) : null,
    lastTransactionAt,
    daysInactive,
    txCount90d,
    gallons90d: Number(row.gallons_90d ?? 0),
    frequencyClass,
    thresholdDays,
    breached: daysInactive > thresholdDays,
    preferredLanguage: spanish.preferredLanguage,
    isSpanishDesk: spanish.isSpanishDesk,
  };
}

/**
 * Scan for frequency-breach candidates after Sales Agent entry exclusions.
 * `lookbackDays` bounds how long-dead an account may be and still enter the scan.
 * `agentZohoUserIds` (optional) scopes the company CTE to those Sales owners — used by
 * the Retention pilot so Daniel Brown (etc.) are not crowded out of the gallons top-N.
 */
export async function scanRetentionCandidates(
  opts: {
    lookbackDays?: number;
    limit?: number;
    now?: Date;
    agentZohoUserIds?: string[];
  } = {},
): Promise<RetentionCandidate[]> {
  const lookbackDays = Math.min(Math.max(opts.lookbackDays ?? 45, 3), 365);
  const limit = Math.min(Math.max(opts.limit ?? 500, 1), 2000);
  const agentIds = [...new Set((opts.agentZohoUserIds ?? []).map((id) => id.trim()).filter(Boolean))];
  const agentFilter =
    agentIds.length > 0 ? 'and c.agent_zoho_user_id::text = any($2::text[])' : '';
  const rows = await dwhQuery<CandidateRow>(
    `with billing_debtors as (
       -- Same rule as Billing Mytrion / Sales Clients roster (cmp_invoice, not dim.is_debtor).
       select carrier_id
         from public.cmp_invoice
        where status in ('PENDING', 'PARTIALLY_PAID')
          and coalesce(total_paid, 0) < total_amount
          and greatest(total_amount - coalesce(total_paid, 0), 0) >= ${DEBT_OPEN_BALANCE_MIN}
          and create_date is not null
          and (current_date - create_date::date) >= ${DEBT_OVERDUE_DAYS}
          and carrier_id is not null
        group by carrier_id
     ),
     tx as (
       select carrier_id,
              max(transaction_date)                       as last_tx_90d,
              count(distinct transaction_date::date)      as tx_days_90d,
              coalesce(sum(transaction_fuel_quantity), 0) as gallons_90d
         from octane.mart_transaction_line_items
        where carrier_id is not null
          and transaction_date >= now() - interval '90 days'
        group by carrier_id
     ),
     company as (
       select distinct on (carrier_id)
              carrier_id, company_name, application_id, agent, agent_zoho_user_id,
              deal_phone, contact_phone, nationality,
              deal_stage, total_active_cards, last_transaction_date, first_swipe_date
         from octane.dim_company
        where carrier_id is not null
          and is_active = 1
          -- Card Swiped / has used a card (excludes Verification + WEX + funded-never-used).
          and first_swipe_date is not null
          -- Out of Business / lost in CRM pipeline (Closed Lost; no separate OoB stage).
          and coalesce(deal_stage, '') <> 'Closed Lost'
          and coalesce(deal_stage, '') not ilike '%out of business%'
        order by carrier_id, update_date desc nulls last
     ),
     -- Zoho Deal id per carrier from octane.agent_deals (canonical agent↔deal directory).
     deals as (
       select distinct on (carrier_id)
              carrier_id, id::text as zoho_deal_id
         from octane.agent_deals
        where carrier_id is not null
          and id is not null
        order by carrier_id, appfilldate desc nulls last, id desc
     ),
     -- Sparse but authoritative language when CRM Main_Language is filled.
     deal_lang as (
       select zoho_deal_id::text as zoho_deal_id, main_language
         from octane.intm_zoho_deals
        where zoho_deal_id is not null
          and main_language is not null
     )
     select c.carrier_id,
            c.company_name,
            c.application_id,
            c.agent,
            c.agent_zoho_user_id,
            d.zoho_deal_id,
            c.deal_phone,
            c.contact_phone,
            c.deal_stage,
            c.total_active_cards,
            c.nationality,
            dl.main_language,
            greatest(tx.last_tx_90d, c.last_transaction_date) as last_tx,
            coalesce(tx.tx_days_90d, 0)                       as tx_days_90d,
            coalesce(tx.gallons_90d, 0)                       as gallons_90d
       from company c
       left join tx on tx.carrier_id = c.carrier_id
       left join deals d on d.carrier_id = c.carrier_id
       left join deal_lang dl on dl.zoho_deal_id = d.zoho_deal_id
       left join billing_debtors bd on bd.carrier_id = c.carrier_id
      where bd.carrier_id is null
        and greatest(tx.last_tx_90d, c.last_transaction_date) is not null
        and greatest(tx.last_tx_90d, c.last_transaction_date) < now() - interval '2 days'
        and greatest(tx.last_tx_90d, c.last_transaction_date) >= now() - ($1 || ' days')::interval
        ${agentFilter}
      order by coalesce(tx.gallons_90d, 0) desc
      limit ${limit}`,
    agentIds.length > 0 ? [String(lookbackDays), agentIds] : [String(lookbackDays)],
  );
  const now = opts.now ?? new Date();
  return rows.map((row) => toCandidate(row, now));
}

/**
 * Latest transaction per carrier (any age) — used to close open cases whose client came
 * back ("Returned" branch). Non-numeric ids are skipped (carrier ids are DWH integers).
 */
export async function fetchCarrierLastTransactions(
  carrierIds: string[],
): Promise<Map<string, Date>> {
  const numeric = [...new Set(carrierIds.filter((id) => /^\d+$/.test(id)))];
  const result = new Map<string, Date>();
  if (numeric.length === 0) return result;
  const rows = await dwhQuery<{ carrier_id: number; last_tx: string | Date | null }>(
    `select carrier_id, max(transaction_date) as last_tx
       from octane.mart_transaction_line_items
      where carrier_id = any($1::int[])
      group by carrier_id`,
    [numeric],
  );
  for (const row of rows) {
    const d = toDate(row.last_tx);
    if (d) result.set(String(row.carrier_id), d);
  }
  return result;
}
