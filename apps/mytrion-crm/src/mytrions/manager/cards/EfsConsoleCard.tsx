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
import { DataTable, type DataColumn } from '@/ds';
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

/**
 * MOBILE ROLES — a manager scanning the roster asks "which carrier, whose, and is it healthy?":
 * company (primary), carrier id and agent (secondary), state (the one value). Active-card count and
 * last-transaction date are the numbers you read once you have picked a carrier, so they open with
 * it rather than shrinking the name.
 */
const ROSTER_COLUMNS: DataColumn<EfsClient>[] = [
  {
    id: 'company',
    header: 'Company',
    rowHeader: true,
    mobile: 'primary',
    cell: (c) => c.companyName,
  },
  {
    id: 'carrier',
    header: 'Carrier',
    mobile: 'secondary',
    cell: (c) => <span className="mg-efs-mono">{c.carrierId}</span>,
  },
  {
    id: 'cards',
    header: 'Active cards',
    numeric: true,
    align: 'end',
    priority: 2,
    cell: (c) => count(c.activeCards),
  },
  { id: 'agent', header: 'Agent', mobile: 'secondary', cell: (c) => c.agent ?? '—' },
  {
    id: 'lastTx',
    header: 'Last transaction',
    priority: 2,
    cell: (c) => shortDate(c.lastTransactionDate),
  },
  {
    id: 'state',
    header: 'Status',
    mobile: 'value',
    cell: (c) => {
      const state = clientState(c);
      return <span className={`mg-efs-badge is-${state.tone}`}>{state.label}</span>;
    },
  },
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
          <DataTable
            caption="EFS carrier roster"
            rows={clients}
            rowKey={(c) => c.carrierId}
            columns={ROSTER_COLUMNS}
            className="mg-efs-table is-roster"
            scrollerClassName="mg-efs-tablewrap"
            /* The company name is a real button in the cell rather than a row handler: the roster's
               job is to lead into one carrier's dossier, and a row-wide target would swallow the
               text selection people use to copy a carrier id out of the next column. */
            onRowActivate={(c) => onSelect(c.carrierId)}
          />
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
