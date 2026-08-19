/**
 * Collection → Collection Cases. The book, as a list or a five-lane board.
 *
 * Status is a scope tab (open / closed / all), like Verification. The saved views are SERVER-side
 * filters (`minRemaining`, `neverContacted`), not a client pass over one page: the counts and the
 * pager describe the whole book, and filtering locally would page through a subset while claiming
 * the book's numbers.
 *
 * `openCaseId` is lifted to the Mytrion shell because three surfaces open a case — this list, the
 * worklist and the placement queue.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, ErrorState, Input, Select, Tabs } from '@/ds';
import {
  listCollectionCases,
  COLLECTION_STAGES,
  type CollectionCaseListResult,
  type CollectionStage,
} from '@/api/collection';
import { PageHead } from '../../_shared/page';
import { useCachedLoad } from '../../_shared/swrCache';
import { useDebounced } from '../../_shared/useDebounced';
import { CaseDetail } from './CaseDetail';
import { CASES_PAGE_SIZE, CasesList } from './CasesList';
import { CasesKanban } from './CasesKanban';
import {
  CASE_SCOPES,
  SAVED_VIEWS,
  STAGE_LABEL,
  statusOf,
  type CaseScope,
  type CaseViewMode,
  type SavedViewId,
} from './casesModel';
import './cases.css';

export function CollectionCases({
  openCaseId,
  onOpenCase,
}: {
  openCaseId: string | null;
  onOpenCase: (id: string | null) => void;
}) {
  const [view, setView] = useState<CaseViewMode>('list');
  const [scope, setScope] = useState<CaseScope>('open');
  const [stage, setStage] = useState<CollectionStage | 'all'>('all');
  const [saved, setSaved] = useState<SavedViewId | null>(null);
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim(), 300);
  const [page, setPage] = useState(1);

  useEffect(() => setPage(1), [scope, stage, saved, search, view]);

  const status = statusOf(scope);
  const stageFilter = stage === 'all' ? undefined : stage;
  const savedFilter = saved ? SAVED_VIEWS.find((v) => v.id === saved)?.filter : undefined;

  const loadList = useCallback(
    () =>
      listCollectionCases({
        limit: view === 'kanban' ? 500 : CASES_PAGE_SIZE,
        offset: view === 'kanban' ? 0 : (page - 1) * CASES_PAGE_SIZE,
        ...(status ? { status } : {}),
        ...(stageFilter ? { stage: stageFilter } : {}),
        ...(search ? { search } : {}),
        ...(savedFilter ?? {}),
      }),
    [view, page, status, stageFilter, search, savedFilter],
  );

  const feed = useCachedLoad(
    `collection:cases:${view}:${scope}:${stage}:${saved ?? 'none'}:${search}:${view === 'kanban' ? 0 : page}`,
    loadList,
  );

  const lastGood = useRef<CollectionCaseListResult | null>(null);
  if (feed.data) lastGood.current = feed.data;
  const shown = feed.data ?? lastGood.current;
  const rows = shown?.items ?? [];
  const desk = shown?.desk ?? {};
  const total = shown?.total ?? 0;
  const agg = shown?.aggregates;
  const filtered = Boolean(search || stage !== 'all' || saved || scope !== 'all');
  const stale = feed.loading && feed.data === null && rows.length > 0;

  if (openCaseId) {
    return (
      <CaseDetail
        caseId={openCaseId}
        onBack={() => onOpenCase(null)}
        onChanged={() => void feed.reload()}
      />
    );
  }

  const scopeCounts: Record<CaseScope, number> = {
    open: agg?.open ?? 0,
    closed: agg?.closed ?? 0,
    all: (agg?.open ?? 0) + (agg?.closed ?? 0),
  };

  return (
    <div className="cc-list" data-stale={stale ? 'true' : undefined}>
      <PageHead
        kicker="Collection"
        title="Collection cases"
        description="The whole bad-debt book, from hand-off through contact, plan and recovery."
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
              labelHidden
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

      {/* Saved views. Buttons, not tabs: they are additive filters over the scope above, and a
          second tab rail under the first would read as a second, competing scope. */}
      <div className="cc-saved" role="group" aria-label="Saved views">
        <span className="t-eyebrow">Saved</span>
        {SAVED_VIEWS.map((v) => (
          <button
            key={v.id}
            type="button"
            className="cc-saved-chip"
            aria-pressed={saved === v.id}
            title={v.hint}
            onClick={() => setSaved(saved === v.id ? null : v.id)}
          >
            {v.label}
          </button>
        ))}
        {saved ? (
          <Button variant="link" size="sm" onClick={() => setSaved(null)}>
            Clear
          </Button>
        ) : null}
      </div>

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
              <span className="cc-banner-title">Could not refresh the case book</span>
              <p className="cc-banner-body">
                {String(feed.error)} — the rows below are the last good page.
              </p>
              <Button variant="secondary" size="sm" onClick={() => void feed.reload()}>
                Retry
              </Button>
            </div>
          ) : null}

          {view === 'list' ? (
            <CasesList
              rows={rows}
              desk={desk}
              total={total}
              page={page}
              loading={feed.loading && rows.length === 0}
              filtered={filtered}
              onPage={setPage}
              onOpen={onOpenCase}
            />
          ) : (
            <CasesKanban
              rows={rows}
              desk={desk}
              loading={feed.loading && rows.length === 0}
              filtered={filtered}
              hideClosedLane={scope === 'open'}
              onOpen={onOpenCase}
            />
          )}
        </>
      )}
    </div>
  );
}
