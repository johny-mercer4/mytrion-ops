/**
 * Open Pool — other agents' retention cases in p1_open_pool (never your own former deals).
 * Claim request (reason required) → prior owner approve (or 1 BD auto) → Zoho ownership → p1_new.
 * Processing rows (p1_pool_claim_pending) are locked for other agents.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { useUserContext } from '@/context/UserContextProvider';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { useLoad } from '../../../_shared/useLoad';
import { RetentionHero, RetentionPoolMetrics, fmtGal } from '../RetentionBoardUi';
import { PoolClaimModal } from '../PoolClaimModal';
import {
  claimOpenPoolCase,
  loadOpenPoolCases,
  quietCaption,
  type RetentionCaseRow,
} from '../retentionData';
import { subscribeRetentionLive } from '../retentionLiveBus';
import { stageTimer } from '../retentionTimers';

type SortKey = 'carrierId' | 'companyName' | 'daysInactive' | 'gallons90d' | 'assignmentCount';
type StatusFilter = 'available' | 'mine' | 'processing' | 'all';

type ClaimModal =
  | { mode: 'single'; caseId: string }
  | { mode: 'bulk'; caseIds: string[] }
  | null;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string; hint: string }> = [
  { id: 'available', label: 'Available', hint: 'Ready to request' },
  { id: 'mine', label: 'My requests', hint: 'Awaiting prior owner' },
  { id: 'processing', label: 'Processing', hint: 'Someone else claimed' },
  { id: 'all', label: 'All', hint: 'Everything in the pool' },
];

function isProcessing(c: RetentionCaseRow): boolean {
  return c.statusCode === 'p1_pool_claim_pending';
}

function isPendingSelf(c: RetentionCaseRow, selfId: string | undefined): boolean {
  return isProcessing(c) && !!selfId && c.pendingClaimantZohoUserId === selfId;
}

function statusLabel(c: RetentionCaseRow, selfId: string | undefined): string {
  if (isPendingSelf(c, selfId)) return 'Your request';
  if (isProcessing(c)) return 'Processing';
  return 'Available';
}

function claimWindowLabel(c: RetentionCaseRow): { text: string; tone: 'ok' | 'warn' | 'danger' | 'muted' } {
  if (c.statusCode === 'p1_pool_claim_pending') {
    const t = stageTimer(c);
    if (t) return { text: t.remain, tone: t.tone === 'danger' ? 'danger' : t.tone === 'warn' ? 'warn' : 'warn' };
    return { text: 'CS review', tone: 'warn' };
  }
  const t = stageTimer(c);
  if (!t) return { text: '—', tone: 'muted' };
  return {
    text: t.remain,
    tone: t.tone === 'danger' ? 'danger' : t.tone === 'warn' ? 'warn' : 'ok',
  };
}

export function PoolTab({ onAvailableCount }: { onAvailableCount?: (n: number) => void }) {
  const { pushToast } = useSales();
  const user = useUserContext();
  const selfId = user.userId && user.userId !== 'dev-user' ? user.userId : undefined;
  const feed = useLoad(() => loadOpenPoolCases(), []);
  const [cases, setCases] = useState<RetentionCaseRow[]>([]);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('available');
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'asc',
  });
  const [claimModal, setClaimModal] = useState<ClaimModal>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [spin, setSpin] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!feed.data?.cases) return;
    // Backend already excludes your former deals; keep pending-self visible.
    setCases(feed.data.cases);
  }, [feed.data?.cases]);

  const claimable = useMemo(
    () => cases.filter((c) => c.statusCode === 'p1_open_pool'),
    [cases],
  );
  const myPending = useMemo(
    () => cases.filter((c) => isPendingSelf(c, selfId)),
    [cases, selfId],
  );
  const othersProcessing = useMemo(
    () => cases.filter((c) => isProcessing(c) && !isPendingSelf(c, selfId)),
    [cases, selfId],
  );

  useEffect(() => {
    if (!feed.loading) onAvailableCount?.(claimable.length);
  }, [claimable.length, feed.loading, onAvailableCount]);

  const refresh = (): void => {
    setSpin(true);
    feed.reload();
    clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpin(false), 900);
  };

  useEffect(
    () =>
      subscribeRetentionLive((payload) => {
        if (
          payload.type === 'retention.pool.opened' ||
          payload.type === 'retention.claim_request' ||
          payload.type === 'retention.claim_approved' ||
          payload.type === 'retention.claim_declined'
        ) {
          refresh();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openClaimModal = (modal: Exclude<ClaimModal, null>): void => {
    setClaimModal(modal);
    setReason('');
    setConfirm(false);
  };

  const closeClaimModal = (): void => {
    if (submitting) return;
    setClaimModal(null);
    setReason('');
    setConfirm(false);
  };

  const toggle = (id: string): void => {
    const row = cases.find((c) => c.id === id);
    if (!row || row.statusCode !== 'p1_open_pool') return;
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = cases.slice();
    if (statusFilter === 'available') rows = rows.filter((c) => c.statusCode === 'p1_open_pool');
    else if (statusFilter === 'mine') rows = rows.filter((c) => isPendingSelf(c, selfId));
    else if (statusFilter === 'processing') {
      rows = rows.filter((c) => isProcessing(c) && !isPendingSelf(c, selfId));
    }
    if (q) {
      rows = rows.filter((c) =>
        `${c.carrierId} ${c.companyName ?? ''} ${c.agentName ?? ''}`.toLowerCase().includes(q),
      );
    }
    if (sort.key) {
      const k = sort.key;
      const dir = sort.dir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const va = a[k] ?? '';
        const vb = b[k] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return va < vb ? -dir : va > vb ? dir : 0;
        return String(va).toLowerCase() < String(vb).toLowerCase()
          ? -dir
          : String(va).toLowerCase() > String(vb).toLowerCase()
            ? dir
            : 0;
      });
    }
    return rows;
  }, [cases, search, sort, statusFilter, selfId]);

  const toggleAll = (): void => {
    const ids = filtered.filter((c) => c.statusCode === 'p1_open_pool').map((c) => c.id);
    setSelected((sel) => (ids.length > 0 && ids.every((id) => sel.includes(id)) ? [] : ids));
  };

  const toggleSort = (k: SortKey): void =>
    setSort((cur) => ({ key: k, dir: cur.key === k && cur.dir === 'asc' ? 'desc' : 'asc' }));

  const arrow = (k: SortKey): string =>
    sort.key === k ? (sort.dir === 'desc' ? '▼' : '▲') : '';

  const claimIds = claimModal
    ? claimModal.mode === 'single'
      ? [claimModal.caseId]
      : claimModal.caseIds
    : [];

  const singleSummary =
    claimModal?.mode === 'single'
      ? cases.find((c) => c.id === claimModal.caseId) ?? null
      : null;

  const submitClaim = async (): Promise<void> => {
    if (!claimIds.length || !reason.trim() || !confirm || submitting) return;
    setSubmitting(true);
    const ids = claimIds.slice();
    const sharedReason = reason.trim();
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await claimOpenPoolCase(id, sharedReason);
        ok += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Failed');
      }
    }
    setSubmitting(false);
    setClaimModal(null);
    setReason('');
    setConfirm(false);
    setSelected([]);
    setStatusFilter('mine');
    feed.reload();
    if (ok > 0) {
      pushToast(
        'Claim requested',
        `${ok} deal${ok !== 1 ? 's' : ''} awaiting prior owner (auto in 1 BD)`,
      );
    }
    if (errors.length > 0) {
      pushToast('Some requests failed', errors[0] ?? 'Could not request claim');
    }
  };

  const selectableFiltered = filtered.filter((c) => c.statusCode === 'p1_open_pool');
  const allChecked =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((c) => selected.includes(c.id));
  const stop = (e: MouseEvent): void => e.stopPropagation();

  const poolGallons = useMemo(
    () => claimable.reduce((sum, c) => sum + (c.gallons90d ?? 0), 0),
    [claimable],
  );
  const avgQuietDays = useMemo(() => {
    const days = claimable
      .map((c) => c.daysInactive)
      .filter((d): d is number => typeof d === 'number' && d >= 0);
    if (days.length === 0) return null;
    return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
  }, [claimable]);

  const filterCount = (id: StatusFilter): number => {
    if (id === 'available') return claimable.length;
    if (id === 'mine') return myPending.length;
    if (id === 'processing') return othersProcessing.length;
    return cases.length;
  };

  return (
    <>
      <div className="ss-fu ss-pool" style={s('display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:480px')}>
        <div style={s('margin-bottom:14px')}>
          <RetentionHero
            title="Open Pool"
            sub="Claim other agents' quiet deals. Prior owner approves (or 1 BD auto). Unclaimed 3 BD → Retention. Max 3 owners → CITI."
            actions={
              <>
                <button
                  type="button"
                  disabled={!selected.length}
                  onClick={() => {
                    if (!selected.length) return;
                    openClaimModal({ mode: 'bulk', caseIds: selected.slice() });
                  }}
                  className={selected.length ? 'ss-btn-p' : undefined}
                  style={s(
                    selected.length
                      ? 'height:38px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:7px'
                      : 'height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13px;cursor:not-allowed;display:flex;align-items:center;gap:7px',
                  )}
                >
                  <Icon name="assign" size={15} strokeWidth={2.2} />
                  Request claim{selected.length ? ` (${selected.length})` : ''}
                </button>
                <button
                  type="button"
                  onClick={refresh}
                  aria-label="Refresh"
                  className="ss-ico-btn"
                  style={s(
                    'width:38px;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center',
                  )}
                >
                  <Icon
                    name="refresh"
                    size={16}
                    style={s(spin || feed.loading ? 'animation:ss-spin .9s linear infinite' : '')}
                  />
                </button>
              </>
            }
          >
            {!feed.loading || claimable.length > 0 ? (
              <RetentionPoolMetrics
                available={claimable.length}
                selected={selected.length}
                gallons={poolGallons}
                avgQuietDays={avgQuietDays}
              />
            ) : null}
          </RetentionHero>
        </div>

        <div className="ss-pool-howto" aria-label="How Open Pool works">
          <div>
            <strong>1. Request</strong>
            <span>Pick available deals + reason</span>
          </div>
          <div>
            <strong>2. CS review</strong>
            <span>Approve / decline · 1 BD auto</span>
          </div>
          <div>
            <strong>3. Your New</strong>
            <span>Ownership transfers · 2 BD to act</span>
          </div>
        </div>

        <div className="ss-pool-toolbar">
          <div className="ss-pool-filters" role="tablist" aria-label="Pool status">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                role="tab"
                title={f.hint}
                aria-selected={statusFilter === f.id}
                className={`ss-pool-chip${statusFilter === f.id ? ' is-on' : ''}`}
                onClick={() => {
                  setStatusFilter(f.id);
                  setSelected([]);
                }}
              >
                {f.label}
                <em>{filterCount(f.id)}</em>
              </button>
            ))}
          </div>
          <div className="ss-pool-search">
            <Icon name="search" size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, carrier, or agent…"
              className="ss-in"
            />
          </div>
        </div>

        {feed.error && <div className="ss-pool-error">{feed.error}</div>}

        <div className="ss-pool-table-wrap">
          <div className="ss-scroll" style={s('flex:1;overflow:auto')}>
            <div style={s('min-width:1040px')}>
              <div className="ss-pool-head">
                <span className="ss-pool-check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    disabled={selectableFiltered.length === 0}
                    aria-label="Select all available"
                  />
                </span>
                <span>#</span>
                <span onClick={() => toggleSort('carrierId')} className="ss-pool-sort">
                  Carrier {arrow('carrierId')}
                </span>
                <span onClick={() => toggleSort('companyName')} className="ss-pool-sort">
                  Company {arrow('companyName')}
                </span>
                <span>Prior agent</span>
                <span onClick={() => toggleSort('daysInactive')} className="ss-pool-sort">
                  Quiet {arrow('daysInactive')}
                </span>
                <span onClick={() => toggleSort('gallons90d')} className="ss-pool-sort">
                  Gallons {arrow('gallons90d')}
                </span>
                <span onClick={() => toggleSort('assignmentCount')} className="ss-pool-sort">
                  Cycle {arrow('assignmentCount')}
                </span>
                <span>Window</span>
                <span>Status</span>
              </div>

              {feed.loading && cases.length === 0
                ? Array.from({ length: 5 }, (_, i) => (
                    <div key={i} className="ss-pool-row is-skel" aria-hidden>
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                      <span />
                    </div>
                  ))
                : null}

              {filtered.map((c, i) => {
                const pendingSelf = isPendingSelf(c, selfId);
                const processing = isProcessing(c);
                const claimableRow = c.statusCode === 'p1_open_pool';
                const on = selected.includes(c.id);
                const status = statusLabel(c, selfId);
                const window = claimWindowLabel(c);
                return (
                  <div
                    key={c.id}
                    role={claimableRow ? 'button' : undefined}
                    tabIndex={claimableRow ? 0 : undefined}
                    onClick={() => {
                      if (!claimableRow) return;
                      openClaimModal({ mode: 'single', caseId: c.id });
                    }}
                    onKeyDown={(e) => {
                      if (!claimableRow) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openClaimModal({ mode: 'single', caseId: c.id });
                      }
                    }}
                    className={`ss-pool-row${on ? ' is-selected' : ''}${pendingSelf ? ' is-mine' : ''}${processing && !pendingSelf ? ' is-processing' : ''}${claimableRow ? ' is-claimable' : ''}`}
                  >
                    <span className="ss-pool-check" onClick={stop}>
                      {claimableRow ? (
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => toggle(c.id)}
                          aria-label={`Select ${c.companyName || c.carrierId}`}
                        />
                      ) : (
                        <span className="ss-pool-check-spacer" />
                      )}
                    </span>
                    <span className="ss-pool-mono muted">{i + 1}</span>
                    <span className="ss-pool-mono">{c.carrierId}</span>
                    <span className="ss-pool-company">{c.companyName || '—'}</span>
                    <span className="ss-pool-agent">{c.agentName || '—'}</span>
                    <span className="ss-pool-quiet">{quietCaption(c)}</span>
                    <span className="ss-pool-mono">
                      {c.gallons90d != null ? fmtGal(c.gallons90d) : '—'}
                    </span>
                    <span className="ss-pool-cycle">{c.assignmentCount}/3</span>
                    <span className={`ss-pool-window is-${window.tone}`}>{window.text}</span>
                    <span>
                      <span
                        className={`ss-pool-status${processing ? ' is-warn' : ' is-ok'}${pendingSelf ? ' is-mine' : ''}`}
                      >
                        {status}
                      </span>
                    </span>
                  </div>
                );
              })}

              {filtered.length === 0 && !feed.loading && (
                <div className="ss-ret-empty" style={s('margin:24px;border:none')}>
                  <div className="ss-ret-empty-title">
                    {feed.error
                      ? 'Could not load Open Pool'
                      : statusFilter === 'available'
                        ? 'No available deals'
                        : statusFilter === 'mine'
                          ? 'No pending requests'
                          : 'Nothing here'}
                  </div>
                  <div className="ss-ret-empty-body">
                    {feed.error
                      ? feed.error
                      : statusFilter === 'available'
                        ? 'Deals enter the pool after Reached (5 BD no fuel), Out of Reach (5 attempts), or Retention 10 BD expiry. Your own former deals never appear here.'
                        : 'Try another filter or refresh.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {claimModal ? (
        <PoolClaimModal
          mode={claimModal.mode}
          claimIds={claimIds}
          singleSummary={singleSummary}
          reason={reason}
          confirm={confirm}
          submitting={submitting}
          onReason={setReason}
          onConfirm={setConfirm}
          onClose={closeClaimModal}
          onSubmit={() => void submitClaim()}
        />
      ) : null}
    </>
  );
}
