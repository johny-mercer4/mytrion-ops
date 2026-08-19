/**
 * Collection cases — the stage board, in FIVE lanes.
 *
 * See `BOARD_LANES` for why five and not eight. Two things the old board did not carry and this
 * one does: the MONEY in each lane (a count of cases says nothing about where recovery is stuck)
 * and each card's last touch (a card nobody has touched is the whole point of looking at a board).
 */
import { Badge, EmptyState } from '@/ds';
import type { CollectionCaseRow } from '@/api/collection';
import type { CaseDeskInfo } from '@/api/collectionDesk';
import { LastTouch, PromiseChip } from '../CollectionBits';
import { BoardSkeleton } from '../CollectionSkeletons';
import { money } from '../collectionFormat';
import {
  BOARD_LANES,
  caseInitials,
  caseName,
  daysTone,
  laneOfStage,
  stageChip,
  stageLabel,
} from './casesModel';

/** Compact money for a lane head — $1.62M reads where $1,618,402 does not. */
function laneMoney(total: number): string {
  if (total >= 1_000_000) return `$${(total / 1_000_000).toFixed(2)}M`;
  if (total >= 1_000) return `$${Math.round(total / 1_000)}k`;
  return money(total);
}

export function CasesKanban({
  rows,
  desk,
  loading,
  filtered,
  hideClosedLane,
  onOpen,
}: {
  rows: CollectionCaseRow[];
  desk: Record<string, CaseDeskInfo>;
  loading: boolean;
  filtered: boolean;
  /**
   * True under the Open scope. The Closed lane can never hold a row there, and an always-empty
   * fifth of the board is dead width — the other four lanes get it back instead.
   */
  hideClosedLane: boolean;
  onOpen: (id: string) => void;
}) {
  const lanes = hideClosedLane ? BOARD_LANES.filter((l) => l.id !== 'closed') : BOARD_LANES;
  if (loading && rows.length === 0) return <BoardSkeleton lanes={lanes.length} />;

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

  const byLane = new Map<string, CollectionCaseRow[]>(lanes.map((l) => [l.id, []]));
  for (const row of rows) byLane.get(laneOfStage(row.collectionStage))?.push(row);

  return (
    <div className="cc-board" data-stale={loading && rows.length > 0 ? 'true' : undefined}>
      {lanes.map((lane) => {
        const cards = byLane.get(lane.id) ?? [];
        const total = cards.reduce((sum, row) => sum + (Number(row.totalDebtAmount) || 0), 0);
        return (
          <section key={lane.id} className="cc-col" data-lane={lane.id}>
            <header className="cc-col-head">
              <div className="cc-col-title">
                <span className="cc-lane-name">
                  <i className="cc-lane-dot" style={{ background: lane.tone }} aria-hidden="true" />
                  {lane.label}
                </span>
                <span className="cc-col-count num">{cards.length}</span>
              </div>
              <div className="cc-col-sub">
                <span className="cc-col-hint">{lane.hint}</span>
                <span className="cc-col-money num" data-zero={total === 0 ? 'true' : undefined}>
                  {laneMoney(total)}
                </span>
              </div>
            </header>
            <div className="cc-col-body">
              {cards.map((row) => {
                const info = desk[row.id];
                const chip = stageChip(row.collectionStage);
                return (
                  <button
                    key={row.id}
                    type="button"
                    className="cc-card"
                    style={{ ['--cc-card-tone' as string]: lane.tone }}
                    aria-label={`Open ${caseName(row)}`}
                    onClick={() => onOpen(row.id)}
                  >
                    <span className="cc-card-edge" aria-hidden="true" />
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
                      <span className="num" data-tone={daysTone(row.daysPastDue)}>
                        {row.daysPastDue}d
                      </span>
                    </span>
                    {info?.promise ? (
                      <PromiseChip
                        amount={info.promise.amount}
                        dueDate={info.promise.dueDate}
                        daysLate={info.promise.daysLate}
                      />
                    ) : null}
                    <span className="cc-card-foot">
                      <Badge intent={chip.intent} icon={chip.icon} size="sm">
                        {stageLabel(row.collectionStage)}
                      </Badge>
                      <LastTouch
                        days={info?.daysSinceContact ?? null}
                        channel={info?.lastContact?.channel ?? null}
                      />
                    </span>
                  </button>
                );
              })}
              {cards.length === 0 ? <p className="cc-col-empty">Nothing in this lane</p> : null}
            </div>
          </section>
        );
      })}
    </div>
  );
}
