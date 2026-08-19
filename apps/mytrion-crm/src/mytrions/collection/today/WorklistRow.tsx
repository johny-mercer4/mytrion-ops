/**
 * One row of Today.
 *
 * The unit of the worklist: a tone rail stating WHY it surfaced, the identity, one sentence of
 * consequence, the two figures that decide priority, and ONE action. If a row needs two actions
 * it is two rows — a queue where each line offers a choice is a queue nobody gets through.
 */
import { Badge, Button } from '@/ds';
import type { DeskPolicy, WorklistItem } from '@/api/collectionDesk';
import { AgeCell, PromiseChip } from '../CollectionBits';
import { money } from '../collectionFormat';
import { stageLabel, stageChip } from '../cases/casesModel';
import { itemName, laneAction, laneMeta, laneSentence } from './worklistCopy';

export function WorklistRow({
  item,
  policy,
  onOpen,
  onAct,
}: {
  item: WorklistItem;
  policy: DeskPolicy;
  onOpen: (caseId: string) => void;
  onAct: (item: WorklistItem) => void;
}) {
  const meta = laneMeta(item.lane);
  const action = laneAction(item.lane);
  const name = itemName(item);
  const chip = stageChip(item.case.collectionStage);
  const initials = name.slice(0, 2).toUpperCase();

  return (
    <div className="wl-row" style={{ ['--wl-tone' as string]: meta.tone }}>
      <span className="wl-rail" aria-hidden="true" />
      {/* The whole identity block opens the case; the action button does something else, so it
          cannot be nested inside the same button. Two controls, not one with a click-through. */}
      <button
        type="button"
        className="wl-open"
        onClick={() => onOpen(item.case.id)}
        aria-label={`Open ${name}`}
      >
        <span className="cc-mono" aria-hidden="true">
          {initials}
        </span>
        <span className="wl-why">
          <span className="wl-head">
            <span className="cc-ident-label">{name}</span>
            <span className="cc-ident-sub">
              {item.case.carrierId}
              {item.case.debtorMcDot ? ` · ${item.case.debtorMcDot}` : ''}
            </span>
            <Badge intent={chip.intent} icon={chip.icon}>
              {stageLabel(item.case.collectionStage)}
            </Badge>
            {item.promise ? (
              <PromiseChip
                amount={item.promise.amount}
                dueDate={item.promise.dueDate}
                daysLate={item.promise.daysLate}
              />
            ) : null}
          </span>
          <span className="wl-ask">{laneSentence(item, policy)}</span>
        </span>
      </button>

      <span className="wl-figs">
        <span className="co-fact wl-fig">
          <span className="t-eyebrow">Remaining</span>
          <span className="num wl-fig-v">{money(item.case.totalDebtAmount)}</span>
        </span>
        <span className="co-fact wl-fig">
          <span className="t-eyebrow">Age</span>
          <AgeCell days={item.case.daysPastDue} bands={policy.agingBands} />
        </span>
      </span>

      <Button size="sm" variant="secondary" icon={action.icon} onClick={() => onAct(item)}>
        {action.label}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        icon="chevron_right"
        aria-label={`Open ${name}`}
        onClick={() => onOpen(item.case.id)}
      />
    </div>
  );
}
