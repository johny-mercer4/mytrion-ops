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
 *
 * `isCarrierOwned` exposes the SAME owner resolution as a targeted probe — it backs the
 * `assertCarrierOwned` RBAC gate (modules/tools/serverCrmScope.ts), so the set of carriers an agent
 * can act on is exactly the set this roster lists. Keep the two functions on the shared
 * `ownerBinds`/`buildOwnedCte` path; a second, divergent ownership authority is how the
 * "Clients modal 403s for every non-admin" P0 happened.
 */
import { dwhQuery } from './dwh.js';
import { logger } from '../lib/logger.js';
import { CYCLE_START_SQL, cycleCte } from '../lib/salesCycle.js';

/** Active-window / debt thresholds — kept in sync with servercrm's dwhClients.js defaults. */
const ACTIVE_DAYS = 10;
const DEBT_OVERDUE_DAYS = 2;
const DEBT_OPEN_BALANCE_MIN = 1;

/** One normalized client roster row (contact/phone/MC fallbacks resolved, numbers coerced). */
export interface AgentClientRow {
  carrierId: string;
  companyName: string;
  contact: string;
  /**
   * The carrier's CURRENT owning agent (`dim_company.agent`). Already selected by every owner arm;
   * surfaced because the Manager all-clients roster spans agents and must show who owns each row.
   * For the agent-scoped roster this is just the caller's own name.
   */
  agentName: string;
  phone: string;
  producedCards: number;
  activeCards: number;
  /** Last persisted loyalty status from the warehouse, used only while a company is dormant. */
  lastTierName: string;
  moneyCode: string;
  dot: string;
  /**
   * Declared fleet size (`dim_company.trucks`, from the Zoho Deal "Trucks" field). Reference context
   * only: the loyalty track is determined by closed-month transacting cards.
   */
  trucks: number | null;
  isLocSuspended: boolean;
  computedIsActive: boolean;
  computedDebt: number;
  computedDebtDays: number;
  /** This billing-cycle (26th→25th) gallons — the "Gallons · Cycle" figure. */
  cycleGallons: number;
  gallonsThisMonth: number;
  /** This-month ULSR + ULSD gallons — progress toward next month's tier. */
  inNetworkGallonsThisMonth: number;
  activeCardsThisMonth: number;
  transactionsThisMonth: number;
  gallonsPrevMonth: number;
  /** Previous-month ULSR + ULSD gallons — the current tier's only volume basis. */
  inNetworkGallonsPrevMonth: number;
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
  tier_name: string | null;
  deal_money_code: string | null;
  comdata_id: string | number | null;
  dot: string | number | null;
  trucks: number | string | null;
  is_loc_suspended: boolean | null;
  computed_is_active: boolean | null;
  computed_debt: string | number | null;
  computed_debt_days: string | number | null;
  cycle_gallons: string | number | null;
  gallons_this_month: string | number | null;
  in_network_gallons_this_month: string | number | null;
  active_cards_this_month: string | number | null;
  transactions_this_month: string | number | null;
  gallons_prev_month: string | number | null;
  in_network_gallons_prev_month: string | number | null;
  active_cards_prev_month: string | number | null;
}

/** pg returns sum/count as strings and int4 as number — coerce everything to a finite number. */
function num(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v ?? 0);
  return Number.isFinite(n) ? n : 0;
}

/**
 * A declared count, or null when it is absent/unusable. Deliberately NOT `num()`: that coerces null to
 * 0, which would turn "fleet size unknown" into "zero trucks" for ~184 carriers — 19 of which hold a
 * live loyalty track today. 0 is rejected too: no dim row has trucks = 0, while the upstream Zoho deal
 * field carries 0 as an unfilled blank, so a 0 after a sync means unknown.
 */
function intOrNull(v: unknown): number | null {
  const n = typeof v === 'number' ? v : Number(v ?? NaN);
  return Number.isInteger(n) && n >= 1 ? n : null;
}

/** Trim to a non-empty string, or '' when null/blank. */
function str(v: unknown): string {
  return v == null ? '' : String(v).trim();
}

/** Last 12 digits of a Zoho id — matches across the DWH org-prefix mismatch (see warehouse_gallons.ts). */
export function zohoIdSuffix(id: string): string {
  return id.replace(/\D+/g, '').slice(-12);
}

/** Owner-match fragments (fixed literals; the value is always the bound `$n`). See the file header. */
const byIdSuffix = (n: number): string =>
  `lpad(right(c.agent_zoho_user_id::text, 12), 12, '0') = lpad($${n}, 12, '0')`;
const byName = (n: number): string => `lower(c.agent) = lower($${n})`;

/** The dim_company columns the roster surfaces — selected identically in every owner-resolution arm. */
const OWNED_COLS = `carrier_id, company_name, deal_full_name, agent, deal_phone, contact_phone,
              total_produced_cards, total_active_cards, tier_name, deal_money_code, comdata_id, dot,
              trucks, is_loc_suspended`;

/** One owner-resolution arm: the newest dim row per carrier matching `pred`, selecting `cols`. */
const ownedArm = (pred: string, cols: string = OWNED_COLS): string =>
  `select distinct on (carrier_id) ${cols}
         from octane.dim_company c
        where carrier_id is not null and (${pred})
        order by carrier_id, update_date desc nulls last`;

/**
 * The AGENT-AGNOSTIC `owned` CTE — every carrier, newest dim row each, no owner predicate and no
 * binds (the predicate is the fixed literal `true`). Exported so the month-anchored loyalty export
 * (integrations/dwhLoyaltyMonth.ts) resolves its carrier set through THIS file's dedupe: a second
 * `distinct on (carrier_id) order by update_date desc` elsewhere is how two loyalty surfaces come to
 * disagree on which dim row is current for a re-assigned carrier. NOT owner-filtered — every caller is
 * a company-wide read whose route must be manager- or marketing-gated. */
export function allCarriersCte(cols: string = OWNED_COLS): string {
  return `owned as (${ownedArm('true', cols)})`;
}

/**
 * Build the `owned` CTE. With BOTH an id-suffix and a name available, resolve id-FIRST and fall back to
 * the name ONLY when the id arm is empty (`union all … where not exists (select 1 from id_owned)`) —
 * mirrors servercrm's by-agent and is deliberately MUTUALLY EXCLUSIVE, never `id OR name`: display
 * names are not unique, so an always-on name arm could pull carriers owned by a different agent who
 * shares the caller's display name (see the file header). With a single arm it's just that arm.
 *
 * `cols` selects which dim_company columns the `owned` relation exposes (default = the roster's
 * OWNED_COLS). Other agent-scoped DWH readers (e.g. the Verification pipeline deals list) pass their
 * own column list to reuse this exact id-suffix-first / name-fallback logic — the ONE owner authority.
 * Every arm selects the SAME cols so the UNION ALL is valid.
 */
export function buildOwnedCte(
  idBindIdx: number | null,
  nameBindIdx: number | null,
  cols: string = OWNED_COLS,
): string {
  const idPred = idBindIdx !== null ? byIdSuffix(idBindIdx) : null;
  const namePred = nameBindIdx !== null ? byName(nameBindIdx) : null;
  if (idPred && namePred) {
    return `id_owned as (${ownedArm(idPred, cols)}),
     name_owned as (${ownedArm(namePred, cols)}),
     owned as (
       select * from id_owned
       union all
       select * from name_owned where not exists (select 1 from id_owned)
     )`;
  }
  return `owned as (${ownedArm((idPred ?? namePred) as string, cols)})`;
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
     ${cycleCte('cyc')},
     debt_cte as (
       select i.carrier_id,
              coalesce(sum(greatest(i.total_amount - coalesce(i.total_paid, 0), 0)), 0) as debt,
              max((current_date - i.create_date::date)::int) as debt_days
         from public.cmp_invoice i
         join owned o on o.carrier_id = i.carrier_id
        where i.status in ('PENDING', 'PARTIALLY_PAID')
          and coalesce(i.total_paid, 0) < i.total_amount
          and greatest(i.total_amount - coalesce(i.total_paid, 0), 0) >= ${DEBT_OPEN_BALANCE_MIN}
          and i.create_date is not null
          and (current_date - i.create_date::date) >= ${DEBT_OVERDUE_DAYS}
          and i.carrier_id is not null
        group by i.carrier_id
     ),
     gallons_cte as (
       select t.carrier_id,
              max(t.transaction_date) as last_tx,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where t.transaction_date >= (select cycle_start from cyc)), 0) as cycle_gallons,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)), 0) as gallons_this_month,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)
                  and upper(trim(t.line_item_category)) in ('ULSD', 'ULSR')
              ), 0) as in_network_gallons_this_month,
              count(distinct t.card_number) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)) as active_cards_this_month,
              count(distinct t.transaction_id) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date)) as transactions_this_month,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date - interval '1 month')), 0) as gallons_prev_month,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where date_trunc('month', t.transaction_date) = date_trunc('month', current_date - interval '1 month')
                  and upper(trim(t.line_item_category)) in ('ULSD', 'ULSR')
              ), 0) as in_network_gallons_prev_month,
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
            o.total_produced_cards, o.total_active_cards, o.tier_name, o.deal_money_code, o.comdata_id, o.dot,
            o.trucks, o.is_loc_suspended,
            coalesce(g.last_tx >= now() - interval '${ACTIVE_DAYS} days', false) as computed_is_active,
            coalesce(d.debt, 0) as computed_debt,
            d.debt_days as computed_debt_days,
            coalesce(g.cycle_gallons, 0) as cycle_gallons,
            coalesce(g.gallons_this_month, 0) as gallons_this_month,
            coalesce(g.in_network_gallons_this_month, 0) as in_network_gallons_this_month,
            coalesce(g.active_cards_this_month, 0) as active_cards_this_month,
            coalesce(g.transactions_this_month, 0) as transactions_this_month,
            coalesce(g.gallons_prev_month, 0) as gallons_prev_month,
            coalesce(g.in_network_gallons_prev_month, 0) as in_network_gallons_prev_month,
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
    agentName: dash(str(r.agent)),
    phone: dash(str(r.deal_phone) || str(r.contact_phone)),
    producedCards: num(r.total_produced_cards ?? r.total_active_cards),
    activeCards: num(r.total_active_cards),
    lastTierName: str(r.tier_name),
    moneyCode: dash(str(r.deal_money_code) || str(r.comdata_id)),
    dot: dash(str(r.dot)),
    trucks: intOrNull(r.trucks),
    isLocSuspended: r.is_loc_suspended === true,
    computedIsActive: r.computed_is_active === true,
    computedDebt: num(r.computed_debt),
    computedDebtDays: num(r.computed_debt_days),
    cycleGallons: num(r.cycle_gallons),
    gallonsThisMonth: num(r.gallons_this_month),
    inNetworkGallonsThisMonth: num(r.in_network_gallons_this_month),
    activeCardsThisMonth: num(r.active_cards_this_month),
    transactionsThisMonth: num(r.transactions_this_month),
    gallonsPrevMonth: num(r.gallons_prev_month),
    inNetworkGallonsPrevMonth: num(r.in_network_gallons_prev_month),
    activeCardsPrevMonth: num(r.active_cards_prev_month),
  };
}

interface ClientRosterCacheEntry {
  rows: AgentClientRow[];
  expiresAt: number;
  staleUntil: number;
}

const CLIENT_ROSTER_TTL_MS = 2 * 60_000;
const CLIENT_ROSTER_STALE_MS = 20 * 60_000;
const CLIENT_ROSTER_CACHE_MAX = 100;
const clientRosterCache = new Map<string, ClientRosterCacheEntry>();
const clientRosterInFlight = new Map<string, Promise<AgentClientRow[]>>();

/** Test hook: clear roster snapshots and refresh promises. */
export function clearClientRosterCache(): void {
  clientRosterCache.clear();
  clientRosterInFlight.clear();
}

function writeClientRosterCache(key: string, rows: AgentClientRow[]): void {
  if (clientRosterCache.has(key)) clientRosterCache.delete(key);
  const now = Date.now();
  clientRosterCache.set(key, {
    rows,
    expiresAt: now + CLIENT_ROSTER_TTL_MS,
    staleUntil: now + CLIENT_ROSTER_STALE_MS,
  });
  while (clientRosterCache.size > CLIENT_ROSTER_CACHE_MAX) {
    const oldest = clientRosterCache.keys().next().value as string | undefined;
    if (!oldest) break;
    clientRosterCache.delete(oldest);
  }
}

async function cachedClientRoster(
  key: string,
  load: () => Promise<AgentClientRow[]>,
  force = false,
  allowStaleOnError = true,
): Promise<AgentClientRow[]> {
  const cached = clientRosterCache.get(key);
  if (!force && cached && cached.expiresAt > Date.now()) return cached.rows;
  // A strict authorization refresh must never join a UI refresh whose failure policy allows a
  // stale snapshot. Keep the two promise classes separate while still coalescing equivalent calls.
  const inFlightKey = `${key}:stale-on-error:${allowStaleOnError ? 'yes' : 'no'}`;
  const running = clientRosterInFlight.get(inFlightKey);
  if (running) return running;
  const request = load()
    .then((rows) => {
      writeClientRosterCache(key, rows);
      return rows;
    })
    .catch((error: unknown) => {
      if (allowStaleOnError && cached && cached.staleUntil > Date.now()) {
        logger.warn(
          { err: error instanceof Error ? error.message : String(error), key },
          'DWH client roster refresh failed — serving recent snapshot',
        );
        return cached.rows;
      }
      throw error;
    })
    .finally(() => clientRosterInFlight.delete(inFlightKey));
  clientRosterInFlight.set(inFlightKey, request);
  return request;
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
  options: { force?: boolean; allowStaleOnError?: boolean } = {},
): Promise<AgentClientRow[]> {
  const { binds, idBindIdx, nameBindIdx } = ownerBinds(ownerZohoUserId, agentName);
  if (idBindIdx === null && nameBindIdx === null) return [];
  const key = `agent:${zohoIdSuffix(ownerZohoUserId)}:${agentName?.trim().toLowerCase() ?? ''}`;
  return cachedClientRoster(
    key,
    async () => {
      const rows = await runClientsQuery(buildOwnedCte(idBindIdx, nameBindIdx), binds);
      return rows.map(toClient);
    },
    options.force,
    options.allowStaleOnError,
  );
}

/**
 * EVERY carrier in the warehouse, agent-agnostic — the Manager Mytrion → Loyalty Program roster.
 *
 * Deliberately runs the SAME `runClientsQuery` + `toClient` as the agent-scoped roster, with the only
 * difference being an `owned` CTE that drops the owner predicate (`ownedArm('true')` still keeps the
 * `carrier_id is not null` guard and the newest-dim-row-per-carrier dedupe). Reusing one query is the
 * point: loyalty tier is derived from `activeCards` + monthly gallons, so if Manager computed those
 * differently from Data Center → Clients the two surfaces would disagree about a client's tier.
 *
 * NOT owner-filtered, so this is a MANAGER-ONLY read — the route must be `management`-gated. There
 * are no binds at all (the predicate is a fixed literal), so nothing here is caller-controlled.
 */
async function runAllLoyaltyClientsQuery(): Promise<ClientDbRow[]> {
  return dwhQuery<ClientDbRow>(
    `with ${allCarriersCte()},
     bounds as (
       select date_trunc('month', current_date) as current_start,
              date_trunc('month', current_date - interval '1 month') as previous_start,
              date_trunc('month', current_date + interval '1 month') as next_start,
              ${CYCLE_START_SQL} as cycle_start
     ),
     gallons_cte as (
       select t.carrier_id,
              max(t.transaction_date) as last_tx,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where t.transaction_date >= (select cycle_start from bounds)), 0) as cycle_gallons,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where t.transaction_date >= (select current_start from bounds)), 0) as gallons_this_month,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where t.transaction_date >= (select current_start from bounds)
                  and upper(trim(t.line_item_category)) in ('ULSD', 'ULSR')
              ), 0) as in_network_gallons_this_month,
              count(distinct t.card_number) filter (
                where t.transaction_date >= (select current_start from bounds)) as active_cards_this_month,
              count(distinct t.transaction_id) filter (
                where t.transaction_date >= (select current_start from bounds)) as transactions_this_month,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where t.transaction_date >= (select previous_start from bounds)
                  and t.transaction_date < (select current_start from bounds)), 0) as gallons_prev_month,
              coalesce(sum(t.line_item_fuel_quantity) filter (
                where t.transaction_date >= (select previous_start from bounds)
                  and t.transaction_date < (select current_start from bounds)
                  and upper(trim(t.line_item_category)) in ('ULSD', 'ULSR')
              ), 0) as in_network_gallons_prev_month,
              count(distinct t.card_number) filter (
                where t.transaction_date >= (select previous_start from bounds)
                  and t.transaction_date < (select current_start from bounds)) as active_cards_prev_month
         from octane.mart_transaction_line_items t
         join owned o on o.carrier_id = t.carrier_id
        where t.transaction_date >= least(
                (select previous_start from bounds),
                (select cycle_start from bounds))
          and t.transaction_date < (select next_start from bounds)
        group by t.carrier_id
     )
     select o.carrier_id, o.company_name, o.deal_full_name, o.agent, o.deal_phone, o.contact_phone,
            o.total_produced_cards, o.total_active_cards, o.tier_name, o.deal_money_code,
            o.comdata_id, o.dot, o.trucks, o.is_loc_suspended,
            coalesce(g.last_tx >= now() - interval '${ACTIVE_DAYS} days', false) as computed_is_active,
            0::numeric as computed_debt,
            0::int as computed_debt_days,
            coalesce(g.cycle_gallons, 0) as cycle_gallons,
            coalesce(g.gallons_this_month, 0) as gallons_this_month,
            coalesce(g.in_network_gallons_this_month, 0) as in_network_gallons_this_month,
            coalesce(g.active_cards_this_month, 0) as active_cards_this_month,
            coalesce(g.transactions_this_month, 0) as transactions_this_month,
            coalesce(g.gallons_prev_month, 0) as gallons_prev_month,
            coalesce(g.in_network_gallons_prev_month, 0) as in_network_gallons_prev_month,
            coalesce(g.active_cards_prev_month, 0) as active_cards_prev_month
       from owned o
       left join gallons_cte g on g.carrier_id = o.carrier_id
      order by g.in_network_gallons_prev_month desc nulls last,
               o.company_name asc nulls last,
               o.carrier_id asc`,
  );
}

export async function fetchAllClients(
  options: { force?: boolean } = {},
): Promise<AgentClientRow[]> {
  return cachedClientRoster(
    'manager:loyalty:all',
    async () => (await runAllLoyaltyClientsQuery()).map(toClient),
    options.force,
  );
}

export interface OwnerBinds {
  binds: string[];
  idBindIdx: number | null;
  nameBindIdx: number | null;
}

/** The owner-resolution bind list shared by the roster and the ownership probe — one identity
 *  normalization (id → suffix, name → trimmed) so the two can never disagree on who owns what. */
export function ownerBinds(ownerZohoUserId: string, agentName?: string): OwnerBinds {
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
  return { binds, idBindIdx, nameBindIdx };
}

/**
 * Is `carrierId` in this owner's roster? EXACTLY the fetchAgentClients owner resolution (id-suffix
 * arm, else name arm — mutually exclusive, newest dim row per carrier), probed with a carrier_id
 * filter instead of materializing the roster (dim_company only — no mart/invoice CTEs). This is the
 * authority behind `assertCarrierOwned`: whatever the Clients tab lists is what carrier-scoped
 * actions may touch. False when neither identity arm is supplied.
 */
export async function isCarrierOwned(
  ownerZohoUserId: string,
  agentName: string | undefined,
  carrierId: string | number,
): Promise<boolean> {
  const { binds, idBindIdx, nameBindIdx } = ownerBinds(ownerZohoUserId, agentName);
  if (idBindIdx === null && nameBindIdx === null) return false;
  binds.push(String(carrierId).trim());
  const rows = await dwhQuery<{ ok: number }>(
    `with ${buildOwnedCte(idBindIdx, nameBindIdx)}
     select 1 as ok from owned where carrier_id::text = $${binds.length} limit 1`,
    binds,
  );
  return rows.length > 0;
}

/** A carrier's owning Sales agent, as resolved for inbound events that only carry a carrier id. */
export interface CarrierOwner {
  carrierId: string;
  companyName: string | null;
  /** Zoho user id from the warehouse. May be null even when a name is known. */
  agentZohoUserId: string | null;
  /** Display name (`dim_company.agent`) — carried because reads match id-OR-name (see below). */
  agentName: string | null;
  source: 'dim_company' | 'zoho_deal';
}

/**
 * Resolve which Sales agent owns a carrier — the REVERSE of the roster's owner scoping.
 *
 * The roster answers "which carriers belong to this session?"; this answers "who owns this carrier?",
 * which is what an inbound webhook needs when all it has is a `carrier_id` (rejection reports).
 * It lives here, next to `buildOwnedCte`, because this file is the single ownership authority — a
 * second, divergent one is how the "Clients modal 403s for every non-admin" P0 happened.
 *
 * Returns BOTH the id and the name on purpose. Storing only the id would be wrong for the read path:
 * a worker's session Zoho id and `dim_company.agent_zoho_user_id` carry different org prefixes, which
 * is exactly why `buildOwnedCte` matches on the last 12 digits and falls back to the display name.
 * Callers persist both and match id-or-name later.
 *
 * `dim_company` is preferred; when it has no agent for the carrier the Zoho deal owner is used as a
 * second arm. Never resolve by company name — names are not unique across carriers.
 */
export async function findCarrierOwner(carrierId: string | number): Promise<CarrierOwner | null> {
  const id = String(carrierId).trim();
  if (!id) return null;
  const rows = await dwhQuery<{
    carrier_id: string;
    company_name: string | null;
    agent_zoho_user_id: string | null;
    agent: string | null;
  }>(
    `select distinct on (carrier_id)
            carrier_id::text as carrier_id,
            company_name,
            nullif(trim(agent_zoho_user_id::text), '') as agent_zoho_user_id,
            nullif(trim(agent), '')                    as agent
       from octane.dim_company
      where carrier_id::text = $1
      order by carrier_id, update_date desc nulls last
      limit 1`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    carrierId: row.carrier_id,
    companyName: row.company_name?.trim() || null,
    agentZohoUserId: row.agent_zoho_user_id,
    agentName: row.agent,
    source: 'dim_company',
  };
}
