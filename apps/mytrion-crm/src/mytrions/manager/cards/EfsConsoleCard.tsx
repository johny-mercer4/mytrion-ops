/**
 * Manager → EFS Console.
 *
 * Roster → dossier, the same shape as Referrals and Loyalty, for the same reason: it is what this
 * hub already is, and a third card in the same idiom needs no new mental model.
 *
 * The organising rule for ~37 read endpoints: the ROSTER is warehouse-only (`octane.dim_company`,
 * milliseconds, no vendor traffic) and every EFS call hangs off something you clicked. The one
 * exception is the parent totals strip — a single `parent.snapshot` (~1.8s) that loads beside the
 * roster because "what is in the parent account" is the number this card gets opened for.
 *
 * ⚠️ Writes are inert. `/capabilities` is server-authoritative and reports `writes.mode:
 * 'disabled'`; while it does, no Execute control is RENDERED at all — absent, not disabled, so
 * nobody goes hunting for the switch. Actions still validate and preview server-side, and every
 * preview writes an audit row, which is the evidence you want before arming anything.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Landmark, RefreshCw, Search, ShieldOff, TriangleAlert } from 'lucide-react';
import {
  fetchEfs,
  getEfsCapabilities,
  listEfsClients,
  partialErrors,
  type EfsCapabilities,
  type EfsClient,
  type EfsClientStatus,
  type EfsParentSnapshot,
} from '../../../api/efsConsole';
import { EfsCarrierDossier } from './efs/EfsCarrierDossier';
import { EfsParentStripSkeleton, EfsRosterSkeleton } from './efs/EfsSkeletons';
import { clientState, count, money, shortDate, type EfsTabId } from './efs/efsModel';
import './efsConsole.css';

const PAGE = 50;

const STATUSES: Array<{ id: EfsClientStatus; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'debtor', label: 'Debtors' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'inactive', label: 'Inactive' },
];

export function EfsConsoleCard({
  onBack,
  carrierId,
  tab,
  onSelect,
  onTab,
}: {
  onBack?: () => void;
  /** Selected carrier, owned by the shell so it can live in the URL. */
  carrierId: string | null;
  tab: EfsTabId;
  onSelect: (carrierId: string | null) => void;
  onTab: (tab: EfsTabId) => void;
}) {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [status, setStatus] = useState<EfsClientStatus>('all');
  const [clients, setClients] = useState<EfsClient[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [capabilities, setCapabilities] = useState<EfsCapabilities | null>(null);
  const [parent, setParent] = useState<EfsParentSnapshot | null>(null);
  const [parentLoading, setParentLoading] = useState(true);
  const [parentError, setParentError] = useState<string | null>(null);
  const parentLoaded = useRef(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    void getEfsCapabilities()
      .then(setCapabilities)
      .catch(() => setCapabilities(null));
  }, []);

  /** The one EFS call on this screen. Loaded once — it is the parent account, not a per-row fact. */
  const loadParent = useCallback(async (force = false) => {
    if (parentLoaded.current && !force) return;
    parentLoaded.current = true;
    setParentLoading(true);
    setParentError(null);
    try {
      const result = await fetchEfs<EfsParentSnapshot>('parent.snapshot');
      setParent(result.payload);
    } catch (caught) {
      setParentError(caught instanceof Error ? caught.message : 'EFS did not answer.');
    } finally {
      setParentLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadParent();
  }, [loadParent]);

  const loadClients = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const page = await listEfsClients({ q: debounced, status, limit: PAGE });
      setClients(page.clients);
      setTotal(page.total);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'The client roster could not be loaded.');
    } finally {
      setLoading(false);
    }
  }, [debounced, status]);

  useEffect(() => {
    void loadClients();
  }, [loadClients]);

  const selected = useMemo(
    () => clients.find((c) => c.carrierId === carrierId) ?? null,
    [clients, carrierId],
  );

  // A carrier can be selected from a URL before its page of the roster is loaded.
  const [resolved, setResolved] = useState<EfsClient | null>(null);
  useEffect(() => {
    if (!carrierId || selected) {
      setResolved(null);
      return;
    }
    let cancelled = false;
    void listEfsClients({ q: carrierId, limit: 1 })
      .then((page) => {
        if (!cancelled) setResolved(page.clients.find((c) => c.carrierId === carrierId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setResolved(null);
      });
    return () => {
      cancelled = true;
    };
  }, [carrierId, selected]);

  const client = selected ?? resolved;
  const writesDisabled = capabilities?.writes.mode === 'disabled';
  const parentBalance = parent?.parent?.totalBalance;
  const parentContracts = parent?.parent?.contracts ?? [];
  const parentWarnings = partialErrors(parent);

  if (carrierId && client) {
    return (
      <div className="mg-page mg-efs">
        <EfsCarrierDossier
          client={client}
          capabilities={capabilities}
          tab={tab}
          windowDays={7}
          onTab={onTab}
          onBack={() => onSelect(null)}
        />
      </div>
    );
  }

  return (
    <div className="mg-page mg-efs">
      <header className="mg-page-head">
        <div className="mg-page-head-left">
          {onBack ? (
            <button type="button" className="mg-backbtn" onClick={onBack} aria-label="Back to overview">
              <ArrowLeft size={16} />
            </button>
          ) : null}
          <div>
            <div className="mg-kicker">Fuel network</div>
            <h1 className="mg-page-title">EFS Console</h1>
            <p className="mg-page-sub">
              Live EFS state for Octane&rsquo;s clients — balances, cards, transactions and money
              codes, read straight from the vendor. Pick a client to open its record.
            </p>
          </div>
        </div>
        <div className="mg-head-actions">
          {writesDisabled ? (
            <span className="mg-efs-badge is-muted" title={capabilities?.writes.note}>
              <ShieldOff size={13} aria-hidden /> Read-only
            </span>
          ) : null}
          <button type="button" className="mg-btn" onClick={() => void loadParent(true)} disabled={parentLoading}>
            <RefreshCw size={15} className={parentLoading ? 'mg-spin' : ''} />
            Refresh
          </button>
        </div>
      </header>

      {/* The parent account: one call, and the number this card is opened for. */}
      {parentLoading ? (
        <EfsParentStripSkeleton />
      ) : parentError ? (
        <div className="mg-efs-warn" role="status">
          <TriangleAlert size={15} aria-hidden />
          <div>
            <strong>Parent account unavailable.</strong>
            <span>{parentError}</span>
          </div>
        </div>
      ) : (
        <section className="mg-efs-parent" aria-label="Parent account">
          <div>
            <span>
              <Landmark size={13} aria-hidden /> Parent available
            </span>
            <strong>{money(parentBalance)}</strong>
          </div>
          <div>
            <span>Contracts</span>
            <strong>{count(parentContracts.length)}</strong>
          </div>
          <div>
            <span>Clients in warehouse</span>
            <strong>{count(total)}</strong>
          </div>
          {parentWarnings.length ? (
            <div className="mg-efs-parent-warn">
              <TriangleAlert size={13} aria-hidden />
              {parentWarnings.length} EFS {parentWarnings.length === 1 ? 'leg' : 'legs'} unavailable
            </div>
          ) : null}
        </section>
      )}

      <section className="mg-efs-controls">
        <label className="mg-search">
          <Search size={15} />
          <input
            type="search"
            value={query}
            placeholder="Company name or carrier id…"
            aria-label="Search clients"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="mg-lty-chips" role="group" aria-label="Filter clients">
          {STATUSES.map((s) => (
            <button
              key={s.id}
              type="button"
              className="mg-lty-chip"
              aria-pressed={status === s.id}
              onClick={() => setStatus(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <span className="mg-efs-count">{count(total)} clients</span>
      </section>

      {loading ? <EfsRosterSkeleton /> : null}

      {!loading && error ? (
        <div className="mg-error">
          <p>{error}</p>
          <button type="button" className="mg-btn" onClick={() => void loadClients()}>
            Retry
          </button>
        </div>
      ) : null}

      {!loading && !error && clients.length === 0 ? (
        <div className="mg-empty">No clients match this search.</div>
      ) : null}

      {!loading && !error && clients.length > 0 ? (
        <div className="mg-efs-tablewrap">
          <table className="mg-efs-table is-roster">
            <thead>
              <tr>
                <th>Company</th>
                <th>Carrier</th>
                <th className="is-num">Active cards</th>
                <th>Agent</th>
                <th>Last transaction</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {clients.map((c) => {
                const state = clientState(c);
                return (
                  <tr key={c.carrierId}>
                    <td>
                      <button type="button" className="mg-efs-rowlink" onClick={() => onSelect(c.carrierId)}>
                        {c.companyName}
                      </button>
                    </td>
                    <td className="mg-efs-mono">{c.carrierId}</td>
                    <td className="is-num">{count(c.activeCards)}</td>
                    <td>{c.agent ?? '—'}</td>
                    <td>{shortDate(c.lastTransactionDate)}</td>
                    <td>
                      <span className={`mg-efs-badge is-${state.tone}`}>{state.label}</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {total > clients.length ? (
            <p className="mg-empty-sm">
              Showing {count(clients.length)} of {count(total)}. Narrow with the search above.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
