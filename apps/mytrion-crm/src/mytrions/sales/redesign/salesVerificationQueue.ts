/**
 * The Sales projection of the verification queue — vocabulary and arithmetic, no React.
 *
 * `/verification/applications` and `/verification/flow/cases` return THE SAME
 * `VerificationCaseRow`, so everything that turns a row into words — its name, its initials, which
 * phase it sits on, how old it is, which route it takes — is imported from the desk's
 * `applicantsModel` rather than restated. Two copies of `phaseNumber` is how one screen comes to
 * call a case "6/10" while the other calls it "5/10".
 *
 * What is Sales-only is the QUESTION each surface answers. The desk asks what a case is blocked on
 * and answers it about somebody else (`blockedOn` → "Documents requested from Sales"); Sales asks
 * what it still owes and answers it about itself (`askFor` → "Verification asked you for
 * documents"). Same row, different reader — so the sentence lives here and the desk's stays there.
 */
import type { VerificationCaseRow } from '@/api/verificationFlow';
import { ageDays, caseName, phaseNumber, salesOwnerId, salesOwnerName } from '../../verification/applicants/applicantsModel';

/**
 * The five states an agent sorts their own book into.
 *
 * NOT the desk's six. `SCOPES` is a reviewer's working set — "Ready to work", "Waiting on Sales",
 * "Manager review" — and four of those six are the same bucket from where Sales stands: the case is
 * with Verification and there is nothing to do. The split that matters to an agent is whether the
 * ball is in their court.
 */
export type SalesScope = 'all' | 'draft' | 'needs_you' | 'with_verification' | 'decided';

export const SALES_SCOPES: ReadonlyArray<{ id: SalesScope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Incomplete' },
  { id: 'needs_you', label: 'Needs you' },
  { id: 'with_verification', label: 'With Verification' },
  { id: 'decided', label: 'Decided' },
];

export function inSalesScope(row: VerificationCaseRow, scope: SalesScope): boolean {
  switch (scope) {
    case 'draft':
      return !row.verificationProcess;
    case 'needs_you':
      return row.statusCode === 'pending_docs';
    case 'decided':
      return Boolean(row.closedAt);
    case 'with_verification':
      return row.verificationProcess && !row.closedAt && row.statusCode !== 'pending_docs';
    default:
      return true;
  }
}

export type AskTone = 'danger' | 'warn' | 'ok' | 'none';

/**
 * The one line that tells Sales to act, and its tone.
 *
 * Precedence is the order the agent can act in: what they still owe comes before what the desk
 * asked for, which comes before a decision they can only read. `none` is the quiet case — the desk
 * is working it and there is nothing for Sales to do but wait.
 *
 * The outstanding COUNT is the server's evaluation (`intakeMissing`), never a browser re-derivation,
 * so this line and the gate on the case can never disagree about what is missing.
 */
export function askFor(row: VerificationCaseRow): { tone: AskTone; text: string } {
  const outstanding = row.intakeMissing?.length ?? 0;
  if (!row.verificationProcess) {
    return {
      tone: 'danger',
      text:
        outstanding > 0
          ? `${outstanding} item${outstanding === 1 ? '' : 's'} still needed from you`
          : 'Not submitted yet',
    };
  }
  if (row.statusCode === 'pending_docs') {
    return { tone: 'warn', text: 'Verification asked you for documents' };
  }
  if (row.closedAt) {
    const limit = row.approvedLimitAmount ? ` — $${row.approvedLimitAmount}` : '';
    return { tone: 'ok', text: `${row.statusLabel ?? 'Decided'}${limit}` };
  }
  return { tone: 'none', text: 'With Verification — nothing needed from you' };
}

/**
 * Whether the row belongs to a DIFFERENT Sales agent, measured on the Deal's owner.
 *
 * The row's assignee is a snapshot taken at ingest, so REASSIGNING a Deal in Zoho leaves it stale:
 * the original agent keeps seeing the case (the Sales list matches the assignee too) while the Deal
 * now belongs to a colleague. Comparing the assignee instead is what once labelled a credit agent
 * as the Sales owner. When Zoho has nobody on the Deal there is nobody to name, so this is false.
 */
export function anotherAgentsDeal(row: VerificationCaseRow, viewerZohoId: string | null): boolean {
  const dealOwnerId = salesOwnerId(row);
  return Boolean(dealOwnerId) && dealOwnerId !== viewerZohoId;
}

/**
 * The applicant type in the words both desks use in FULL.
 *
 * Deliberately not the desk's `APPLICANT_LABEL`, which is rail-width ("Carrier"): an agent picking
 * the type on the form reads "Carrier (Company)", and a list that abbreviates it makes the two
 * screens look like they are naming different things.
 *
 * TWO types, not three. `company` was a value the Zoho poller assigned on its own and the two desks
 * read differently; it is mapped here only so rows that still carry it render a name.
 */
export function applicantLabel(type: VerificationCaseRow['applicantType']): string {
  if (type === 'owner_operator') return 'Owner-Operator / Individual';
  if (type === 'carrier' || type === 'company') return 'Carrier (Company)';
  return 'Type not set';
}

/**
 * Phase names in SALES' words, not the desk's.
 *
 * `PHASE_SHORT` is the credit desk's own vocabulary — "Hard stops", "Highway", "Risk tier" — and it
 * names the CHECK, which is the desk's business. The agent needs to know how far along their
 * application is, so these say what STAGE it is at without naming what is being looked for. `full` is
 * the roster's long-standing wording; `short` is the rail-width form, because the table cell and the
 * spine step each hold about twenty characters and the phase NUMBER beside it already carries most of
 * the meaning. The long form stays on the cell's `title`, so nothing is lost to the ellipsis.
 */
export const SALES_PHASE_LABEL: Record<string, { short: string; full: string }> = {
  p1_intake: { short: 'Intake', full: 'Application intake' },
  p2_identity: { short: 'Identity', full: 'Identity check' },
  p3_screening: { short: 'Screening', full: 'Internal screening' },
  p4_authority: { short: 'Authority', full: 'Authority status' },
  p5_routing: { short: 'Routing', full: 'Review routing' },
  p6_credit_banking: { short: 'Credit & banking', full: 'Credit & banking' },
  p7_hard_stops: { short: 'Financial checks', full: 'Financial checks' },
  p8_highway: { short: 'Operations', full: 'Operational review' },
  p9_risk_capacity: { short: 'Risk & capacity', full: 'Risk & capacity' },
  p10_decision: { short: 'Decision', full: 'Final decision' },
};

const FALLBACK_PHASE = { short: 'Intake', full: 'Application intake' };

/** The `short` map alone, for `PhaseSpine`'s `labels` prop. */
export const SALES_PHASE_SHORT: Record<string, string> = Object.fromEntries(
  Object.entries(SALES_PHASE_LABEL).map(([code, l]) => [code, l.short]),
);

export function salesPhaseLabel(phaseCode: string): { short: string; full: string } {
  return SALES_PHASE_LABEL[phaseCode] ?? FALLBACK_PHASE;
}

export type SalesSortKey = 'name' | 'status' | 'phase' | 'trucks' | 'cards' | 'limit' | 'age';
export type SalesSortDir = 'asc' | 'desc';

function numeric(value: string | number | null): number {
  if (value == null) return -1;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) ? n : -1;
}

/**
 * The visible list: scope, then search, then sort — all in the browser.
 *
 * An agent's own book is two orders of magnitude below the route's 200-row cap, and a filter that
 * costs a round trip is a filter nobody uses twice. The scope counts come off these same rows, so a
 * tab can never disagree with what opening it shows.
 */
export function selectSalesRows(
  rows: readonly VerificationCaseRow[],
  q: {
    scope: SalesScope;
    search: string;
    sortKey: SalesSortKey;
    sortDir: SalesSortDir;
    now: number;
  },
): VerificationCaseRow[] {
  const needle = q.search.trim().toLowerCase();

  const out = rows.filter((row) => {
    if (!inSalesScope(row, q.scope)) return false;
    if (!needle) return true;
    const haystack = [
      caseName(row),
      salesOwnerName(row) ?? '',
      row.email ?? '',
      row.phone ?? '',
      row.ein ?? '',
      row.mc ?? '',
      row.dot ?? '',
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(needle);
  });

  const dir = q.sortDir === 'asc' ? 1 : -1;
  const key = (row: VerificationCaseRow): string | number => {
    switch (q.sortKey) {
      case 'name':
        return caseName(row).toLowerCase();
      case 'status':
        return (row.statusLabel ?? row.statusCode).toLowerCase();
      case 'phase':
        return phaseNumber(row.phaseCode);
      case 'trucks':
        return numeric(row.trucksCount);
      case 'cards':
        return numeric(row.fuelCardsRequested);
      case 'limit':
        return numeric(row.approvedLimitAmount ?? row.requestedLimit);
      default:
        return ageDays(row, q.now);
    }
  };

  return out.sort((a, b) => {
    const av = key(a);
    const bv = key(b);
    if (av === bv) return 0;
    return av > bv ? dir : -dir;
  });
}
