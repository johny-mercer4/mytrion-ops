/**
 * CS desk filter model — Phase first, then dependent status chips.
 * Labels match product language; `explain` describes timers / automations.
 */
import type { LucideIcon } from 'lucide-react';
import {
  Briefcase,
  CheckCircle2,
  Folder,
  Handshake,
  Inbox,
  Layers,
  Palmtree,
  PhoneCall,
  Shield,
  UserPlus,
  Users,
  Waves,
} from 'lucide-react';

export type CsPhase = 'any' | 'sales' | 'retention' | 'citi';

/** Status chip ids — meaning depends on selected phase. */
export type CsStatusBucket =
  | 'open'
  | 'closed'
  | 'all'
  | 'to_claim'
  | 'working'
  | 'offer_pending'
  | 'calling'
  | 'reached'
  | 'out_of_reach'
  | 'open_pool'
  | 'vacation'
  | 'hold'
  | 'review';

/** Active chip color tone — maps to `.cs-chip.active.is-*` CSS. */
export type CsChipTone =
  | 'neutral'
  | 'sales'
  | 'retention'
  | 'citi'
  | 'open'
  | 'success'
  | 'warning'
  | 'danger'
  | 'orange'
  | 'info';

export interface FilterChip {
  id: CsStatusBucket | CsPhase;
  label: string;
  hint: string;
  /** One-line automation / countdown summary under the filter row. */
  explain: string;
  Icon: LucideIcon;
  tone: CsChipTone;
}

type StatusChip = {
  id: CsStatusBucket;
  label: string;
  hint: string;
  explain: string;
  Icon: LucideIcon;
  tone: CsChipTone;
};

export const PHASE_CHIPS: Array<{
  id: CsPhase;
  label: string;
  hint: string;
  explain: string;
  Icon: LucideIcon;
  tone: CsChipTone;
}> = [
  {
    id: 'any',
    label: 'All phases',
    hint: 'Every phase',
    explain: 'Browse across Sales, Retention, and CITI.',
    Icon: Layers,
    tone: 'neutral',
  },
  {
    id: 'sales',
    label: 'Sales',
    hint: 'Phase 1 — Sales agents',
    explain: 'Sales owns the case. Idle 2 BD without fuel → handoff to Retention.',
    Icon: Briefcase,
    tone: 'sales',
  },
  {
    id: 'retention',
    label: 'Retention',
    hint: 'Phase 2 — CS desk',
    explain: 'CS desk work. Open cases watch 10 BD for fuel / outcome.',
    Icon: Shield,
    tone: 'retention',
  },
  {
    id: 'citi',
    label: 'CITI',
    hint: 'Phase 3 — CITI Folder',
    explain: 'Ops CITI folder after max reassignments or Ops deny.',
    Icon: Folder,
    tone: 'citi',
  },
];

const OPEN_CLOSED_ALL: StatusChip[] = [
  {
    id: 'open',
    label: 'All open',
    hint: 'Every open case',
    explain: 'All open cases in the selected phase (not closed).',
    Icon: Inbox,
    tone: 'open',
  },
  {
    id: 'closed',
    label: 'Closed (Returned)',
    hint: 'Fuel return / closed',
    explain: 'Closed in the last 90 days — usually fuel returned after the case opened.',
    Icon: CheckCircle2,
    tone: 'success',
  },
  {
    id: 'all',
    label: 'Everything',
    hint: 'Open + closed (90d)',
    explain: 'Open cases plus closed in the last 90 days.',
    Icon: Layers,
    tone: 'neutral',
  },
];

const SALES_STATUS: StatusChip[] = [
  {
    id: 'open',
    label: 'All open',
    hint: 'Every open Sales case',
    explain: 'All open Sales statuses together (New, Reached, Out of reach, Pool, Vacation…).',
    Icon: Inbox,
    tone: 'open',
  },
  {
    id: 'calling',
    label: 'New',
    hint: 'Needs first call — 2 BD',
    explain:
      'New / just assigned. Agent has 2 business days to act. Miss it → Retention (or CITI after 3 owners).',
    Icon: PhoneCall,
    tone: 'info',
  },
  {
    id: 'reached',
    label: 'Reached',
    hint: 'Contact made — 5 BD fuel watch',
    explain:
      'Contact made. Watch 5 BD for fuel. Fuel → Closed (Returned). No fuel → Open Pool.',
    Icon: Handshake,
    tone: 'success',
  },
  {
    id: 'out_of_reach',
    label: 'Out of reach',
    hint: 'Channel attempts (max 5)',
    explain:
      'Log up to 5 channel attempts (1 BD prompt each). At attempt 5 → Open Pool. No auto handoff on the 1 BD alone.',
    Icon: Waves,
    tone: 'danger',
  },
  {
    id: 'open_pool',
    label: 'Open Pool',
    hint: 'Unclaimed Sales pool — 3 BD',
    explain:
      'Sales Open Pool (readonly here). Agents claim instantly in Sales. Unclaimed 3 BD → Retention; max 3 agent cycles → CITI.',
    Icon: Users,
    tone: 'orange',
  },
  {
    id: 'vacation',
    label: 'Vacation',
    hint: '14d pause → Ops gate',
    explain:
      '14 calendar days vacation → 2 BD follow-up → Ops confirm (back to New) or deny (CITI).',
    Icon: Palmtree,
    tone: 'warning',
  },
  {
    id: 'closed',
    label: 'Closed (Returned)',
    hint: 'Fuel returned — closed in Sales',
    explain:
      'Closed Sales cases (90d). Common path: any fuel after case open → Closed (Returned).',
    Icon: CheckCircle2,
    tone: 'success',
  },
];

const RETENTION_STATUS: StatusChip[] = [
  {
    id: 'open',
    label: 'All open',
    hint: 'Every open Retention case',
    explain: 'Unassigned + In progress + Offer pending (all open Phase 2).',
    Icon: Inbox,
    tone: 'open',
  },
  {
    id: 'to_claim',
    label: 'Unassigned',
    hint: 'No CS owner yet — claim to start',
    explain:
      'No CS owner (RoundRobin missed or daily cap). Claim it → In progress + 10 BD fuel watch.',
    Icon: UserPlus,
    tone: 'info',
  },
  {
    id: 'working',
    label: 'In progress',
    hint: 'Assigned CS — 10 BD',
    explain:
      'Assigned to a CS agent. Call 1 (listen) then Call 2 (solution), then set outcome. 10 BD with no fuel → Open Pool.',
    Icon: Handshake,
    tone: 'warning',
  },
  {
    id: 'offer_pending',
    label: 'Offer out',
    hint: 'Waiting on client · ≤15% portfolio',
    explain:
      'Offer proposed — waiting on client. Still on the 10 BD clock. Cap: ~15% of open cases (at least 1 when you have open work).',
    Icon: Waves,
    tone: 'orange',
  },
  {
    id: 'closed',
    label: 'Closed',
    hint: 'Refused / lost / OoB / etc.',
    explain: 'Terminal Retention outcomes (Refused, Lost, Out of business…) in the last 90 days.',
    Icon: CheckCircle2,
    tone: 'success',
  },
];

const CITI_STATUS: StatusChip[] = [
  {
    id: 'open',
    label: 'All open',
    hint: 'Hold + review',
    explain: 'Open CITI cases (on hold or in review).',
    Icon: Inbox,
    tone: 'open',
  },
  {
    id: 'hold',
    label: 'On hold',
    hint: 'CITI hold window',
    explain: 'In CITI hold (typically 7 calendar days) before review/export.',
    Icon: Folder,
    tone: 'citi',
  },
  {
    id: 'review',
    label: 'Review',
    hint: 'Ready for export review',
    explain: 'Hold ended — ready for Ops review / export.',
    Icon: Layers,
    tone: 'warning',
  },
  {
    id: 'closed',
    label: 'Closed',
    hint: 'Exported / closed',
    explain: 'Closed CITI cases in the last 90 days.',
    Icon: CheckCircle2,
    tone: 'success',
  },
];

export function statusChipsForPhase(phase: CsPhase): StatusChip[] {
  if (phase === 'sales') return SALES_STATUS;
  if (phase === 'retention') return RETENTION_STATUS;
  if (phase === 'citi') return CITI_STATUS;
  return OPEN_CLOSED_ALL;
}

export function defaultStatusForPhase(_phase: CsPhase): CsStatusBucket {
  return 'open';
}

export function explainForFilters(phase: CsPhase, status: CsStatusBucket): string {
  const chip = statusChipsForPhase(phase).find((c) => c.id === status);
  if (chip) return chip.explain;
  return PHASE_CHIPS.find((c) => c.id === phase)?.explain ?? '';
}
