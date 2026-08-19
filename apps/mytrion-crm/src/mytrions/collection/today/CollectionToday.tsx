/**
 * Collection → Home. The worklist that replaced the launcher.
 *
 * Same tab, same grant key; a different screen. The old Home was three tiles, a hero and two
 * buttons to the tabs already in the rail. This is the work: every open case that wants an
 * action, in one risk-ordered list, each row saying why it surfaced. Lane counts describe the whole open book and do not move when you filter under
 * them — a tile that changes when you click it cannot be used to check your work.
 *
 * The lane filter is SERVER-side (a `lane` query param) rather than a client filter over one
 * fetched page: the counts come from the whole book, so filtering locally would page through a
 * subset while claiming the whole book's numbers.
 */
import { useCallback, useState } from 'react';
import { Button, EmptyState, ErrorState, Input, Skeleton, SkeletonRegion, Tabs } from '@/ds';
import {
  getDeskSummary,
  getWorklist,
  type WorklistItem,
  type WorklistLane,
  type WorklistResult,
} from '@/api/collectionDesk';
import { KpiGrid, KpiTile, PageHead } from '../../_shared/page';
import { useCachedLoad, type CachedLoad } from '../../_shared/swrCache';
import { useDebounced } from '../../_shared/useDebounced';
import { money } from '../collectionFormat';
import type { CollectionTabId } from '../collectionNav';
import { CaseActionDialogs, useCaseActions } from '../actions/useCaseActions';
import { WorklistRow } from './WorklistRow';
import { LANES } from './worklistCopy';
import './today.css';

export function CollectionToday({
  onOpenCase,
  onOpenTab,
}: {
  onOpenCase: (caseId: string) => void;
  onOpenTab: (tab: CollectionTabId) => void;
}) {
  const [lane, setLane] = useState<WorklistLane | 'all'>('all');
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 300);

  const loadWorklist = useCallback(
    () => getWorklist({ ...(lane === 'all' ? {} : { lane }), ...(search ? { search } : {}), limit: 40 }),
    [lane, search],
  );
  const feed = useCachedLoad(`collection:worklist:${lane}:${search}`, loadWorklist);
  const loadSummary = useCallback(() => getDeskSummary(), []);
  const summary = useCachedLoad('collection:summary', loadSummary);

  const actions = useCaseActions({
    onDone: () => {
      void feed.reload();
      void summary.reload();
    },
  });

  const data = feed.data;
  const lanes = data?.lanes;
  const totalOpen = lanes ? Object.values(lanes).reduce((a, b) => a + b, 0) : 0;

  /** The row's own action button — the lane decides which dialog, or whether to just open it. */
  const act = (item: WorklistItem): void => {
    switch (item.lane) {
      case 'agency_threshold':
        actions.openPlacement(item.case);
        break;
      case 'payment_posted':
        actions.openClose(item.case);
        break;
      case 'agency_returned':
      case 'new_intake':
        onOpenCase(item.case.id);
        break;
      default:
        actions.openContact(item.case);
    }
  };

  return (
    <div className="cc-list">
      <PageHead
        kicker="Collection"
        title="Home"
        description="Everything the desk owes an action on, ordered by the recovery at risk if nobody touches it."
        actions={
          <div className="cc-head-actions">
            <Input
              className="cc-search"
              type="search"
              icon="search"
              placeholder="Company, carrier, MC…"
              aria-label="Search the worklist"
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
        <KpiTile label="Needs an action" value={String(totalOpen)} />
        <KpiTile label="Open cases" value={String(summary.data?.openCases ?? '—')} />
        <KpiTile label="Remaining debt" value={money(summary.data?.remainingDebt)} />
        <KpiTile label="Recovered MTD" value={money(summary.data?.recoveredMtd)} />
      </KpiGrid>

      {data?.scanTruncated ? (
        <div className="cc-banner" data-tone="danger" role="alert">
          <span className="cc-banner-title">The worklist is incomplete</span>
          <p className="cc-banner-body">
            The open book is larger than this desk scans in one pass, so the lane counts below
            describe part of it. Narrow with search, and tell an engineer — the cap is meant to be
            three times headroom.
          </p>
        </div>
      ) : null}

      <Tabs
        variant="line"
        aria-label="Filter the worklist by reason"
        value={lane}
        onValueChange={(v) => setLane(v as WorklistLane | 'all')}
        items={[
          { value: 'all', label: 'All', count: totalOpen },
          ...LANES.map((l) => ({
            value: l.id,
            label: l.label,
            count: lanes?.[l.id] ?? 0,
          })),
        ]}
      />

      <WorklistBody
        feed={feed}
        lane={lane}
        onOpen={onOpenCase}
        onAct={act}
        onOpenTab={onOpenTab}
      />

      <CaseActionDialogs actions={actions} />
    </div>
  );
}

function WorklistBody({
  feed,
  lane,
  onOpen,
  onAct,
  onOpenTab,
}: {
  feed: CachedLoad<WorklistResult>;
  lane: WorklistLane | 'all';
  onOpen: (caseId: string) => void;
  onAct: (item: WorklistItem) => void;
  onOpenTab: (tab: CollectionTabId) => void;
}) {
  if (feed.loading && !feed.data) {
    return (
      <SkeletonRegion busy label="Loading the worklist">
        <Skeleton variant="rect" height="420px" radius="panel" />
      </SkeletonRegion>
    );
  }
  if (feed.error && !feed.data) {
    return (
      <ErrorState
        size="page"
        title="Could not load the worklist"
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
        icon="check_circle"
        title={lane === 'all' ? 'Nothing needs you right now' : 'Nothing in this lane'}
        description={
          lane === 'all'
            ? 'Every open case has been touched inside its window and no promise is due. The book is still there under Collection Cases.'
            : 'No case matches this reason today.'
        }
        primaryAction={
          <Button variant="secondary" onClick={() => onOpenTab('cases')}>
            Open the case book
          </Button>
        }
      />
    );
  }
  return (
    <section className="cc-panel" data-stale={feed.revalidating ? 'true' : undefined}>
      {data.items.map((item) => (
        <WorklistRow
          key={item.case.id}
          item={item}
          policy={data.policy}
          onOpen={onOpen}
          onAct={onAct}
        />
      ))}
      <div className="cc-foot">
        <span className="cc-foot-count">
          Showing <strong className="num">{data.items.length}</strong> of{' '}
          <strong className="num">{data.total}</strong>
        </span>
      </div>
    </section>
  );
}
