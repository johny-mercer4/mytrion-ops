/**
 * CS Retention Cases — badge tones, icons, skeletons, due urgency helpers.
 */
import type { ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  Building2,
  CalendarClock,
  Clock3,
  Droplets,
  Folder,
  FolderKanban,
  Fuel,
  Globe2,
  Hash,
  Languages,
  ListChecks,
  Phone,
  RefreshCw,
  Shield,
  User,
  Users,
} from 'lucide-react';
import type { RetentionCaseRow } from '@/api/touchpointTypes';

export type BadgeTone =
  | 'sales'
  | 'retention'
  | 'citi'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'muted'
  | 'orange'
  | 'purple';

export function phaseShort(code: string): string {
  if (code === 'phase_2_retention') return 'Retention';
  if (code === 'phase_3_citi') return 'CITI';
  if (code === 'phase_1_agent') return 'Sales';
  return code;
}

export function phaseTone(code: string): BadgeTone {
  if (code === 'phase_2_retention') return 'retention';
  if (code === 'phase_3_citi') return 'citi';
  if (code === 'phase_1_agent') return 'sales';
  return 'muted';
}

export function phaseIcon(code: string): LucideIcon {
  if (code === 'phase_2_retention') return Shield;
  if (code === 'phase_3_citi') return Folder;
  if (code === 'phase_1_agent') return Briefcase;
  return FolderKanban;
}

export function statusLabel(code: string): string {
  const map: Record<string, string> = {
    p1_new: 'New',
    p1_in_progress: 'New',
    p1_reached: 'Reached',
    p1_out_of_reach: 'Out of reach',
    p1_vacation: 'Vacation',
    p1_vacation_followup: 'Vacation follow-up',
    p1_awaiting_ops: 'Awaiting Ops',
    p1_dissatisfied: 'Dissatisfied',
    p1_returned: 'Closed (Returned)',
    p1_open_pool: 'Open Pool',
    p1_pool_claim_pending: 'Claim pending',
    p1_pool_assigned: 'New',
    p1_no_action_2bd: 'No action 2BD',
    p1_handoff_retention: 'Handoff Retention',
    p2_new: 'Unassigned',
    p2_working: 'In progress',
    p2_offer_pending: 'Offer out',
    p2_saved: 'Saved',
    p2_refused: 'Refused',
    p2_out_of_business: 'Out of business',
    p2_no_response: 'No response',
    p2_lost: 'Lost',
    p2_handoff_citi: 'Handoff CITI',
    p3_hold: 'CITI hold',
    p3_review: 'CITI review',
    p3_closed: 'CITI closed',
  };
  return map[code] ?? code.replace(/^p[123]_/, '').replace(/_/g, ' ');
}

export function statusTone(code: string): BadgeTone {
  if (
    code === 'p1_returned' ||
    code === 'p2_saved' ||
    code === 'p1_reached' ||
    code === 'p3_closed'
  ) {
    return 'success';
  }
  if (
    code === 'p1_out_of_reach' ||
    code === 'p2_refused' ||
    code === 'p2_lost' ||
    code === 'p2_out_of_business' ||
    code === 'p1_dissatisfied'
  ) {
    return 'danger';
  }
  if (
    code === 'p1_in_progress' ||
    code === 'p2_working' ||
    code === 'p2_offer_pending' ||
    code === 'p1_vacation' ||
    code === 'p1_vacation_followup' ||
    code === 'p1_awaiting_ops' ||
    code === 'p1_pool_claim_pending'
  ) {
    return 'warning';
  }
  if (code === 'p2_handoff_citi' || code === 'p3_hold' || code === 'p3_review') {
    return 'citi';
  }
  if (code === 'p1_open_pool' || code === 'p1_pool_assigned' || code === 'p2_no_response') {
    return 'orange';
  }
  if (code === 'p1_new' || code === 'p2_new') return 'info';
  return 'muted';
}

export type DueUrgency = 'ok' | 'soon' | 'overdue' | 'none';

export function dueUrgency(c: RetentionCaseRow, now = new Date()): DueUrgency {
  if (!c.currentDeadlineAt || c.closedAt) return 'none';
  const due = new Date(c.currentDeadlineAt);
  if (Number.isNaN(due.getTime())) return 'none';
  const ms = due.getTime() - now.getTime();
  if (ms < 0) return 'overdue';
  if (ms < 36 * 60 * 60 * 1000) return 'soon';
  return 'ok';
}

/** Human label for `currentDeadlineType` (never show raw snake_case in UI). */
export function deadlineTypeLabel(type: string | null | undefined): string {
  switch (type) {
    case '2BD_agent_action':
      return '2 BD to act → Retention';
    case '1BD_comms_attempt':
      return '1 BD attempt prompt';
    case '5BD_comms_attempt':
      return 'Comms attempt window';
    case '5BD_post_contact':
      return '5 BD fuel watch → Open Pool';
    case '3BD_pool_claim':
      return '3 BD Open Pool claim → Retention';
    case '1BD_claim_approve':
      return '1 BD claim approve';
    case '3BD_new_owner':
      return '3 BD new-owner fuel watch';
    case '10BD_retention':
      return '10 BD Retention fuel watch → Open Pool';
    case '14D_vacation':
      return '14d vacation pause';
    case '2BD_vacation_followup':
      return '2 BD vacation follow-up';
    case '7D_citi_hold':
      return '7d CITI hold';
    default:
      return type ? type.replace(/_/g, ' ') : '';
  }
}

export function deadlineLabel(c: RetentionCaseRow): string {
  const until =
    c.currentDeadlineType === '14D_vacation' && c.vacationCountdownEnd
      ? c.vacationCountdownEnd
      : c.currentDeadlineAt;
  if (!until) return '—';
  return new Date(until).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
  });
}

/** Detail-pane deadline: date + plain-language SLA (no raw type codes). */
export function deadlineDetail(c: RetentionCaseRow): string {
  if (c.closedAt || c.statusCode === 'p1_returned') return 'None — case closed';
  if (c.statusCode === 'p1_awaiting_ops') return 'Awaiting Ops confirm (no auto timer)';
  const date = deadlineLabel(c);
  if (date === '—') return '—';
  const sla = deadlineTypeLabel(c.currentDeadlineType);
  return sla ? `${date} · ${sla}` : date;
}

export function CaseBadge({
  tone,
  children,
  icon: Icon,
}: {
  tone: BadgeTone;
  children: string;
  icon?: LucideIcon;
}) {
  return (
    <span className={`cs-ret-badge is-${tone}`}>
      {Icon ? <Icon size={12} strokeWidth={2.4} aria-hidden /> : null}
      {children}
    </span>
  );
}

export function MetaIcon({ icon: Icon }: { icon: LucideIcon }) {
  return <Icon className="cs-ret-ico" size={14} strokeWidth={2.2} aria-hidden />;
}

export const FIELD_ICONS = {
  carrier: Hash,
  phase: FolderKanban,
  status: ListChecks,
  assignee: User,
  language: Languages,
  frequency: Droplets,
  quiet: Clock3,
  lastFuel: Fuel,
  volume: Droplets,
  cards: Globe2,
  deadline: CalendarClock,
  pool: Users,
  deal: Building2,
  twoCall: Phone,
  timeline: RefreshCw,
} as const;

export function CasesListSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div className="cs-ret-skel-list" aria-hidden="true">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="cs-ret-skel-row" style={{ animationDelay: `${i * 45}ms` }}>
          <div className="cs-ret-skel-line w-55" />
          <div className="cs-ret-skel-line w-35 short" />
          <div className="cs-ret-skel-line w-70 tiny" />
        </div>
      ))}
    </div>
  );
}

export function CaseDetailSkeleton() {
  return (
    <div className="cs-ret-skel-detail" aria-busy="true" aria-label="Loading case detail">
      <div className="cs-ret-skel-line w-45 tall" />
      <div className="cs-ret-skel-badges">
        <div className="cs-ret-skel-pill" />
        <div className="cs-ret-skel-pill" />
      </div>
      <div className="cs-ret-skel-grid">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i}>
            <div className="cs-ret-skel-line w-40 tiny" />
            <div className="cs-ret-skel-line w-70 short" />
          </div>
        ))}
      </div>
      <div className="cs-ret-skel-line w-100 block" />
      <div className="cs-ret-skel-line w-100 block" />
    </div>
  );
}

export function Field({
  label,
  icon: Icon,
  children,
  valueClassName,
}: {
  label: string;
  icon: LucideIcon;
  children: ReactNode;
  valueClassName?: string;
}) {
  return (
    <div>
      <dt>
        <Icon size={12} strokeWidth={2.3} aria-hidden />
        {label}
      </dt>
      <dd className={valueClassName}>{children}</dd>
    </div>
  );
}
