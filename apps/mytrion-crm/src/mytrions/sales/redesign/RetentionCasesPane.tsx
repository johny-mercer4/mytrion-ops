/**
 * Retention Cases board — Kanban + List over the agent's Phase 1 cases.
 */
import { useEffect, useMemo, useState } from 'react';
import { useLoad } from '../../_shared/useLoad';
import { s } from './dc';
import { Icon } from './icons';
import { RetentionCaseDetail } from './RetentionCaseDetail';
import {
  breachSeverity,
  cadenceExplain,
  deadlineCaption,
  freqLabel,
  isOverdue,
  KANBAN_COLS,
  kanbanColOf,
  loadMyRetentionCases,
  loadRetentionCase,
  quietCaption,
  sortCasesPriority,
  statusLabel,
  type RetentionCaseRow,
  type RetentionKanbanCol,
} from './retentionData';
import { subscribeRetentionLive } from './retentionLiveBus';
import { useSales } from './ctx';

type ViewMode = 'kanban' | 'list';

export function RetentionCasesPane() {
  const { pushToast } = useSales();
  const feed = useLoad(() => loadMyRetentionCases(), []);
  const [view, setView] = useState<ViewMode>('kanban');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [localCases, setLocalCases] = useState<RetentionCaseRow[] | null>(null);
  const selectedSeed = useMemo(
    () => (selectedId ? (localCases ?? feed.data?.cases ?? []).find((c) => c.id === selectedId) ?? null : null),
    [selectedId, localCases, feed.data?.cases],
  );

  const cases = useMemo(() => {
    const src = localCases ?? feed.data?.cases ?? [];
    return sortCasesPriority(src);
  }, [localCases, feed.data?.cases]);

  /** First paint only — refresh keeps rows and spins the refresh icon alone. */
  const initialLoad = feed.loading && cases.length === 0 && !feed.error;

  const byCol = useMemo(() => {
    const map: Record<RetentionKanbanCol, RetentionCaseRow[]> = {
      new: [],
      working: [],
      out_of_reach: [],
      vacation: [],
      dissatisfied: [],
      exited: [],
    };
    for (const c of cases) map[kanbanColOf(c)].push(c);
    return map;
  }, [cases]);

  const onUpdated = (row: RetentionCaseRow): void => {
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

  // Live: new case / timer transitions → fetch row (or full list) without waiting for cron UI.
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

  return (
    <div style={s('display:flex;flex-direction:column;gap:14px;min-height:0')}>
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>
            My cases
          </div>
          <div style={s('font-size:13px;color:var(--muted);margin-top:2px')}>
            Deals that missed their fueling cadence · Phase 1 · 2 BD to act · Returned closes via
            hourly sync
          </div>
        </div>
        <div style={s('display:flex;align-items:center;gap:8px')}>
          <div style={s('display:inline-flex;padding:3px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt)')}>
            {([
              ['kanban', 'Kanban'],
              ['list', 'List'],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setView(id)}
                disabled={initialLoad}
                style={s(`height:30px;padding:0 12px;border:none;border-radius:calc(var(--radius-md) - 2px);background:${view === id ? 'var(--surface)' : 'transparent'};color:${view === id ? 'var(--text)' : 'var(--muted)'};font-size:12px;font-weight:700;cursor:pointer;box-shadow:${view === id ? 'var(--shadow-sm)' : 'none'}`)}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={refresh}
            aria-label="Refresh"
            disabled={feed.loading && cases.length === 0}
            className="ss-ico-btn"
            style={s('width:38px;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}
          >
            <Icon name="refresh" size={16} style={s(feed.loading ? 'animation:ss-spin .9s linear infinite' : '')} />
          </button>
        </div>
      </div>

      {!initialLoad && (
        <div style={s('display:flex;gap:8px;flex-wrap:wrap')}>
          <Pill label="Open" value={String(cases.filter((c) => c.isOpen && kanbanColOf(c) !== 'exited').length)} col="var(--accent)" />
          <Pill label="Overdue" value={String(cases.filter(isOverdue).length)} col="var(--danger)" />
          <Pill label="Total" value={String(feed.data?.total ?? cases.length)} col="var(--muted)" />
        </div>
      )}

      {feed.error && (
        <div style={s('padding:14px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border));background:color-mix(in srgb,var(--danger) 8%,transparent);color:var(--danger);font-size:13px')}>
          {feed.error}
        </div>
      )}

      {initialLoad && <CasesBoardSkeleton view={view} />}

      {!initialLoad && !feed.error && cases.length === 0 && (
        <div style={s('padding:48px 24px;text-align:center;border-radius:var(--radius-md);border:1px dashed var(--border);background:var(--alt)')}>
          <div style={s('font-size:15px;font-weight:700')}>No retention cases</div>
          <div style={s('font-size:13px;color:var(--muted);margin-top:6px;max-width:380px;margin-left:auto;margin-right:auto;line-height:1.5')}>
            When a client goes longer without fueling than their usual cadence (expected every 2 / 5 /
            7 days), a case appears here automatically.
          </div>
        </div>
      )}

      {view === 'kanban' && cases.length > 0 && (
        <div className="ss-scroll" style={s('display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;min-height:420px')}>
          {KANBAN_COLS.map((col) => (
            <div
              key={col.id}
              style={s('flex:0 0 240px;display:flex;flex-direction:column;gap:8px;min-height:0')}
            >
              <div style={s('display:flex;align-items:center;justify-content:space-between;padding:0 4px')}>
                <span style={s('font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>{col.label}</span>
                <span style={s("font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)")}>{byCol[col.id].length}</span>
              </div>
              <div style={s('flex:1;display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--alt) 80%,transparent);border:1px solid var(--border2);min-height:200px')}>
                {byCol[col.id].map((c) => (
                  <CaseCard key={c.id} row={c} onOpen={() => setSelectedId(c.id)} />
                ))}
                {byCol[col.id].length === 0 && (
                  <div style={s('padding:20px 8px;text-align:center;font-size:11px;color:var(--faint)')}>Empty</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {view === 'list' && cases.length > 0 && (
        <div style={s('border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:hidden;box-shadow:var(--shadow-sm)')}>
          <div className="ss-scroll" style={s('overflow:auto;max-height:calc(100vh - 280px)')}>
            <div style={s('min-width:920px')}>
              <div style={s("display:grid;grid-template-columns:1.4fr 110px 90px 1.1fr 90px 100px 90px 1fr;gap:10px;padding:11px 15px;background:var(--alt);border-bottom:1px solid var(--border);font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);position:sticky;top:0;z-index:2")}>
                <span>Company</span>
                <span>Carrier</span>
                <span>Freq</span>
                <span>Quiet</span>
                <span>Gallons</span>
                <span>Deadline</span>
                <span>Attempts</span>
                <span>Status</span>
              </div>
              {cases.map((c) => {
                const overdue = isOverdue(c);
                return (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => setSelectedId(c.id)}
                    style={s(`display:grid;grid-template-columns:1.4fr 110px 90px 1.1fr 90px 100px 90px 1fr;gap:10px;align-items:center;width:100%;padding:11px 15px;border:none;border-top:1px solid var(--border2);background:transparent;text-align:left;cursor:pointer;font-size:13px;color:var(--text)`)}
                  >
                    <span style={s('font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{c.companyName || '—'}</span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)")}>{c.carrierId}</span>
                    <span><FreqBadge f={c.transactionFrequency} /></span>
                    <span style={s(`font-size:12px;color:${breachSeverity(c) > 0 ? 'var(--warn)' : 'var(--muted)'}`)}>{quietCaption(c)}</span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px")}>{c.gallons90d != null ? Math.round(c.gallons90d).toLocaleString() : '—'}</span>
                    <span style={s(`font-size:12px;font-weight:600;color:${overdue ? 'var(--danger)' : 'var(--muted)'}`)}>{deadlineCaption(c)}</span>
                    <span style={s('font-size:12px')}>{attemptPips(c.outOfReachAttempts)}</span>
                    <span style={s('font-size:12px;font-weight:700;color:var(--text2)')}>{statusLabel(c.statusCode)}</span>
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

function Pill({ label, value, col }: { label: string; value: string; col: string }) {
  return (
    <span style={s(`display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;background:color-mix(in srgb,${col} 12%,transparent);font-size:12px;font-weight:700;color:${col}`)}>
      <span style={s(`width:7px;height:7px;border-radius:50%;background:${col}`)} />
      {value} {label}
    </span>
  );
}

function CasesBoardSkeleton({ view }: { view: ViewMode }) {
  if (view === 'list') {
    return (
      <div
        style={s('border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:hidden;padding:12px;display:flex;flex-direction:column;gap:10px')}
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
    <div
      className="ss-scroll"
      style={s('display:flex;gap:12px;overflow-x:auto;padding-bottom:8px;min-height:420px')}
      aria-busy="true"
      aria-label="Loading cases"
    >
      {KANBAN_COLS.map((col) => (
        <div key={col.id} style={s('flex:0 0 240px;display:flex;flex-direction:column;gap:8px')}>
          <div className="ss-skel" style={s('height:14px;width:40%')} />
          <div style={s('flex:1;display:flex;flex-direction:column;gap:8px;padding:8px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--alt) 80%,transparent);border:1px solid var(--border2);min-height:200px')}>
            {Array.from({ length: 3 }, (_, i) => (
              <div key={i} className="ss-skel" style={s('height:96px')} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FreqBadge({ f }: { f: RetentionCaseRow['transactionFrequency'] }) {
  const col = f === 'high' ? 'var(--danger)' : f === 'medium' ? 'var(--warn)' : f === 'low' ? 'var(--accent)' : 'var(--muted)';
  return (
    <span
      title={cadenceExplain(f)}
      style={s(`display:inline-flex;padding:2px 8px;border-radius:99px;background:color-mix(in srgb,${col} 14%,transparent);color:${col};font-size:10px;font-weight:800`)}
    >
      {freqLabel(f)}
    </span>
  );
}

function attemptPips(n: number): string {
  const filled = Math.min(5, Math.max(0, n));
  return `${'●'.repeat(filled)}${'○'.repeat(5 - filled)}`;
}

function CaseCard({ row, onOpen }: { row: RetentionCaseRow; onOpen: () => void }) {
  const overdue = isOverdue(row);
  return (
    <button
      type="button"
      onClick={onOpen}
      style={s(`text-align:left;padding:12px;border-radius:var(--radius-md);border:1px solid var(--border);border-left:3px solid ${overdue ? 'var(--danger)' : 'var(--accent)'};background:var(--surface);cursor:pointer;display:flex;flex-direction:column;gap:6px;box-shadow:var(--shadow-sm);transition:border-color .14s`)}
    >
      <div style={s('display:flex;justify-content:space-between;gap:6px;align-items:flex-start')}>
        <div style={s('font-size:13px;font-weight:700;line-height:1.3;overflow:hidden;text-overflow:ellipsis')}>{row.companyName || '—'}</div>
        <FreqBadge f={row.transactionFrequency} />
      </div>
      <div style={s("font-family:'JetBrains Mono',monospace;font-size:11px;color:var(--muted)")}>{row.carrierId}</div>
      <div style={s(`font-size:12px;font-weight:600;color:${breachSeverity(row) > 0 ? 'var(--warn)' : 'var(--muted)'}`)}>{quietCaption(row)}</div>
      <div style={s('display:flex;justify-content:space-between;align-items:center;gap:6px;font-size:11px')}>
        <span style={s('color:var(--text2)')}>{row.gallons90d != null ? `${Math.round(row.gallons90d).toLocaleString()} gal` : '—'}</span>
        <span style={s(`font-weight:700;color:${overdue ? 'var(--danger)' : 'var(--muted)'}`)}>{deadlineCaption(row)}</span>
      </div>
      {row.outOfReachAttempts > 0 && (
        <div style={s('font-size:11px;color:var(--muted);letter-spacing:.08em')}>{attemptPips(row.outOfReachAttempts)}</div>
      )}
    </button>
  );
}
