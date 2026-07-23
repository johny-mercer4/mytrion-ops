/**
 * CS Open Pool — readonly list of Sales pool cases (no claim). Timeline on select.
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Building2,
  CalendarClock,
  Hash,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';
import type { RetentionCaseEventRow, RetentionCaseRow } from '@/api/touchpointTypes';
import { csRetention } from '@/api/csRetention';
import { useLoad } from '../live';
import { subscribeCsRetentionLive } from './retentionLiveBus';
import { CaseBadge, CasesListSkeleton, deadlineLabel, statusLabel } from './casesUi';

function fmtWhen(iso: string | null | undefined): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return iso;
  }
}

function quietLabel(c: RetentionCaseRow): string {
  if (c.daysInactive == null) return '—';
  return `${c.daysInactive}d quiet`;
}

function windowLabel(c: RetentionCaseRow): string {
  return deadlineLabel(c) || '—';
}

const ENTRY_CHIPS = [
  { label: 'Reached', hint: '5 BD no fuel' },
  { label: 'Out of Reach', hint: '5 attempts' },
  { label: 'Retention', hint: '10 BD expiry' },
] as const;

export function OpenPoolReadonlyPanel() {
  const feed = useLoad(
    () => csRetention.cases({ phase: 'sales', status: 'open_pool', limit: 200 }),
    [],
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');

  useEffect(
    () =>
      subscribeCsRetentionLive(() => {
        feed.reload();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const cases = useMemo(() => {
    const rows = (feed.data?.cases ?? []).filter(
      (c) => c.statusCode === 'p1_open_pool' || c.statusCode === 'p1_pool_claim_pending',
    );
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((c) =>
      `${c.carrierId} ${c.companyName ?? ''}`.toLowerCase().includes(q),
    );
  }, [feed.data?.cases, search]);

  const poolGallons = useMemo(
    () => cases.reduce((sum, c) => sum + (c.gallons90d ?? 0), 0),
    [cases],
  );

  useEffect(() => {
    if (selectedId && !cases.some((c) => c.id === selectedId)) {
      setSelectedId(null);
    }
  }, [cases, selectedId]);

  const selected = cases.find((c) => c.id === selectedId) ?? null;
  const [events, setEvents] = useState<RetentionCaseEventRow[]>([]);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedId) {
      setEvents([]);
      setDetailError(null);
      setDetailLoading(false);
      return;
    }
    let cancelled = false;
    setDetailLoading(true);
    setDetailError(null);
    void csRetention
      .caseGet(selectedId)
      .then((res) => {
        if (!cancelled) setEvents(res.events ?? []);
      })
      .catch((e) => {
        if (!cancelled) {
          setEvents([]);
          setDetailError(e instanceof Error ? e.message : 'Failed to load timeline');
        }
      })
      .finally(() => {
        if (!cancelled) setDetailLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId]);

  return (
    <div className="cs-panel cs-ret-panel cs-pool-panel">
      <div className="cs-panel-header">
        <div>
          <div className="cs-pool-kicker">
            <Layers size={13} strokeWidth={2.3} aria-hidden />
            Sales Open Pool · readonly
          </div>
          <h2 className="cs-panel-title">Open Pool</h2>
          <p className="cs-panel-sub">
            Watch quiet deals waiting for Sales to claim. No claim from CS — use Retention Cases for
            your Phase 2 desk.
          </p>
        </div>
        <button
          type="button"
          className={`cs-btn cs-btn-ghost${feed.refreshing ? ' is-spinning' : ''}`}
          onClick={() => feed.refresh()}
          disabled={feed.refreshing}
        >
          <RefreshCw size={14} strokeWidth={2.3} aria-hidden />
          Refresh
        </button>
      </div>

      <div className="cs-pool-metrics" aria-label="Pool snapshot">
        <div className="cs-pool-metric">
          <span>In pool</span>
          <strong>{cases.length}</strong>
          <em>Available now</em>
        </div>
        <div className="cs-pool-metric">
          <span>Gallons</span>
          <strong>
            {poolGallons > 0 ? Math.round(poolGallons).toLocaleString('en-US') : '—'}
          </strong>
          <em>90d listed</em>
        </div>
        <div className="cs-pool-metric">
          <span>Claim</span>
          <strong>Sales</strong>
          <em>Instant · max 2/day</em>
        </div>
      </div>

      <div className="cs-pool-toolbar">
        <div className="cs-pool-search">
          <Search size={15} strokeWidth={2.2} aria-hidden />
          <input
            className="cs-form-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search carrier or company…"
            aria-label="Search carrier or company"
          />
        </div>
        <CaseBadge tone="orange">Readonly</CaseBadge>
        <CaseBadge tone="info">{cases.length} deals</CaseBadge>
      </div>

      {feed.loading && !feed.data ? (
        <CasesListSkeleton />
      ) : feed.error ? (
        <p className="cs-error">{feed.error}</p>
      ) : (
        <div className="cs-ret-split">
          <div className="cs-ret-list">
            {cases.length === 0 ? (
              <div className="cs-pool-empty" role="status">
                <div className="cs-pool-empty-ico" aria-hidden>
                  <Sparkles size={22} strokeWidth={2.1} />
                </div>
                <div className="cs-pool-empty-title">
                  {search.trim() ? 'No matches' : 'Pool is clear'}
                </div>
                <p className="cs-pool-empty-body">
                  {search.trim()
                    ? 'Try another carrier ID or company name.'
                    : 'Deals enter from Sales when Reached, Out of Reach, or Retention timers expire. Your Retention Cases desk stays separate.'}
                </p>
                {!search.trim() ? (
                  <div className="cs-pool-empty-chips">
                    {ENTRY_CHIPS.map((c) => (
                      <span key={c.label} className="cs-pool-empty-chip">
                        <strong>{c.label}</strong>
                        <span>{c.hint}</span>
                      </span>
                    ))}
                  </div>
                ) : (
                  <button
                    type="button"
                    className="cs-btn cs-btn-ghost"
                    style={{ marginTop: 14 }}
                    onClick={() => setSearch('')}
                  >
                    Clear search
                  </button>
                )}
              </div>
            ) : (
              cases.map((c, i) => (
                <button
                  key={c.id}
                  type="button"
                  className={`cs-ret-row${selectedId === c.id ? ' active' : ''}`}
                  style={{ animationDelay: `${Math.min(i, 10) * 35}ms` }}
                  onClick={() => setSelectedId(c.id)}
                >
                  <div className="cs-ret-row-top">
                    <strong className="cs-ret-row-title">
                      <Building2 size={15} strokeWidth={2.2} aria-hidden />
                      {c.companyName || c.carrierId}
                    </strong>
                    <span className="cs-ret-due is-ok">
                      <CalendarClock size={12} strokeWidth={2.3} aria-hidden />
                      {windowLabel(c)}
                    </span>
                  </div>
                  <div className="cs-ret-row-badges">
                    <CaseBadge tone="orange">{statusLabel(c.statusCode)}</CaseBadge>
                    <CaseBadge tone="info">Cycle {c.assignmentCount}/3</CaseBadge>
                    <CaseBadge tone="warning">{quietLabel(c)}</CaseBadge>
                  </div>
                  <div className="cs-ret-row-meta">
                    <span className="cs-ret-row-carrier">
                      <Hash size={12} strokeWidth={2.3} aria-hidden />
                      {c.carrierId}
                    </span>
                    <span>
                      {c.gallons90d != null
                        ? `${Math.round(c.gallons90d).toLocaleString('en-US')} gal`
                        : '—'}
                    </span>
                  </div>
                </button>
              ))
            )}
          </div>

          <aside className="cs-ret-detail">
            {!selected ? (
              <div className="cs-pool-detail-empty">
                <Layers size={28} strokeWidth={1.8} aria-hidden />
                <strong>Select a deal</strong>
                <p>Timeline includes claim transfers when Sales agents take ownership.</p>
              </div>
            ) : detailLoading ? (
              <p className="cs-muted">Loading timeline…</p>
            ) : detailError ? (
              <p className="cs-error">{detailError}</p>
            ) : (
              <div className="cs-ret-detail-body">
                <div className="cs-ret-detail-head">
                  <h3>
                    <Building2 size={18} strokeWidth={2.2} aria-hidden />
                    {selected.companyName || selected.carrierId}
                  </h3>
                  <div className="cs-ret-row-badges" style={{ marginTop: 10 }}>
                    <CaseBadge tone="orange">{statusLabel(selected.statusCode)}</CaseBadge>
                    <CaseBadge tone="info">Cycle {selected.assignmentCount}/3</CaseBadge>
                    <CaseBadge tone="warning">{quietLabel(selected)}</CaseBadge>
                  </div>
                  <p className="cs-muted" style={{ marginTop: 10, fontSize: 12 }}>
                    Carrier {selected.carrierId} · window {windowLabel(selected)}
                  </p>
                </div>
                <div className="cs-ret-timeline">
                  <div className="cs-ret-section-lbl">Timeline</div>
                  {events.length === 0 ? (
                    <p className="cs-muted">No events yet.</p>
                  ) : (
                    <ul className="cs-pool-timeline">
                      {events.map((ev) => (
                        <li key={ev.id}>
                          <div className="cs-pool-timeline-when">
                            {fmtWhen(ev.occurredAt)} · {ev.eventType}
                          </div>
                          <div className="cs-pool-timeline-note">
                            {ev.notes?.trim() ||
                              `${ev.fromStatus ?? '—'} → ${ev.toStatus ?? '—'}`}
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}
