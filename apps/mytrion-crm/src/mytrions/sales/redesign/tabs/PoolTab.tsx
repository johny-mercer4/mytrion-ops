/**
 * Open Pool — other agents' retention cases in p1_open_pool (never your own former deals).
 * Instant claim (reason required) → Zoho ownership + Kanban New. Max 2 claims / UTC day.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { getImpersonation } from '../../../../api/impersonation';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { useLoad } from '../../../_shared/useLoad';
import { RetentionHero, RetentionPoolMetrics, fmtGal } from '../RetentionBoardUi';
import { PoolClaimModal } from '../PoolClaimModal';
import {
  claimOpenPoolCase,
  loadOpenPoolCases,
  loadOpenPoolQuota,
  quietCaption,
  type RetentionCaseRow,
} from '../retentionData';
import { subscribeRetentionLive } from '../retentionLiveBus';
import { stageTimer } from '../retentionTimers';

type PoolQuota = { used: number; max: number; remaining: number };

type SortKey = 'carrierId' | 'companyName' | 'daysInactive' | 'gallons90d' | 'assignmentCount';
type StatusFilter = 'available' | 'all';

type ClaimModal =
  | { mode: 'single'; caseId: string }
  | { mode: 'bulk'; caseIds: string[] }
  | null;

const STATUS_FILTERS: Array<{ id: StatusFilter; label: string; hint: string }> = [
  { id: 'available', label: 'Available', hint: 'Ready to claim' },
  { id: 'all', label: 'All', hint: 'Everything in the pool' },
];

function claimWindowLabel(c: RetentionCaseRow): {
  text: string;
  tone: 'ok' | 'warn' | 'danger' | 'muted';
} {
  const t = stageTimer(c);
  if (!t) return { text: '—', tone: 'muted' };
  return {
    text: t.remain,
    tone: t.tone === 'danger' ? 'danger' : t.tone === 'warn' ? 'warn' : 'ok',
  };
}

const ENTRY_BADGES: Array<{ label: string; hint: string; tone: 'ok' | 'warn' | 'accent' }> = [
  { label: 'Reached', hint: '5 BD no fuel', tone: 'ok' },
  { label: 'Out of Reach', hint: '5 attempts', tone: 'warn' },
  { label: 'Retention', hint: '10 BD expiry', tone: 'accent' },
];

function PoolEmptyState({
  error,
  searching,
  claimsLeft,
  onClearSearch,
}: {
  error: string | null;
  searching: boolean;
  claimsLeft: number | null;
  onClearSearch: () => void;
}) {
  if (error) {
    return (
      <div className="ss-pool-empty is-error" role="alert">
        <div className="ss-pool-empty-glow" aria-hidden />
        <div className="ss-pool-empty-ico is-danger" aria-hidden>
          <Icon name="alert" size={22} />
        </div>
        <div className="ss-pool-empty-title">Could not load Open Pool</div>
        <p className="ss-pool-empty-body">{error}</p>
        <div className="ss-pool-empty-badges">
          <span className="ss-pool-empty-badge is-danger">Refresh &amp; try again</span>
        </div>
      </div>
    );
  }

  if (searching) {
    return (
      <div className="ss-pool-empty" role="status">
        <div className="ss-pool-empty-glow" aria-hidden />
        <div className="ss-pool-empty-ico" aria-hidden>
          <Icon name="search" size={22} />
        </div>
        <div className="ss-pool-empty-title">No matches</div>
        <p className="ss-pool-empty-body">
          Nothing in the pool matches that carrier or company. Clear search to see all available
          deals.
        </p>
        <button type="button" className="ss-pool-empty-cta" onClick={onClearSearch}>
          Clear search
        </button>
      </div>
    );
  }

  return (
    <div className="ss-pool-empty" role="status">
      <div className="ss-pool-empty-glow" aria-hidden />
      <div className="ss-pool-empty-ico" aria-hidden>
        <Icon name="pool" size={24} />
      </div>
      <div className="ss-pool-empty-kicker">
        <span className="ss-pool-empty-pill is-ok">Pool clear</span>
        {claimsLeft != null ? (
          <span className="ss-pool-empty-pill">
            {claimsLeft} claim{claimsLeft !== 1 ? 's' : ''} left today
          </span>
        ) : null}
      </div>
      <div className="ss-pool-empty-title">No available deals</div>
      <p className="ss-pool-empty-body">
        Quiet deals land here for anyone to claim. Your own former deals stay hidden. Unclaimed
        after 3 BD → Retention.
      </p>
      <div className="ss-pool-empty-badges" aria-label="How deals enter the pool">
        {ENTRY_BADGES.map((b) => (
          <span key={b.label} className={`ss-pool-empty-badge is-${b.tone}`}>
            <em>{b.label}</em>
            <span>{b.hint}</span>
          </span>
        ))}
      </div>
      <div className="ss-pool-empty-foot">
        <Icon name="info" size={14} />
        <span>Max 2 claims / day · Cycle up to 3 agents</span>
      </div>
    </div>
  );
}

export function PoolTab({ onAvailableCount }: { onAvailableCount?: (n: number) => void }) {
  const { pushToast } = useSales();
  const actAsKey = getImpersonation()?.zohoUserId ?? 'self';
  const feed = useLoad(() => loadOpenPoolCases(), [actAsKey]);
  const quota = useLoad(() => loadOpenPoolQuota(), [actAsKey]);
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
  /** Immediate post-claim quota so the badge does not wait on a second fetch. */
  const [quotaSnap, setQuotaSnap] = useState<PoolQuota | null>(null);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setQuotaSnap(null);
  }, [actAsKey]);

  useEffect(() => {
    if (quota.data) setQuotaSnap(quota.data);
  }, [quota.data]);

  useEffect(() => {
    if (!feed.data?.cases) return;
    setCases(feed.data.cases.filter((c) => c.statusCode === 'p1_open_pool'));
  }, [feed.data?.cases]);

  const claimable = cases;

  useEffect(() => {
    if (!feed.loading) onAvailableCount?.(claimable.length);
  }, [claimable.length, feed.loading, onAvailableCount]);

  const refresh = (): void => {
    setSpin(true);
    feed.reload();
    quota.reload();
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
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = cases.slice();
    if (statusFilter === 'available') rows = rows.filter((c) => c.statusCode === 'p1_open_pool');
    if (q) {
      rows = rows.filter((c) =>
        `${c.carrierId} ${c.companyName ?? ''}`.toLowerCase().includes(q),
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
  }, [cases, search, sort, statusFilter]);

  const toggleAll = (): void => {
    const ids = filtered.map((c) => c.id);
    setSelected((sel) => (ids.length > 0 && ids.every((id) => sel.includes(id)) ? [] : ids));
  };

  const toggleSort = (k: SortKey): void =>
    setSort((cur) => ({ key: k, dir: cur.key === k && cur.dir === 'asc' ? 'desc' : 'asc' }));

  const arrow = (k: SortKey): string => (sort.key === k ? (sort.dir === 'desc' ? '▼' : '▲') : '');

  const claimIds = claimModal
    ? claimModal.mode === 'single'
      ? [claimModal.caseId]
      : claimModal.caseIds
    : [];

  const singleSummary =
    claimModal?.mode === 'single'
      ? (cases.find((c) => c.id === claimModal.caseId) ?? null)
      : null;

  const submitClaim = async (): Promise<void> => {
    if (!claimIds.length || !reason.trim() || !confirm || submitting) return;
    setSubmitting(true);
    const ids = claimIds.slice();
    const sharedReason = reason.trim();
    let ok = 0;
    const errors: string[] = [];
    let lastQuota: PoolQuota | null = null;
    for (const id of ids) {
      try {
        const res = await claimOpenPoolCase(id, sharedReason);
        ok += 1;
        if (res.quota) {
          lastQuota = res.quota;
          setQuotaSnap(res.quota);
        }
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Failed');
        // Cap hit mid-bulk — stop so we don't spam 429s.
        if (/daily|2 claim|limit|quota|per day|RETENTION_OPEN_POOL_DAILY_CAP/i.test(errors[errors.length - 1] ?? '')) {
          break;
        }
      }
    }
    setSubmitting(false);
    setClaimModal(null);
    setReason('');
    setConfirm(false);
    setSelected([]);
    feed.reload();
    quota.reload();
    if (ok > 0) {
      const left = lastQuota?.remaining;
      pushToast(
        'Assigned — in New',
        left != null
          ? `${ok} deal${ok !== 1 ? 's' : ''} claimed · ${left} claim${left !== 1 ? 's' : ''} left today`
          : `${ok} deal${ok !== 1 ? 's' : ''} claimed`,
      );
    }
    if (errors.length > 0) {
      const first = errors[0] ?? 'Could not claim';
      const daily =
        /daily|2 claim|limit|quota|per day/i.test(first)
          ? 'Daily limit reached (2). Try tomorrow.'
          : /3 agents|CITI|maximum/i.test(first)
            ? 'This deal already had 3 agents — CITI.'
            : first;
      pushToast('Claim failed', daily);
    }
  };

  const allChecked =
    filtered.length > 0 && filtered.every((c) => selected.includes(c.id));
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

  const remaining = quotaSnap?.remaining ?? quota.data?.remaining ?? null;

  return (
    <>
      <div
        className="ss-fu ss-pool"
        style={s('display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:480px')}
      >
        <div style={s('margin-bottom:14px')}>
          <RetentionHero
            title="Open Pool"
            sub="Take quiet deals. Max 2 per day. Cycle up to 3. Unclaimed 3 BD → Retention."
            actions={
              <>
                {remaining != null ? (
                  <span
                    className={`ss-pool-quota${remaining <= 0 ? ' is-empty' : remaining === 1 ? ' is-low' : ''}`}
                    title="Open Pool claims left today (UTC day)"
                  >
                    Claims left today · {remaining}
                    {quotaSnap?.max != null || quota.data?.max != null
                      ? ` / ${quotaSnap?.max ?? quota.data?.max}`
                      : ''}
                  </span>
                ) : null}
                <button
                  type="button"
                  disabled={
                    submitting ||
                    !selected.length ||
                    (remaining != null && remaining <= 0)
                  }
                  onClick={() => {
                    if (!selected.length || submitting) return;
                    openClaimModal({ mode: 'bulk', caseIds: selected.slice() });
                  }}
                  className={selected.length && !submitting ? 'ss-btn-p' : undefined}
                  style={s(
                    selected.length && !submitting
                      ? 'height:38px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:7px'
                      : 'height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13px;cursor:not-allowed;display:flex;align-items:center;gap:7px',
                  )}
                >
                  <Icon name="assign" size={15} strokeWidth={2.2} />
                  {submitting
                    ? 'Claiming…'
                    : `Claim${selected.length ? ` (${selected.length})` : ''}`}
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
            <span className="ss-pool-howto-ico" aria-hidden>
              <Icon name="assign" size={15} />
            </span>
            <div>
              <strong>1. Claim</strong>
              <span>Select deals + short reason</span>
            </div>
          </div>
          <div>
            <span className="ss-pool-howto-ico" aria-hidden>
              <Icon name="bolt" size={15} />
            </span>
            <div>
              <strong>2. Instant assign</strong>
              <span>Ownership transfers now</span>
            </div>
          </div>
          <div>
            <span className="ss-pool-howto-ico" aria-hidden>
              <Icon name="board" size={15} />
            </span>
            <div>
              <strong>3. Your New</strong>
              <span>Lands in New · 2 BD to act</span>
            </div>
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
                <em>{f.id === 'available' ? claimable.length : cases.length}</em>
              </button>
            ))}
          </div>
          <div className="ss-pool-search">
            <Icon name="search" size={15} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search carrier or company…"
              className="ss-in"
            />
          </div>
        </div>

        {feed.error && <div className="ss-pool-error">{feed.error}</div>}

        <div className={`ss-pool-table-wrap${submitting ? ' is-busy' : ''}`}>
          <div className="ss-scroll" style={s('flex:1;overflow:auto')}>
            <div style={s(filtered.length === 0 && !feed.loading ? '' : 'min-width:920px')}>
              {(filtered.length > 0 || feed.loading) && (
              <div className="ss-pool-head">
                <span className="ss-pool-check">
                  <input
                    type="checkbox"
                    checked={allChecked}
                    onChange={toggleAll}
                    disabled={filtered.length === 0 || submitting}
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
              )}

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
                    </div>
                  ))
                : null}

              {filtered.map((c, i) => {
                const on = selected.includes(c.id);
                const window = claimWindowLabel(c);
                return (
                  <div
                    key={c.id}
                    role="button"
                    tabIndex={submitting ? -1 : 0}
                    onClick={() => {
                      if (submitting) return;
                      openClaimModal({ mode: 'single', caseId: c.id });
                    }}
                    onKeyDown={(e) => {
                      if (submitting) return;
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        openClaimModal({ mode: 'single', caseId: c.id });
                      }
                    }}
                    className={`ss-pool-row${on ? ' is-selected' : ''} is-claimable${submitting ? ' is-processing' : ''}`}
                  >
                    <span className="ss-pool-check" onClick={stop}>
                      <input
                        type="checkbox"
                        checked={on}
                        disabled={submitting}
                        onChange={() => toggle(c.id)}
                        aria-label={`Select ${c.companyName || c.carrierId}`}
                      />
                    </span>
                    <span className="ss-pool-mono muted">{i + 1}</span>
                    <span className="ss-pool-mono">{c.carrierId}</span>
                    <span className="ss-pool-company">{c.companyName || '—'}</span>
                    <span className="ss-pool-quiet">{quietCaption(c)}</span>
                    <span className="ss-pool-mono">
                      {c.gallons90d != null ? fmtGal(c.gallons90d) : '—'}
                    </span>
                    <span className="ss-pool-cycle">Cycle {c.assignmentCount}/3</span>
                    <span className={`ss-pool-window is-${window.tone}`}>{window.text}</span>
                    <span>
                      <span className="ss-pool-status is-ok">Available</span>
                    </span>
                  </div>
                );
              })}

              {filtered.length === 0 && !feed.loading && (
                <PoolEmptyState
                  error={feed.error}
                  searching={Boolean(search.trim())}
                  claimsLeft={remaining}
                  onClearSearch={() => setSearch('')}
                />
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
