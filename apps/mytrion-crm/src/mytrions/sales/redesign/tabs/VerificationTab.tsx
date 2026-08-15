/**
 * Sales "Verification" tab — the agent's own credit applications, on Mytrion's own database.
 *
 * Rebuilt (2026-08-15) off the retired credit_platform pipeline. The card's red/green state IS
 * `verification_process`: red means Sales still owes intake and Verification cannot start; green
 * means it is with the desk. The count of outstanding items comes from the server's evaluation, so
 * the card and the form can never disagree about what is missing.
 */
import { useCallback, useState } from 'react';
import { Icon } from '../icons';
import { NAV_DESC } from '../salesData';
import { useCachedLoad } from '../dcCache';
import { SalesEmpty, SalesErrorNote, SalesPage, SalesPageHead } from '../SalesPage';
import { SalesBodySkeleton } from '../SalesTabSkeleton';
import { s } from '../dc';
import { ApplicationIntake } from '../applicationIntake';
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
 * What the body line says for a green case.
 *
 * Deliberately NOT the status again — the chip already carries that, and a card that says
 * "In review" twice has spent its second line saying nothing.
 */
function progressLine(row: VerificationCaseRow): string {
  if (row.closedAt) return row.statusLabel ?? 'Decided';
  const phase = PHASE_PROGRESS[row.phaseCode];
  if (!phase) return row.statusLabel ?? 'In review';
  return `Phase ${phase.order} of 10 · ${phase.label}`;
}

function ApplicationCard({ row, onOpen }: { row: VerificationCaseRow; onOpen: () => void }) {
  const tone = toneFor(row);
  const outstanding = row.intakeMissing?.length ?? 0;
  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="application-card"
      className="ss-card-h"
      aria-label={`Open application for ${displayName(row)}`}
      style={s(
        `text-align:left;display:grid;gap:12px;padding:16px;border-radius:var(--radius-md);background:var(--surface);cursor:pointer;border:1px solid ${tone.bd}`,
      )}
    >
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px')}>
        <span style={s('font-size:15px;font-weight:800;color:var(--text);line-height:1.35')}>
          {displayName(row)}
        </span>
        <span
          style={s(
            `flex-shrink:0;padding:4px 10px;border-radius:var(--radius-full);font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${tone.fg};background:${tone.bg};border:1px solid ${tone.bd}`,
          )}
        >
          {tone.label}
        </span>
      </div>

      {/* The red state names what is outstanding — a colour alone is neither accessible nor useful. */}
      {!row.verificationProcess ? (
        <span style={s('display:flex;align-items:center;gap:7px;font-size:12px;color:var(--danger);font-weight:700')}>
          <Icon name="warn" size={14} strokeWidth={2.2} />
          {outstanding > 0
            ? `${outstanding} item${outstanding === 1 ? '' : 's'} still needed`
            : 'Not submitted yet'}
        </span>
      ) : row.statusCode === 'pending_docs' ? (
        <span style={s('display:flex;align-items:center;gap:7px;font-size:12px;color:var(--warn);font-weight:700')}>
          <Icon name="upload" size={14} strokeWidth={2.2} />
          Verification has asked you for documents
        </span>
      ) : (
        <span style={s('font-size:12px;color:var(--muted)')}>{progressLine(row)}</span>
      )}

      <div style={s('display:flex;flex-wrap:wrap;gap:8px')}>
        <Fact label="Type" value={row.applicantType === 'owner_operator' ? 'Owner-op' : row.applicantType === 'carrier' ? 'Carrier' : row.applicantType === 'company' ? 'Company' : '—'} />
        <Fact label="Trucks" value={row.trucksCount == null ? '—' : String(row.trucksCount)} />
        <Fact label="Cards" value={row.fuelCardsRequested == null ? '—' : String(row.fuelCardsRequested)} />
        {row.underwritingRoute === 'wex' ? <Fact label="Route" value="WEX" /> : null}
        {row.approvedLimitAmount ? <Fact label="Approved" value={`$${row.approvedLimitAmount}`} /> : null}
      </div>
    </button>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <span
      style={s(
        'display:inline-flex;align-items:baseline;gap:5px;padding:4px 9px;border-radius:var(--radius-sm);background:var(--alt);font-size:11px',
      )}
    >
      <span style={s('color:var(--faint);text-transform:uppercase;letter-spacing:.04em;font-weight:700')}>
        {label}
      </span>
      <span style={s('color:var(--text);font-weight:700')}>{value}</span>
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

      <div role="tablist" aria-label="Filter applications" style={s('display:flex;flex-wrap:wrap;gap:8px')}>
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
        <SalesBodySkeleton variant="grid" />
      ) : visible.length === 0 ? (
        <SalesEmpty
          icon="verification"
          title={rows.length === 0 ? 'No applications yet' : 'Nothing in this filter'}
          body={
            rows.length === 0
              ? 'Applications you own appear here. Incomplete ones stay with you until every detail and document is in.'
              : 'Try another filter to see the rest of your applications.'
          }
        />
      ) : (
        <div
          style={s(
            'display:grid;gap:14px;grid-template-columns:repeat(auto-fill,minmax(min(300px,100%),1fr))',
          )}
        >
          {visible.map((row) => (
            <ApplicationCard key={row.id} row={row} onOpen={() => setOpenId(row.id)} />
          ))}
        </div>
      )}
    </SalesPage>
  );
}
