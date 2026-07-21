/**
 * DWH client roster — the Sales Mytrion "Data Center → Clients" tab's SOLE data source. A SINGLE
 * read-only query over `octane.dim_company` (metadata) + `octane.mart_transaction_line_items` (activity
 * + gallons) + `public.cmp_invoice` (debt) returns, per carrier: contact/cards/MC/DOT metadata, the
 * computed debtor + activity overlays, and cycle / this-month / prev-month gallons + card counts.
 *
 * Replaces the previous two-call path (servercrm `/api/clients/by-agent` — which layered a LIVE CMP
 * debt HTTP call on top of the same CTEs — plus a separate DWH loyalty query). One round-trip, one mart
 * scan. The trade-off (chosen deliberately): debt comes from the DWH `public.cmp_invoice` snapshot
 * (refreshes ~every 3h) instead of live CMP — servercrm already fell back to exactly these values when
 * its live overlay failed, so this is the same rule, just without the live call.
 *
 * Why NOT read `dim_company.debt_amount` / `.is_active` directly (they're already on the scanned row):
 * both are STALE/WRONG on the dim (servercrm measured debt_amount at ~$6M vs ~$13.4M from invoices, and
 * is_active stays 1 long after a carrier stops fueling). So debt is computed from `cmp_invoice` and
 * activity from the mart, mirroring servercrm's `dwhClients.js`.
 *
 * Business rules (kept identical to servercrm so the numbers reconcile):
 * - Active   = ≥1 transaction in the last ACTIVE_DAYS (10) days.
 * - Debt     = Σ outstanding on `cmp_invoice` rows that are PENDING/PARTIALLY_PAID, still owe ≥ $1, and
 *              are ≥ DEBT_OVERDUE_DAYS (2) days old by `create_date`. `debt_days` = max age of those.
 * - Cycle    = Σ `line_item_fuel_quantity` over the org billing cycle (26th → 25th; current cycle starts
 *              on the most-recent 26th), from the DWH `current_date` (Asia/Tashkent) — same basis as the
 *              month filters here.
 *
 * Owner scope (mirrors servercrm's by-agent, the roster authority, so we return the SAME carriers): a
 * carrier maps to its CURRENT owning agent via `dim_company` (newest row per carrier). We resolve by
 * the last-12-digit id suffix FIRST and fall back to the display name (`dim_company.agent`) ONLY when
 * the id arm matches nothing — exactly servercrm's id-first / name-fallback order, and deliberately
 * MUTUALLY EXCLUSIVE, NOT `id OR name`. The fallback matters because the session id and the warehouse
 * `agent_zoho_user_id` often share only the record suffix (different org prefixes) or don't line up at
 * all (sandbox). It must not be OR'd: display names are NOT unique, so an always-on name arm could pull
 * carriers owned by a different agent who shares the caller's display name. (The residual exposure —
 * the id arm is empty AND two agents share a display name — is inherent to name resolution and is the
 * exact same risk servercrm's name fallback already carries; the durable fix is aligning the session id
 * space with the warehouse `agent_zoho_user_id` so the id arm resolves.) Every matched value is bound
 * (`$1`/`$2`); the fragments are fixed internal literals, never caller input.
 */
import { dwhQuery } from './dwh.js';

/** Active-window / debt thresholds — kept in sync with servercrm's dwhClients.js defaults. */
const ACTIVE_DAYS = 10;
const DEBT_OVERDUE_DAYS = 2;
const DEBT_OPEN_BALANCE_MIN = 1;

/** One normalized client roster row (contact/phone/MC fallbacks resolved, numbers coerced). */
export interface AgentClientRow {
  carrierId: string;
  companyName: string;
  contact: string;
  phone: string;
  producedCards: number;
  activeCards: number;
  moneyCode: string;
  dot: string;
  isLocSuspended: boolean;
  computedIsActive: boolean;
  computedDebt: number;
  computedDebtDays: number;
  /** This billing-cycle (26th→25th) gallons — the "Gallons · Cycle" figure. */
  cycleGallons: number;
  gallonsThisMonth: number;
  activeCardsThisMonth: number;
  transactionsThisMonth: number;
  gallonsPrevMonth: number;
  activeCardsPrevMonth: number;
}

/** Raw DB row (dim columns + computed overlays). pg returns sums/counts as strings, bools as booleans. */
interface ClientDbRow {
  carrier_id: number | string;
  company_name: string | null;
  deal_full_name: string | null;
  agent: string | null;
  deal_phone: string | null;
  contact_phone: string | null;
  total_produced_cards: number | string | null;
  total_active_cards: number | string | null;
  deal_money_code: string | null;
  comdata_id: string | number | null;
  dot: string | number | null;
  is_loc_suspended: boolean | null;
  computed_is_active: boolean | null;
  computed_debt: string | number | null;
  computed_debt_days: string | number | null;
  cycle_gallons: string | number | null;
  gallons_this_month: string | number | null;
  active_cards_this_month: string | number | null;
  transactions_this_month: string | number | null;
  gallons_prev_month: string | number | null;
  active_cards_prev_month: string | number | null;
}

/** pg returns sum/count as strings and int4 as number — coerce everything to a finite number. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/** Trim to a non-empty string, or '' when null/blank. */
function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Last 12 digits of a Zoho id — matches across the DWH org-prefix mismatch (see warehouse_gallons.ts). */
function zohoIdSuffix(id: string): string {
  return id.replace(/\D+/g, '').slice(-12);
}

/** Owner-match fragments (fixed literals; the value is always the bound `$n`). See the file header. */
const byIdSuffix = (n: number): string =>
  `lpad(right(c.agent_zoho_user_id::text, 12), 12, '0') = lpad($${n}, 12, '0')`;
const byName = (n: number): string => `lower(c.agent) = lower($${n})`;

/** The dim_company columns the roster surfaces — selected identically in every owner-resolution arm. */
const OWNED_COLS = `carrier_id, company_name, deal_full_name, agent, deal_phone, contact_phone,
              total_produced_cards, total_active_cards, deal_money_code, comdata_id, dot, is_loc_suspended`;

/** One owner-resolution arm: the newest dim row per carrier matching `pred`. */
const ownedArm = (pred: string): string =>
  `select distinct on (carrier_id) ${OWNED_COLS}
         from octane.dim_company c
        where carrier_id is not null and (${pred})
        order by carrier_id, update_date desc nulls last`;

/**
 * Build the `owned` CTE. With BOTH an id-suffix and a name available, resolve id-FIRST and fall back to
 * the name ONLY when the id arm is empty (`union all … where not exists (select 1 from id_owned)`) —
 * mirrors servercrm's by-agent and is deliberately MUTUALLY EXCLUSIVE, never `id OR name`: display
 * names are not unique, so an always-on name arm could pull carriers owned by a different agent who
 * shares the caller's display name (see the file header). With a single arm it's just that arm.
 */
function buildOwnedCte(idBindIdx: number | null, nameBindIdx: number | null): string {
  const idPred = idBindIdx !== null ? byIdSuffix(idBindIdx) : null;
  const namePred = nameBindIdx !== null ? byName(nameBindIdx) : null;
  if (idPred && namePred) {
    return `id_owned as (${ownedArm(idPred)}),
     name_owned as (${ownedArm(namePred)}),
     owned as (
       select * from id_owned
       union all
       select * from name_owned where not exists (select 1 from id_owned)
     )`;
  }
  return `owned as (${ownedArm((idPred ?? namePred) as string)})`;
}

/**
 * The whole roster in one query. `ownedCteSql` is the owner-resolution CTE(s) from `buildOwnedCte`
 * (with values bound via `binds`); it always defines an `owned` relation = the FULL roster (inactive
 * carriers included). `gallons_cte` scans the mart ONCE: cycle + this/prev-month aggregates AND
 * `max(transaction_date)` (→ the activity flag, so no separate active scan). `debt_cte` sums
 * `cmp_invoice`. Carriers with no recent transactions simply have NULL gallons → coalesced to 0 / false.
 * Ordered active-first then highest-debt then name, matching servercrm's roster surfacing.
 */
async function runClientsQuery(ownedCteSql: string, binds: string[]): Promise<ClientDbRow[]> {
  return dwhQuery<ClientDbRow>(
    `with ${ownedCteSql},
     cyc as (
       select case when extract(day from current_date) >= 26
                   then date_trunc('month', current_date) + interval '25 days'
                   else date_trunc('month', current_date) - interval '1 month' + interval '25 days'
              end as cycle_start
     ),
     debt_cte as (
       select carrier_id,
              coalesce(sum(greatest(total_amount - coalesce(total_paid, 0), 0)), 0) as debt,
              max((current_date - create_date::date)::int) as debt_days
         from public.cmp_invoice
        where status in ('PENDING', 'PARTIALLY_PAID')
          and coalesce(total_paid, 0) < total_amount
          and greatest(total_amount - coalesce(total_paid, 0), 0) >= ${DEBT_OPEN_BALANCE_MIN}
          and create_date is not null
          and (current_date - create_date::date) >= ${DEBT_OVERDUE_DAYS}
          and carrier_id is not null
        group by carrier_id
     ),
     gallons_cte as (
       select t.carrier_id,
              max(t.transaction_date) as last_tx,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where t.transaction_date >= (select cycle_start from cyc)), 0) as cycle_gallons,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)), 0) as gallons_this_month,
              count(distinct t.card_number) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)) as active_cards_this_month,
              count(distinct t.transaction_id) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)) as transactions_this_month,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date - interval '1 month')), 0) as gallons_prev_month,
              count(distinct t.card_number) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date - interval '1 month')) as active_cards_prev_month
         from octane.mart_transaction_line_items t
         join owned o on o.carrier_id = t.carrier_id
        where t.transaction_date >= least(
                (select cycle_start from cyc),
                date_trunc('month', current_date - interval '1 month'))
        group by t.carrier_id
     )
     select o.carrier_id, o.company_name, o.deal_full_name, o.agent, o.deal_phone, o.contact_phone,
            o.total_produced_cards, o.total_active_cards, o.deal_money_code, o.comdata_id, o.dot,
            o.is_loc_suspended,
            coalesce(g.last_tx >= now() - interval '${ACTIVE_DAYS} days', false) as computed_is_active,
            coalesce(d.debt, 0) as computed_debt,
            d.debt_days as computed_debt_days,
            coalesce(g.cycle_gallons, 0) as cycle_gallons,
            coalesce(g.gallons_this_month, 0) as gallons_this_month,
            coalesce(g.active_cards_this_month, 0) as active_cards_this_month,
            coalesce(g.transactions_this_month, 0) as transactions_this_month,
            coalesce(g.gallons_prev_month, 0) as gallons_prev_month,
            coalesce(g.active_cards_prev_month, 0) as active_cards_prev_month
       from owned o
       left join debt_cte d on d.carrier_id = o.carrier_id
       left join gallons_cte g on g.carrier_id = o.carrier_id
      order by computed_is_active desc, computed_debt desc, o.company_name asc nulls last, o.carrier_id asc`,
    binds,
  );
}

/** Resolve fallbacks + coerce a raw DB row to the normalized roster shape. */
function toClient(r: ClientDbRow): AgentClientRow {
  const dash = (v: string): string => v || '—';
  return {
    carrierId: str(r.carrier_id),
    companyName: str(r.company_name) || '(unnamed)',
    // deal contact name, falling back to the owning agent's name (there is no contact_name on the dim).
    contact: dash(str(r.deal_full_name) || str(r.agent)),
    phone: dash(str(r.deal_phone) || str(r.contact_phone)),
    producedCards: num(r.total_produced_cards ?? r.total_active_cards),
    activeCards: num(r.total_active_cards),
    moneyCode: dash(str(r.deal_money_code) || str(r.comdata_id)),
    dot: dash(str(r.dot)),
    isLocSuspended: r.is_loc_suspended === true,
    computedIsActive: r.computed_is_active === true,
    computedDebt: num(r.computed_debt),
    computedDebtDays: num(r.computed_debt_days),
    cycleGallons: num(r.cycle_gallons),
    gallonsThisMonth: num(r.gallons_this_month),
    activeCardsThisMonth: num(r.active_cards_this_month),
    transactionsThisMonth: num(r.transactions_this_month),
    gallonsPrevMonth: num(r.gallons_prev_month),
    activeCardsPrevMonth: num(r.active_cards_prev_month),
  };
}

/**
 * The caller's full client roster (every carrier they currently own), with debt + activity overlays and
 * cycle/month gallons — one DWH query. Resolves owners id-suffix-FIRST, display-name-FALLBACK (see the
 * file header) so it returns exactly the carriers servercrm's by-agent roster would, without an OR that
 * could leak another same-named agent's carriers. Empty array when neither match path is supplied.
 */
export async function fetchAgentClients(
  ownerZohoUserId: string,
  agentName?: string,
): Promise<AgentClientRow[]> {
  const binds: string[] = [];
  let idBindIdx: number | null = null;
  let nameBindIdx: number | null = null;
  const suffix = zohoIdSuffix(ownerZohoUserId);
  if (suffix) {
    binds.push(suffix);
    idBindIdx = binds.length;
  }
  const name = agentName?.trim();
  if (name) {
    binds.push(name);
    nameBindIdx = binds.length;
  }
  if (idBindIdx === null && nameBindIdx === null) return [];
  const rows = await runClientsQuery(buildOwnedCte(idBindIdx, nameBindIdx), binds);
  return rows.map(toClient);
}
