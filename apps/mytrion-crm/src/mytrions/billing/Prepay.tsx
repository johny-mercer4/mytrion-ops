/**
 * Prepay panel — 1:1 port of the zoho widget's prepay-panel.js template (bm-prepay-panel /
 * pp-toolbar segmented controls / db-kpi-grid / db-list-header + db-row-item rows reused from
 * the Debtors panel / db-pagination / bm-modal-* + pl-* daily reconciliation ledger), scoped
 * under `.bm-root`. Read-only.
 *
 * Data is LIVE via three PG-backed REST routes (/v1/billing/prepay/*, see api/billing.ts):
 *   • fetchPrepayCompanies — the company roll-up, composed in mytrion-ops (DWH companies +
 *                            loads/draws, PG Zelle/Chase/Merchant, servercrm EFS/CMP/Maintenance).
 *   • fetchPrepayRmve      — lazy EFS-RMVE enrichment for the VISIBLE page only (the list's
 *                            baseline RMVE comes from FundStation draws and is blind to removals
 *                            done directly in EFS; this converges loaded/difference to the modal's
 *                            numbers without ~400 EFS calls up front). Proxied to servercrm.
 *   • fetchPrepayLedger    — the per-carrier daily ledger for the row→modal drill-down (proxied).
 *
 * Date-mode segmented control (day=1d / month=30d / quarter=90d rolling windows / custom range)
 * with the widget's _ymd / computeRange / _shiftYmd helpers ported verbatim. The ledger API
 * treats endDate as INCLUSIVE, so the modal shifts the (exclusive) list end back one day.
 *
 * Export: the ledger exports as a styled .xlsx (exportLedgerXlsx) — a faithful port of the zoho
 * widget's ExcelJS workbook (title / summary with live formulas / banded table / totals). ExcelJS
 * is code-split via dynamic import so it only loads when someone actually exports.
 */
import { useEffect, useMemo, useRef, useState } from 'react';

import { fetchPrepayCompanies, fetchPrepayExternals, fetchPrepayLedger, fetchPrepayRmve } from '@/api/billing';
import type { BillingPrepayCompanies, BillingPrepayLedger } from '@/api/touchpointTypes';
import { useLoad } from '../_shared/useLoad';
import { fmtCurrency } from './data';

/* ── icon path constants (verbatim from the widget template) ── */
const P_SEARCH = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
const P_CLOSE = 'M6 18L18 6M6 6l12 12';
const P_REFRESH =
  'M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-14.357-2m14.357 2H15';
const P_ERROR = 'M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z';
const P_CHEVRON_LEFT = 'M15 19l-7-7 7-7';
const P_CHEVRON_RIGHT = 'M9 5l7 7-7 7';
const P_DOWNLOAD = 'M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3';

const MONO = "'JetBrains Mono', monospace";
const ITEMS_PER_PAGE = 50;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

type DateMode = 'day' | 'month' | 'quarter' | 'custom';
const DATE_MODES: DateMode[] = ['day', 'month', 'quarter', 'custom'];
const DATE_LABELS: Record<DateMode, string> = { day: 'Day', month: 'Month', quarter: 'Quarter', custom: 'Custom' };

type DiffFilter = 'all' | 'with' | 'without';
const DIFF_FILTERS: DiffFilter[] = ['all', 'with', 'without'];
const DIFF_FILTER_LABELS: Record<DiffFilter, string> = { all: 'All', with: 'With Diff', without: 'No Diff' };

interface Range {
  startDate: string;
  endDate: string;
}

/* ── raw → view-model mapping (defensive; the servercrm envelope shape varies) ── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function toNum(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : 0;
}
function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

interface PrepayCompany {
  carrierId: string;
  companyName: string;
  billingCycle: string;
  loaded: number;
  moneyCode: number;
  maintenance: number;
  payments: number;
  difference: number;
  rmve: number;
  topUp: number;
}

/** companies/data array, {data:{companies:[…]}} (un-unwrapped envelope) or a bare array — handle all. */
function extractCompanyRows(res: BillingPrepayCompanies | null): Record<string, unknown>[] {
  const r: unknown = res;
  if (Array.isArray(r)) return r.filter(isRecord);
  if (!isRecord(r)) return [];
  if (Array.isArray(r.companies)) return r.companies.filter(isRecord);
  const data = r.data;
  if (Array.isArray(data)) return data.filter(isRecord);
  if (isRecord(data) && Array.isArray(data.companies)) return data.companies.filter(isRecord);
  return [];
}

function mapCompany(raw: Record<string, unknown>): PrepayCompany {
  return {
    carrierId: toStr(raw.carrier_id),
    companyName: toStr(raw.company_name),
    billingCycle: toStr(raw.billing_cycle),
    loaded: toNum(raw.loaded),
    moneyCode: toNum(raw.money_code),
    maintenance: toNum(raw.maintenance),
    payments: toNum(raw.payments),
    difference: toNum(raw.difference),
    rmve: toNum(raw.rmve),
    topUp: toNum(raw.top_up),
  };
}

/** billing.prepay.rmve → carrier_id → rmve map. The reply is {rmve:{…}} (server-unwrapped) or,
 *  defensively, the bare map itself; extra envelope keys are harmless (we only look up by id). */
function extractRmveMap(res: unknown): Record<string, unknown> {
  if (isRecord(res) && isRecord(res.rmve)) return res.rmve;
  if (isRecord(res)) return res;
  return {};
}

interface Externals {
  money_code?: number;
  maintenance?: number;
  stripe?: number;
}
/** /billing/prepay/externals → carrier_id → {money_code, maintenance, stripe}. Reply is
 *  {externals:{…}} or, defensively, the bare map. */
function extractExternalsMap(res: unknown): Record<string, Externals> {
  const src =
    isRecord(res) && isRecord(res.externals) ? res.externals : isRecord(res) ? res : {};
  const out: Record<string, Externals> = {};
  for (const [k, v] of Object.entries(src)) if (isRecord(v)) out[k] = v as Externals;
  return out;
}

interface LedgerRow {
  date: string;
  topUp: number;
  rmve: number;
  moneyCode: number;
  maintenance: number;
  stripe: number;
  zelle: number;
  chase: number;
  merchant: number;
  difference: number;
}
interface LedgerTotals {
  topUp: number;
  rmve: number;
  moneyCode: number;
  maintenance: number;
  stripe: number;
  zelle: number;
  chase: number;
  merchant: number;
  net: number;
}
interface Ledger {
  rows: LedgerRow[];
  totals: LedgerTotals;
  warnings: string[];
}

function mapLedgerRow(raw: Record<string, unknown>): LedgerRow {
  return {
    date: toStr(raw.date),
    topUp: toNum(raw.top_up),
    rmve: toNum(raw.rmve),
    moneyCode: toNum(raw.money_code),
    maintenance: toNum(raw.maintenance),
    stripe: toNum(raw.stripe),
    zelle: toNum(raw.zelle),
    chase: toNum(raw.chase),
    merchant: toNum(raw.merchant),
    difference: toNum(raw.difference),
  };
}

/** Ledger endpoint returns { rows, totals, warnings, … } at top level (widget parity). */
function extractLedger(res: BillingPrepayLedger | null): Ledger {
  const r: unknown = res;
  const rowsRaw = isRecord(r) && Array.isArray(r.rows) ? r.rows : isRecord(r) && Array.isArray(r.data) ? r.data : [];
  const rows = rowsRaw.filter(isRecord).map(mapLedgerRow);
  const t = isRecord(r) && isRecord(r.totals) ? r.totals : {};
  const totals: LedgerTotals = {
    topUp: toNum(t.top_up),
    rmve: toNum(t.rmve),
    moneyCode: toNum(t.money_code),
    maintenance: toNum(t.maintenance),
    stripe: toNum(t.stripe),
    zelle: toNum(t.zelle),
    chase: toNum(t.chase),
    merchant: toNum(t.merchant),
    net: toNum(t.net),
  };
  const warnings = isRecord(r) && Array.isArray(r.warnings) ? r.warnings.map(toStr) : [];
  return { rows, totals, warnings };
}

/* ── date helpers (ported verbatim from the widget: _ymd / _shiftYmd / computeRange) ── */

function ymd(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}
function shiftYmd(s: string, n: number): string {
  if (!s) return s;
  const d = new Date(s + 'T00:00:00');
  d.setDate(d.getDate() + n);
  return ymd(d);
}
function computeRange(mode: DateMode, customStart: string, customEnd: string): Range | null {
  const now = new Date();
  const end = new Date(now);
  end.setDate(end.getDate() + 1); // through today (exclusive tomorrow)
  const endYmd = ymd(end);
  if (mode === 'custom') {
    if (!customStart || !customEnd) return null;
    const e = new Date(customEnd);
    e.setDate(e.getDate() + 1); // end-inclusive
    return { startDate: customStart, endDate: ymd(e) };
  }
  // Rolling windows ending today (calendar "this month" is empty early in a month for prepay).
  const backDays = mode === 'day' ? 1 : mode === 'quarter' ? 90 : 30;
  const s = new Date(now);
  s.setDate(s.getDate() - backDays + 1);
  return { startDate: ymd(s), endDate: endYmd };
}

/* ── display helpers ── */

// Ledger cell: dash for zero/empty, currency otherwise (matches the finance sheet).
function cell(n: number): string {
  return n === 0 ? '—' : fmtCurrency(n);
}
// 'YYYY-MM-DD' → 'Jun 11' without Date() (avoids UTC-parse day shifts).
function formatDay(s: string): string {
  if (!s) return '—';
  const parts = s.split('-');
  const mp = parts[1];
  const dp = parts[2];
  if (mp === undefined || dp === undefined) return s;
  const mon = MONTHS[parseInt(mp, 10) - 1] || mp;
  return mon + ' ' + parseInt(dp, 10);
}
// Sub-cent differences are rounding noise, not a real imbalance.
function hasDiff(c: PrepayCompany): boolean {
  return Math.abs(c.difference) >= 0.005;
}
function diffClass(d: number | null): string {
  if (d == null) return '';
  return d > 0 ? 'text-danger' : 'text-info';
}

/* ═══════════════════════════ Panel ═══════════════════════════ */

export function Prepay() {
  const [companies, setCompanies] = useState<PrepayCompany[]>([]);
  const [search, setSearch] = useState('');
  const [diffFilter, setDiffFilter] = useState<DiffFilter>('all');
  const [pageNum, setPageNum] = useState(1);

  const [dateMode, setDateMode] = useState<DateMode>('month');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  // The range actually applied to the query. Custom mode only applies on "Apply" (widget parity),
  // so switching to custom keeps the previous window's rows visible until dates are chosen.
  const [appliedRange, setAppliedRange] = useState<Range | null>(() => computeRange('month', '', ''));
  const [freshTick, setFreshTick] = useState(0);

  const [selected, setSelected] = useState<PrepayCompany | null>(null);
  const [rmveSyncing, setRmveSyncing] = useState(false);
  const [externalsSyncing, setExternalsSyncing] = useState(false);
  const externalsToken = useRef(0); // bumps on every list (re)fetch — stales in-flight externals

  // Non-reactive lazy-RMVE bookkeeping (kept off render state so patching it can't re-trigger the
  // enrichment effect — mirrors the widget's created() fields).
  const rmveChecked = useRef<Record<string, boolean>>({});
  const rmveToken = useRef(0); // bumps on every list (re)fetch — stales in-flight batches
  const listRange = useRef<Range | null>(null); // the exact range the current list was fetched with
  const freshRef = useRef(false); // whether the pending companies load bypasses the server cache
  const rmveFreshRef = useRef(false); // Refresh: the next enrich batch bypasses the RMVE cache too

  const load = useLoad<BillingPrepayCompanies>(() => {
    const r = appliedRange;
    if (!r) return Promise.resolve<BillingPrepayCompanies>({});
    // Composed in mytrion-ops (DWH + PG + servercrm externals); always fresh (no cache).
    return fetchPrepayCompanies(r.startDate, r.endDate);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appliedRange?.startDate, appliedRange?.endDate, freshTick]);

  const loading = load.loading;
  // While EFS-RMVE or the deferred externals batch are in flight, the loaded/payments/difference
  // are still being computed — show a skeleton in those cells instead of interim numbers so users
  // don't read half-calculated values as final.
  const enriching = rmveSyncing || externalsSyncing;

  // Sync fetched rows into local state (kept mutable so RMVE enrichment can patch rows in place).
  useEffect(() => {
    if (!load.data) return;
    setCompanies(extractCompanyRows(load.data).map(mapCompany));
    setPageNum(1);
    // Fresh list → all rows un-checked again; stale in-flight RMVE batches (older token) must not
    // patch the new rows. Explicit Refresh → the visible page's RMVE recomputes fresh too.
    rmveChecked.current = {};
    rmveToken.current += 1;
    externalsToken.current += 1;
    listRange.current = appliedRange;
    // Carry the just-used fetch-fresh flag over to the enrichment batch, then consume it — so an
    // explicit Refresh recomputes the visible page's EFS RMVE live, while page turns use the cache.
    rmveFreshRef.current = freshRef.current;
    freshRef.current = false;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.data]);

  const searchFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return companies;
    return companies.filter((c) => c.carrierId.toLowerCase().includes(q) || c.companyName.toLowerCase().includes(q));
  }, [companies, search]);

  // Filter-button counts are search-scoped so they always add up to what the search would list.
  const diffCounts = useMemo<Record<DiffFilter, number>>(() => {
    const withN = searchFiltered.filter(hasDiff).length;
    return { all: searchFiltered.length, with: withN, without: searchFiltered.length - withN };
  }, [searchFiltered]);

  const filtered = useMemo(() => {
    if (diffFilter === 'with') return searchFiltered.filter(hasDiff);
    if (diffFilter === 'without') return searchFiltered.filter((c) => !hasDiff(c));
    return searchFiltered;
  }, [searchFiltered, diffFilter]);

  // KPIs reflect the CURRENT filtered view, not the full book (widget parity).
  const kpi = useMemo(
    () => ({
      totalCompanies: filtered.length,
      totalLoaded: filtered.reduce((s, c) => s + c.loaded, 0),
      totalPaid: filtered.reduce((s, c) => s + c.payments, 0),
    }),
    [filtered],
  );

  const totalPages = Math.max(1, Math.ceil(filtered.length / ITEMS_PER_PAGE));
  const currentPage = Math.min(pageNum, totalPages);
  const paginated = useMemo(
    () => filtered.slice((currentPage - 1) * ITEMS_PER_PAGE, currentPage * ITEMS_PER_PAGE),
    [filtered, currentPage],
  );

  // Reset to page 1 whenever a filter/search changes (the widget's watchers).
  useEffect(() => {
    setPageNum(1);
  }, [search, diffFilter]);

  // Whatever brings new rows into view (page turn, search, filter, fresh fetch) queues them for
  // live-EFS RMVE. Already-checked rows are skipped, so the in-place patches can't loop the effect.
  useEffect(() => {
    const range = listRange.current;
    if (!range) return;
    const targets = paginated.filter((c) => !rmveChecked.current[c.carrierId]).map((c) => c.carrierId);
    if (targets.length === 0) return;
    for (const id of targets) rmveChecked.current[id] = true;
    const token = rmveToken.current;
    const useFresh = rmveFreshRef.current;
    rmveFreshRef.current = false; // one batch only — the page visible at Refresh time
    let cancelled = false;
    setRmveSyncing(true);
    void (async () => {
      try {
        const res = await fetchPrepayRmve(targets.join(','), range.startDate, range.endDate, useFresh);
        if (token !== rmveToken.current) return; // list was refetched meanwhile
        const map = extractRmveMap(res);
        setCompanies((prev) => {
          let changed = false;
          const next = prev.map((c) => {
            const v = map[c.carrierId];
            if (v == null) return c; // EFS failed for this carrier → keep baseline
            const rmve = toNum(v);
            if (rmve === c.rmve) return c;
            changed = true;
            const loaded = round2(c.topUp - rmve + c.maintenance + c.moneyCode);
            return { ...c, rmve, loaded, difference: round2(loaded - c.payments) };
          });
          return changed ? next : prev;
        });
      } catch {
        // Transport failure: un-mark so revisiting the page retries.
        if (token === rmveToken.current) for (const id of targets) delete rmveChecked.current[id];
      } finally {
        if (token === rmveToken.current && !cancelled) setRmveSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paginated]);

  // Deferred externals (EFS money codes + Zoho Maintenance + CMP Stripe) — the slow ~7s source split
  // out of the companies endpoint so the list shows fast. Fired ONCE per list load (account-wide,
  // not per-page), then patched into every row: money_code/maintenance recompute `loaded`, stripe
  // adds into `payments`. Token-guarded so a stale batch can't patch a newer list.
  useEffect(() => {
    if (!load.data) return;
    const range = listRange.current;
    if (!range) return;
    const token = externalsToken.current;
    let cancelled = false;
    setExternalsSyncing(true);
    void (async () => {
      try {
        const res = await fetchPrepayExternals(range.startDate, range.endDate);
        if (token !== externalsToken.current) return; // list was refetched meanwhile
        const map = extractExternalsMap(res);
        setCompanies((prev) => {
          let changed = false;
          const next = prev.map((c) => {
            const e = map[c.carrierId];
            if (!e) return c;
            const moneyCode = round2(toNum(e.money_code));
            const maintenance = round2(toNum(e.maintenance));
            const stripe = round2(toNum(e.stripe));
            if (moneyCode === 0 && maintenance === 0 && stripe === 0) return c;
            changed = true;
            const loaded = round2(c.topUp - c.rmve + maintenance + moneyCode);
            const payments = round2(c.payments + stripe); // base excludes stripe; add once (token-guarded)
            return { ...c, moneyCode, maintenance, loaded, payments, difference: round2(loaded - payments) };
          });
          return changed ? next : prev;
        });
      } catch {
        // Externals failed → keep the DWH+PG baseline (money_code/maintenance/stripe = 0).
      } finally {
        if (token === externalsToken.current && !cancelled) setExternalsSyncing(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [load.data]);

  const rangeLabel = useMemo(() => {
    if (dateMode === 'custom') return customStart && customEnd ? `${customStart} → ${customEnd}` : 'custom';
    if (dateMode === 'day') return 'today';
    if (dateMode === 'quarter') return 'last 90 days';
    return 'last 30 days';
  }, [dateMode, customStart, customEnd]);

  function setMode(m: DateMode) {
    setDateMode(m);
    if (m !== 'custom') {
      freshRef.current = false;
      const r = computeRange(m, customStart, customEnd);
      if (r) setAppliedRange(r);
    }
  }

  function applyCustom() {
    const r = computeRange('custom', customStart, customEnd);
    if (r) {
      freshRef.current = false;
      setAppliedRange(r);
    }
  }

  // Refresh / Try Again: recompute "now" for the current mode and bypass the server cache. The
  // freshTick forces a refetch even when the range is unchanged (e.g. same day, same mode).
  function refresh() {
    freshRef.current = true;
    const r = computeRange(dateMode, customStart, customEnd);
    if (r) setAppliedRange(r);
    setFreshTick((t) => t + 1);
  }

  function prevPage() {
    if (currentPage > 1) setPageNum(currentPage - 1);
  }
  function nextPage() {
    if (currentPage < totalPages) setPageNum(currentPage + 1);
  }

  return (
    <div className="bm-panel bm-prepay-panel">
      {/* ── Header ── */}
      <div className="bm-header-row">
        <div>
          <h2 className="bm-title">Prepay Companies</h2>
          <div className="bm-subtitle">
            Companies on prepay terms — open a company for its daily reconciliation ledger
          </div>
        </div>
      </div>

      {/* ── Toolbar: every filter on one row (mirrors the Returns tab) ── */}
      <div className="pp-toolbar">
        <div className="pp-seg">
          {DATE_MODES.map((m) => (
            <button key={m} className={dateMode === m ? 'pp-seg-active' : undefined} onClick={() => setMode(m)}>
              {DATE_LABELS[m]}
            </button>
          ))}
        </div>

        <div className="pp-seg">
          {DIFF_FILTERS.map((f) => (
            <button key={f} className={diffFilter === f ? 'pp-seg-active' : undefined} onClick={() => setDiffFilter(f)}>
              {DIFF_FILTER_LABELS[f]} ({diffCounts[f]})
            </button>
          ))}
        </div>

        <div className="db-search-wrap">
          <svg className="db-search-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_SEARCH} />
          </svg>
          <input
            type="text"
            className="db-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search Carrier ID or Company..."
          />
          {search ? (
            <button className="db-search-clear" onClick={() => setSearch('')}>
              <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CLOSE} />
              </svg>
            </button>
          ) : null}
        </div>

        <button className="bm-refresh-btn" onClick={refresh} disabled={loading}>
          <svg
            className={loading ? 'spin-icon' : undefined}
            width="14"
            height="14"
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_REFRESH} />
          </svg>
          Refresh
        </button>
      </div>

      {/* Custom date range */}
      {dateMode === 'custom' ? (
        <div className="pp-daterange">
          <label>
            From <input type="date" value={customStart} onChange={(e) => setCustomStart(e.target.value)} />
          </label>
          <label>
            To <input type="date" value={customEnd} onChange={(e) => setCustomEnd(e.target.value)} />
          </label>
          <button className="pp-apply" disabled={!customStart || !customEnd || loading} onClick={applyCustom}>
            Apply
          </button>
        </div>
      ) : null}

      {/* ── KPI Banner ── */}
      <div className="db-kpi-grid">
        <div className="db-kpi-card">
          <div className="db-kpi-title">Prepay Companies</div>
          <div className="db-kpi-value">{kpi.totalCompanies}</div>
        </div>
        <div className="db-kpi-card">
          <div className="db-kpi-title">
            Total Loaded <span className="db-kpi-badge">{rangeLabel}</span>
          </div>
          <div className="db-kpi-value">
            {enriching ? <span className="pp-cell-skeleton pp-cell-skeleton-lg" /> : fmtCurrency(kpi.totalLoaded)}
          </div>
        </div>
        <div className="db-kpi-card">
          <div className="db-kpi-title">
            Total Payments <span className="db-kpi-badge">{rangeLabel}</span>
          </div>
          <div className="db-kpi-value text-info">
            {enriching ? <span className="pp-cell-skeleton pp-cell-skeleton-lg" /> : fmtCurrency(kpi.totalPaid)}
          </div>
        </div>
      </div>

      {/* ── Loading / Error / Data ── */}
      {loading && companies.length === 0 ? (
        <div className="bm-initial-loader">
          <div className="bm-loader-ring" />
          <div>
            <div className="bm-loader-text">Loading Prepay Companies</div>
            <div className="bm-loader-sub">Querying the data warehouse...</div>
          </div>
        </div>
      ) : load.error ? (
        <div className="db-error-state">
          <svg width="32" height="32" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_ERROR} />
          </svg>
          <div className="db-error-msg">{load.error}</div>
          <button className="bm-refresh-btn" onClick={refresh} style={{ width: 'fit-content', marginTop: '0.5rem' }}>
            Try Again
          </button>
        </div>
      ) : (
        <div className="db-content-area">
          <div className="db-list-header">
            <div className="db-col-carrier">Carrier</div>
            <div className="db-col-company">Company Name</div>
            <div className="db-col-count">
              Loaded <span style={{ opacity: 0.6 }}>({rangeLabel})</span>
            </div>
            <div className="db-col-count">
              Payments <span style={{ opacity: 0.6 }}>({rangeLabel})</span>
            </div>
            <div className="db-col-owed">
              Difference
              {rmveSyncing || externalsSyncing ? (
                <span style={{ fontSize: '0.6rem', color: 'var(--text-muted)', fontWeight: 400 }}>
                  {' · '}
                  {externalsSyncing ? 'syncing EFS / Stripe…' : 'syncing EFS…'}
                </span>
              ) : null}
            </div>
          </div>

          {paginated.length > 0 ? (
            <>
              {paginated.map((c) => (
                <div className="db-row-item" key={c.carrierId}>
                  <div className="db-row-main" onClick={() => setSelected(c)}>
                    <div className="db-col-carrier db-carrier-id">{c.carrierId}</div>
                    <div className="db-col-company">
                      <div className="db-company-name">{c.companyName}</div>
                      {c.billingCycle ? (
                        <div style={{ fontSize: '0.65rem', color: 'var(--text-muted)' }}>{c.billingCycle}</div>
                      ) : null}
                    </div>
                    <div className="db-col-count">
                      {enriching ? (
                        <span className="pp-cell-skeleton" />
                      ) : (
                        <>
                          <div className="db-money-muted">{fmtCurrency(c.loaded)}</div>
                          {c.moneyCode || c.maintenance ? (
                            <div style={{ fontSize: '0.62rem', color: 'var(--text-muted)' }}>
                              {c.moneyCode ? <>MC {fmtCurrency(c.moneyCode)}</> : null}
                              {c.maintenance ? <> · Maint {fmtCurrency(c.maintenance)}</> : null}
                            </div>
                          ) : null}
                        </>
                      )}
                    </div>
                    <div className="db-col-count">
                      {enriching ? (
                        <span className="pp-cell-skeleton" />
                      ) : (
                        <div className="db-money-muted text-info">{fmtCurrency(c.payments)}</div>
                      )}
                    </div>
                    <div className={`db-col-owed db-money-bold ${enriching ? '' : diffClass(c.difference)}`}>
                      {enriching ? <span className="pp-cell-skeleton" /> : fmtCurrency(c.difference)}
                    </div>
                  </div>
                </div>
              ))}

              {filtered.length > ITEMS_PER_PAGE ? (
                <div className="db-pagination">
                  <div className="db-page-info">
                    Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} -{' '}
                    {Math.min(currentPage * ITEMS_PER_PAGE, filtered.length)} of {filtered.length} companies
                  </div>
                  <div className="db-page-actions">
                    <button className="db-page-btn" onClick={prevPage} disabled={currentPage === 1}>
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CHEVRON_LEFT} />
                      </svg>
                      Prev
                    </button>
                    <span className="db-page-current">
                      Page {currentPage} of {totalPages}
                    </span>
                    <button className="db-page-btn" onClick={nextPage} disabled={currentPage === totalPages}>
                      Next
                      <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CHEVRON_RIGHT} />
                      </svg>
                    </button>
                  </div>
                </div>
              ) : null}
            </>
          ) : (
            <div className="db-empty-state">No prepay companies match your filters.</div>
          )}
        </div>
      )}

      {/* ── Modal: daily reconciliation ledger ── */}
      {selected && appliedRange ? (
        <PrepayLedgerModal
          company={selected}
          range={appliedRange}
          rangeLabel={rangeLabel}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

/* ═══════════════════════ Ledger modal ═══════════════════════ */

/**
 * Styled .xlsx export — a faithful port of the widget's _buildLedgerWorkbook (prepay-panel.js):
 * title block, summary with live formulas, dark banded table, totals row with SUM formulas +
 * cached results, frozen header, autofilter. ExcelJS is code-split (dynamic import) so it only
 * loads when someone actually exports.
 */
async function exportLedgerXlsx(
  company: PrepayCompany,
  detailRange: { start: string; end: string },
  ledger: Ledger,
): Promise<void> {
  const ExcelJS = (await import('exceljs')).default;

  const F = 'Arial';
  const C = {
    ink: 'FF0F172A', body: 'FF334155', muted: 'FF64748B', faint: 'FF94A3B8',
    headFill: 'FF1E293B', band: 'FFF8FAFC', totalFill: 'FFF1F5F9',
    red: 'FFDC2626', blue: 'FF2563EB', line: 'FFE2E8F0', white: 'FFFFFFFF',
  };
  const MONEY = '$#,##0.00;[Red]($#,##0.00);"–"';
  const num = (v: number) => Math.round((Number(v) || 0) * 100) / 100;
  // UTC-anchored: ExcelJS serialises Dates via their UTC value, so a local-midnight Date west/
  // east of UTC would shift ±1 day.
  const ymdToDate = (ymd: string) => {
    const [y, m, d] = String(ymd).split('-').map(Number);
    return new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1));
  };
  const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fmtDay = (ymd: string) => {
    const [y, m, d] = String(ymd).split('-');
    return (MONTHS[Number(m) - 1] ?? m ?? '') + ' ' + Number(d) + ', ' + (y ?? '');
  };

  const rows = ledger.rows;
  const t = ledger.totals;
  const warnings = ledger.warnings;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Ledger', {
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 },
  });
  ws.columns = [
    { width: 12 }, { width: 12.5 }, { width: 12.5 }, { width: 12.5 }, { width: 12.5 },
    { width: 12.5 }, { width: 12.5 }, { width: 12.5 }, { width: 12.5 }, { width: 14 },
  ];

  let r = 1;
  const merge = (row: number) => ws.mergeCells('A' + row + ':J' + row);

  // Title block
  merge(r);
  ws.getCell('A' + r).value = 'PREPAY RECONCILIATION LEDGER';
  ws.getCell('A' + r).font = { name: F, size: 9, bold: true, color: { argb: C.muted } };
  r++;

  merge(r);
  ws.getCell('A' + r).value = {
    richText: [
      { text: company.companyName, font: { name: F, size: 16, bold: true, color: { argb: C.ink } } },
      { text: '   #' + company.carrierId, font: { name: F, size: 11, color: { argb: C.faint } } },
    ],
  };
  ws.getRow(r).height = 22;
  r++;

  merge(r);
  const metaBits = ['Period: ' + fmtDay(detailRange.start) + ' – ' + fmtDay(detailRange.end)];
  if (company.billingCycle) metaBits.push('Billing Cycle: ' + company.billingCycle);
  metaBits.push('Generated: ' + new Date().toLocaleString('en-US', { dateStyle: 'medium', timeStyle: 'short' }));
  ws.getCell('A' + r).value = metaBits.join('   ·   ');
  ws.getCell('A' + r).font = { name: F, size: 9, color: { argb: C.muted } };
  r++;

  if (warnings.length) {
    merge(r);
    ws.getCell('A' + r).value = '⚠ Some sources were unavailable and count as 0: ' + warnings.join('; ');
    ws.getCell('A' + r).font = { name: F, size: 9, italic: true, color: { argb: 'FFB45309' } };
    r++;
  }

  ws.getRow(r).height = 6;
  r++; // spacer

  // Summary block (values become formulas referencing the totals row)
  const summaryStart = r;
  const summary: [string, string][] = [
    ['Total Loaded', '= Top Up − RMVE + Money Code + Maintenance'],
    ['Total Payments', '= Stripe + Zelle + Chase + Merchant'],
    ['Net Difference', '= Loaded − Payments   (positive: paid less than loaded · negative: paid more)'],
  ];
  for (const [label, note] of summary) {
    ws.getCell('A' + r).value = label;
    ws.getCell('A' + r).font = { name: F, size: 10, bold: true, color: { argb: C.body } };
    ws.getCell('B' + r).numFmt = MONEY;
    ws.getCell('B' + r).font = { name: F, size: 11, bold: true, color: { argb: C.ink } };
    ws.mergeCells('C' + r + ':J' + r);
    ws.getCell('C' + r).value = note;
    ws.getCell('C' + r).font = { name: F, size: 9, italic: true, color: { argb: C.faint } };
    r++;
  }

  ws.getRow(r).height = 6;
  r++; // spacer

  // Table header
  const headerRow = r;
  const header = ['Date', 'Top Up', 'RMVE', 'Money Code', 'Maintenance', 'Stripe', 'Zelle', 'Chase', 'Merchant', 'Difference'];
  header.forEach((h, i) => {
    const cell = ws.getCell(headerRow, i + 1);
    cell.value = h;
    cell.font = { name: F, size: 10, bold: true, color: { argb: C.white } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.headFill } };
    cell.alignment = { horizontal: i === 0 ? 'left' : 'right', vertical: 'middle' };
  });
  ws.getRow(headerRow).height = 20;
  ws.autoFilter = { from: { row: headerRow, column: 1 }, to: { row: headerRow, column: 10 } };
  r++;

  // Data rows
  const dataStart = r;
  for (let i = 0; i < rows.length; i++) {
    const d = rows[i];
    if (!d) continue;
    const row = ws.getRow(r);
    row.getCell(1).value = ymdToDate(d.date);
    row.getCell(1).numFmt = 'mmm d';
    const vals = [d.topUp, d.rmve, d.moneyCode, d.maintenance, d.stripe, d.zelle, d.chase, d.merchant, d.difference];
    vals.forEach((v, j) => {
      const cell = row.getCell(j + 2);
      cell.value = num(v);
      cell.numFmt = MONEY;
    });
    for (let cIdx = 1; cIdx <= 10; cIdx++) {
      const cell = row.getCell(cIdx);
      cell.font = { name: F, size: 10, color: { argb: C.body } };
      if (i % 2 === 1) cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.band } };
      cell.border = { bottom: { style: 'hair', color: { argb: C.line } } };
    }
    const diff = num(d.difference);
    row.getCell(10).font = {
      name: F, size: 10, bold: true,
      color: { argb: diff > 0 ? C.red : diff < 0 ? C.blue : C.faint },
    };
    r++;
  }
  const dataEnd = r - 1;

  // Totals row — SUM formulas WITH cached results (viewers that never recalc still show totals).
  const totalRow = ws.getRow(r);
  totalRow.getCell(1).value = 'Total';
  const totalKeys: (keyof LedgerTotals)[] = ['topUp', 'rmve', 'moneyCode', 'maintenance', 'stripe', 'zelle', 'chase', 'merchant'];
  for (let cIdx = 2; cIdx <= 9; cIdx++) {
    const col = String.fromCharCode(64 + cIdx);
    const key = totalKeys[cIdx - 2] as keyof LedgerTotals;
    totalRow.getCell(cIdx).value =
      dataEnd >= dataStart
        ? { formula: 'SUM(' + col + dataStart + ':' + col + dataEnd + ')', result: num(t[key]) }
        : 0;
    totalRow.getCell(cIdx).numFmt = MONEY;
  }
  totalRow.getCell(10).value = dataEnd >= dataStart ? { formula: 'J' + dataEnd, result: num(t.net) } : 0;
  totalRow.getCell(10).numFmt = MONEY;
  const netVal = num(t.net);
  const netColor = netVal > 0 ? C.red : netVal < 0 ? C.blue : C.ink;
  for (let cIdx = 1; cIdx <= 10; cIdx++) {
    const cell = totalRow.getCell(cIdx);
    cell.font = { name: F, size: 10, bold: true, color: { argb: C.ink } };
    cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: C.totalFill } };
    cell.border = { top: { style: 'medium', color: { argb: C.headFill } } };
  }
  totalRow.getCell(10).font = { name: F, size: 10, bold: true, color: { argb: netColor } };

  // Summary values reference the totals row (cached results, same reason)
  const loadedVal = num(num(t.topUp) - num(t.rmve) + num(t.moneyCode) + num(t.maintenance));
  const paymentsVal = num(num(t.stripe) + num(t.zelle) + num(t.chase) + num(t.merchant));
  ws.getCell('B' + summaryStart).value = { formula: 'B' + r + '-C' + r + '+D' + r + '+E' + r, result: loadedVal };
  ws.getCell('B' + (summaryStart + 1)).value = { formula: 'F' + r + '+G' + r + '+H' + r + '+I' + r, result: paymentsVal };
  ws.getCell('B' + (summaryStart + 2)).value = { formula: 'B' + summaryStart + '-B' + (summaryStart + 1), result: num(loadedVal - paymentsVal) };
  ws.getCell('B' + (summaryStart + 2)).font = { name: F, size: 11, bold: true, color: { argb: netColor } };

  wb.calcProperties.fullCalcOnLoad = true;
  ws.views = [{ state: 'frozen', ySplit: headerRow }];

  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const safe = company.companyName.replace(/[^A-Za-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'company';
  const fname = `Prepay_Ledger_${company.carrierId}_${safe}_${detailRange.start}_${detailRange.end}.xlsx`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fname;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

function PrepayLedgerModal({
  company,
  range,
  rangeLabel,
  onClose,
}: {
  company: PrepayCompany;
  range: Range;
  rangeLabel: string;
  onClose: () => void;
}) {
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  // computeRange() returns an EXCLUSIVE end (+1 day, for the list SQL); the ledger API treats
  // endDate as INCLUSIVE — shift back one day so e.g. a custom To=Jun 27 doesn't render a Jun 28 row.
  const detailRange = useMemo(
    () => ({ start: range.startDate, end: shiftYmd(range.endDate, -1) }),
    [range.startDate, range.endDate],
  );

  const load = useLoad<BillingPrepayLedger>(
    () => fetchPrepayLedger(company.carrierId, detailRange.start, detailRange.end),
    [company.carrierId, detailRange.start, detailRange.end],
  );

  const ledger = useMemo(() => (load.data ? extractLedger(load.data) : null), [load.data]);

  // Styled .xlsx export (matches the zoho widget's ExcelJS ledger workbook).
  function downloadExcel() {
    if (!ledger || exporting) return;
    setExporting(true);
    exportLedgerXlsx(company, detailRange, ledger)
      .catch((e: unknown) => {
        // eslint-disable-next-line no-console
        console.error('Prepay Excel export failed:', e);
        alert('Excel export failed: ' + (e instanceof Error ? e.message : String(e)));
      })
      .finally(() => setExporting(false));
  }

  return (
    <div className="bm-modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bm-modal-box" style={{ maxWidth: 1180 }}>
        <div className="bm-modal-header">
          <h3 className="bm-modal-title">
            {company.companyName}
            <span style={{ fontSize: '0.6875rem', color: 'var(--text-muted)', marginLeft: '0.5rem', fontFamily: MONO }}>
              #{company.carrierId}
            </span>
          </h3>
          <button
            className="bm-refresh-btn"
            style={{ marginLeft: 'auto', marginRight: '0.75rem' }}
            disabled={load.loading || !ledger || exporting}
            onClick={downloadExcel}
          >
            <svg width="14" height="14" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_DOWNLOAD} />
            </svg>
            {exporting ? 'Exporting…' : 'Excel'}
          </button>
          <button className="bm-modal-close" onClick={onClose}>
            <svg width="18" height="18" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CLOSE} />
            </svg>
          </button>
        </div>

        <div className="bm-modal-body" style={{ padding: '1rem 1.25rem' }}>
          {load.loading ? (
            <div className="bm-initial-loader" style={{ padding: '2rem 0' }}>
              <div className="bm-loader-ring" />
              <div className="bm-loader-text">Loading details…</div>
            </div>
          ) : ledger ? (
            <>
              {/* Summary line: period + net running difference */}
              <div className="pl-summary">
                <span className="pl-range">{rangeLabel}</span>
                <span className="pl-net">
                  Net difference: <b className={diffClass(ledger.totals.net)}>{fmtCurrency(ledger.totals.net)}</b>
                </span>
              </div>
              {ledger.warnings.length ? (
                <div className="pl-warn" title={ledger.warnings.join(', ')}>
                  ⚠ {ledger.warnings.length} source(s) unavailable this load — shown as 0. Hover for details.
                </div>
              ) : null}

              {/* Daily ledger */}
              <div className="pl-wrap">
                <table className="pl-table">
                  <thead>
                    <tr>
                      <th className="pl-l">Date</th>
                      <th>Top Up</th>
                      <th>RMVE</th>
                      <th>Money Code</th>
                      <th>Maintenance</th>
                      <th>Stripe</th>
                      <th>Zelle</th>
                      <th>Chase</th>
                      <th>Merchant</th>
                      <th className="pl-diff-h">Difference</th>
                    </tr>
                  </thead>
                  <tbody>
                    {ledger.rows.length > 0 ? (
                      ledger.rows.map((r) => (
                        <tr key={r.date}>
                          <td className="pl-l pl-date">{formatDay(r.date)}</td>
                          <td>{cell(r.topUp)}</td>
                          <td>{cell(r.rmve)}</td>
                          <td>{cell(r.moneyCode)}</td>
                          <td>{cell(r.maintenance)}</td>
                          <td>{cell(r.stripe)}</td>
                          <td>{cell(r.zelle)}</td>
                          <td>{cell(r.chase)}</td>
                          <td>{cell(r.merchant)}</td>
                          {/* Difference = cumulative running balance; the Total row shows the same final net. */}
                          <td className={`pl-diff ${diffClass(r.difference)}`}>{cell(r.difference)}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td className="pl-empty" colSpan={10}>
                          No activity in this period.
                        </td>
                      </tr>
                    )}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className="pl-l">Total</td>
                      <td>{cell(ledger.totals.topUp)}</td>
                      <td>{cell(ledger.totals.rmve)}</td>
                      <td>{cell(ledger.totals.moneyCode)}</td>
                      <td>{cell(ledger.totals.maintenance)}</td>
                      <td>{cell(ledger.totals.stripe)}</td>
                      <td>{cell(ledger.totals.zelle)}</td>
                      <td>{cell(ledger.totals.chase)}</td>
                      <td>{cell(ledger.totals.merchant)}</td>
                      <td className={`pl-diff ${diffClass(ledger.totals.net)}`}>{cell(ledger.totals.net)}</td>
                    </tr>
                  </tfoot>
                </table>
              </div>
            </>
          ) : (
            <div className="db-error-state">
              <div className="db-error-msg">{load.error || 'Failed to load details.'}</div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
