/**
 * The case record's head: identity, the recovery bar, and the eight-stage spine.
 *
 * The RECOVERY BAR is the change worth naming. The old detail printed Invoiced, Paid and
 * Remaining as three separate figures in a definition list, which asked the reader to subtract.
 * One bar of the same three, plus what a running plan has scheduled, states the position in a
 * glance — and "scheduled" is drawn as its own band because money a debtor has agreed to pay is
 * not money that has arrived.
 */
import { Badge, Button, Icon } from '@/ds';
import type { CollectionCaseRow, CollectionStage } from '@/api/collection';
import type { CaseDeskBundle, DeskPolicy } from '@/api/collectionDesk';
import { AgingMeter, PromiseChip, RecoveryBar } from '../../CollectionBits';
import { fmtDate, money } from '../../collectionFormat';
import {
  CLOSED_REASON_LABEL,
  KANBAN_STAGES,
  caseInitials,
  caseName,
  stageLabel,
  statusChip,
} from '../casesModel';

/** How much of the debt a running plan has already scheduled but not yet collected. */
function scheduledOnPlan(bundle: CaseDeskBundle | null): number {
  const plan = bundle?.plan;
  if (!plan) return 0;
  return plan.instalments
    .filter((i) => i.status === 'scheduled')
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);
}

/** The stage the case is on, and every stage it has already passed through. */
function spineState(current: CollectionStage, stage: CollectionStage): 'done' | 'now' | 'todo' {
  if (stage === current) return 'now';
  return KANBAN_STAGES.indexOf(stage) < KANBAN_STAGES.indexOf(current) ? 'done' : 'todo';
}

export function CaseHeader({
  row,
  bundle,
  policy,
  onBack,
  onAdvance,
  onLogContact,
}: {
  row: CollectionCaseRow;
  bundle: CaseDeskBundle | null;
  policy: DeskPolicy | null;
  onBack: () => void;
  onAdvance: () => void;
  onLogContact: () => void;
}) {
  const name = caseName(row);
  const chip = statusChip(row);
  const invoiced = Number(row.totalInvoiceAmount) || 0;
  const paid = Number(row.totalAmountPaid) || 0;
  const scheduled = scheduledOnPlan(bundle);
  const openPromise = bundle?.promises.find((p) => p.status === 'open') ?? null;
  const promiseDaysLate = openPromise
    ? Math.floor((Date.now() - new Date(`${openPromise.dueDate}T00:00:00`).getTime()) / 86_400_000)
    : 0;

  return (
    <section className="cc-case-head">
      <div className="cc-crumbs">
        <Button variant="secondary" size="sm" icon="chevron_left" onClick={onBack}>
          All cases
        </Button>
        <span className="cc-crumb">Collection case</span>
        <Icon name="chevron_right" size="sm" className="cc-crumb-sep" />
        <span className="cc-crumb-current">{name}</span>
        <span className="cc-crumbs-gap" />
        <span className="cc-case-id num">CASE {row.id}</span>
      </div>

      <div className="cc-case-identity">
        <div className="cc-case-who">
          <span className="cc-mono cc-mono-lg" aria-hidden="true">
            {caseInitials(row)}
          </span>
          <div className="cc-case-titles">
            <div className="cc-case-title-row">
              <h1 className="cc-case-name">{name}</h1>
              <Badge intent={chip.intent} icon={chip.icon}>
                {chip.label}
              </Badge>
              {openPromise ? (
                <PromiseChip
                  amount={openPromise.amount}
                  dueDate={openPromise.dueDate}
                  daysLate={promiseDaysLate}
                />
              ) : null}
            </div>
            <div className="cc-case-facts">
              <Fact k="Carrier">{row.carrierId}</Fact>
              <Fact k="MC / DOT">{row.debtorMcDot ?? 'Not recorded'}</Fact>
              <Fact k="Invoices">{`${row.issueInvoiceCount} unpaid`}</Fact>
              <Fact k="Opened">{fmtDate(row.caseCreatedDate)}</Fact>
              <Fact k="Stage">{stageLabel(row.collectionStage)}</Fact>
            </div>
          </div>
        </div>
        <div className="cc-case-cta">
          <Button variant="secondary" icon="call" onClick={onLogContact}>
            Log contact
          </Button>
          <Button
            variant="primary"
            icon="arrow_forward"
            disabled={row.status === 'closed'}
            onClick={onAdvance}
          >
            Advance stage
          </Button>
        </div>
      </div>

      <div className="cc-recovery-block">
        <div className="cc-recovery-main">
          <div className="cc-recovery-top">
            <span className="t-eyebrow">Recovery against {money(row.totalInvoiceAmount)} invoiced</span>
            <span className="cc-recovery-age">
              First delinquent <span className="num">{fmtDate(row.firstDelinquentDate)}</span> ·{' '}
              <span className="num">{row.daysPastDue}</span> days past due
              <AgingMeter days={row.daysPastDue} {...(policy ? { bands: policy.agingBands } : {})} />
            </span>
          </div>
          <RecoveryBar invoiced={invoiced} paid={paid} scheduled={scheduled} height={14} legend />
        </div>
        <div className="cc-recovery-figure">
          <span className="t-eyebrow">Remaining</span>
          <span className="num cc-recovery-value">{money(row.totalDebtAmount)}</span>
        </div>
      </div>

      {row.status === 'closed' ? (
        <div className="cc-banner" data-tone="success" role="status">
          <span className="cc-banner-title">
            Closed{row.closedReason ? ` — ${CLOSED_REASON_LABEL[row.closedReason]}` : ''}
          </span>
          <p className="cc-banner-body">
            {row.closedAt ? `Signed off ${fmtDate(row.closedAt)}.` : 'Read-only from here.'}
          </p>
        </div>
      ) : null}

      <ol className="cc-spine" aria-label="Collection stages">
        {KANBAN_STAGES.map((stage) => {
          const state = spineState(row.collectionStage, stage);
          return (
            <li key={stage} className="cc-spine-step" data-state={state}>
              <span className="cc-spine-bar" aria-hidden="true" />
              <span className="cc-spine-label">{stageLabel(stage)}</span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Fact({ k, children }: { k: string; children: string }) {
  return (
    <span className="cc-fact">
      <span className="t-eyebrow">{k}</span>
      <span className="cc-fact-v num">{children}</span>
    </span>
  );
}
