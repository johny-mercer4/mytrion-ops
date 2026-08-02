/**
 * Sales Call Hub — agent call history (Mytrion + Zoho). Softphone stays global.
 * Always scoped to the signed-in / View-as agent (backend honors x-act-as-*).
 */
import { useMemo, useState } from 'react';
import {
  listCallHubCalls,
  type CallHubItem,
  type CallHubSource,
  type CallHubStatus,
} from '@/api/callHub';
import { getSession } from '@/api/session';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { CallDetailModal } from '../CallDetailModal';
import { useCachedLoad } from '../dcCache';
import { s } from '../dc';
import { Icon } from '../icons';

type SourceFilter = CallHubSource | 'all';
type StatusFilter = CallHubStatus | 'all';

const PAGE_SIZE = 25;

const SOURCE_TONE: Record<CallHubSource, string> = {
  mytrion: 'var(--accent)',
  zoho: 'var(--ok)',
  gong: 'var(--violet)',
};

function formatWhen(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const sRem = Math.round(seconds % 60);
  return `${m}:${String(sRem).padStart(2, '0')}`;
}

function CallHubSkeleton() {
  return (
    <div className="ss-fu ss-call-skel" aria-busy="true" aria-label="Loading Call Hub">
      <div className="ss-ret-hero ss-call-hero">
        <div style={s('display:flex;flex-direction:column;gap:8px')}>
          <div className="ss-skel" style={s('width:110px;height:26px;border-radius:99px')} />
          <div className="ss-skel" style={s('width:180px;height:28px')} />
          <div className="ss-skel" style={s('width:340px;height:14px')} />
        </div>
        <div className="ss-ret-metrics" style={{ marginTop: 12 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="ss-ret-metric">
              <div className="ss-skel" style={s('width:54px;height:11px')} />
              <div className="ss-skel" style={s('width:40px;height:22px;margin-top:6px')} />
            </div>
          ))}
        </div>
      </div>
      <div style={s('margin-top:16px;display:flex;flex-direction:column;gap:8px')}>
        {[0, 1, 2, 3, 4, 5].map((i) => (
          <div
            key={i}
            className="ss-skel"
            style={s('height:72px;border-radius:var(--radius-md)')}
          />
        ))}
      </div>
    </div>
  );
}

export function CallHubTab() {
  const { actingAs } = useImpersonation();
  const sessionWorker = getSession()?.worker;
  const currentUserId = String(actingAs?.zohoUserId ?? sessionWorker?.zohoUserId ?? '');
  const agentLabel = actingAs?.name ?? sessionWorker?.userName ?? 'You';
  const [source, setSource] = useState<SourceFilter>('all');
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<CallHubItem | null>(null);

  const cacheKey = `sales:call-hub:${currentUserId}:${source}:${status}:${page}:${PAGE_SIZE}`;
  const load = useCachedLoad(
    cacheKey,
    () =>
      listCallHubCalls({
        source,
        status,
        page,
        pageSize: PAGE_SIZE,
      }),
    { staleMs: 45_000 },
  );

  const calls = load.data?.calls ?? [];
  const total = load.data?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const stats = useMemo(() => {
    const answered = calls.filter((c) => c.status === 'answered').length;
    const missed = calls.filter((c) => c.status === 'missed').length;
    const mytrion = calls.filter((c) => c.source === 'mytrion').length;
    const zoho = calls.filter((c) => c.source === 'zoho').length;
    return { answered, missed, mytrion, zoho };
  }, [calls]);

  if (load.loading && !load.data) return <CallHubSkeleton />;

  return (
    <div className="ss-call-page" style={s('display:flex;flex-direction:column;gap:16px;min-height:0')}>
      <div className="ss-ret-hero ss-call-hero">
        <div>
          <div className="ss-ret-hero-kicker">
            <Icon name="callHub" size={13} /> Call workspace
          </div>
          <div className="ss-ret-hero-title">Call Hub</div>
          <p className="ss-ret-hero-sub">
            Calls for <strong style={{ color: 'var(--text)' }}>{agentLabel}</strong> only — Mytrion and
            Zoho history merged. Softphone stays in the corner; open a row to redial.
          </p>
        </div>
        <div className="ss-ret-metrics" style={{ marginTop: 4 }}>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Total</div>
            <div className="ss-ret-metric-val">{total}</div>
            <div className="ss-ret-metric-hint">Agent scope</div>
          </div>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Answered</div>
            <div className="ss-ret-metric-val is-ok">{stats.answered}</div>
            <div className="ss-ret-metric-hint">This page</div>
          </div>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Missed</div>
            <div className={`ss-ret-metric-val${stats.missed ? ' is-danger' : ''}`}>{stats.missed}</div>
            <div className="ss-ret-metric-hint">This page</div>
          </div>
          <div className="ss-ret-metric">
            <div className="ss-ret-metric-lbl">Sources</div>
            <div className="ss-ret-metric-val is-accent">
              {stats.mytrion}/{stats.zoho}
            </div>
            <div className="ss-ret-metric-hint">Mytrion / Zoho</div>
          </div>
        </div>
      </div>

      <div className="ss-call-filters">
        <div className="ss-ret-tabs" role="tablist" aria-label="Call source">
          {(
            [
              ['all', 'All'],
              ['mytrion', 'Mytrion'],
              ['zoho', 'Zoho'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={source === id}
              className={`ss-ret-tab${source === id ? ' is-on' : ''}`}
              onClick={() => {
                setSource(id);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="ss-ret-tabs" role="tablist" aria-label="Call status">
          {(
            [
              ['all', 'Any status'],
              ['answered', 'Answered'],
              ['missed', 'Missed'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={status === id}
              className={`ss-ret-tab${status === id ? ' is-on' : ''}`}
              onClick={() => {
                setStatus(id);
                setPage(1);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {load.error && calls.length === 0 ? (
        <div className="ss-call-empty" style={s('color:var(--danger)')}>
          {load.error}
        </div>
      ) : null}

      {calls.length === 0 && !load.error ? (
        <div className="ss-call-empty">
          <Icon name="callHub" size={28} color="var(--accent)" />
          <div style={s('margin-top:10px;font-weight:700')}>No calls for {agentLabel}</div>
          <div style={s('margin-top:4px;color:var(--muted);font-size:13px;max-width:42ch;margin-left:auto;margin-right:auto')}>
            Outbound clicks from Data Center and Retention land in Mytrion under this agent; Zoho Call
            rows owned by them show up here too.
          </div>
        </div>
      ) : (
        <>
          <div className="ss-call-list">
            {calls.map((call) => {
              const tone = SOURCE_TONE[call.source];
              const statusTone =
                call.status === 'answered'
                  ? 'var(--ok)'
                  : call.status === 'missed'
                    ? 'var(--danger)'
                    : 'var(--muted)';
              return (
                <button
                  key={`${call.source}:${call.id}`}
                  type="button"
                  className="ss-call-row"
                  onClick={() => setSelected(call)}
                  style={{ ['--call-src' as string]: tone }}
                >
                  <div className="ss-call-row-main">
                    <div className="ss-call-row-title">
                      {call.subject?.trim() || call.result || call.direction || 'Call'}
                    </div>
                    <div className="ss-call-row-meta">
                      {formatWhen(call.startedAt)}
                      {call.phone ? ` · ${call.phone}` : ''}
                      {call.linked
                        ? ` · ${call.linked.type.replaceAll('_', ' ')}${call.linked.label ? ` ${call.linked.label}` : ''}`
                        : ''}
                    </div>
                  </div>
                  <div className="ss-call-row-side">
                    <span
                      className="ss-call-chip"
                      style={{
                        color: tone,
                        borderColor: `color-mix(in srgb,${tone} 40%,transparent)`,
                        background: `color-mix(in srgb,${tone} 12%,transparent)`,
                      }}
                    >
                      {call.source}
                    </span>
                    <span
                      className="ss-call-chip"
                      style={{
                        color: statusTone,
                        borderColor: `color-mix(in srgb,${statusTone} 40%,transparent)`,
                        background: `color-mix(in srgb,${statusTone} 12%,transparent)`,
                      }}
                    >
                      {call.status}
                    </span>
                    <span className="ss-call-dur">{formatDuration(call.durationSeconds)}</span>
                  </div>
                </button>
              );
            })}
          </div>

          {total > PAGE_SIZE ? (
            <div
              className="ss-call-pager"
              style={s(
                'display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;padding:4px 2px',
              )}
            >
              <div style={s('font-size:12px;color:var(--muted);font-weight:600')}>
                Page {page} of {pageCount}
                {total ? ` · ${total} calls` : ''}
              </div>
              <div style={s('display:flex;gap:8px')}>
                <button
                  type="button"
                  aria-label="Previous call page"
                  disabled={page <= 1}
                  className="ss-ico-btn"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  style={s(
                    `height:36px;padding:0 13px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font:inherit;font-size:12px;font-weight:700;cursor:${page <= 1 ? 'default' : 'pointer'};opacity:${page <= 1 ? '.45' : '1'}`,
                  )}
                >
                  Previous
                </button>
                <button
                  type="button"
                  aria-label="Next call page"
                  disabled={page >= pageCount}
                  className="ss-ico-btn"
                  onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
                  style={s(
                    `height:36px;padding:0 13px;border-radius:10px;border:1px solid var(--border);background:var(--alt);color:var(--text2);font:inherit;font-size:12px;font-weight:700;cursor:${page >= pageCount ? 'default' : 'pointer'};opacity:${page >= pageCount ? '.45' : '1'}`,
                  )}
                >
                  Next
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {selected ? <CallDetailModal call={selected} onClose={() => setSelected(null)} /> : null}
    </div>
  );
}
