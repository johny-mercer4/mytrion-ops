/**
 * The case record's right rail: what to do next, the plan, the Array tradeline, the debtor.
 *
 * The TRADELINE panel is the join this module never had. `collection_cases` and `array_reports`
 * are both keyed on `carrier_id` and the UI has never put them on one screen, so a collector had
 * to leave the case to learn it had already been filed — or worse, filed and excluded.
 */
import { useState } from 'react';
import { Badge, Button, Icon, useToast } from '@/ds';
import type { CollectionCaseRow } from '@/api/collection';
import { assignCase, unassignCase, type CaseDeskBundle, type PaymentPlan } from '@/api/collectionDesk';
import { CallButton, callPhone } from '../../CollectionCall';
import { PlanPips } from '../../CollectionBits';
import { fmtDate, money, moneyExact } from '../../collectionFormat';

function planProgress(plan: PaymentPlan): { paid: number; missed: number; total: number; planId: string } {
  return {
    planId: plan.id,
    total: plan.instalments.length,
    paid: plan.instalments.filter((i) => i.status === 'paid').length,
    missed: plan.instalments.filter((i) => i.status === 'missed').length,
  };
}

export function CaseRail({
  row,
  bundle,
  onChanged,
  onLogContact,
  onPlan,
  onPlacement,
  onClose,
  onReopen,
}: {
  row: CollectionCaseRow;
  bundle: CaseDeskBundle | null;
  /** Refresh after an ownership change — the header and the list both read the assignee. */
  onChanged: () => void;
  onLogContact: () => void;
  onPlan: () => void;
  onPlacement: () => void;
  onClose: () => void;
  onReopen: () => void;
}) {
  const plan = bundle?.plan ?? null;
  const tradeline = bundle?.tradeline ?? null;
  const closed = row.status === 'closed';
  const progress = plan ? planProgress(plan) : null;
  const nextDue = plan?.instalments.find((i) => i.status === 'scheduled');

  return (
    <div className="cc-rail">
      <CaseOwner row={row} onChanged={onChanged} />

      <section className="cc-pane">
        <h2 className="cc-pane-title">Do next</h2>
        <div className="cc-rail-actions">
          {closed ? (
            <Button variant="secondary" fullWidth icon="refresh" onClick={onReopen}>
              Reopen the case
            </Button>
          ) : (
            <>
              <Button variant="secondary" fullWidth icon="call" onClick={onLogContact}>
                Log a contact attempt
              </Button>
              <Button variant="secondary" fullWidth icon="payments" onClick={onPlan}>
                {plan ? 'Revise the payment plan' : 'Set up a payment plan'}
              </Button>
              <Button
                variant="secondary"
                fullWidth
                icon="send"
                disabled={Boolean(row.placementDate)}
                onClick={onPlacement}
              >
                {row.placementDate ? 'Already placed' : 'Place with an agency'}
              </Button>
              <Button variant="danger" fullWidth icon="flag" onClick={onClose}>
                Close the case
              </Button>
            </>
          )}
        </div>
      </section>

      {plan && progress ? (
        <section className="cc-pane">
          <header className="cc-pane-head">
            <h2 className="cc-pane-title">Payment plan</h2>
            <Badge intent={progress.missed > 0 ? 'warning' : 'success'} size="sm">
              {progress.missed > 0 ? 'At risk' : 'On track'}
            </Badge>
          </header>
          <div className="cc-plan">
            <p className="cc-plan-line">
              <span className="num cc-plan-amount">{money(plan.instalmentAmount)}</span>
              <span>
                {plan.frequency} × {plan.instalmentCount}, from{' '}
                <span className="num">{fmtDate(plan.firstPaymentDate)}</span>
              </span>
            </p>
            <PlanPips progress={progress} />
            <p className="cc-plan-foot">
              <span className="num">{progress.paid}</span> paid ·{' '}
              <span className="num">{progress.missed}</span> missed ·{' '}
              <span className="num">{progress.total - progress.paid - progress.missed}</span> to come.
              {nextDue ? (
                <>
                  {' '}
                  Next due <span className="num">{fmtDate(nextDue.dueDate)}</span>.
                </>
              ) : null}
            </p>
          </div>
        </section>
      ) : null}

      <section className="cc-pane">
        <header className="cc-pane-head">
          <h2 className="cc-pane-title">Array tradeline</h2>
          <Badge intent={tradeline ? (tradeline.hasAgency ? 'warning' : 'info') : 'neutral'} size="sm">
            {tradeline ? (tradeline.hasAgency ? 'Placed' : 'Reported') : 'Not filed'}
          </Badge>
        </header>
        {tradeline ? (
          <dl className="cc-dl cc-dl-1">
            <Row k="Latest filing">{tradeline.reportPeriod}</Row>
            <Row k="Account status">{tradeline.accountStatus ?? '—'}</Row>
            <Row k="Agency">{tradeline.agencyName ?? '—'}</Row>
            {tradeline.validationErrors || tradeline.excludedReason ? (
              <div className="cc-dl-row">
                <dt>Excluded</dt>
                <dd className="cc-danger">
                  <Icon name="warning" size="sm" aria-hidden />{' '}
                  {tradeline.validationErrors ?? tradeline.excludedReason}
                </dd>
              </div>
            ) : null}
          </dl>
        ) : (
          <p className="cc-pane-empty">
            This carrier has never appeared on an Array file. The placement queue decides when it
            should.
          </p>
        )}
      </section>

      <section className="cc-pane">
        <header className="cc-pane-head">
          <h2 className="cc-pane-title">Debtor</h2>
          {row.zohoDealId ? (
            <span className="cc-pane-meta num">Deal {row.zohoDealId}</span>
          ) : null}
        </header>
        <dl className="cc-dl cc-dl-1">
          <Row k="Contact">{row.debtorFullName ?? '—'}</Row>
          <Row k="Email">{row.verifiedEmail ?? row.debtorEmail ?? '—'}</Row>
          <Row k="Phone">{callPhone(row) ?? '—'}</Row>
          <Row k="Address">{addressOf(row)}</Row>
          <Row k="Date of birth">{fmtDate(row.debtorDateOfBirth)}</Row>
        </dl>
        {callPhone(row) ? (
          <div className="cc-rail-actions">
            <CallButton caseId={row.id} phone={callPhone(row)} label="Call the debtor" size="md" />
          </div>
        ) : null}
      </section>

      <section className="cc-pane">
        <h2 className="cc-pane-title">Debt</h2>
        <dl className="cc-dl">
          <Row k="Invoiced">{moneyExact(row.totalInvoiceAmount)}</Row>
          <Row k="Paid">{moneyExact(row.totalAmountPaid)}</Row>
          <Row k="Remaining">{moneyExact(row.totalDebtAmount)}</Row>
          <Row k="First delinquent">{fmtDate(row.firstDelinquentDate)}</Row>
          <Row k="Placed">{fmtDate(row.placementDate)}</Row>
          <Row k="Reopened">{String(row.reopenCount)}</Row>
        </dl>
      </section>
    </div>
  );
}

function Row({ k, children }: { k: string; children: string }) {
  return (
    <div className="cc-dl-row">
      <dt>{k}</dt>
      <dd className="num">{children}</dd>
    </div>
  );
}

function addressOf(row: CollectionCaseRow): string {
  const line = [
    row.debtorAddress,
    [row.debtorCity, row.debtorState].filter(Boolean).join(', '),
    row.debtorZipCode,
  ]
    .filter(Boolean)
    .join(' · ');
  return line || '—';
}

/**
 * Who owns this case.
 *
 * `Owner` is the one Zoho field populated on all 476 cases that Mytrion could not write at all —
 * `assignee_user_id` existed but nothing ever set it. Without it a collection team cannot divide
 * a book of debt between them, which is most of what a collection team does.
 *
 * Deliberately a claim button rather than a user picker: there is no roster endpoint for the
 * collection team yet, and a picker over the wrong list is worse than an honest "take this one".
 * Reassigning to someone else is the gap to close when that roster exists.
 *
 * Neither action tells the server WHO — assign with no body means "me", resolved from the token.
 * An earlier version compared the case's assignee against the browser session to decide whether
 * to show "Give it up" or "Take it over", which fails wherever the session is not populated (the
 * local dev shell, for one) and made the panel depend on the client knowing the id format the
 * token writes. Offering both actions on an owned case is correct without knowing either.
 */
function CaseOwner({ row, onChanged }: { row: CollectionCaseRow; onChanged: () => void }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const owned = Boolean(row.assigneeUserId);

  const run = async (fn: () => Promise<unknown>, title: string): Promise<void> => {
    setBusy(true);
    try {
      await fn();
      toast({ intent: 'success', title });
      onChanged();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not change the owner', description: String(err) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="cc-pane cr-owner">
      <header className="cc-pane-head">
        <h2 className="cc-pane-title">Owner</h2>
        {row.assignedAt ? (
          <span className="cc-pane-meta">since {fmtDate(row.assignedAt)}</span>
        ) : null}
      </header>
      <p className="cr-owner-name" data-empty={row.assigneeUserId ? undefined : 'true'}>
        {row.assigneeName ?? (row.assigneeUserId ? row.assigneeUserId : 'Unassigned')}
      </p>
      <div className="cc-rail-actions">
        <Button
          variant="secondary"
          fullWidth
          icon="person_add"
          disabled={busy}
          onClick={() => void run(() => assignCase(row.id), owned ? 'Taken over' : 'Assigned to you')}
        >
          {owned ? 'Take it over' : 'Assign to me'}
        </Button>
        {owned ? (
          <Button
            variant="ghost"
            fullWidth
            icon="person_remove"
            disabled={busy}
            onClick={() => void run(() => unassignCase(row.id), 'Put back in the pool')}
          >
            Put back in the pool
          </Button>
        ) : null}
      </div>
    </section>
  );
}

