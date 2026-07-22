/**
 * Retention Cases board — Kanban + List over the agent's Phase 1 cases.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLoad } from '../../_shared/useLoad';
import { s } from './dc';
import { Icon } from './icons';
import { RetentionCaseDetail } from './RetentionCaseDetail';
import {
  RetentionCaseCard,
  RetentionCasesMetrics,
  RetentionColHead,
  RetentionEmpty,
  RetentionFreqBadge,
  RetentionHero,
  RetentionStageTimer,
  attemptPips,
  fmtGal,
} from './RetentionBoardUi';
import {
  breachSeverity,
  KANBAN_COLS,
  kanbanColOf,
  loadMyRetentionCases,
  loadRetentionCase,
  quietCaption,
  retentionBoardStats,
  sortCasesPriority,
  statusLabel,
  type RetentionCaseRow,
  type RetentionKanbanCol,
} from './retentionData';
import { isSalesLocked, isSalesPooled, stageTimer } from './retentionTimers';
import { subscribeRetentionLive } from './retentionLiveBus';
import { useSales } from './ctx';

type ViewMode = 'kanban' | 'list';

const LIST_GRID =
  'grid-template-columns:1.4fr 110px 90px 1.1fr 90px 160px 90px 1fr';

function useBoardClock(ms = 30_000): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = window.setInterval(() => setNow(new Date()), ms);
    return () => window.clearInterval(id);
  }, [ms]);
  return now;
}

export function RetentionCasesPane({ onOpenCount }: { onOpenCount?: (n: number) => void }) {
  const { pushToast } = useSales();
  const feed = useLoad(() => loadMyRetentionCases(), []);
  const now = useBoardClock();
  const [view, setView] = useState<ViewMode>('kanban');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localCases, setLocalCases] = useState<RetentionCaseRow[] | null>(null);
  const selectedSeed = useMemo(
    () => (selectedId ? (localCases ?? feed.data?.cases ?? []).find((c) => c.id === selectedId) ?? null : null),
    [selectedId, localCases, feed.data?.cases],
  );

  // Dissatisfied cards are locked — never keep the detail modal open on them.
  useEffect(() => {
    if (selectedSeed && isSalesLocked(selectedSeed)) setSelectedId(null);
  }, [selectedSeed]);

  const cases = useMemo(() => {
    const src = localCases ?? feed.data?.cases ?? [];
    return sortCasesPriority(src);
  }, [localCases, feed.data?.cases]);

  const stats = useMemo(() => retentionBoardStats(cases), [cases]);

  useEffect(() => {
    onOpenCount?.(stats.openActive);
  }, [stats.openActive, onOpenCount]);

  /** First paint only — refresh keeps rows and spins the refresh icon alone. */
  const initialLoad = feed.loading && cases.length === 0 && !feed.error;

  const byCol = useMemo(() => {
    const map: Record<RetentionKanbanCol, RetentionCaseRow[]> = {
      new: [],
      reached: [],
      out_of_reach: [],
      vacation: [],
      dissatisfied: [],
      closed: [],
    };
    for (const c of cases) map[kanbanColOf(c)].push(c);
    return map;
  }, [cases]);

  const onUpdated = (row: RetentionCaseRow): void => {
    // Keep Open Pool / Retention / CITI on the board as locked former-owner cards.
    if (isSalesLocked(row) && selectedId === row.id) setSelectedId(null);
    setLocalCases((prev) => {
      const base = prev ?? feed.data?.cases ?? [];
      const idx = base.findIndex((x) => x.id === row.id);
      if (idx < 0) return [row, ...base];
      const next = base.slice();
      next[idx] = row;
      return next;
    });
  };

  const refresh = (): void => {
    setLocalCases(null);
    feed.reload();
  };

  useEffect(
    () =>
      subscribeRetentionLive((payload) => {
        if (payload.type === 'retention.case.created' && payload.caseId) {
          void loadRetentionCase(payload.caseId)
            .then((detail) => {
              onUpdated(detail.case);
            })
            .catch(() => {
              refresh();
              pushToast('New retention case', 'Refresh if it does not appear yet');
            });
          return;
        }
        if (
          payload.type === 'retention.case.created' ||
          payload.type === 'retention.pool.opened' ||
          payload.type === 'retention.ops.vacation_signoff'
        ) {
          refresh();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable bus; avoid reload churn
    [],
  );

  const viewToggle = (
    <div className="ss-ret-tabs" role="tablist" aria-label="Board view">
      {([
        ['kanban', 'Kanban'],
        ['list', 'List'],
      ] as const).map(([id, label]) => (
        <button
          key={id}
          type="button"
          role="tab"
          aria-selected={view === id}
          onClick={() => setView(id)}
          disabled={initialLoad}
          className={`ss-ret-tab${view === id ? ' is-on' : ''}`}
        >
          {label}
        </button>
      ))}
    </div>
  );

  const refreshBtn = (
    <button
      type="button"
      onClick={refresh}
      aria-label="Refresh"
      disabled={feed.loading && cases.length === 0}
      className="ss-ico-btn"
      style={s(
        'width:38px;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center',
      )}
    >
      <Icon name="refresh" size={16} style={s(feed.loading ? 'animation:ss-spin .9s linear infinite' : '')} />
    </button>
  );

  return (
    <div style={s('display:flex;flex-direction:column;gap:14px;min-height:0')}>
      <RetentionHero
        title="My cases"
        sub="New → call → stage · excludes debtors, pre–Card Swiped, Closed Lost / OoB"
        actions={
          <>
            {viewToggle}
            {refreshBtn}
          </>
        }
      >
        {!initialLoad && <RetentionCasesMetrics stats={stats} />}
      </RetentionHero>

      {feed.error && (
        <div
          style={s(
            'padding:14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border));background:color-mix(in srgb,var(--danger) 8%,transparent);color:var(--danger);font-size:13px',
          )}
        >
          {feed.error}
        </div>
      )}

      {initialLoad && <CasesBoardSkeleton view={view} />}

      {!initialLoad && !feed.error && cases.length === 0 && (
        <RetentionEmpty
          title="No retention cases"
          body="When a client goes longer without fueling than their usual cadence (expected every 2 / 5 / 7 days), a case appears here automatically."
        />
      )}

      {view === 'kanban' && cases.length > 0 && (
        <div className="ss-scroll ss-ret-board">
          {KANBAN_COLS.map((col) => {
            const rows = byCol[col.id];
            const gal = stats.byCol[col.id].gallons;
            return (
              <div key={col.id} className="ss-ret-col">
                <RetentionColHead
                  label={col.label}
                  hint={col.hint}
                  color={col.color}
                  count={rows.length}
                  gallons={gal}
                />
                <div className="ss-ret-col-body" style={{ boxShadow: `inset 0 2px 0 ${col.color}` }}>
                  {rows.map((c, i) => (
                    <RetentionCaseCard
                      key={c.id}
                      row={c}
                      colColor={col.color}
                      index={i}
                      now={now}
                      onOpen={() => setSelectedId(c.id)}
                    />
                  ))}
                  {rows.length === 0 && (
                    <div style={s('padding:28px 8px;text-align:center;font-size:11px;color:var(--faint);font-weight:600')}>
                      Empty
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {view === 'list' && cases.length > 0 && (
        <div
          style={s(
            'border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:hidden;box-shadow:var(--shadow-sm)',
          )}
        >
          <div className="ss-scroll" style={s('overflow:auto;max-height:calc(100vh - 320px)')}>
            <div style={s('min-width:920px')}>
              <div
                style={s(
                  `display:grid;${LIST_GRID};gap:10px;padding:11px 15px;background:var(--alt);border-bottom:1px solid var(--border);font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);position:sticky;top:0;z-index:2`,
                )}
              >
                <span>Company</span>
                <span>Carrier</span>
                <span>Freq</span>
                <span>Quiet</span>
                <span>Gallons</span>
                <span>Timer</span>
                <span>Attempts</span>
                <span>Status</span>
              </div>
              {cases.map((c) => {
                const locked = isSalesLocked(c);
                const pooled = isSalesPooled(c);
                const timer = locked ? null : stageTimer(c, now);
                const overdue = Boolean(timer?.overdue);
                if (locked) {
                  const statusTxt = pooled
                    ? c.statusCode === 'p1_pool_claim_pending'
                      ? 'Open Pool · pending'
                      : 'Open Pool'
                    : c.phaseCode === 'phase_3_citi'
                      ? 'CITI'
                      : c.agentOutcome === 'dissatisfied' || c.statusCode === 'p1_dissatisfied'
                        ? 'Dissatisfied'
                        : 'Retention';
                  return (
                    <div
                      key={c.id}
                      className={`ss-ret-list-row is-locked${pooled ? ' is-pooled' : ''}`}
                      style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 90px 1.1fr 90px 160px 90px 1fr' }}
                      title={
                        pooled
                          ? 'Sent to Open Pool — locked for you'
                          : 'Handed off — locked for Sales'
                      }
                    >
                      <span style={s('font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                        {c.companyName || '—'}
                      </span>
                      <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)")}>
                        {c.carrierId}
                      </span>
                      <span>
                        <RetentionFreqBadge f={c.transactionFrequency} />
                      </span>
                      <span style={s('font-size:12px;color:var(--muted)')}>{quietCaption(c)}</span>
                      <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px")}>
                        {c.gallons90d != null ? fmtGal(c.gallons90d) : '—'}
                      </span>
                      <span
                        className={`ss-ret-locked-badge${pooled ? ' is-pooled' : ''}`}
                        style={{ padding: '4px 6px' }}
                      >
                        {pooled ? '→ Open Pool' : c.phaseCode === 'phase_3_citi' ? '→ CITI' : '→ Retention'}
                      </span>
                      <span className="ss-ret-pips">—</span>
                      <span
                        style={s(
                          `font-size:12px;font-weight:700;color:${pooled ? 'var(--warn)' : 'var(--danger)'}`,
                        )}
                      >
                        {statusTxt}
                      </span>
                    </div>
                  );
                }
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    className={`ss-ret-list-row${overdue ? ' is-overdue' : ''}`}
                    style={{ display: 'grid', gridTemplateColumns: '1.4fr 110px 90px 1.1fr 90px 160px 90px 1fr' }}
                  >
                    <span style={s('font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                      {c.companyName || '—'}
                    </span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)")}>
                      {c.carrierId}
                    </span>
                    <span>
                      <RetentionFreqBadge f={c.transactionFrequency} />
                    </span>
                    <span
                      style={s(
                        `font-size:12px;color:${breachSeverity(c) > 0 ? 'var(--warn)' : 'var(--muted)'}`,
                      )}
                    >
                      {quietCaption(c)}
                    </span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px")}>
                      {c.gallons90d != null ? fmtGal(c.gallons90d) : '—'}
                    </span>
                    <span>
                      {timer ? (
                        <RetentionStageTimer timer={timer} compact />
                      ) : (
                        <span style={s('font-size:12px;color:var(--faint)')}>—</span>
                      )}
                    </span>
                    <span className="ss-ret-pips">{attemptPips(c.outOfReachAttempts)}</span>
                    <span style={s('font-size:12px;font-weight:700;color:var(--text2)')}>
                      {statusLabel(c.statusCode)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {selectedId && (
        <RetentionCaseDetail
          caseId={selectedId}
          seed={selectedSeed}
          onClose={() => setSelectedId(null)}
          onUpdated={onUpdated}
        />
      )}
    </div>
  );
}

function CasesBoardSkeleton({ view }: { view: ViewMode }) {
  if (view === 'list') {
    return (
      <div
        style={s(
          'border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:10px',
        )}
        aria-busy="true"
        aria-label="Loading cases"
      >
        <div className="ss-skel" style={s('height:36px')} />
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="ss-skel" style={s('height:44px')} />
        ))}
      </div>
    );
  }
  return (
    <div className="ss-scroll ss-ret-board" aria-busy="true" aria-label="Loading cases">
      {KANBAN_COLS.map((col) => (
        <div key={col.id} className="ss-ret-col">
          <div className="ss-skel" style={s('height:36px')} />
          <div className="ss-ret-col-body">
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="ss-skel" style={s('height:104px')} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
