/**
 * Sales Mytrion dashboards — native replacements for the Zoho Deluge functions the widget used to hit
 * (`mytrionhomesnapshot`, `mytrionAgentSalesDashboard`, `mytriondbdebtorsinfo`, `mytrioncompanydashboard`).
 *
 * Each Deluge function resolved the agent's name from the Zoho user record, then orchestrated servercrm
 * DWH endpoints (+ Zoho COQL for two of them) and assembled a result. We do the SAME orchestration here
 * in TypeScript — but skip the Zoho user-lookup entirely (the caller's display name is already on the
 * verified session: `ctx.userName`), and call servercrm / Zoho COQL directly. This removes the Zoho
 * Deluge round-trip (slow, rate-limited) from these four dashboards.
 *
 * The RETURN SHAPES are byte-compatible with the Deluge output (the frontend parsers are unchanged): see
 * each function. servercrm response field names are exactly what the Deluge read.
 */
import { serverCrmPost } from './serverCrm.js';
import { runCoql } from './zohoCrm.js';

type Row = Record<string, unknown>;

/** ifnull(...).toNumber()/.toDecimal() parity — coerce to a finite number, else the default. */
function num(v: unknown, dflt = 0): number {
  const n = typeof v === 'number' ? v : Number(v ?? dflt);
  return Number.isFinite(n) ? n : dflt;
}
/** ifnull(...,dflt) parity — dflt only on null/undefined (NOT on ''), else String(v). */
function str(v: unknown, dflt = ''): string {
  return v == null ? dflt : String(v);
}
/** servercrm/DWH booleans come back as bool or "true"/1. */
function bool(v: unknown): boolean {
  return v === true || v === 'true' || v === 1;
}
/** A servercrm agent call succeeded — matches the Deluge `success == true` / `status == success` checks. */
function ok(res: Row | null, mode: 'success' | 'status'): boolean {
  if (!res) return false;
  return mode === 'status' ? res.status === 'success' : res.success === true || String(res.success) === 'true';
}

const AGENT_BODY = (agentName: string): { agentName: string } => ({ agentName });

/**
 * Billing Mytrion debtor floors (Billing Debtors.tsx + dwhClientRoster):
 * pending/partial invoices · remaining ≥ $1 · age ≥ 2 days · hard = 15+ days.
 * CMP roll-up totals can include fresher invoices — recompute from invoice rows when present.
 */
export const DEBT_MIN_DAYS = 2;
export const DEBT_MIN_REMAINING = 1;
export const HARD_DEBT_DAYS = 15;

export interface CmpDebtorSummary {
  totalDebtors: number;
  totalHardDebtors: number;
  totalDebtAmount: number;
  largestDebtor: Row;
}

/** Recompute agent debtor KPIs from CMP invoice rows (Billing-aligned). Falls back to CMP totals. */
export function summarizeCmpDebtors(list: Row[], fallback: CmpDebtorSummary): CmpDebtorSummary {
  let sawInvoiceDetail = false;
  let totalDebtAmount = 0;
  let totalHardDebtors = 0;
  let totalDebtors = 0;
  let largestDebtor: Row = {};
  let largestRemaining = 0;

  for (const debtor of list) {
    const invoices = Array.isArray(debtor.invoices) ? (debtor.invoices as Row[]) : [];
    if (invoices.length > 0) sawInvoiceDetail = true;
    const kept = invoices.filter(
      (inv) => num(inv.debt_days) >= DEBT_MIN_DAYS && num(inv.remaining_amount) >= DEBT_MIN_REMAINING,
    );
    if (kept.length === 0) {
      // No invoice detail — keep CMP carrier row if it already qualifies on roll-up fields.
      if (invoices.length > 0) continue;
      const remaining = num(debtor.total_remaining);
      const maxDays = num(debtor.max_debt_days);
      if (remaining < DEBT_MIN_REMAINING || maxDays < DEBT_MIN_DAYS) continue;
      totalDebtors += 1;
      totalDebtAmount += remaining;
      if (maxDays >= HARD_DEBT_DAYS || bool(debtor.is_hard_debtor)) totalHardDebtors += 1;
      if (remaining > largestRemaining) {
        largestRemaining = remaining;
        largestDebtor = {
          deal_name: str(debtor.company_name),
          total_remaining: remaining,
          carrier_id: str(debtor.carrier_id),
          worst_status: str(debtor.worst_status),
        };
      }
      continue;
    }
    const remaining = kept.reduce((a, inv) => a + num(inv.remaining_amount), 0);
    const maxDays = kept.reduce((a, inv) => Math.max(a, num(inv.debt_days)), 0);
    totalDebtors += 1;
    totalDebtAmount += remaining;
    if (maxDays >= HARD_DEBT_DAYS) totalHardDebtors += 1;
    if (remaining > largestRemaining) {
      largestRemaining = remaining;
      largestDebtor = {
        deal_name: str(debtor.company_name),
        total_remaining: remaining,
        carrier_id: str(debtor.carrier_id),
        worst_status: str(debtor.worst_status),
      };
    }
  }

  if (!sawInvoiceDetail && totalDebtors === 0 && fallback.totalDebtors > 0) {
    return fallback;
  }
  return { totalDebtors, totalHardDebtors, totalDebtAmount, largestDebtor };
}

// ── Date helpers (America/New_York — matches servercrm's ET basis + the org's Zoho TZ) ───────────────
function etYmd(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}
/** 0=Sun … 6=Sat, in ET. */
function etDow(d: Date): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short' }).format(d);
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(wd);
}
/** Subtract `days` from a YYYY-MM-DD string (UTC-anchored, DST-safe). Mirrors servercrm's subtractDays. */
function subDaysYmd(ymd: string, days: number): string {
  const parts = ymd.split('-');
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  const dt = new Date(Date.UTC(y, m - 1, d - days));
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
}

// ── COQL helper — paginate a Deals query (up to 2000/page, cap 25 pages), best-effort ────────────────
async function coqlAllDeals(select: string, where: string, orderBy: string): Promise<Row[]> {
  const out: Row[] = [];
  const PAGE = 2000;
  for (let page = 0; page < 25; page += 1) {
    const offset = page * PAGE;
    const q = `select ${select} from Deals where ${where} ${orderBy} limit ${offset}, ${PAGE}`;
    const { rows, moreRecords } = await runCoql(q);
    out.push(...rows);
    if (!moreRecords || rows.length < PAGE) break;
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 1. HOME SNAPSHOT  (was standalone.mytrionHomeSnapshot)
//    servercrm /api/agent/dwh/snapshot + /api/agent/cmp/debtors → assembled snapshot + brief_context.
//    Returns { status, user_id, agent_name, snapshot, brief_context }. Best-effort: a failed servercrm
//    call leaves that section at zeros (status stays 'success'), matching the Deluge.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchHomeSnapshot(userId: string, agentName: string): Promise<Row> {
  if (!agentName) {
    return { status: 'error', message: `Could not resolve agent name for userId: ${userId}` };
  }
  const body = AGENT_BODY(agentName);
  const [snapRes, debtRes] = await Promise.all([
    serverCrmPost<Row>('/api/agent/dwh/snapshot', body).catch(() => null),
    serverCrmPost<Row>('/api/agent/cmp/debtors', body).catch(() => null),
  ]);

  // PART 1 — snapshot metrics
  const s: Row = ok(snapRes, 'status') ? ((snapRes as Row).snapshot as Row) ?? {} : {};
  const totalClients = ok(snapRes, 'status') ? num((snapRes as Row).carrier_count) : 0;
  const activeClients = num(s.active_clients);
  const inactiveClients = num(s.inactive_clients);
  const stuckClients = num(s.stuck_deals_count);
  const swipesThisWeek = num(s.swipes_this_week);
  const swipesLastWeek = num(s.swipes_last_week);
  const swipesToday = num(s.swipes_today);
  const gallonsThisWeek = num(s.gallons_this_week);
  const gallonsLastWeek = num(s.gallons_last_week);
  const gallonsToday = num(s.gallons_today);
  const gallonsTrend = str(s.gallons_trend, 'same');
  const swipesTrend = str(s.swipes_trend, 'same');
  const newCardsThisWeek = num(s.new_cards_this_week);
  const newCardsLastWeek = num(s.new_cards_last_week);
  const newCardsToday = num(s.new_cards_today);
  const newCardsTrend = str(s.new_cards_trend, 'same');
  const gallonsAvgThisWeek = num(s.gallons_avg_per_day_this_week);
  const gallonsAvgLastWeek = num(s.gallons_avg_per_day_last_week);
  const txAvgThisWeek = num(s.transactions_avg_per_day_this_week);
  const txAvgLastWeek = num(s.transactions_avg_per_day_last_week);
  const newCardsAvgThisWeek = num(s.new_cards_avg_per_day_this_week);
  const newCardsAvgLastWeek = num(s.new_cards_avg_per_day_last_week);
  const daysElapsedThisWeek = num(s.days_elapsed_this_week, 7);

  // PART 2 — debtors (Billing floors applied; CMP list sorted by total_remaining DESC)
  let totalDebtors = 0;
  let totalHardDebtors = 0;
  let totalDebtAmount = 0;
  let largestDebtor: Row = {};
  if (ok(debtRes, 'success')) {
    const d = ((debtRes as Row).data as Row) ?? {};
    const list = Array.isArray(d.debtors) ? (d.debtors as Row[]) : [];
    const top = list[0];
    const summarized = summarizeCmpDebtors(list, {
      totalDebtors: num(d.total_debtors),
      totalHardDebtors: num(d.total_hard_debtors),
      totalDebtAmount: num(d.total_debt_amount),
      largestDebtor: top
        ? {
            deal_name: str(top.company_name),
            total_remaining: num(top.total_remaining),
            carrier_id: str(top.carrier_id),
            worst_status: str(top.worst_status),
          }
        : {},
    });
    totalDebtors = summarized.totalDebtors;
    totalHardDebtors = summarized.totalHardDebtors;
    totalDebtAmount = summarized.totalDebtAmount;
    largestDebtor = summarized.largestDebtor;
  }

  const snapshot: Row = {
    active_clients: activeClients,
    inactive_clients: inactiveClients,
    stuck_deals_count: stuckClients,
    total_clients: totalClients,
    gallons_this_week: gallonsThisWeek,
    gallons_last_week: gallonsLastWeek,
    gallons_trend: gallonsTrend,
    gallons_today: gallonsToday,
    swipes_this_week: swipesThisWeek,
    swipes_last_week: swipesLastWeek,
    swipes_trend: swipesTrend,
    swipes_today: swipesToday,
    total_debtors: totalDebtors,
    total_hard_debtors: totalHardDebtors,
    total_debt_amount: totalDebtAmount,
    new_cards_this_week: newCardsThisWeek,
    new_cards_last_week: newCardsLastWeek,
    new_cards_today: newCardsToday,
    new_cards_trend: newCardsTrend,
    days_elapsed_this_week: daysElapsedThisWeek,
    gallons_avg_per_day_this_week: gallonsAvgThisWeek,
    gallons_avg_per_day_last_week: gallonsAvgLastWeek,
    transactions_avg_per_day_this_week: txAvgThisWeek,
    transactions_avg_per_day_last_week: txAvgLastWeek,
    new_cards_avg_per_day_this_week: newCardsAvgThisWeek,
    new_cards_avg_per_day_last_week: newCardsAvgLastWeek,
  };
  const existingClients: Row = {
    total_clients: totalClients,
    active_clients: activeClients,
    inactive_clients: inactiveClients,
    gallons_this_week: gallonsThisWeek,
    gallons_last_week: gallonsLastWeek,
    gallons_trend: gallonsTrend,
    gallons_today: gallonsToday,
    swipes_this_week: swipesThisWeek,
    swipes_last_week: swipesLastWeek,
    swipes_trend: swipesTrend,
    swipes_today: swipesToday,
    new_cards_this_week: newCardsThisWeek,
    new_cards_last_week: newCardsLastWeek,
    new_cards_today: newCardsToday,
    new_cards_trend: newCardsTrend,
    days_elapsed_this_week: daysElapsedThisWeek,
    gallons_avg_per_day_this_week: gallonsAvgThisWeek,
    gallons_avg_per_day_last_week: gallonsAvgLastWeek,
    transactions_avg_per_day_this_week: txAvgThisWeek,
    transactions_avg_per_day_last_week: txAvgLastWeek,
    new_cards_avg_per_day_this_week: newCardsAvgThisWeek,
    new_cards_avg_per_day_last_week: newCardsAvgLastWeek,
  };
  const briefContext: Row = {
    total_clients: totalClients,
    active_clients: activeClients,
    stuck_deals_count: stuckClients,
    existing_clients: existingClients,
    debtors: {
      total_debtors: totalDebtors,
      total_hard_debtors: totalHardDebtors,
      total_debt_amount: totalDebtAmount,
      largest_debtor: largestDebtor,
    },
  };
  return {
    status: 'success',
    user_id: userId,
    agent_name: agentName,
    snapshot,
    brief_context: briefContext,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 2. AGENT SALES DASHBOARD  (was standalone.mytrionAgentSalesDashboard)
//    Pure passthrough of servercrm /api/agent/salesdata (KPI, cardsByCompany, transactions, cycle…).
//    The Deluge returned the servercrm response verbatim; the frontend reads { success, data }.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchAgentSalesDashboard(agentName: string): Promise<unknown> {
  if (!agentName) return { success: false, error: 'Could not resolve agent name' };
  try {
    return await serverCrmPost('/api/agent/salesdata', AGENT_BODY(agentName));
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 3. DEBTORS  (was standalone.mytriondbdebtorsinfo)
//    servercrm /api/agent/cmp/debtors, each row enriched with Zoho deal metadata (owner-scoped COQL over
//    the caller's Deals, keyed by Carrier_ID). Returns { user_id, total_debtors, total_hard_debtors,
//    total_debt_amount, debtors[] }.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchDebtorsInfo(
  userId: string,
  agentName: string,
  opts: { summaryOnly?: boolean } = {},
): Promise<Row> {
  const empty: Row = {
    user_id: userId,
    total_debtors: 0,
    total_hard_debtors: 0,
    total_debt_amount: 0,
    debtors: [],
  };
  if (!agentName) return { ...empty, error: `Could not resolve agent name for userId: ${userId}` };

  // Enrichment map: Carrier_ID → deal. Owner-scoped (userId validated numeric so it can't be smuggled
  // into COQL). Run the enrichment COQL and the CMP debtors fetch IN PARALLEL (they're independent).
  // The Home "Money Owed" summary path (summaryOnly) skips enrichment entirely — that path only sums
  // remaining/counts from the CMP rows and never reads deal metadata, so the up-to-25-page Deals scan
  // was pure waste there. Best-effort: a COQL failure just means debtors render without deal metadata.
  const doEnrich = !opts.summaryOnly && /^\d+$/.test(userId);
  const [deals, debtRes] = await Promise.all([
    doEnrich
      ? coqlAllDeals(
          'id, Deal_Name, Stage, Owner, Carrier_ID, Application_ID, Created_Time',
          `Owner = '${userId}'`,
          'order by Created_Time desc',
        ).catch(() => [] as Row[])
      : Promise.resolve([] as Row[]),
    serverCrmPost<Row>('/api/agent/cmp/debtors', AGENT_BODY(agentName)).catch(() => null),
  ]);

  const carrierIdToDeal = new Map<string, Row>();
  for (const deal of deals) {
    const cid = str(deal.Carrier_ID);
    if (cid && cid !== 'null' && cid !== '0' && cid !== '0.0') carrierIdToDeal.set(cid, deal);
  }
  if (!ok(debtRes, 'success')) return { ...empty, error: 'DWH call failed' };

  const d = ((debtRes as Row).data as Row) ?? {};
  const rawDebtors = Array.isArray(d.debtors) ? (d.debtors as Row[]) : [];
  const debtors = rawDebtors.map((debtor) => {
    const carrierId = str(debtor.carrier_id);
    const deal = carrierIdToDeal.get(carrierId) ?? {};
    const owner = (deal.Owner as Row) ?? {};
    return {
      // Zoho deal fields
      id: str(deal.id),
      deal_name: str(deal.Deal_Name),
      stage: str(deal.Stage),
      owner: str(owner.name),
      carrier_id: carrierId,
      application_id: str(deal.Application_ID),
      created_time: str(deal.Created_Time),
      // DWH debt fields
      company_name: str(debtor.company_name),
      worst_status: str(debtor.worst_status, 'pending'),
      total_owed: num(debtor.total_owed),
      total_paid: num(debtor.total_paid),
      total_remaining: num(debtor.total_remaining),
      invoice_count: num(debtor.invoice_count),
      has_pending: bool(debtor.has_pending),
      has_partial: bool(debtor.has_partial),
      has_rejected: false, // DWH only tracks pending / partially_paid
      max_debt_days: num(debtor.max_debt_days),
      is_hard_debtor: bool(debtor.is_hard_debtor),
      invoices: Array.isArray(debtor.invoices) ? debtor.invoices : [],
    };
  });

  const summarized = summarizeCmpDebtors(rawDebtors, {
    totalDebtors: num(d.total_debtors),
    totalHardDebtors: num(d.total_hard_debtors),
    totalDebtAmount: num(d.total_debt_amount),
    largestDebtor: {},
  });

  return {
    user_id: userId,
    total_debtors: summarized.totalDebtors,
    total_hard_debtors: summarized.totalHardDebtors,
    total_debt_amount: summarized.totalDebtAmount,
    debtors,
  };
}

// ─────────────────────────────────────────────────────────────────────────────────────────────────────
// 4. COMPANY DASHBOARD  (was standalone.mytrionCompanyDashboard)
//    Layer 1: company-wide app-fill counts from Zoho COQL (Deals by Application_Date, today/week/month +
//    UTM source split). Layer 2: gallons from servercrm /api/agent/dwh/company-dashboard.
//    Returns { status, data: { fills_*, gallons_*, unique_cards_*, as_of, week_start } }.
// ─────────────────────────────────────────────────────────────────────────────────────────────────────
export async function fetchCompanyDashboard(agentName: string): Promise<Row> {
  if (!agentName) return { status: 'error', message: 'Could not resolve agent name' };
  try {
    const now = new Date();
    const todayStr = etYmd(now);
    const monthStartStr = `${todayStr.slice(0, 7)}-01`;
    const dow = etDow(now); // 0=Sun … 6=Sat
    const daysSinceMon = dow === 0 ? 6 : dow - 1;
    const weekStartStr = subDaysYmd(todayStr, daysSinceMon);
    const todayNum = Number(todayStr.replace(/-/g, ''));
    const weekStartNum = Number(weekStartStr.replace(/-/g, ''));

    // Layer 1 — app fills (COMPANY-WIDE: no Owner filter, by design).
    let fillsToday = 0;
    let fillsThisWeek = 0;
    let fillsThisMonth = 0;
    let fillsMeta = 0;
    let fillsWebsite = 0;
    let fillsOthers = 0;
    const deals = await coqlAllDeals(
      'id, Application_Date, utm_source',
      `Application_Date >= '${monthStartStr}' and Application_Date <= '${todayStr}'`,
      '',
    );
    for (const deal of deals) {
      const appDate = str(deal.Application_Date);
      if (!appDate) continue;
      fillsThisMonth += 1;
      const appDateNum = Number(appDate.replace(/-/g, ''));
      if (appDateNum >= weekStartNum) fillsThisWeek += 1;
      if (appDateNum === todayNum) fillsToday += 1;
      const utm = str(deal.utm_source).toLowerCase();
      if (utm.includes('meta')) fillsMeta += 1;
      else if (utm.includes('website')) fillsWebsite += 1;
      else fillsOthers += 1;
    }

    // Layer 2 — gallons from servercrm DWH (best-effort; zeros if unavailable).
    let gallonsToday = 0;
    let gallonsThisWeek = 0;
    let gallonsThisMonth = 0;
    let cardsToday = 0;
    let cardsThisWeek = 0;
    let cardsThisMonth = 0;
    let asOf = todayStr;
    let weekStart = weekStartStr;
    const dwhResp = await serverCrmPost<Row>('/api/agent/dwh/company-dashboard', AGENT_BODY(agentName)).catch(
      () => null,
    );
    if (ok(dwhResp, 'success')) {
      const data = ((dwhResp as Row).data as Row) ?? {};
      const meta = ((dwhResp as Row).meta as Row) ?? {};
      const gallons = (data.gallons as Row) ?? {};
      gallonsToday = num(gallons.today);
      gallonsThisWeek = num(gallons.this_week);
      gallonsThisMonth = num(gallons.this_month);
      cardsToday = num(gallons.unique_cards_today);
      cardsThisWeek = num(gallons.unique_cards_this_week);
      cardsThisMonth = num(gallons.unique_cards_this_month);
      asOf = str(meta.as_of, todayStr);
      weekStart = str(meta.week_start, weekStartStr);
    }

    return {
      status: 'success',
      data: {
        fills_today: fillsToday,
        fills_this_week: fillsThisWeek,
        fills_this_month: fillsThisMonth,
        fills_meta: fillsMeta,
        fills_website: fillsWebsite,
        fills_others: fillsOthers,
        gallons_today: gallonsToday,
        gallons_this_week: gallonsThisWeek,
        gallons_this_month: gallonsThisMonth,
        unique_cards_today: cardsToday,
        unique_cards_this_week: cardsThisWeek,
        unique_cards_this_month: cardsThisMonth,
        as_of: asOf,
        week_start: weekStart,
      },
    };
  } catch (err) {
    return { status: 'error', error: err instanceof Error ? err.message : String(err) };
  }
}
