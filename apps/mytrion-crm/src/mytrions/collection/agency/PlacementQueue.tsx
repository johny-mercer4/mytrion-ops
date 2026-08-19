/**
 * Collection → Agency → Placement queue.
 *
 * The screen the module never had. `array_reports` is the OUTPUT of the monthly Metro 2 filing;
 * the work sits in front of it — which open cases clear the agency thresholds, which are blocked,
 * and on which field. `excluded_reason` and `validation_errors` have been columns on the snapshot
 * all along with nothing rendering them, so a tradeline could drop out of a filing silently.
 *
 * The four readiness dots are never the only signal: `blocking` names the field in words in the
 * column beside them, and the legend at the foot fixes their order.
 */
import { useCallback, useState } from 'react';
import { Badge, Button, EmptyState, ErrorState, Input, Skeleton, SkeletonRegion, Tabs } from '@/ds';
import { getPlacementQueue, type PlacementRow, type PlacementState } from '@/api/collectionDesk';
import { getCollectionCase } from '@/api/collection';
import { KpiGrid, KpiTile, PageHead } from '../../_shared/page';
import { useCachedLoad } from '../../_shared/swrCache';
import { useDebounced } from '../../_shared/useDebounced';
import { AgeCell, ReadinessDots } from '../CollectionBits';
import { money } from '../collectionFormat';
import { CaseActionDialogs, useCaseActions } from '../actions/useCaseActions';
import './agency.css';

const STATE_CHIP: Record<PlacementState, { intent: 'success' | 'warning' | 'danger' | 'neutral'; label: string }> = {
  ready: { intent: 'success', label: 'Ready to file' },
  blocked: { intent: 'warning', label: 'Blocked' },
  error: { intent: 'danger', label: 'Validation error' },
  hold: { intent: 'neutral', label: 'Not yet eligible' },
  filed: { intent: 'neutral', label: 'Filed' },
};

const STATE_TABS: ReadonlyArray<{ id: PlacementState | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'ready', label: 'Ready' },
  { id: 'blocked', label: 'Blocked' },
  { id: 'error', label: 'Errors' },
  { id: 'hold', label: 'Not yet' },
];

export function PlacementQueue({ onOpenCase }: { onOpenCase: (caseId: string) => void }) {
  const [state, setState] = useState<PlacementState | 'all'>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 300);

  const load = useCallback(
    () => getPlacementQueue({ ...(state === 'all' ? {} : { state }), ...(search ? { search } : {}), limit: 50 }),
    [state, search],
  );
  const feed = useCachedLoad(`collection:placement:${state}:${search}`, load);
  const actions = useCaseActions({ onDone: () => void feed.reload() });

  const data = feed.data;
  const counts = data?.counts;

  /** Opening the file dialog needs the case row itself — the queue row is a projection of it. */
  const file = async (row: PlacementRow): Promise<void> => {
    const { case: full } = await getCollectionCase(row.caseId);
    actions.openPlacement(full, row);
  };

  return (
    <div className="cc-list">
      <PageHead
        kicker="Collection · Agency"
        title="Placement queue"
        description="What is ready to go to Array on the next file, what is blocked, and on which Metro 2 field."
        actions={
          <div className="cc-head-actions">
            <Input
              className="cc-search"
              type="search"
              icon="search"
              placeholder="Company, carrier, MC…"
              aria-label="Search the placement queue"
              value={term}
              onChange={(e) => setTerm(e.currentTarget.value)}
              onClear={() => setTerm('')}
            />
            <Button
              variant="secondary"
              icon="refresh"
              loading={feed.revalidating}
              onClick={() => void feed.reload()}
            >
              Refresh
            </Button>
          </div>
        }
      />

      <KpiGrid>
        <KpiTile label="Ready to file" value={String(counts?.ready ?? '—')} />
        <KpiTile label="Placeable value" value={money(data?.readyAmount)} />
        <KpiTile label="Blocked on a field" value={String(counts?.blocked ?? '—')} />
        <KpiTile label="Validation errors" value={String(counts?.error ?? '—')} />
      </KpiGrid>

      {counts && counts.error > 0 ? (
        <div className="cc-banner" data-tone="danger" role="alert">
          <span className="cc-banner-title">
            {counts.error} {counts.error === 1 ? 'tradeline was' : 'tradelines were'} excluded from
            the last file
          </span>
          <p className="cc-banner-body">
            They failed Metro 2 validation and were dropped without being reported anywhere. Until
            the named field is fixed they stay excluded from the next one too.
          </p>
          <Button variant="secondary" size="sm" onClick={() => setState('error')}>
            Show them
          </Button>
        </div>
      ) : null}

      <Tabs
        variant="line"
        aria-label="Filter the placement queue"
        value={state}
        onValueChange={(v) => setState(v as PlacementState | 'all')}
        items={STATE_TABS.map((t) => ({
          value: t.id,
          label: t.label,
          ...(t.id === 'all'
            ? { count: data?.total ?? 0 }
            : counts
              ? { count: counts[t.id as PlacementState] }
              : {}),
        }))}
      />

      <QueueBody
        feed={feed}
        onOpenCase={onOpenCase}
        onFile={(row) => void file(row)}
      />

      {data ? (
        <p className="ar-legend">
          <span className="ar-legend-key">
            <span className="co-dots">
              <i />
            </span>
            Present
          </span>
          <span className="ar-legend-key">
            <span className="co-dots">
              <i data-missing="true" />
            </span>
            Missing
          </span>
          <span>
            Metro 2 fields, in order: date of birth · address · MC/DOT · date of first delinquency
          </span>
        </p>
      ) : null}

      <CaseActionDialogs actions={actions} />
    </div>
  );
}

function QueueBody({
  feed,
  onOpenCase,
  onFile,
}: {
  feed: ReturnType<typeof useCachedLoad<Awaited<ReturnType<typeof getPlacementQueue>>>>;
  onOpenCase: (caseId: string) => void;
  onFile: (row: PlacementRow) => void;
}) {
  if (feed.loading && !feed.data) {
    return (
      <SkeletonRegion busy label="Loading the placement queue">
        <Skeleton variant="rect" height="360px" radius="panel" />
      </SkeletonRegion>
    );
  }
  if (feed.error && !feed.data) {
    return (
      <ErrorState
        size="page"
        title="Could not load the placement queue"
        description="Retry the request, or check that you can reach Collection."
        primaryAction={
          <Button variant="primary" onClick={() => void feed.reload()}>
            Retry
          </Button>
        }
      />
    );
  }
  const data = feed.data;
  if (!data) return null;
  if (data.items.length === 0) {
    return (
      <EmptyState
        size="page"
        icon="send"
        title="Nothing in this state"
        description="Cases appear here once they are open, past the agency thresholds, or blocked on a Metro 2 field."
      />
    );
  }

  return (
    <div className="cc-panel">
      <table className="ar-queue">
        <caption className="ar-queue-caption">Cases eligible for the next Array file</caption>
        <thead>
          <tr>
            <th scope="col">Carrier</th>
            <th scope="col" className="ar-end">
              Remaining
            </th>
            <th scope="col">Age</th>
            <th scope="col">Metro 2</th>
            <th scope="col">State</th>
            <th scope="col">Blocking</th>
            <th scope="col" className="ar-end">
              <span className="ds-sr-only">Action</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {data.items.map((row) => {
            const chip = STATE_CHIP[row.state];
            return (
              <tr key={row.caseId} data-ready={row.state === 'ready' ? 'true' : undefined}>
                <th scope="row">
                  <button type="button" className="ar-name" onClick={() => onOpenCase(row.caseId)}>
                    <span className="cc-ident-label">{row.name}</span>
                    <span className="cc-ident-sub">
                      {row.carrierId}
                      {row.mcDot ? ` · ${row.mcDot}` : ''}
                    </span>
                  </button>
                </th>
                <td className="ar-end">
                  <span className="num cc-strong">{money(row.remaining)}</span>
                </td>
                <td>
                  <AgeCell days={row.daysPastDue} bands={data.policy.agingBands} />
                </td>
                <td>
                  <span className="ar-dots">
                    <ReadinessDots fields={data.metro2Fields} readiness={row.readiness} />
                    <span className="num ar-dots-count">
                      {data.metro2Fields.length - row.missing.length}/{data.metro2Fields.length}
                    </span>
                  </span>
                </td>
                <td>
                  <Badge intent={chip.intent}>{chip.label}</Badge>
                </td>
                <td className="ar-blocking" data-tone={row.state === 'error' ? 'danger' : undefined}>
                  {row.blocking ?? '—'}
                </td>
                <td className="ar-end">
                  {row.state === 'ready' ? (
                    <Button size="sm" variant="primary" icon="send" onClick={() => onFile(row)}>
                      File
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => onOpenCase(row.caseId)}>
                      Open
                    </Button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <div className="cc-foot">
        <span className="cc-foot-count">
          Showing <strong className="num">{data.items.length}</strong> of{' '}
          <strong className="num">{data.total}</strong> ·{' '}
          <strong className="num">{data.counts.ready}</strong> ready
        </span>
      </div>
    </div>
  );
}
