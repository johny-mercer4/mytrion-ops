import { useDeferredValue, useMemo, useState } from 'react';
import { ChevronRight, RefreshCw, Search, Users } from 'lucide-react';
import { formatCachedAt, useCachedLoad } from '../../_shared/swrCache';
import { listFinanceClients, type FinanceClient } from '../../../api/finance';
import { ClientModal } from '../ClientModal';
import { financeKeys, STALE } from '../panelBits';
import { dash, money0, num } from '../financeFormat';

/**
 * Finance → Clients. Every carrier, with payment terms and computed debt.
 *
 * Speed is the design constraint. The roster is ~8,000 rows, so:
 *   • the server sends a LEAN row (10 fields) and the modal fetches the rest on open;
 *   • filtering and search run client-side over the loaded array — no round-trip per keystroke;
 *   • the search term goes through `useDeferredValue`, so typing never blocks on re-filtering 8k rows;
 *   • the list renders in windows of PAGE — 8,000 DOM rows would stall the whole shell.
 *
 * Debt here is the SAME cmp_invoice computation Billing and Sales use (see the backend
 * financeClients.ts header) — never `dim_company.debt_amount`, which is stale.
 */

const PAGE = 50;

type TermsFilter = 'all' | 'LOC' | 'Prepay' | 'none';
type DebtFilter = 'all' | 'debtors' | 'clear';

const TERMS: { id: TermsFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'LOC', label: 'LOC' },
  { id: 'Prepay', label: 'Prepay' },
  { id: 'none', label: 'Not set' },
];
const DEBT: { id: DebtFilter; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'debtors', label: 'Debtors' },
  { id: 'clear', label: 'No debt' },
];

/** Billing-type chips are derived from the data so a new CMP value can't silently disappear. */
function billingTypes(rows: FinanceClient[]): string[] {
  const set = new Set<string>();
  for (const r of rows) if (r.billingType) set.add(r.billingType);
  return [...set].sort((a, b) => a.localeCompare(b));
}

export function FinanceClients() {
  const [q, setQ] = useState('');
  const [terms, setTerms] = useState<TermsFilter>('all');
  const [debt, setDebt] = useState<DebtFilter>('all');
  const [billing, setBilling] = useState<string | null>(null);
  const [shown, setShown] = useState(PAGE);
  const [openCarrier, setOpenCarrier] = useState<FinanceClient | null>(null);

  /**
   * Cached: this payload is ~1.6 MB and the API does not gzip, so leaving the tab and coming back used
   * to re-download all 8k rows. The Refresh button now forces a revalidation instead of being the only
   * way the list is ever fetched.
   */
  const load = useCachedLoad(financeKeys.roster(), () => listFinanceClients(), {
    staleMs: STALE.ROSTER,
  });
  const rows = useMemo(() => load.data?.clients ?? [], [load.data]);

  // Typing stays responsive: React renders the keystroke immediately and re-filters at lower
  // priority, so an 8k-row pass never blocks the input.
  const deferredQ = useDeferredValue(q);

  const filtered = useMemo(() => {
    const needle = deferredQ.trim().toLowerCase();
    return rows.filter((c) => {
      if (terms === 'none' ? c.paymentTerms !== '' : terms !== 'all' && c.paymentTerms !== terms) {
        return false;
      }
      if (debt === 'debtors' && !c.isDebtor) return false;
      if (debt === 'clear' && c.isDebtor) return false;
      if (billing && c.billingType !== billing) return false;
      if (!needle) return true;
      return c.companyName.toLowerCase().includes(needle) || c.carrierId.includes(needle);
    });
  }, [rows, deferredQ, terms, debt, billing]);

  /** Totals describe the FILTERED set — the summary must match what you're looking at. */
  const totals = useMemo(() => {
    let debtors = 0;
    let outstanding = 0;
    for (const c of filtered) {
      if (c.isDebtor) {
        debtors += 1;
        outstanding += c.computedDebt;
      }
    }
    return { debtors, outstanding };
  }, [filtered]);

  const reset = <T,>(set: (v: T) => void) => (v: T) => {
    set(v);
    setShown(PAGE);
  };

  const visible = filtered.slice(0, shown);
  const busy = load.loading || load.revalidating;

  return (
    <div className="fi-page">
      <header className="fi-head">
        <div>
          <div className="fi-kicker">Receivables</div>
          <h1 className="fi-title">Clients</h1>
          <p className="fi-sub">
            Every carrier with its payment terms and outstanding balance. Open one for invoices,
            payments and fuel transactions.
          </p>
        </div>
        <div className="fi-head-actions">
          {/* The roster is cached, so say how old it is — a debtor list that is quietly minutes stale
              is the kind of thing someone acts on. */}
          {load.cachedAt ? (
            <span className="fi-cachedat">
              {load.revalidating ? 'Refreshing…' : `Updated ${formatCachedAt(load.cachedAt)}`}
            </span>
          ) : null}
          <button type="button" className="fi-btn" onClick={load.reload} disabled={busy}>
            <RefreshCw size={15} className={busy ? 'fi-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {load.error ? <div className="fi-error">{load.error}</div> : null}

      <div className="fi-toolbar">
        <div className="fi-summary">
          <strong>{num(filtered.length)}</strong> clients ·{' '}
          <strong>{num(totals.debtors)}</strong> debtors ·{' '}
          <strong>{money0(totals.outstanding)}</strong> outstanding
        </div>
        <label className="fi-search">
          <Search size={15} />
          <input
            type="search"
            value={q}
            onChange={(e) => reset(setQ)(e.target.value)}
            placeholder="Company or carrier id…"
          />
        </label>
      </div>

      <div className="fi-filters">
        <div className="fi-filter-group">
          <span className="fi-filter-label">Payment</span>
          {TERMS.map((t) => (
            <button
              key={t.id}
              type="button"
              className="fi-chip"
              aria-pressed={terms === t.id}
              onClick={() => reset(setTerms)(t.id)}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="fi-filter-group">
          <span className="fi-filter-label">Status</span>
          {DEBT.map((d) => (
            <button
              key={d.id}
              type="button"
              className="fi-chip"
              aria-pressed={debt === d.id}
              onClick={() => reset(setDebt)(d.id)}
            >
              {d.label}
            </button>
          ))}
        </div>
        <div className="fi-filter-group">
          <span className="fi-filter-label">Billing</span>
          {billingTypes(rows).map((b) => (
            <button
              key={b}
              type="button"
              className="fi-chip"
              aria-pressed={billing === b}
              onClick={() => reset(setBilling)(billing === b ? null : b)}
            >
              {b.replace(/_/g, ' ')}
            </button>
          ))}
        </div>
      </div>

      {load.loading && rows.length === 0 ? (
        <div className="fi-rows">
          {Array.from({ length: 8 }, (_, i) => (
            <div key={i} className="fi-sk fi-sk-row" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <div className="fi-empty">
          <Users size={30} />
          <div className="fi-empty-title">No clients match</div>
          <p>Try a different payment type, status or search term.</p>
        </div>
      ) : (
        <div className="fi-rows">
          {visible.map((c) => (
            <button
              key={c.carrierId}
              type="button"
              className={`fi-row${c.isDebtor ? ' is-debtor' : ''}`}
              onClick={() => setOpenCarrier(c)}
            >
              <div style={{ minWidth: 0 }}>
                <div className="fi-row-name" title={c.companyName}>
                  {c.companyName}
                </div>
                <div className="fi-row-sub">
                  #{c.carrierId} · {c.activeCards} card{c.activeCards === 1 ? '' : 's'}
                  {c.computedIsActive ? '' : ' · inactive'}
                </div>
              </div>
              <div className="fi-row-hide">
                <div className="fi-cell-l">Payment</div>
                <div className="fi-cell-v">{dash(c.paymentTerms)}</div>
              </div>
              <div className="fi-row-hide">
                <div className="fi-cell-l">Billing</div>
                <div className="fi-cell-v">{dash(c.billingType.replace(/_/g, ' '))}</div>
              </div>
              <div>
                <div className="fi-cell-l">Outstanding</div>
                <div className={`fi-cell-v${c.isDebtor ? ' is-debt' : ' is-muted'}`}>
                  {c.isDebtor ? money0(c.computedDebt) : '—'}
                  {c.isDebtor && c.computedDebtDays > 0 ? (
                    <span style={{ opacity: 0.7 }}> · {c.computedDebtDays}d</span>
                  ) : null}
                </div>
              </div>
              <ChevronRight size={17} className="fi-row-arrow" />
            </button>
          ))}
        </div>
      )}

      {visible.length < filtered.length ? (
        <div style={{ display: 'flex', justifyContent: 'center' }}>
          <button type="button" className="fi-btn" onClick={() => setShown((s) => s + PAGE)}>
            Show {Math.min(PAGE, filtered.length - visible.length)} more
          </button>
        </div>
      ) : null}

      {openCarrier ? (
        <ClientModal client={openCarrier} onClose={() => setOpenCarrier(null)} />
      ) : null}
    </div>
  );
}
