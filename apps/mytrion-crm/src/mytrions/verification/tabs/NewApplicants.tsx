/**
 * Verification desk — new applicants queue.
 *
 * Red cases are LISTED, not hidden: "what am I waiting on?" is the desk's most useful question on a
 * slow morning, and a workable-only queue cannot answer it. Red rows are visibly locked instead.
 *
 * Built on the desk's own `vf-*` / `vfx-*` language rather than inline styles — an earlier cut used
 * its own colours and spacing, which is what made this surface read as foreign next to the rest of
 * the Mytrion.
 */
import { useCallback, useMemo, useState } from 'react';
import { Inbox, Lock, ShieldCheck, Upload } from 'lucide-react';
import { useCachedLoad } from '../../_shared/swrCache';
import { CaseWorkspace } from '../flow/CaseWorkspace';
import { listDeskCases, type VerificationCaseRow } from '@/api/verificationFlow';
import '../flow/verificationFlow.css';

type Scope = 'all' | 'workable' | 'awaiting_sales' | 'pending_docs' | 'manager_review' | 'closed';

const SCOPES: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'workable', label: 'Ready to work' },
  { id: 'awaiting_sales', label: 'Waiting on Sales' },
  { id: 'pending_docs', label: 'Pending documents' },
  { id: 'manager_review', label: 'Manager review' },
  { id: 'closed', label: 'Decided' },
];

function inScope(row: VerificationCaseRow, scope: Scope): boolean {
  switch (scope) {
    case 'workable':
      return row.verificationProcess && !row.closedAt;
    case 'awaiting_sales':
      return !row.verificationProcess;
    case 'pending_docs':
      return row.statusCode === 'pending_docs';
    case 'manager_review':
      return row.statusCode === 'manager_review';
    case 'closed':
      return Boolean(row.closedAt);
    default:
      return true;
  }
}

function nameOf(row: VerificationCaseRow): string {
  return (
    row.companyName || [row.firstName, row.lastName].filter(Boolean).join(' ') || 'Untitled application'
  );
}

const PHASE_ORDER: Record<string, number> = {
  p1_intake: 1,
  p2_identity: 2,
  p3_screening: 3,
  p4_authority: 4,
  p5_routing: 5,
  p6_credit_banking: 6,
  p7_hard_stops: 7,
  p8_highway: 8,
  p9_risk_capacity: 9,
  p10_decision: 10,
};

const APPLICANT_LABEL: Record<string, string> = {
  owner_operator: 'Owner-operator',
  carrier: 'Carrier',
  company: 'Company',
};

export function NewApplicants() {
  // Default to ALL. Defaulting to "ready to work" showed an empty state on a desk that had three
  // cases in it — the first thing an agent saw was "nothing here" while the counters said otherwise.
  const [scope, setScope] = useState<Scope>('all');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => listDeskCases({ limit: 200 }), []);
  const { data, loading, error, reload } = useCachedLoad('verification:flow:cases', load);

  const rows = useMemo(() => data?.items ?? [], [data]);
  const counts = useMemo(() => {
    const out = {} as Record<Scope, number>;
    for (const sc of SCOPES) out[sc.id] = rows.filter((r) => inScope(r, sc.id)).length;
    return out;
  }, [rows]);

  if (openId) {
    return (
      <CaseWorkspace
        caseId={openId}
        onBack={() => {
          setOpenId(null);
          void reload();
        }}
      />
    );
  }

  const visible = rows.filter((r) => inScope(r, scope));
  const agg = data?.aggregates;

  return (
    <div className="vfx">
      {/* Stats render at every stage — skeleton, loaded, empty — so nothing shifts on load. */}
      <div className="vfx-stats">
        {loading ? (
          <StatSkeletons />
        ) : (
          <>
            <Stat label="Ready to work" value={agg?.workable ?? 0} tone="ok" scope="workable" active={scope === 'workable'} onPick={setScope} />
            <Stat label="Waiting on Sales" value={agg?.awaitingSales ?? 0} tone="bad" scope="awaiting_sales" active={scope === 'awaiting_sales'} onPick={setScope} />
            <Stat label="Pending documents" value={agg?.pendingDocs ?? 0} tone="warn" scope="pending_docs" active={scope === 'pending_docs'} onPick={setScope} />
            <Stat label="Manager review" value={agg?.managerReview ?? 0} tone="warn" scope="manager_review" active={scope === 'manager_review'} onPick={setScope} />
            <Stat label="Decided" value={agg?.closed ?? 0} tone="plain" scope="closed" active={scope === 'closed'} onPick={setScope} />
          </>
        )}
      </div>

      <div className="vf-chips" role="tablist" aria-label="Filter applicants">
        {SCOPES.map((sc) => (
          <button
            key={sc.id}
            type="button"
            role="tab"
            aria-selected={scope === sc.id}
            className={`vf-chip${scope === sc.id ? ' is-on' : ''}`}
            onClick={() => setScope(sc.id)}
          >
            {sc.label}
            <span className="vf-chip-n">{loading ? '·' : counts[sc.id]}</span>
          </button>
        ))}
      </div>

      {error ? (
        <div className="vfx-banner" data-tone="bad" role="alert">
          <span className="vfx-banner-title">Could not load the queue</span>
          <p className="vfx-banner-body">{String(error)}</p>
        </div>
      ) : null}

      {loading ? (
        <RowSkeletons />
      ) : visible.length === 0 ? (
        <div className="vf-empty">
          <Inbox size={22} aria-hidden />
          <span className="vf-empty-title">
            {rows.length === 0 ? 'No applications yet' : 'Nothing in this filter'}
          </span>
          <span>
            {rows.length === 0
              ? 'Applications appear here once a Sales agent completes intake.'
              : 'Try another filter to see the rest of the desk.'}
          </span>
        </div>
      ) : (
        <ul className="vfx-rows">
          {visible.map((row) => (
            <li key={row.id}>
              <ApplicantRow row={row} onOpen={() => setOpenId(row.id)} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** A counter you can act on is a control — clicking it filters the list below. */
function Stat({
  label,
  value,
  tone,
  scope,
  active,
  onPick,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'bad' | 'warn' | 'plain';
  scope: Scope;
  active: boolean;
  onPick: (s: Scope) => void;
}) {
  return (
    <button
      type="button"
      className="vfx-stat"
      data-tone={tone}
      aria-pressed={active}
      onClick={() => onPick(active ? 'all' : scope)}
    >
      <span className="vfx-stat-label">{label}</span>
      <span className="vfx-stat-value">{value}</span>
    </button>
  );
}

/** Same box, same height, same count as the loaded state — only the content is a placeholder. */
function StatSkeletons() {
  return (
    <>
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="vfx-stat" aria-hidden="true">
          <span className="vfx-sk vfx-sk-line" style={{ width: '58%' }} />
          <span className="vfx-sk vfx-sk-value" />
        </div>
      ))}
    </>
  );
}

function RowSkeletons() {
  return (
    <div aria-busy="true">
      <span className="sr-only" role="status">
        Loading applicants
      </span>
      <ul className="vfx-rows" aria-hidden="true">
        {Array.from({ length: 4 }, (_, i) => (
          <li key={i}>
            <div className="vfx-row" data-skeleton="true">
              <span className="vfx-sk vfx-sk-title vfx-row-name" />
              <span className="vfx-sk vfx-sk-line vfx-row-state" style={{ width: 62 }} />
              <span className="vfx-sk vfx-sk-line vfx-row-line" style={{ width: '34%' }} />
              <span className="vfx-sk vfx-sk-line vfx-row-meta" style={{ width: '60%' }} />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

function ApplicantRow({ row, onOpen }: { row: VerificationCaseRow; onOpen: () => void }) {
  const locked = !row.verificationProcess;
  const outstanding = row.intakeMissing?.length ?? 0;
  const phase = PHASE_ORDER[row.phaseCode] ?? 1;
  const decided = Boolean(row.closedAt);

  return (
    <button
      type="button"
      className="vfx-row"
      data-locked={locked}
      data-testid="applicant-row"
      aria-label={`Open ${nameOf(row)}`}
      onClick={onOpen}
    >
      <span className="vfx-row-name">{nameOf(row)}</span>

      <span className="vfx-row-state">
        <span className="vfx-pill" data-tone={locked ? 'bad' : decided ? 'ok' : 'plain'}>
          {locked ? (
            <>
              <Lock size={11} aria-hidden /> Locked
            </>
          ) : (
            (row.statusLabel ?? 'In review')
          )}
        </span>
      </span>

      {locked ? (
        <span className="vfx-row-line" data-tone="bad">
          <ShieldCheck size={13} aria-hidden />
          {/* A legacy Zoho-ingested case has never been evaluated, so a count would read
              "0 items outstanding" and mean nothing. Say what is actually true instead. */}
          {outstanding > 0
            ? `Waiting on Sales — ${outstanding} item${outstanding === 1 ? '' : 's'} outstanding`
            : 'Waiting on Sales — intake not started'}
        </span>
      ) : row.statusCode === 'pending_docs' ? (
        <span className="vfx-row-line" data-tone="warn">
          <Upload size={13} aria-hidden />
          Documents requested from Sales
        </span>
      ) : (
        <span className="vfx-row-line" data-tone="plain">
          <span className="vfx-meter">
            <span className="vfx-meter-track" aria-hidden>
              {Array.from({ length: 10 }, (_, i) => (
                <span key={i} className="vfx-meter-seg" data-on={i < phase} />
              ))}
            </span>
            Phase {phase} of 10
          </span>
        </span>
      )}

      <span className="vfx-row-meta">
        <span>{APPLICANT_LABEL[row.applicantType ?? ''] ?? 'Type not set'}</span>
        <span>{row.trucksCount ?? '—'} trucks</span>
        <span>{row.fuelCardsRequested ?? '—'} cards</span>
        {row.underwritingRoute === 'wex' ? <span>WEX route</span> : null}
        <span>{row.ownerName}</span>
      </span>
    </button>
  );
}
