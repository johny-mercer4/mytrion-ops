/**
 * Start or revise a payment plan.
 *
 * The schedule is previewed BEFORE anything is written — a collector agreeing dates on a call
 * needs to read them out, and "we'll email you the schedule" is how a plan gets disputed. The
 * shortfall line is the other half of that: a plan that does not clear the debt is a legitimate
 * outcome, but it must be stated rather than discovered eleven months later.
 */
import { useMemo, useState } from 'react';
import { Button, DateField, Dialog, Input, Select, useToast } from '@/ds';
import {
  PLAN_FREQUENCIES,
  createPaymentPlan,
  type PaymentPlan,
  type PlanFrequency,
} from '@/api/collectionDesk';
import type { CollectionCaseRow } from '@/api/collection';
import { caseName } from '../cases/casesModel';
import { fmtDate, money, moneyExact } from '../collectionFormat';
import { ActionField, ActionNote } from './ActionField';
import { isoPlusDays, moneyInput, planShortfall, previewSchedule } from './actionsModel';

const FREQUENCY_LABEL: Record<PlanFrequency, string> = {
  weekly: 'Weekly',
  fortnightly: 'Fortnightly',
  monthly: 'Monthly',
};

const PREVIEW_ROWS = 4;

export function PaymentPlanDialog({
  row,
  existing,
  open,
  onClose,
  onDone,
}: {
  row: CollectionCaseRow;
  /** The plan this one would replace, if the case already has a running one. */
  existing: PaymentPlan | null;
  open: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { toast } = useToast();
  const outstanding = Number(row.totalDebtAmount) || 0;
  const [amount, setAmount] = useState(existing?.instalmentAmount ?? '');
  const [count, setCount] = useState(String(existing?.instalmentCount ?? 6));
  const [frequency, setFrequency] = useState<PlanFrequency>(existing?.frequency ?? 'monthly');
  const [firstPaymentDate, setFirstPaymentDate] = useState<string | null>(isoPlusDays(14));
  const [saving, setSaving] = useState(false);

  const parsedAmount = moneyInput(amount);
  const parsedCount = Number(count);
  const countValid = Number.isInteger(parsedCount) && parsedCount >= 1 && parsedCount <= 60;
  const canSave = parsedAmount !== null && countValid && Boolean(firstPaymentDate);

  const schedule = useMemo(
    () =>
      canSave && firstPaymentDate
        ? previewSchedule({
            amount: parsedAmount,
            count: parsedCount,
            frequency,
            firstPaymentDate,
            outstanding,
          })
        : [],
    [canSave, parsedAmount, parsedCount, frequency, firstPaymentDate, outstanding],
  );
  const shortfall = canSave ? planShortfall(outstanding, parsedAmount, parsedCount) : 0;
  const last = schedule[schedule.length - 1];

  const submit = async (): Promise<void> => {
    if (!canSave || !firstPaymentDate || !parsedAmount) return;
    setSaving(true);
    try {
      await createPaymentPlan(row.id, {
        instalmentAmount: parsedAmount,
        instalmentCount: parsedCount,
        frequency,
        firstPaymentDate,
      });
      toast({
        intent: 'success',
        title: existing ? 'Plan revised' : 'Plan started',
        description: `${parsedCount} instalments of ${money(parsedAmount)}, from ${fmtDate(firstPaymentDate)}.`,
      });
      onDone();
      onClose();
    } catch (err) {
      toast({ intent: 'error', title: 'Could not save the plan', description: String(err) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={existing ? 'Revise the payment plan' : 'Set up a payment plan'}
      subtitle={`${caseName(row)} · ${money(row.totalDebtAmount)} outstanding`}
      size="lg"
      footer={
        <div className="ca-foot">
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            icon="payments"
            loading={saving}
            disabled={!canSave}
            onClick={() => void submit()}
          >
            {existing ? 'Start the revised plan' : 'Start the plan'}
          </Button>
        </div>
      }
    >
      <div className="ca-body">
        {existing ? (
          <ActionNote tone="warning">
            This replaces the plan set {fmtDate(existing.createdAt)} —{' '}
            {existing.instalmentCount} instalments of {money(existing.instalmentAmount)}. The old
            schedule is closed and anything still owed rolls into the balance below.
          </ActionNote>
        ) : null}

        <div className="ca-grid">
          <ActionField
            label="Per instalment"
            hint={amount !== '' && parsedAmount === null ? 'Dollars and cents, e.g. 2400.00' : undefined}
          >
            <Input
              fullWidth
              inputMode="decimal"
              placeholder="2400.00"
              value={amount}
              invalid={amount !== '' && parsedAmount === null}
              onChange={(e) => setAmount(e.currentTarget.value)}
            />
          </ActionField>
          <ActionField label="Instalments" hint={countValid ? undefined : '1 to 60'}>
            <Input
              fullWidth
              inputMode="numeric"
              value={count}
              invalid={!countValid}
              onChange={(e) => setCount(e.currentTarget.value)}
            />
          </ActionField>
        </div>

        <div className="ca-grid">
          <Select
            label="Frequency"
            value={frequency}
            onChange={(v) => setFrequency((v ?? 'monthly') as PlanFrequency)}
            searchable={false}
            options={PLAN_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABEL[f] }))}
          />
          <ActionField label="First payment">
            <DateField value={firstPaymentDate} onChange={(v) => setFirstPaymentDate(v)} />
          </ActionField>
        </div>

        {schedule.length > 0 ? (
          <section className="ca-schedule">
            <div className="ca-schedule-head">
              <span className="t-eyebrow">Schedule</span>
              <span className="ca-schedule-total num">
                Total {moneyExact(String(parsedCount * Number(parsedAmount)))}
              </span>
            </div>
            <table className="ca-schedule-table">
              <thead>
                <tr>
                  <th scope="col">#</th>
                  <th scope="col">Due</th>
                  <th scope="col" className="ca-end">
                    Amount
                  </th>
                  <th scope="col" className="ca-end">
                    Balance after
                  </th>
                </tr>
              </thead>
              <tbody>
                {schedule.slice(0, PREVIEW_ROWS).map((line) => (
                  <tr key={line.seq}>
                    <td className="num">{line.seq}</td>
                    <td className="num">{fmtDate(line.dueDate)}</td>
                    <td className="num ca-end">{moneyExact(line.amount)}</td>
                    <td className="num ca-end">{moneyExact(line.balanceAfter)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {schedule.length > PREVIEW_ROWS && last ? (
              <p className="ca-schedule-foot">
                <span className="num">{schedule.length - PREVIEW_ROWS}</span> more · final{' '}
                <span className="num">{fmtDate(last.dueDate)}</span>
              </p>
            ) : null}
          </section>
        ) : null}

        {shortfall > 0 ? (
          <ActionNote tone="warning">
            This plan leaves <b className="num">{moneyExact(String(shortfall))}</b> unpaid. That is a
            partial settlement — record why in the case note if it is deliberate.
          </ActionNote>
        ) : null}
      </div>
    </Dialog>
  );
}
