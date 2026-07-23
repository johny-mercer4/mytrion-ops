/**
 * Admin Deals — browse / search Zoho deals and one-click transfer
 * Deal + Contact + Account ownership. Recovery mode uses Timeline `done_by`.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  DEFAULT_TRANSFERRER_ZOHO_USER_ID,
  getAdminDeal,
  listAdminDeals,
  listDealsTransferredBy,
  searchAdminDeals,
  transferAdminDeal,
  type AdminDeal,
  type OwnerTimelineChange,
} from '../../api/adminDeals';
import { listAgents, type AgentUser } from '../../api/agents';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import { RefreshIcon, SearchIcon } from '../../components/icons';
import { ConfirmDialog } from './ConfirmDialog';
import { DealTransferDrawer, type PriorOwnerState } from './DealTransferDrawer';
import { OwnershipTransferLogPane } from './OwnershipTransferLog';
import {
  dash,
  filterAgents,
  filterDeals,
  recoveryStats as buildRecoveryStats,
  relativeTime,
} from './dealsHelpers';
import { adminToast } from './toast';
import s from './admin.module.css';

const BROWSE_SKELETON = ['42%', '28%', '32%', '22%', '24%', '20%', '16%'] as const;
const RECOVERY_SKELETON = ['40%', '28%', '30%', '28%', '22%', '20%'] as const;

type Mode = 'browse' | 'recovery' | 'transferLog';

export function Deals() {
  const [mode, setMode] = useState<Mode>('browse');
  const [deals, setDeals] = useState<AdminDeal[]>([]);
  const [timelineByDeal, setTimelineByDeal] = useState<Record<string, OwnerTimelineChange>>({});
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [query, setQuery] = useState('');
  const [listFilter, setListFilter] = useState('');
  const [transferrerId, setTransferrerId] = useState('');
  const [activeTransferrerId, setActiveTransferrerId] = useState('');
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<AdminDeal | null>(null);
  const [priorOwner, setPriorOwner] = useState<PriorOwnerState | null>(null);
  const [agentQuery, setAgentQuery] = useState('');
  const [toAgentId, setToAgentId] = useState('');
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [lastTransfer, setLastTransfer] = useState<{
    deal: boolean;
    contact: boolean;
    account: boolean;
  } | null>(null);
  const loadSeq = useRef(0);
  const openSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const recoveryMode = mode === 'recovery';
  const transferLogMode = mode === 'transferLog';

  const loadDeals = useCallback(async (q: string, opts?: { transferredBy?: string | null }) => {
    const seq = (loadSeq.current += 1);
    const transferredBy = opts?.transferredBy?.trim() || null;

    setLoading(true);
    setError('');
    setDeals([]);
    setTimelineByDeal({});
    setLastTransfer(null);
    if (transferredBy) {
      setMode('recovery');
      setActiveTransferrerId(transferredBy);
    } else {
      setMode('browse');
      setActiveTransferrerId('');
    }

    try {
      if (transferredBy) {
        const result = await listDealsTransferredBy(transferredBy, 200);
        if (seq !== loadSeq.current) return;
        setDeals(result.deals);
        const map: Record<string, OwnerTimelineChange> = {};
        for (const row of result.timeline) map[row.dealId] = row.change;
        setTimelineByDeal(map);
      } else {
        const rows = q.trim() ? await searchAdminDeals(q.trim()) : await listAdminDeals(200);
        if (seq !== loadSeq.current) return;
        setDeals(rows);
      }
    } catch (e) {
      if (seq === loadSeq.current) setError(e instanceof Error ? e.message : String(e));
    } finally {
      if (seq === loadSeq.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void listAgents(true)
      .then((rows) =>
        setAgents(
          [...rows].sort((a, b) => (a.name ?? a.zohoUserId).localeCompare(b.name ?? b.zohoUserId)),
        ),
      )
      .catch(() => adminToast.error('Could not load agents'));
  }, []);

  useEffect(() => {
    void loadDeals('');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- mount only
  }, []);

  const onQueryChange = (value: string) => {
    setQuery(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void loadDeals(value);
    }, 320);
  };

  const loadRecoverySet = () => {
    const tid = transferrerId.trim() || DEFAULT_TRANSFERRER_ZOHO_USER_ID;
    if (!/^\d+$/.test(tid)) {
      adminToast.error('Transferrer id must be numeric');
      return;
    }
    setTransferrerId(tid);
    setQuery('');
    setListFilter('');
    setSelected(null);
    void loadDeals('', { transferredBy: tid });
  };

  const switchBrowse = () => {
    setMode('browse');
    setListFilter('');
    setSelected(null);
    setPriorOwner(null);
    setLastTransfer(null);
    void loadDeals(query);
  };

  const openDeal = async (deal: AdminDeal) => {
    const seq = (openSeq.current += 1);
    setSelected(deal);
    setLastTransfer(null);
    setAgentQuery('');
    setToAgentId(deal.ownerZohoUserId ?? '');

    const cached = timelineByDeal[deal.id];
    if (cached?.previousOwnerName || cached?.previousOwnerZohoUserId) {
      setPriorOwner({
        zohoUserId: cached.previousOwnerZohoUserId,
        name: cached.previousOwnerName,
        change: cached,
      });
      if (cached.previousOwnerZohoUserId) setToAgentId(cached.previousOwnerZohoUserId);
    } else if (!recoveryMode) {
      setPriorOwner(null);
    }

    setDetailLoading(true);
    try {
      const tid =
        activeTransferrerId || transferrerId.trim() || DEFAULT_TRANSFERRER_ZOHO_USER_ID;
      const detail = await getAdminDeal(deal.id, { transferrerId: tid });
      if (seq !== openSeq.current) return;
      setSelected(detail.deal);
      setPriorOwner(detail.priorOwner);
      if (detail.priorOwner?.zohoUserId) {
        setToAgentId(detail.priorOwner.zohoUserId);
      } else if (detail.priorOwner?.name) {
        const match = agents.find(
          (a) =>
            (a.name ?? '').trim().toLowerCase() === detail.priorOwner!.name!.trim().toLowerCase(),
        );
        if (match) setToAgentId(match.zohoUserId);
      }
    } catch (e) {
      if (seq === openSeq.current) {
        adminToast.error(e instanceof Error ? e.message : 'Failed to load deal');
      }
    } finally {
      if (seq === openSeq.current) setDetailLoading(false);
    }
  };

  const selectedAgent = agents.find((a) => a.zohoUserId === toAgentId) ?? null;
  const filteredAgents = useMemo(
    () => filterAgents(agents, agentQuery, priorOwner?.zohoUserId),
    [agents, agentQuery, priorOwner?.zohoUserId],
  );
  const visibleDeals = useMemo(
    () => filterDeals(deals, listFilter, timelineByDeal),
    [deals, listFilter, timelineByDeal],
  );
  const recoveryStats = useMemo(
    () => (recoveryMode ? buildRecoveryStats(deals, timelineByDeal) : null),
    [recoveryMode, deals, timelineByDeal],
  );

  const runTransfer = async () => {
    if (!selected || !toAgentId) return;
    setBusy(true);
    try {
      const res = await transferAdminDeal(selected.id, toAgentId, selectedAgent?.name ?? null);
      setSelected(res.deal);
      setDeals((prev) => prev.map((d) => (d.id === res.deal.id ? res.deal : d)));
      setLastTransfer({
        deal: res.transfer.dealUpdated,
        contact: res.transfer.contactUpdated,
        account: res.transfer.accountUpdated,
      });
      const parts = [
        res.transfer.dealUpdated ? 'Deal' : null,
        res.transfer.contactUpdated ? 'Contact' : null,
        res.transfer.accountUpdated ? 'Account' : null,
      ].filter(Boolean);
      adminToast.success(`Transferred ${parts.join(' + ') || 'ownership'}`);
      if (res.transfer.warnings.length) {
        adminToast.error(res.transfer.warnings.join('; '));
      }
      setConfirmOpen(false);
    } catch (e) {
      adminToast.error(e instanceof Error ? e.message : 'Transfer failed');
    } finally {
      setBusy(false);
    }
  };

  const colsClass = recoveryMode ? s.tDealsRecovery : s.tDeals;
  const canTransfer =
    Boolean(toAgentId) &&
    toAgentId !== selected?.ownerZohoUserId &&
    !busy &&
    !detailLoading;

  return (
    <section className={`${s.panel} ${s.panelWide} ${s.dealsPanel}`}>
      <header className={s.head}>
        <div>
          <div className={s.eyebrow}>Zoho CRM</div>
          <h2 className={s.h2}>Deals</h2>
          <p className={s.sub}>
            Find a deal, confirm ownership, and move Deal + Contact + Company to the right agent in
            one step.
          </p>
        </div>
        <div className={s.chipRow}>
          <div className={s.dealsModeSwitch} role="tablist" aria-label="Deals mode">
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'browse'}
              className={mode === 'browse' ? s.dealsModeActive : s.dealsModeBtn}
              onClick={switchBrowse}
            >
              Browse
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'recovery'}
              className={mode === 'recovery' ? s.dealsModeActive : s.dealsModeBtn}
              onClick={() => {
                setMode('recovery');
                if (!activeTransferrerId && !transferrerId) {
                  setTransferrerId(DEFAULT_TRANSFERRER_ZOHO_USER_ID);
                }
              }}
            >
              Recovery
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={mode === 'transferLog'}
              className={mode === 'transferLog' ? s.dealsModeActive : s.dealsModeBtn}
              onClick={() => {
                setMode('transferLog');
                setSelected(null);
                setPriorOwner(null);
                setLastTransfer(null);
                setError('');
              }}
            >
              Transfer log
            </button>
          </div>
          {!transferLogMode ? (
            <button
              type="button"
              className={s.ghostBtn}
              disabled={loading}
              onClick={() =>
                void loadDeals(query, {
                  transferredBy: recoveryMode ? activeTransferrerId || transferrerId : null,
                })
              }
              title="Refresh"
            >
              <RefreshIcon /> Refresh
            </button>
          ) : null}
        </div>
      </header>

      {transferLogMode ? <OwnershipTransferLogPane /> : null}

      {!transferLogMode && mode === 'browse' ? (
        <div className={s.dealsToolbar}>
          <div className={`${s.search} ${s.searchTall} ${s.dealsSearch}`}>
            <SearchIcon />
            <input
              className={s.searchInput}
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="Search deal name, id, carrier, application…"
              aria-label="Search deals"
            />
          </div>
          {!loading ? <span className={s.dealsCount}>{visibleDeals.length} shown</span> : null}
        </div>
      ) : !transferLogMode ? (
        <div className={s.dealsRecoveryBar}>
          <div className={s.dealsRecoveryFields}>
            <label className={s.fieldLabel} htmlFor="transferrer-id">
              Transferrer Zoho user id
            </label>
            <div className={s.dealsRecoveryRow}>
              <input
                id="transferrer-id"
                className={`${s.input} ${s.mono}`}
                value={transferrerId}
                onChange={(e) => setTransferrerId(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') loadRecoverySet();
                }}
                placeholder="Who changed Deal Owner"
                aria-label="Transferrer Zoho user id"
              />
              <button
                type="button"
                className={s.ghostBtn}
                onClick={() => setTransferrerId(DEFAULT_TRANSFERRER_ZOHO_USER_ID)}
                title="Fill John Mercer"
              >
                John Mercer
              </button>
              <button
                type="button"
                className={s.primaryBtn}
                onClick={loadRecoverySet}
                disabled={loading}
              >
                Load set
              </button>
            </div>
          </div>
          {recoveryStats ? (
            <div className={`${s.statGrid} ${s.dealsStatGrid}`}>
              <div className={s.statTile}>
                <div className={s.statNum}>{recoveryStats.total}</div>
                <div className={s.statLabel}>Deals</div>
              </div>
              <div className={s.statTile}>
                <div className={`${s.statNum} ${s.good}`}>{recoveryStats.withPrior}</div>
                <div className={s.statLabel}>Have prior</div>
              </div>
              <div className={s.statTile}>
                <div className={`${s.statNum} ${recoveryStats.missing ? s.warn : ''}`}>
                  {recoveryStats.missing}
                </div>
                <div className={s.statLabel}>Missing prior</div>
              </div>
              <div className={s.statTile}>
                <div className={s.statNum}>{recoveryStats.confirmed}</div>
                <div className={s.statLabel}>Timeline hits</div>
              </div>
            </div>
          ) : (
            <p className={s.sub} style={{ margin: 0 }}>
              Enter the transferrer id (or tap John Mercer), then load the recovery set. Each row
              shows Timeline prior → changed to.
            </p>
          )}
        </div>
      ) : null}

      {!transferLogMode && ((recoveryMode && deals.length > 0) || listFilter) ? (
        <div className={s.dealsToolbar}>
          <div className={`${s.search} ${s.dealsSearch}`}>
            <SearchIcon />
            <input
              className={s.searchInput}
              value={listFilter}
              onChange={(e) => setListFilter(e.target.value)}
              placeholder="Filter this list by name, owner, prior…"
              aria-label="Filter loaded deals"
            />
          </div>
          <span className={s.dealsCount}>
            {visibleDeals.length}
            {visibleDeals.length !== deals.length ? ` / ${deals.length}` : ''} shown
          </span>
        </div>
      ) : null}

      {!transferLogMode && error ? <p className={s.errorText}>{error}</p> : null}

      {!transferLogMode ? (
        <div className={s.dealsLayout}>
          <div className={s.tableScroll} aria-busy={loading}>
            <div className={s.table}>
              {recoveryMode ? (
                <div className={`${s.tHead} ${s.tDealsRecovery}`}>
                  <span>Deal</span>
                  <span>Current</span>
                  <span>Prior (return to)</span>
                  <span>Was changed to</span>
                  <span>When</span>
                  <span>By</span>
                </div>
              ) : (
                <div className={`${s.tHead} ${s.tDeals}`}>
                  <span>Deal</span>
                  <span>Owner</span>
                  <span>Company</span>
                  <span>App date</span>
                  <span>Owner updated</span>
                  <span>Stage</span>
                  <span>Carrier</span>
                </div>
              )}
              {loading ? (
                <>
                  <span className={s.srOnly}>Loading deals</span>
                  <TableSkeleton
                    widths={recoveryMode ? RECOVERY_SKELETON : BROWSE_SKELETON}
                    rowClassName={s.tRow}
                    colsClassName={colsClass}
                  />
                </>
              ) : null}
              {!loading && visibleDeals.length === 0 ? (
                <div className={s.emptyState}>
                  {deals.length === 0
                    ? recoveryMode
                      ? 'No recovery deals loaded yet — enter a transferrer and Load set.'
                      : 'No deals found. Try another search.'
                    : 'No rows match this filter.'}
                </div>
              ) : null}
              {!loading
                ? visibleDeals.map((d) => {
                    const tl = timelineByDeal[d.id];
                    const hasPrior = Boolean(tl?.previousOwnerName || tl?.previousOwnerZohoUserId);
                    return (
                      <button
                        key={d.id}
                        type="button"
                        className={`${s.tRow} ${colsClass} ${s.tRowBtn} ${selected?.id === d.id ? s.tRowActive : ''}`}
                        onClick={() => void openDeal(d)}
                      >
                        <span>
                          <strong className={s.jobTitle}>{dash(d.dealName)}</strong>
                          <span className={s.jobDesc}>{d.id}</span>
                        </span>
                        {recoveryMode ? (
                          <>
                            <span>
                              <strong className={s.jobTitle}>{dash(d.ownerName)}</strong>
                            </span>
                            <span>
                              <strong className={`${s.jobTitle} ${hasPrior ? s.dealsPriorOk : ''}`}>
                                {dash(tl?.previousOwnerName)}
                              </strong>
                              {!hasPrior ? (
                                <span className={`${s.jobDesc} ${s.dealsPriorMissing}`}>No prior</span>
                              ) : null}
                            </span>
                            <span>
                              <strong className={s.jobTitle}>{dash(tl?.newOwnerName)}</strong>
                            </span>
                            <span title={tl?.auditedTime ?? undefined}>
                              {relativeTime(tl?.auditedTime)}
                            </span>
                            <span>{dash(tl?.transferrerName)}</span>
                          </>
                        ) : (
                          <>
                            <span>{dash(d.ownerName)}</span>
                            <span>{dash(d.accountName)}</span>
                            <span>{dash(d.applicationDate)}</span>
                            <span>{dash(d.ownerLastUpdated)}</span>
                            <span>{dash(d.stage)}</span>
                            <span>{dash(d.carrierId)}</span>
                          </>
                        )}
                      </button>
                    );
                  })
                : null}
            </div>
          </div>

          <DealTransferDrawer
            selected={selected}
            priorOwner={priorOwner}
            filteredAgents={filteredAgents}
            agentQuery={agentQuery}
            toAgentId={toAgentId}
            selectedAgent={selectedAgent}
            detailLoading={detailLoading}
            canTransfer={canTransfer}
            lastTransfer={lastTransfer}
            onAgentQueryChange={setAgentQuery}
            onToAgentChange={setToAgentId}
            onUsePrior={() => {
              if (!priorOwner?.zohoUserId) return;
              setToAgentId(priorOwner.zohoUserId);
              setAgentQuery(priorOwner.name ?? '');
            }}
            onConfirmTransfer={() => setConfirmOpen(true)}
          />
        </div>
      ) : null}

      {confirmOpen && selected ? (
        <ConfirmDialog
          title="Transfer ownership?"
          body={`Move Deal, Contact, and Company from ${dash(selected.ownerName)} to ${dash(selectedAgent?.name ?? toAgentId)}. This writes to Zoho immediately.`}
          confirmLabel="Transfer now"
          busy={busy}
          onConfirm={() => void runTransfer()}
          onCancel={() => {
            if (!busy) setConfirmOpen(false);
          }}
        />
      ) : null}
    </section>
  );
}
