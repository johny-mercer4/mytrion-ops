/**
 * Sales Call Hub — agent call history (Mytrion + Zoho). Softphone stays global.
 * Always scoped to the signed-in / View-as agent (backend honors x-act-as-*).
 *
 * Page chrome is the shared `SalesPage`; the tab no longer prints a "Call Hub" heading under the
 * top bar's "CALL HUB", nor a "Call workspace" chip beside it.
 */
import { useState } from 'react';
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
import {
  SalesEmpty,
  SalesErrorNote,
  SalesPage,
  SalesPageHead,
  SalesPager,
  SalesSubTabs,
  type SalesMetric,
  type SalesSubTab,
} from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
import { isTelegramWebView } from '@/telegram/webApp';
import { emitKpiActivity } from '../kpiTelemetry';

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

const SOURCE_TABS: ReadonlyArray<SalesSubTab<SourceFilter>> = [
  { id: 'all', label: 'All sources' },
  { id: 'mytrion', label: 'Mytrion' },
  { id: 'zoho', label: 'Zoho' },
];

const STATUS_TABS: ReadonlyArray<SalesSubTab<StatusFilter>> = [
  { id: 'all', label: 'Any status' },
  { id: 'answered', label: 'Answered' },
  { id: 'missed', label: 'Missed' },
];

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
  const stats = load.data?.aggregates ?? {
    answered: 0,
    missed: 0,
    unknown: 0,
    mytrion: 0,
    zoho: 0,
    gong: 0,
    exact: true,
  };
  const degradedSources = load.data
    ? Object.entries(load.data.sourceHealth ?? {})
        .filter(([, health]) => health === 'degraded')
        .map(([name]) => name)
    : [];

  const cold = load.loading && !load.data;
  const metrics: SalesMetric[] = [
    {
      label: 'Total',
      value: total,
      hint: stats.exact ? 'All matching calls' : 'At least this many',
    },
    { label: 'Answered', value: stats.answered, hint: 'All matching calls', tone: 'ok' },
    {
      label: 'Missed',
      value: stats.missed,
      hint: 'All matching calls',
      ...(stats.missed ? { tone: 'danger' as const } : {}),
    },
    {
      label: 'Sources',
      value: `${stats.mytrion}/${stats.zoho}`,
      hint: 'Mytrion / Zoho · deduplicated',
      tone: 'accent',
    },
  ];

  const openCall = (call: CallHubItem): void => {
    emitKpiActivity('ui.record_open', { entityType: 'call', entityId: call.id });
    setSelected(call);
  };

  return (
    <SalesPage className="ss-call-page" busy={cold || load.revalidating}>
      <SalesPageHead
        description={
          isTelegramWebView() ? (
            <>
              Calls for <strong>{agentLabel}</strong>. In-app calling is not available in Telegram —
              use desktop Mytrion or the RingCentral app to place and answer calls. History still
              shows here.
            </>
          ) : (
            <>
              Calls for <strong>{agentLabel}</strong> only — Mytrion and Zoho history merged. Softphone
              stays in the corner; open a row to redial.
            </>
          )
        }
        metrics={cold ? undefined : metrics}
      />

      {cold ? (
        <SalesBodySkeleton variant="rows" />
      ) : (
        <>
        {degradedSources.length ? (
          <div className="ss-source-health" role="status">
            Showing available call history. {degradedSources.join(', ')} is temporarily unavailable.
          </div>
        ) : null}

        <div className="ss-call-filters">
          <SalesSubTabs
            items={SOURCE_TABS}
            value={source}
            label="Call source"
            size="sm"
            onChange={(next) => {
              setSource(next);
              setPage(1);
            }}
          />
          <SalesSubTabs
            items={STATUS_TABS}
            value={status}
            label="Call status"
            size="sm"
            onChange={(next) => {
              setStatus(next);
              setPage(1);
            }}
          />
        </div>

        {load.error ? <SalesErrorNote>{load.error}</SalesErrorNote> : null}

        {calls.length === 0 && !load.error ? (
          <SalesEmpty
            icon="callHub"
            title={`No calls for ${agentLabel}`}
            body={
              isTelegramWebView()
                ? 'Call history still lands here. To place or answer a call, open Mytrion on desktop or use the RingCentral app.'
                : 'Outbound clicks from Data Center and Retention land in Mytrion under this agent; Zoho Call rows owned by them show up here too.'
            }
          />
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
                    onClick={() => openCall(call)}
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
              <SalesPager
                page={page}
                pageCount={pageCount}
                onPage={setPage}
                summary={`${total} call${total === 1 ? '' : 's'} matching these filters`}
              />
            ) : null}
        </>
      )}
        </>
      )}

      {selected ? <CallDetailModal call={selected} onClose={() => setSelected(null)} /> : null}
    </SalesPage>
  );
}
