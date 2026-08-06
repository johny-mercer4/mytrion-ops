/**
 * One carrier, everything EFS knows.
 *
 * Every tab owns exactly ONE list fetch and fires it when the tab is opened — never on mount, and
 * never more than one at a time. Against prod these reads take 1.1s–5.0s, so a dossier that
 * preloaded its four tabs would sit at ten seconds before showing anything.
 *
 * Partial failures render as a chip beside good data. EFS answers 200 with `cardDetailError` set
 * more often than it fails outright, and throwing that away would hide a perfectly good balance
 * behind a card bug.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ArrowLeft, RefreshCw, TriangleAlert } from 'lucide-react';
import {
  fetchEfs,
  partialErrors,
  type EfsCapabilities,
  type EfsCarrierSnapshot,
  type EfsClient,
  type EfsListPayload,
} from '../../../../api/efsConsole';
import { EFS_TABS, clientState, count, daysAgoIso, money, nowIso, shortDate, type EfsTabId } from './efsModel';
import { EfsPanelSkeleton } from './EfsSkeletons';

interface PanelState {
  loading: boolean;
  error: string | null;
  payload: unknown;
  fetchedAt: string | null;
}

const IDLE: PanelState = { loading: false, error: null, payload: null, fetchedAt: null };

export function EfsCarrierDossier({
  client,
  capabilities,
  tab,
  windowDays,
  onTab,
  onBack,
}: {
  client: EfsClient;
  capabilities: EfsCapabilities | null;
  tab: EfsTabId;
  windowDays: number;
  onTab: (tab: EfsTabId) => void;
  onBack: () => void;
}) {
  const [panels, setPanels] = useState<Record<string, PanelState>>({});
  const active = EFS_TABS.find((t) => t.id === tab) ?? EFS_TABS[0]!;
  const panel = panels[active.id] ?? IDLE;

  /** The window ceiling for THIS tab, from the server's published limits. */
  const maxDays = useMemo(() => {
    if (!active.windowed) return null;
    const info = capabilities?.fetchers.find((f) => f.key === active.fetcher);
    if (!info) return null;
    return info.window === 'txn7d' ? capabilities?.windows.txn7d ?? 7 : capabilities?.windows.history90d ?? 90;
  }, [active, capabilities]);

  const effectiveDays = maxDays ? Math.min(windowDays, maxDays) : windowDays;

  const load = useCallback(
    async (tabId: EfsTabId, force = false) => {
      const spec = EFS_TABS.find((t) => t.id === tabId);
      if (!spec) return;
      // A loaded panel stays loaded — switching back to a tab must not re-pay 5 seconds.
      if (!force && panels[tabId] && !panels[tabId]?.error) return;

      setPanels((prev) => ({ ...prev, [tabId]: { ...IDLE, loading: true } }));
      try {
        const params: Record<string, string | number | undefined> = { carrierId: client.carrierId };
        if (spec.windowed) {
          params['from'] = daysAgoIso(effectiveDays);
          params['to'] = nowIso();
        }
        const result = await fetchEfs(spec.fetcher, params);
        setPanels((prev) => ({
          ...prev,
          [tabId]: { loading: false, error: null, payload: result.payload, fetchedAt: result.fetchedAt },
        }));
      } catch (caught) {
        setPanels((prev) => ({
          ...prev,
          [tabId]: {
            loading: false,
            error: caught instanceof Error ? caught.message : 'EFS did not answer.',
            payload: null,
            fetchedAt: null,
          },
        }));
      }
    },
    [client.carrierId, effectiveDays, panels],
  );

  useEffect(() => {
    void load(tab);
    // `load` closes over `panels`, which changes on every fetch; depending on it would re-fire.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, client.carrierId, effectiveDays]);

  const state = clientState(client);
  const warnings = partialErrors(panel.payload);

  return (
    <div className="mg-efs-dossier">
      <header className="mg-efs-dossier-head">
        <button type="button" className="mg-backbtn" onClick={onBack} aria-label="Back to clients">
          <ArrowLeft size={16} />
        </button>
        <div className="mg-efs-dossier-id">
          <h2>{client.companyName}</h2>
          <div className="mg-efs-dossier-meta">
            <span className="mg-efs-mono">{client.carrierId}</span>
            <span className={`mg-efs-badge is-${state.tone}`}>{state.label}</span>
            {client.tierName ? <span className="mg-efs-badge is-muted">{client.tierName}</span> : null}
            {client.agent ? <span>{client.agent}</span> : null}
            <span>{count(client.activeCards)} active cards</span>
            <span>Last txn {shortDate(client.lastTransactionDate)}</span>
          </div>
        </div>
        <button
          type="button"
          className="mg-btn"
          onClick={() => void load(active.id, true)}
          disabled={panel.loading}
        >
          <RefreshCw size={15} className={panel.loading ? 'mg-spin' : ''} />
          Refresh
        </button>
      </header>

      <nav className="mg-efs-tabs" role="tablist" aria-label="EFS record">
        {EFS_TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={t.id === tab}
            className={t.id === tab ? 'is-on' : ''}
            onClick={() => onTab(t.id)}
          >
            {t.label}
          </button>
        ))}
        {active.windowed && maxDays ? (
          <span className="mg-efs-window-note">
            Last {effectiveDays}d · EFS caps this view at {maxDays} days
          </span>
        ) : null}
      </nav>

      {panel.loading ? <EfsPanelSkeleton variant={active.id === 'overview' ? 'overview' : 'table'} /> : null}

      {!panel.loading && panel.error ? (
        <div className="mg-error">
          <p>{panel.error}</p>
          <button type="button" className="mg-btn" onClick={() => void load(active.id, true)}>
            Retry
          </button>
        </div>
      ) : null}

      {!panel.loading && !panel.error ? (
        <>
          {warnings.length ? (
            <div className="mg-efs-warn" role="status">
              <TriangleAlert size={15} aria-hidden />
              <div>
                <strong>EFS answered partially.</strong>
                {warnings.map((w) => (
                  <span key={w.field}>
                    {w.field}: {w.message}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          <TabBody tab={active.id} payload={panel.payload} emptyLabel={active.emptyLabel} />
        </>
      ) : null}
    </div>
  );
}

/** Each tab reads the one payload shape it owns. Unknown shapes fall back to a readable dump. */
function TabBody({ tab, payload, emptyLabel }: { tab: EfsTabId; payload: unknown; emptyLabel: string }) {
  if (tab === 'overview') return <OverviewBody payload={payload as EfsCarrierSnapshot} emptyLabel={emptyLabel} />;
  const rows = (payload as EfsListPayload<Record<string, unknown>>)?.data ?? [];
  if (!rows.length) return <div className="mg-empty">{emptyLabel}</div>;
  return <RowTable rows={rows} />;
}

function OverviewBody({ payload, emptyLabel }: { payload: EfsCarrierSnapshot; emptyLabel: string }) {
  const contracts = payload?.contracts ?? [];
  if (!payload || (!contracts.length && payload.totalBalance === undefined)) {
    return <div className="mg-empty">{emptyLabel}</div>;
  }
  return (
    <div className="mg-efs-overview">
      <div className="mg-efs-figures">
        <div>
          <span>Total balance</span>
          <strong>{money(payload.totalBalance)}</strong>
        </div>
        <div>
          <span>Contracts</span>
          <strong>{count(contracts.length)}</strong>
        </div>
        <div>
          <span>Cards</span>
          <strong>{count(payload.cardCount)}</strong>
        </div>
      </div>
      {contracts.length ? (
        <table className="mg-efs-table">
          <thead>
            <tr>
              <th>Contract</th>
              <th>Description</th>
              <th className="is-num">Balance</th>
            </tr>
          </thead>
          <tbody>
            {contracts.map((c) => (
              <tr key={String(c.contractId)}>
                <td className="mg-efs-mono">{c.contractId ?? '—'}</td>
                <td>{c.description ?? '—'}</td>
                <td className="is-num">{money(c.balance)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : null}
    </div>
  );
}

/**
 * A generic table over whatever EFS returned.
 *
 * Deliberately shape-agnostic: EFS's row shapes differ per endpoint and between V1/V2, and a table
 * hand-typed per endpoint would break silently the day the vendor adds a column. Columns come from
 * the union of the first rows' keys, so a new field appears rather than disappearing.
 */
function RowTable({ rows }: { rows: Array<Record<string, unknown>> }) {
  const columns = useMemo(() => {
    const seen = new Set<string>();
    for (const row of rows.slice(0, 25)) for (const key of Object.keys(row)) seen.add(key);
    return [...seen].slice(0, 12);
  }, [rows]);

  return (
    <div className="mg-efs-tablewrap">
      <table className="mg-efs-table">
        <thead>
          <tr>
            {columns.map((c) => (
              <th key={c}>{c}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, 200).map((row, index) => (
            <tr key={index}>
              {columns.map((c) => (
                <td key={c}>{renderCell(row[c])}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {rows.length > 200 ? (
        <p className="mg-empty-sm">Showing the first 200 of {count(rows.length)} rows.</p>
      ) : null}
    </div>
  );
}

function renderCell(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'object') return JSON.stringify(value).slice(0, 80);
  return String(value).slice(0, 120);
}
