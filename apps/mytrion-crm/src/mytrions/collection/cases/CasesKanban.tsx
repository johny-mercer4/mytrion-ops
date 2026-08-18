/**
 * Collection cases — stage board. Columns are the eight collection stages.
 * Cards reuse the list identity (mono tile + name + remaining), so a hop between
 * list and board is the same desk, not a second product.
 */
import { Badge, EmptyState, Skeleton, SkeletonRegion } from '@/ds';
import type { CollectionCaseRow, CollectionStage } from '@/api/collection';
import { money } from '../collectionFormat';
import {
  KANBAN_STAGES,
  STAGE_HINT,
  caseInitials,
  caseName,
  daysTone,
  stageChip,
  stageLabel,
  statusChip,
} from './casesModel';

export function CasesKanban({
  rows,
  loading,
  filtered,
  onOpen,
}: {
  rows: CollectionCaseRow[];
  loading: boolean;
  filtered: boolean;
  onOpen: (id: string) => void;
}) {
  const byStage = {} as Record<CollectionStage, CollectionCaseRow[]>;
  for (const stage of KANBAN_STAGES) byStage[stage] = [];
  for (const row of rows) {
    const bucket = byStage[row.collectionStage];
    if (bucket) bucket.push(row);
    else byStage.intake.push(row);
  }

  if (loading && rows.length === 0) {
    return (
      <div className="cc-board hscroll">
        <SkeletonRegion busy label="Loading the collection board">
          {KANBAN_STAGES.map((stage) => (
            <section key={stage} className="cc-col" aria-hidden="true">
              <Skeleton variant="rect" height="220px" radius="panel" />
            </section>
          ))}
        </SkeletonRegion>
      </div>
    );
  }

  if (!loading && rows.length === 0) {
    return (
      <EmptyState
        size="page"
        icon="view_kanban"
        title={filtered ? 'No cases match' : 'No collection cases'}
        description={
          filtered
            ? 'Nothing matches these filters. Clear them to see the board.'
            : 'Cases appear when remaining debt stays above $100.'
        }
      />
    );
  }

  return (
    <div className="cc-board hscroll" data-stale={loading && rows.length > 0 ? 'true' : undefined}>
      {KANBAN_STAGES.map((stage) => {
        const cards = byStage[stage] ?? [];
        const chip = stageChip(stage);
        return (
          <section key={stage} className="cc-col" data-stage={stage}>
            <header className="cc-col-head">
              <div className="cc-col-title">
                <Badge intent={chip.intent} icon={chip.icon}>
                  {stageLabel(stage)}
                </Badge>
                <span className="cc-col-count num">{cards.length}</span>
              </div>
              <p className="cc-col-hint">{STAGE_HINT[stage]}</p>
            </header>
            <div className="cc-col-body">
              {cards.map((row) => (
                <button
                  key={row.id}
                  type="button"
                  className="cc-card"
                  aria-label={`Open ${caseName(row)}`}
                  onClick={() => onOpen(row.id)}
                >
                  <span className="cc-ident">
                    <span className="cc-mono" aria-hidden="true">
                      {caseInitials(row)}
                    </span>
                    <span className="cc-ident-text">
                      <span className="cc-ident-name">
                        <span className="cc-ident-label">{caseName(row)}</span>
                      </span>
                      <span className="cc-ident-sub">{row.carrierId}</span>
                    </span>
                  </span>
                  <span className="cc-card-facts">
                    <span className="cc-card-debt num">{money(row.totalDebtAmount)}</span>
                    <span className="cc-card-dpd num" data-tone={daysTone(row.daysPastDue)}>
                      {row.daysPastDue}d
                    </span>
                  </span>
                  {row.status === 'closed' ? (
                    <Badge intent={statusChip(row).intent} icon={statusChip(row).icon}>
                      {statusChip(row).label}
                    </Badge>
                  ) : null}
                </button>
              ))}
              {cards.length === 0 ? (
                <p className="cc-col-empty">No cases in this stage</p>
              ) : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
