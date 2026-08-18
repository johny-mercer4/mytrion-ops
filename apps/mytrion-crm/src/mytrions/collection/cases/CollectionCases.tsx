/**
 * Collection → Collection Cases. List + kanban over the finder-owned case book.
 *
 * Status is a scope tab (open / closed / all), like Verification. Stages are kanban
 * columns. The board fetches up to 500 rows (the whole book is 494); the list pages
 * 15 at a time on the server so a filter change never dumps invoices.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ErrorState, Input, Select, Tabs } from '@/ds';
import { listCollectionCases, type CollectionCaseListResult, type CollectionStage } from '@/api/collection';
import { COLLECTION_STAGES } from '@/api/collection';
import { PageHead } from '../../_shared/page';
import { useCachedLoad } from '../../_shared/swrCache';
import { CaseDetail } from './CaseDetail';
import { CASES_PAGE_SIZE, CasesList } from './CasesList';
import { CasesKanban } from './CasesKanban';
import { CASE_SCOPES, STAGE_LABEL, statusOf, type CaseScope, type CaseViewMode } from './casesModel';
import './cases.css';

export function CollectionCases() {
  const [view, setView] = useState<CaseViewMode>('list');
  const [scope, setScope] = useState<CaseScope>('open');
  const [stage, setStage] = useState<CollectionStage | 'all'>('all');
  const [term, setTerm] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    const t = setTimeout(() => setSearch(term.trim()), 300);
    return () => clearTimeout(t);
  }, [term]);

  useEffect(() => setPage(1), [scope, stage, search, view]);

  const status = statusOf(scope);
  const stageFilter = stage === 'all' ? undefined : stage;

  const loadList = useCallback(
    () =>
      listCollectionCases({
        limit: view === 'kanban' ? 500 : CASES_PAGE_SIZE,
        offset: view === 'kanban' ? 0 : (page - 1) * CASES_PAGE_SIZE,
        ...(status ? { status } : {}),
        ...(stageFilter ? { stage: stageFilter } : {}),
        ...(search ? { search } : {}),
      }),
    [view, page, status, stageFilter, search],
  );

  const feed = useCachedLoad(
    `collection:cases:${view}:${scope}:${stage}:${search}:${view === 'kanban' ? 0 : page}`,
    loadList,
  );

  const lastGood = useRef<CollectionCaseListResult | null>(null);
  if (feed.data) lastGood.current = feed.data;
  const shown = feed.data ?? lastGood.current;
  const rows = shown?.items ?? [];
  const total = shown?.total ?? 0;
  const agg = shown?.aggregates;
  const filtered = Boolean(search || stage !== 'all' || scope !== 'all');
  const stale = feed.loading && feed.data === null && rows.length > 0;

  if (openId) return <CaseDetail caseId={openId} onBack={() => setOpenId(null)} />;

  const scopeCounts: Record<CaseScope, number> = {
    open: agg?.open ?? 0,
    closed: agg?.closed ?? 0,
    all: (agg?.open ?? 0) + (agg?.closed ?? 0),
  };

  return (
    <div className="cc-list" data-stale={stale ? 'true' : undefined}>
      <PageHead
        title="Collection cases"
        description="Bad-debt escalation from intake through agency, plan and recovery."
        actions={
          <div className="cc-head-actions">
            <Input
              className="cc-search"
              type="search"
              icon="search"
              placeholder="Company, carrier, MC…"
              aria-label="Search collection cases"
              value={term}
              onChange={(e) => setTerm(e.currentTarget.value)}
              onClear={() => setTerm('')}
            />
            <Select
              label="Stage"
              size="sm"
              value={stage}
              onChange={(v) => setStage((v ?? 'all') as CollectionStage | 'all')}
              options={[
                { value: 'all', label: 'All stages' },
                ...COLLECTION_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] })),
              ]}
            />
            <Tabs
              variant="pill"
              size="sm"
              aria-label="Case view"
              items={[
                { value: 'list', label: 'List' },
                { value: 'kanban', label: 'Board' },
              ]}
              value={view}
              onValueChange={(v) => setView(v as CaseViewMode)}
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

      <Tabs
        items={CASE_SCOPES.map((s) => ({ value: s.id, label: s.label, count: scopeCounts[s.id] }))}
        value={scope}
        onValueChange={(value) => setScope(value as CaseScope)}
        variant="line"
        aria-label="Filter cases by status"
      />

      {feed.error && rows.length === 0 ? (
        <ErrorState
          size="page"
          title="Could not load collection cases"
          description="Retry the request, or check that you can reach Collection."
          primaryAction={
            <Button variant="primary" onClick={() => void feed.reload()}>
              Retry
            </Button>
          }
        />
      ) : (
        <>
          {feed.error ? (
            <div className="cc-banner" data-tone="danger" role="alert">
              <span className="cc-banner-title">Could not load collection cases</span>
              <p className="cc-banner-body">{String(feed.error)}</p>
              <Button variant="secondary" size="sm" onClick={() => void feed.reload()}>
                Retry
              </Button>
            </div>
          ) : null}

          {view === 'list' ? (
            <CasesList
              rows={rows}
              total={total}
              page={page}
              loading={feed.loading && rows.length === 0}
              filtered={filtered}
              onPage={setPage}
              onOpen={setOpenId}
            />
          ) : (
            <CasesKanban
              rows={rows}
              loading={feed.loading && rows.length === 0}
              filtered={filtered}
              onOpen={setOpenId}
            />
          )}
        </>
      )}
    </div>
  );
}
