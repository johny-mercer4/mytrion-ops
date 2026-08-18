/**
 * Sales "Verification" tab — the agent's own credit applications, on Mytrion's own database.
 *
 * Applications are NOT started here. The Zoho Deal poller creates them
 * (`automation.verification.case-ingest`) and assigns them to the Deal's owner; this tab is where
 * that agent completes intake and then watches underwriting.
 *
 * The card's red/green state IS `verification_process`: red means Sales still owes intake and
 * Verification cannot start; green means it is with the desk. The count of outstanding items comes
 * from the server's evaluation, so the card and the form can never disagree about what is missing.
 */
import { useCallback, useState } from 'react';
import { Icon } from '../icons';
import { NAV_DESC } from '../salesData';
import { useCachedLoad } from '../dcCache';
import { SalesEmpty, SalesErrorNote, SalesPage, SalesPageHead, Skel } from '../SalesPage';
import { s } from '../dc';
import { ApplicationIntake } from '../applicationIntake';
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import { salesOwnerId, salesOwnerName } from '../../../_shared/verificationSalesOwner';
import { listApplications, type VerificationCaseRow } from '@/api/verificationFlow';

const PAGE_SIZE = 24;

type Filter = 'all' | 'draft' | 'with_verification' | 'needs_you' | 'decided';

const FILTERS: ReadonlyArray<{ id: Filter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'draft', label: 'Incomplete' },
  { id: 'with_verification', label: 'With Verification' },
  { id: 'needs_you', label: 'Needs you' },
  { id: 'decided', label: 'Decided' },
];

/** Board column → the words and tone the agent sees. Mirrors `verification_statuses.board_column`. */
interface ColumnTone {
  label: string;
  fg: string;
  bg: string;
  bd: string;
}

const DRAFT_TONE: ColumnTone = {
  label: 'Incomplete',
  fg: 'var(--danger)',
  bg: 'rgba(248,113,113,.12)',
  bd: 'rgba(248,113,113,.32)',
};

const COLUMN_TONE: Record<string, ColumnTone> = {
  draft: DRAFT_TONE,
  submitted: { label: 'With Verification', fg: 'var(--ok)', bg: 'rgba(52,211,153,.12)', bd: 'rgba(52,211,153,.3)' },
  in_review: { label: 'In review', fg: 'var(--ok)', bg: 'rgba(52,211,153,.12)', bd: 'rgba(52,211,153,.3)' },
  needs_you: { label: 'Needs you', fg: 'var(--warn)', bg: 'rgba(251,191,36,.14)', bd: 'rgba(251,191,36,.34)' },
  approved: { label: 'Approved', fg: 'var(--ok)', bg: 'rgba(52,211,153,.14)', bd: 'rgba(52,211,153,.34)' },
  declined: { label: 'Declined', fg: 'var(--danger)', bg: 'rgba(248,113,113,.12)', bd: 'rgba(248,113,113,.32)' },
};

function toneFor(row: VerificationCaseRow): ColumnTone {
  if (!row.verificationProcess) return DRAFT_TONE;
  return COLUMN_TONE[row.boardColumn ?? 'submitted'] ?? DRAFT_TONE;
}

function matchesFilter(row: VerificationCaseRow, filter: Filter): boolean {
  switch (filter) {
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

function displayName(row: VerificationCaseRow): string {
  return (
    row.companyName ||
    [row.firstName, row.lastName].filter(Boolean).join(' ') ||
    'Untitled application'
  );
}

/**
 * Phase labels for the Sales card. The desk owns the full rail; Sales only needs to know how far
 * along their application is, so this is a short read-only mirror of the fixed 10-phase catalog.
 */
const PHASE_PROGRESS: Record<string, { order: number; label: string }> = {
  p1_intake: { order: 1, label: 'Application intake' },
  p2_identity: { order: 2, label: 'Identity check' },
  p3_screening: { order: 3, label: 'Internal screening' },
  p4_authority: { order: 4, label: 'Authority status' },
  p5_routing: { order: 5, label: 'Review routing' },
  p6_credit_banking: { order: 6, label: 'Credit & banking' },
  p7_hard_stops: { order: 7, label: 'Financial checks' },
  p8_highway: { order: 8, label: 'Operational review' },
  p9_risk_capacity: { order: 9, label: 'Risk & capacity' },
  p10_decision: { order: 10, label: 'Final decision' },
};

/**
 * The applicant type in the words both desks now use.
 *
 * TWO types, not three: "Owner-Operator / Individual" and "Carrier (Company)". `company` was a
 * third value the Zoho poller assigned on its own, and Sales and Verification each read it
 * differently — it is kept here only so the rows that already carry it still render a name
 * instead of a dash. Nothing offers it as a choice any more.
 */
function applicantLabel(type: VerificationCaseRow['applicantType']): string {
  if (type === 'owner_operator') return 'Owner-Operator / Individual';
  if (type === 'carrier' || type === 'company') return 'Carrier (Company)';
  return 'Type not set';
}

/**
 * Whose list this is — the View-as target when one is picked, else the signed-in worker.
 *
 * Used for one thing: deciding whether the Sales owner is worth naming on a card. A case reaches an
 * agent three ways — they submitted it, they were ASSIGNED it, or they own the Zoho Deal — so a card
 * in your list can belong to a different Sales agent, and that is when you need the name. Naming
 * yourself on all the others would be noise.
 */
function viewerZohoId(): string | null {
  return getImpersonation()?.zohoUserId ?? getSession()?.worker.zohoUserId ?? null;
}

/**
 * The one line that tells Sales to act, and its tone.
 *
 * Precedence is the order the agent can act in: what they still owe comes before what the desk
 * asked for, which comes before a decision they can only read. `none` is the quiet case — the desk
 * is working it and there is nothing for Sales to do but wait.
 */
function askFor(row: VerificationCaseRow): { tone: 'danger' | 'warn' | 'ok' | 'none'; text: string } {
  const outstanding = row.intakeMissing?.length ?? 0;
  if (!row.verificationProcess) {
    return {
      tone: 'danger',
      text: outstanding > 0
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

const ASK_ICON: Record<'danger' | 'warn' | 'ok' | 'none', 'warn' | 'upload' | 'check' | 'clock'> = {
  danger: 'warn',
  warn: 'upload',
  ok: 'check',
  none: 'clock',
};

/**
 * The roster's own skeleton, deliberately NOT `SalesBodySkeleton variant="grid"`.
 *
 * Two mismatches made the shared one shift the page. Shape: the grid variant draws a 40px avatar
 * row, two pills and a three-up stat footer, which is not this card. Geometry: its
 * `.ss-verification-page .ss-skel-grid` override only applies inside `.ss-verification-page`,
 * which nothing rendered — so the skeleton fell back to `sales-page.css`'s
 * `minmax(min(100%,320px),1fr)` while the roster used an inline `minmax(min(300px,100%),1fr)`,
 * and the column COUNT changed when the data landed.
 *
 * Now both live inside `.ss-verification-page` and share one grid rule (3 / 2 / 1 columns at
 * 900 and 640), and this mirrors the real card block for block: title row, meter, stage line,
 * ask line, chips. It sits next to `ApplicationCard` so a change to one is visibly a change to
 * the other.
 */
function RosterSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="ss-skel-grid" aria-busy="true" aria-label="Loading your applications">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="ss-verification-card" aria-hidden="true">
          <div className="ss-verification-card-top">
            <div className="ss-verification-card-heading">
              <Skel w="72%" h="15px" />
              <div style={{ marginTop: 7 }}>
                <Skel w="46%" h="11px" />
              </div>
            </div>
            <Skel w="84px" h="22px" radius="999px" />
          </div>
          <div style={{ marginTop: 14 }}>
            <Skel w="100%" h="4px" radius="1px" />
          </div>
          <div style={{ marginTop: 7 }}>
            <Skel w="58%" h="11px" />
          </div>
          <div style={{ marginTop: 12 }}>
            <Skel w="100%" h="36px" />
          </div>
          <div className="ss-vf-card-foot">
            <span className="ss-vf-chips">
              {[0, 1, 2].map((c) => (
                <Skel key={c} w="100%" h="38px" />
              ))}
            </span>
          </div>
        </div>
      ))}
    </div>
  );
}

function ApplicationCard({
  row,
  viewer,
  onOpen,
}: {
  row: VerificationCaseRow;
  viewer: string | null;
  onOpen: () => void;
}) {
  const tone = toneFor(row);
  const ask = askFor(row);
  const stage = PHASE_PROGRESS[row.phaseCode];
  const stageNo = stage?.order ?? 1;
  const locked = !row.verificationProcess;
  /**
   * The DEAL's owner against the viewer — never the row's assignee.
   *
   * The assignee is a snapshot taken at ingest, so REASSIGNING a Deal in Zoho leaves it stale: the
   * original agent keeps seeing the case (the Sales list matches the assignee too) while the Deal now
   * belongs to a colleague. Three live cases are in exactly that state. Naming the current Deal owner
   * is what tells the agent "this moved to Robert" instead of leaving them to work someone else's
   * application — and comparing the assignee instead is what labelled a credit agent as Sales.
   * When Zoho has nobody on the Deal there is nobody to name, so the chip stays off.
   */
  const dealOwnerId = salesOwnerId(row);
  const anotherAgentsDeal = Boolean(dealOwnerId) && dealOwnerId !== viewer;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="application-card"
      className="ss-verification-card"
      aria-label={`Open application for ${displayName(row)}`}
      style={s(`border-color:${tone.bd}`)}
    >
      <div className="ss-verification-card-top">
        <div className="ss-verification-card-heading">
          <span className="ss-verification-card-title">{displayName(row)}</span>
          <span className="ss-vf-open">{applicantLabel(row.applicantType)}</span>
        </div>
        <span
          className="ss-vf-class"
          style={s(`color:${tone.fg};background:${tone.bg};border-color:${tone.bd}`)}
        >
          {tone.label}
        </span>
      </div>

      {/* WHERE IT IS. Ten segments, the same shape the Verification queue draws — Sales sees the
          progress, never the findings behind it. */}
      <span className="ss-vf-meter" aria-hidden="true">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className="ss-vf-seg" data-on={i < stageNo} data-locked={locked} />
        ))}
      </span>
      <span className="ss-vf-stage-caption">
        Stage <b>{stageNo}</b> of 10 · {stage?.label ?? 'Application intake'}
      </span>

      {/* WHAT TO DO ABOUT IT. Always present, so the card never leaves the agent guessing. */}
      <span className="ss-vf-card-attention" data-tone={ask.tone}>
        <Icon name={ASK_ICON[ask.tone]} size={14} strokeWidth={2.2} />
        {ask.text}
      </span>

      <div className="ss-vf-card-foot">
        <span className="ss-vf-chips">
          <Fact label="Trucks" value={row.trucksCount == null ? '—' : String(row.trucksCount)} />
          <Fact label="Cards" value={row.fuelCardsRequested == null ? '—' : String(row.fuelCardsRequested)} />
          {row.underwritingRoute === 'wex' ? <Fact label="Route" value="WEX" /> : null}
          {anotherAgentsDeal ? (
            <Fact label="Sales owner" value={salesOwnerName(row) ?? ''} />
          ) : null}
        </span>
      </div>
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span className="ss-vf-chip">
      <span className="ss-vf-chip-lbl">{label}</span>
      <span className="ss-vf-chip-val">{value}</span>
    </span>
  );
}

export function VerificationTab() {
  const [filter, setFilter] = useState<Filter>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => listApplications({ limit: PAGE_SIZE }), []);
  const { data, loading, error, reload } = useCachedLoad('sales:verification:applications', load);

  const rows = data?.items ?? [];
  const visible = rows.filter((r) => matchesFilter(r, filter));
  const viewer = viewerZohoId();

  if (openId) {
    return (
      <SalesPage>
        <button
          type="button"
          onClick={() => {
            setOpenId(null);
            void reload();
          }}
          style={s(
            'align-self:flex-start;display:inline-flex;align-items:center;gap:8px;height:38px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);font-size:13px;font-weight:700;cursor:pointer',
          )}
        >
          <Icon name="chevronLeft" size={15} strokeWidth={2.2} />
          All applications
        </button>
        <ApplicationIntake applicationId={openId} />
      </SalesPage>
    );
  }

  return (
    <SalesPage>
      <SalesPageHead description={NAV_DESC.verification} />

      {/* `.ss-verification-page` wraps the FILTERS + LIST only, not the page head: the head is
          shared chrome that expects to be a direct child of `.ss-page`. Its one job here is to
          bring `.ss-verification-page .ss-skel-grid` alive so the skeleton and the loaded roster
          are governed by the same 3 / 2 / 1 column rule. */}
      <div className="ss-verification-page">
      <div role="tablist" aria-label="Filter applications" className="ss-vf-filters">
        {FILTERS.map((f) => {
          const active = filter === f.id;
          const n = rows.filter((r) => matchesFilter(r, f.id)).length;
          return (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.id)}
              style={s(
                `height:34px;padding:0 14px;border-radius:var(--radius-full);font-size:13px;font-weight:700;cursor:pointer;background:${
                  active ? 'var(--accent)' : 'var(--surface)'
                };color:${active ? 'var(--on-accent)' : 'var(--text2)'};border:1px solid ${
                  active ? 'var(--accent)' : 'var(--border)'
                }`,
              )}
            >
              {f.label}
              <span style={s('margin-left:7px;opacity:.72')}>{n}</span>
            </button>
          );
        })}
      </div>

      {error ? <SalesErrorNote>Could not load your applications. {String(error)}</SalesErrorNote> : null}

      {/* One loader per surface: `loading` is only true when there is nothing to show. */}
      {loading ? (
        <RosterSkeleton />
      ) : visible.length === 0 ? (
        <SalesEmpty
          icon="verification"
          title={rows.length === 0 ? 'No applications yet' : 'Nothing in this filter'}
          body={
            rows.length === 0
              ? 'Applications are created automatically from your Deals in Zoho — you do not start one here. When a Deal reaches an application stage it appears in this list, red, waiting for you to fill in the details and upload the documents.'
              : 'Try another filter to see the rest of your applications.'
          }
        />
      ) : (
        <div className="ss-verification-grid">
          {visible.map((row) => (
            <ApplicationCard
              key={row.id}
              row={row}
              viewer={viewer}
              onOpen={() => setOpenId(row.id)}
            />
          ))}
        </div>
      )}
      </div>
    </SalesPage>
  );
}
