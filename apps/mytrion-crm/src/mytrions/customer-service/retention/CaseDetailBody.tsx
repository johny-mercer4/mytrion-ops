import { Building2 } from 'lucide-react';
import type { RetentionCaseEventRow, RetentionCaseRow } from '@/api/touchpointTypes';
import { CaseDeskActions, type DeskOutcomeId } from './CaseDeskActions';
import {
  CaseBadge,
  CaseTimeline,
  FIELD_ICONS,
  Field,
  deadlineDetail,
  dueUrgency,
  phaseIcon,
  phaseShort,
  phaseTone,
  statusLabel,
  statusTone,
} from './casesUi';

const phaseLabel = (code: string) =>
  code === 'phase_2_retention'
    ? 'Retention (Phase 2)'
    : code === 'phase_3_citi'
      ? 'CITI Folder'
      : code === 'phase_1_agent'
        ? 'Sales (Phase 1)'
        : code;

const fmtGal = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? '—' : `${Math.round(v).toLocaleString('en-US')} gal`;

const agentLabel = (c: RetentionCaseRow) =>
  c.agentName?.trim() ||
  (c.assignedAgentZohoUserId ? `Agent ${c.assignedAgentZohoUserId}` : 'Unassigned');

export function CaseDetailBody({
  selected,
  events,
  canAct,
  canClaim,
  canMarkPending,
  twoCall,
  notes,
  onNotes,
  busy,
  onClaim,
  onLogListen,
  onLogSolution,
  onOutcome,
}: {
  selected: RetentionCaseRow;
  events: RetentionCaseEventRow[];
  canAct: boolean;
  canClaim: boolean;
  canMarkPending: boolean;
  twoCall: { listen: boolean; solution: boolean };
  notes: string;
  onNotes: (value: string) => void;
  busy: boolean;
  onClaim: () => void;
  onLogListen: () => void;
  onLogSolution: () => void;
  onOutcome: (id: DeskOutcomeId) => void;
}) {
  return (
    <div className="cs-ret-detail-body">
      <div className="cs-ret-detail-head">
        <h3>
          <Building2 size={22} strokeWidth={2.1} aria-hidden />
          {selected.companyName || selected.carrierId}
        </h3>
        <div className="cs-ret-row-badges">
          <CaseBadge tone={phaseTone(selected.phaseCode)} icon={phaseIcon(selected.phaseCode)}>
            {phaseShort(selected.phaseCode)}
          </CaseBadge>
          <CaseBadge tone={statusTone(selected.statusCode)}>{statusLabel(selected.statusCode)}</CaseBadge>
          {selected.isSpanishDesk ? <CaseBadge tone="orange">Spanish desk</CaseBadge> : null}
          {selected.closedAt ? (
            <CaseBadge tone={selected.statusCode === 'p1_returned' ? 'success' : 'muted'}>
              {selected.statusCode === 'p1_returned' ? 'Closed (Returned)' : 'Closed'}
            </CaseBadge>
          ) : null}
        </div>
      </div>

      {!canAct ? (
        <div className="cs-banner-info">
          {selected.closedAt
            ? 'Closed — view only.'
            : selected.phaseCode === 'phase_1_agent'
              ? 'Sales phase — view only. Ownership stays with the Sales agent until Retention handoff.'
              : selected.phaseCode === 'phase_3_citi'
                ? 'CITI Folder — manage exports from the CITI panel. View only here.'
                : 'View only for this phase.'}
        </div>
      ) : null}

      <div className="cs-ret-section-lbl">Overview</div>
      <dl className="cs-ret-dl">
        <Field label="Carrier" icon={FIELD_ICONS.carrier}>
          {selected.carrierId}
        </Field>
        <Field label="Phase" icon={FIELD_ICONS.phase}>
          {phaseLabel(selected.phaseCode)}
        </Field>
        <Field label="Status" icon={FIELD_ICONS.status}>
          {statusLabel(selected.statusCode)}
        </Field>
        <Field label="Assignee" icon={FIELD_ICONS.assignee}>
          {agentLabel(selected)}
        </Field>
        <Field label="Language" icon={FIELD_ICONS.language}>
          {selected.preferredLanguage ?? (selected.isSpanishDesk ? 'Spanish' : '—')}
        </Field>
        <Field label="Frequency" icon={FIELD_ICONS.frequency}>
          {selected.transactionFrequency ?? '—'}
        </Field>
        <Field label="Quiet days" icon={FIELD_ICONS.quiet}>
          {selected.daysInactive ?? '—'}
          {selected.thresholdDays != null ? ` / ${selected.thresholdDays}d expect` : ''}
        </Field>
        <Field label="Last fuel" icon={FIELD_ICONS.lastFuel}>
          {selected.lastTransactionAt
            ? new Date(selected.lastTransactionAt).toLocaleDateString('en-US', {
                month: 'short',
                day: 'numeric',
                year: 'numeric',
              })
            : '—'}
        </Field>
        <Field label="90d volume" icon={FIELD_ICONS.volume}>
          {fmtGal(selected.gallons90d)}
          {selected.txCount90d != null ? ` · ${selected.txCount90d} tx` : ''}
        </Field>
        <Field label="Active cards" icon={FIELD_ICONS.cards}>
          {selected.activeCards ?? '—'}
        </Field>
        <Field
          label="Deadline"
          icon={FIELD_ICONS.deadline}
          valueClassName={`cs-ret-due is-${dueUrgency(selected)}`}
        >
          {deadlineDetail(selected)}
        </Field>
        <Field label="Owners" icon={FIELD_ICONS.pool}>
          {selected.assignmentCount}/3
          <span className="cs-ret-field-hint"> · at 3 → CITI</span>
        </Field>
        <Field label="Zoho Deal" icon={FIELD_ICONS.deal} valueClassName="cs-ret-mono">
          {selected.zohoDealId || '—'}
        </Field>
        <Field label="Two-call" icon={FIELD_ICONS.twoCall}>
          <span className={`cs-ret-tick${twoCall.listen ? ' on' : ''}`}>
            Call 1 {twoCall.listen ? '✓' : '—'}
          </span>
          {' · '}
          <span className={`cs-ret-tick${twoCall.solution ? ' on' : ''}`}>
            Call 2 {twoCall.solution ? '✓' : '—'}
          </span>
        </Field>
      </dl>

      {canAct ? (
        <>
          <div className="cs-ret-section-lbl">Update case</div>
          <CaseDeskActions
            busy={busy}
            canClaim={canClaim}
            canMarkPending={canMarkPending}
            unassigned={!selected.assignedAgentZohoUserId}
            twoCall={twoCall}
            notes={notes}
            onNotes={onNotes}
            onClaim={onClaim}
            onLogListen={onLogListen}
            onLogSolution={onLogSolution}
            onOutcome={onOutcome}
          />
        </>
      ) : null}

      <CaseTimeline events={events} />
    </div>
  );
}
