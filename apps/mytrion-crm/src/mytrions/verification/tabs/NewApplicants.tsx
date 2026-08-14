/**
 * Verification desk — new applicants queue.
 *
 * Red cases are LISTED, not hidden. The desk's most useful question on a slow morning is "what am I
 * waiting on?", and a queue that only showed workable cases could not answer it. Red rows are
 * visibly locked instead.
 */
import { useCallback, useState } from 'react';
import { Icon } from '../../sales/redesign/icons';
import { s } from '../../sales/redesign/dc';
import { useCachedLoad } from '../../_shared/swrCache';
import { CaseWorkspace } from '../flow/CaseWorkspace';
import { listDeskCases, type VerificationCaseRow } from '@/api/verificationFlow';

type Scope = 'workable' | 'awaiting_sales' | 'pending_docs' | 'manager_review' | 'closed' | 'all';

const SCOPES: ReadonlyArray<{ id: Scope; label: string }> = [
  { id: 'workable', label: 'Ready to work' },
  { id: 'awaiting_sales', label: 'Waiting on Sales' },
  { id: 'pending_docs', label: 'Pending documents' },
  { id: 'manager_review', label: 'Manager review' },
  { id: 'closed', label: 'Decided' },
  { id: 'all', label: 'All' },
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

export function NewApplicants() {
  const [scope, setScope] = useState<Scope>('workable');
  const [openId, setOpenId] = useState<string | null>(null);

  const load = useCallback(() => listDeskCases({ limit: 200 }), []);
  const { data, loading, error, reload } = useCachedLoad('verification:flow:cases', load);

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

  const rows = data?.items ?? [];
  const aggregates = data?.aggregates;
  const visible = rows.filter((r) => inScope(r, scope));

  return (
    <div style={s('display:grid;gap:18px')}>
      {aggregates ? (
        <div style={s('display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(min(140px,100%),1fr))')}>
          <Stat label="Ready to work" value={aggregates.workable} tone="ok" />
          <Stat label="Waiting on Sales" value={aggregates.awaitingSales} tone="bad" />
          <Stat label="Pending documents" value={aggregates.pendingDocs} tone="warn" />
          <Stat label="Manager review" value={aggregates.managerReview} tone="warn" />
          <Stat label="Decided" value={aggregates.closed} tone="plain" />
        </div>
      ) : null}

      <div role="tablist" aria-label="Filter applicants" style={s('display:flex;flex-wrap:wrap;gap:8px')}>
        {SCOPES.map((sc) => {
          const active = scope === sc.id;
          return (
            <button
              key={sc.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setScope(sc.id)}
              style={s(
                `height:34px;padding:0 14px;border-radius:var(--radius-full);font-size:13px;font-weight:700;cursor:pointer;background:${
                  active ? 'var(--accent)' : 'var(--surface)'
                };color:${active ? 'var(--on-accent)' : 'var(--text2)'};border:1px solid ${
                  active ? 'var(--accent)' : 'var(--border)'
                }`,
              )}
            >
              {sc.label}
              <span style={s('margin-left:7px;opacity:.72')}>{rows.filter((r) => inScope(r, sc.id)).length}</span>
            </button>
          );
        })}
      </div>

      {error ? (
        <p role="alert" style={s('margin:0;font-size:13px;color:var(--danger)')}>
          Could not load the queue. {String(error)}
        </p>
      ) : null}

      {loading ? (
        <p style={s('margin:0;padding:32px;text-align:center;color:var(--muted);font-size:14px')}>
          Loading applicants…
        </p>
      ) : visible.length === 0 ? (
        <p
          style={s(
            'margin:0;padding:32px;text-align:center;color:var(--muted);font-size:14px;border-radius:var(--radius-md);border:1px dashed var(--border)',
          )}
        >
          {scope === 'workable'
            ? 'Nothing ready to underwrite. Applications appear here once Sales completes intake.'
            : 'Nothing in this filter.'}
        </p>
      ) : (
        <ul style={s('margin:0;padding:0;list-style:none;display:grid;gap:10px')}>
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

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'ok' | 'bad' | 'warn' | 'plain';
}) {
  const colour =
    tone === 'ok' ? 'var(--ok)' : tone === 'bad' ? 'var(--danger)' : tone === 'warn' ? 'var(--warn)' : 'var(--text)';
  return (
    <div
      style={s(
        'display:grid;gap:3px;padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface)',
      )}
    >
      <span style={s('font-size:11px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--faint)')}>
        {label}
      </span>
      <span style={s(`font-size:22px;font-weight:800;color:${colour};font-variant-numeric:tabular-nums`)}>
        {value}
      </span>
    </div>
  );
}

function ApplicantRow({ row, onOpen }: { row: VerificationCaseRow; onOpen: () => void }) {
  const locked = !row.verificationProcess;
  const outstanding = row.intakeMissing?.length ?? 0;
  const phase = PHASE_ORDER[row.phaseCode] ?? 1;

  return (
    <button
      type="button"
      onClick={onOpen}
      data-testid="applicant-row"
      aria-label={`Open ${nameOf(row)}`}
      style={s(
        `width:100%;text-align:left;display:grid;gap:10px;padding:14px 16px;border-radius:var(--radius-md);cursor:pointer;background:var(--surface);border:1px solid ${
          locked ? 'rgba(248,113,113,.34)' : 'var(--border)'
        }`,
      )}
    >
      <div style={s('display:flex;flex-wrap:wrap;gap:10px;align-items:baseline;justify-content:space-between')}>
        <span style={s('font-size:15px;font-weight:800;color:var(--text)')}>{nameOf(row)}</span>
        <span
          style={s(
            `font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:${
              locked ? 'var(--danger)' : 'var(--ok)'
            }`,
          )}
        >
          {locked ? 'Locked' : row.statusLabel ?? 'In review'}
        </span>
      </div>

      {locked ? (
        <span style={s('display:flex;align-items:center;gap:7px;font-size:12px;font-weight:700;color:var(--danger)')}>
          <Icon name="lock" size={13} strokeWidth={2.2} />
          Waiting on Sales — {outstanding} item{outstanding === 1 ? '' : 's'} outstanding
        </span>
      ) : (
        <PhaseMeter phase={phase} />
      )}

      <div style={s('display:flex;flex-wrap:wrap;gap:14px;font-size:12px;color:var(--muted)')}>
        <span>{row.applicantType === 'owner_operator' ? 'Owner-operator' : row.applicantType === 'carrier' ? 'Carrier' : 'Company'}</span>
        <span>{row.trucksCount ?? '—'} trucks</span>
        <span>{row.fuelCardsRequested ?? '—'} cards</span>
        {row.underwritingRoute === 'wex' ? <span style={s('color:var(--warn);font-weight:700')}>WEX route</span> : null}
        <span>{row.ownerName}</span>
      </div>
    </button>
  );
}

/** Ten segments — position in the flow at a glance, without a number to decode. */
function PhaseMeter({ phase }: { phase: number }) {
  return (
    <span style={s('display:flex;align-items:center;gap:8px')}>
      <span aria-hidden style={s('display:flex;gap:3px')}>
        {Array.from({ length: 10 }, (_, i) => (
          <span
            key={i}
            style={s(
              `width:14px;height:4px;border-radius:var(--radius-full);background:${
                i < phase ? 'var(--accent)' : 'var(--border)'
              }`,
            )}
          />
        ))}
      </span>
      <span style={s('font-size:12px;color:var(--muted)')}>Phase {phase} of 10</span>
    </span>
  );
}
