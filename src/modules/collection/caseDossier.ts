/**
 * The Zoho fields this schema deliberately does not store — computed on read instead.
 *
 * Zoho keeps flat mirrors of things the desk models relationally: `Promise_Status` beside
 * `collection_promises`, the payment-plan quartet beside `collection_payment_plans`,
 * `Total_Contact_Attempts` and `First_Contact_Date` beside `collection_activity`,
 * `Days_In_Current_Stage` beside the stage history. Every one of them is a second copy that has
 * to be bumped on write, and the first time somebody updates one and not the other the record
 * starts lying. So the columns are not in `0134` and this module derives them at read time.
 *
 * It also carries the three FORMULA fields, which Zoho computes and does not expose through the
 * API at all — remaining, the agency's cut, and what the debtor actually owes all in.
 *
 * Pure. No db import, no I/O — the caller passes what it already fetched for the case record, so
 * this adds no queries. Covered by `tests/unit/collection-case-dossier.test.ts`.
 */
import { agencyFee, totalDebtWithFee } from './agencyFees.js';

export type PromiseStatus = 'Kept' | 'Failed' | 'Pending';

export interface DossierInputs {
  /** Already net of payments — see the note in `buildCaseDossier`. */
  totalDebtAmount: string;
  currentAgency: string | null;
  /** The newest promise on the case, whatever its state. */
  promise: { dueDate: string; status: string } | null;
  /** The active plan, if there is one. */
  plan: {
    frequency: 'weekly' | 'fortnightly' | 'monthly' | string;
    instalmentAmount: string;
    instalments: ReadonlyArray<{ dueDate: string; status: string }>;
  } | null;
  lastContact: { channel: string | null; outcome: string | null; occurredAt: string } | null;
  contactStats: { attempts: number; firstContactAt: string | null } | null;
  lastStageChangeAt: string | null;
  /** Falls back to the case row's own timestamp when the timeline is empty. */
  caseUpdatedAt: string;
  caseCreatedDate: string;
}

export interface CaseDossier {
  promiseStatus: PromiseStatus | null;
  promiseToPayDate: string | null;
  paymentPlanCreated: boolean;
  paymentPlanType: 'Weekly' | 'Monthly' | 'Custom' | null;
  weeklyPaymentAmount: string | null;
  nextPaymentDueDate: string | null;
  firstContactDate: string | null;
  contactMethod: 'Call' | 'Email' | 'SMS' | 'Mail' | null;
  contactResult: 'Connected' | 'No Answer' | 'Wrong Number' | 'Refused' | null;
  totalContactAttempts: number;
  lastActivityDate: string;
  lastStageChangeDate: string | null;
  daysInCurrentStage: number;
  /** Formula fields. `agencyFee` is null when the agency has no known rate — see agencyFees.ts. */
  totalRemainingAmount: string;
  agencyFee: string | null;
  totalDebtWithFee: string;
}

/** Our channel vocabulary in Zoho's words, so a collector reads the same label in both systems. */
const CHANNEL_LABEL: Record<string, CaseDossier['contactMethod']> = {
  call: 'Call',
  email: 'Email',
  sms: 'SMS',
  letter: 'Mail',
};

const OUTCOME_LABEL: Record<string, CaseDossier['contactResult']> = {
  reached: 'Connected',
  no_answer: 'No Answer',
  voicemail: 'No Answer',
  wrong_number: 'Wrong Number',
  refused: 'Refused',
};

const PROMISE_STATUS: Record<string, PromiseStatus> = {
  kept: 'Kept',
  broken: 'Failed',
  open: 'Pending',
};

/**
 * Zoho names Weekly, Monthly and Custom. The desk also supports fortnightly, which Zoho has no
 * word for, so it reads as Custom rather than being rounded to the nearest wrong answer.
 */
const PLAN_TYPE: Record<string, CaseDossier['paymentPlanType']> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
};

const money = (n: number): string => (Math.round(n * 100) / 100).toFixed(2);

/** Whole UTC days between a date and now, pinned to midnight so "today" is never a fraction. */
function daysSince(iso: string, now: Date): number {
  const then = Date.parse(iso);
  if (Number.isNaN(then)) return 0;
  const a = Date.UTC(
    new Date(then).getUTCFullYear(),
    new Date(then).getUTCMonth(),
    new Date(then).getUTCDate(),
  );
  const b = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function buildCaseDossier(input: DossierInputs, now = new Date()): CaseDossier {
  /**
   * `total_debt_amount` IS ALREADY NET OF PAYMENTS — do not subtract them again.
   *
   * The finder writes it as `totalInvoiceAmount - totalPaid` (`collectionCaseFinder.js`), and Zoho
   * agrees on every row: checked against eight live cases carrying payments,
   * `Total_Debt_Amount == Total_Invoice_Amount - Total_Amount_Paid` and
   * `Total_Remaining_Amount == Total_Debt_Amount` exactly, including one carrier who had paid
   * $177,975 of $202,632.
   *
   * This used to compute `debt - paid`, which took the payments off twice: a case owing $72,500
   * with $7,500 paid read as $65,000 remaining while "total with fee" beside it still said
   * $72,500. The desk was quoting a debtor less than they owe and contradicting itself on the
   * same panel.
   */
  const debt = Number(input.totalDebtAmount) || 0;
  // Floored at zero: an overpayment is a credit question, not a negative debt.
  const remaining = Math.max(0, debt);
  const fee = agencyFee(input.currentAgency, debt);

  const plan = input.plan;
  // The next one still to be PAID. `missed` ones are in the past and already showing as broken
  // on the plan; what a collector needs on the record is the date money is next expected.
  const nextInstalment = plan?.instalments.find((i) => i.status === 'scheduled');

  // The stage clock starts at the last stage move, or at the day the case opened if it has never
  // moved — a case sitting in Intake since April has been there since April, not since today.
  const stageSince = input.lastStageChangeAt ?? `${input.caseCreatedDate}T00:00:00Z`;

  return {
    promiseStatus: input.promise ? (PROMISE_STATUS[input.promise.status] ?? null) : null,
    promiseToPayDate: input.promise?.dueDate ?? null,
    paymentPlanCreated: plan !== null,
    paymentPlanType: plan ? (PLAN_TYPE[plan.frequency] ?? 'Custom') : null,
    weeklyPaymentAmount: plan && plan.frequency === 'weekly' ? plan.instalmentAmount : null,
    nextPaymentDueDate: nextInstalment?.dueDate ?? null,
    firstContactDate: input.contactStats?.firstContactAt?.slice(0, 10) ?? null,
    contactMethod: input.lastContact?.channel
      ? (CHANNEL_LABEL[input.lastContact.channel] ?? null)
      : null,
    contactResult: input.lastContact?.outcome
      ? (OUTCOME_LABEL[input.lastContact.outcome] ?? null)
      : null,
    totalContactAttempts: input.contactStats?.attempts ?? 0,
    lastActivityDate: input.lastContact?.occurredAt ?? input.caseUpdatedAt,
    lastStageChangeDate: input.lastStageChangeAt?.slice(0, 10) ?? null,
    daysInCurrentStage: daysSince(stageSince, now),
    totalRemainingAmount: money(remaining),
    agencyFee: fee === null ? null : money(fee),
    totalDebtWithFee: money(totalDebtWithFee(input.currentAgency, debt)),
  };
}
