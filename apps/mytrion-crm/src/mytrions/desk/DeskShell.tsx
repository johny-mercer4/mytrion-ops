import { useEffect, useState } from 'react';
import { BarChart3, Circle, Plus, Settings, Ticket, TriangleAlert } from 'lucide-react';
import { TicketConsole } from '@/features/comms/TicketConsole';
import {
  getCommsCatalog,
  getMyAvailability,
  type AgentAvailability,
  type AvailabilityDto,
  type DepartmentOptionDto,
  type TicketDto,
} from '@/api/comms';
import { isAdmin } from '../../access/resolveAccess';
import { useUserContext } from '../../context/UserContextProvider';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { DeskAnalytics } from './DeskAnalytics';
import { DeskAvailability } from './DeskAvailability';
import { DeskCompose, type DeskComposeResult } from './DeskCompose';
import { DeskEscalationActions } from './DeskEscalationActions';
import { DeskTicketActions } from './DeskTicketActions';
import { EscalationRouting } from '../admin/EscalationRouting';
import { AdminToastHost } from '../admin/toast';
import type { DeskTabKey } from './deskTabs';

/** Derived — see the note in access/tabRegistry.ts. */
export type DeskView = DeskTabKey;

const AVAIL_LABEL: Record<AgentAvailability, string> = {
  available: 'Available',
  away: 'Away',
  do_not_assign: 'Do not assign',
};
const AVAIL_TONE: Record<AgentAvailability, string> = {
  available: 'var(--tone-emerald)',
  away: 'var(--tone-amber)',
  do_not_assign: 'var(--tone-rose)',
};

/**
 * Mytrion Desk — the support workspace over the existing `comms` backend, for Customer Service,
 * Billing and Verification. Tickets and Escalations are each the shared `TicketConsole` (list + live
 * chat thread over /v1/comms + the comms WebSocket), scoped per tab. "New" opens the compose modal;
 * on an escalation the conversation header carries the ladder actions. Visibility is gated in
 * resolveAccess and the data is scoped server-side by the comms reader filter.
 */
export function DeskShell() {
  const user = useUserContext();
  const admin = isAdmin(user);
  const [view, setView] = useState<DeskView>('tickets');
  const [composeOpen, setComposeOpen] = useState(false);
  /** Ticket id to auto-open in the active console after a create; cleared once honoured. */
  const [focusId, setFocusId] = useState<string | null>(null);
  /** Departments used for the ticket type filter + escalation hand-off. Loaded once. */
  const [departments, setDepartments] = useState<DepartmentOptionDto[]>([]);
  /** The agent's own availability (work mode) — governs whether the round-robin routes to them. */
  const [availability, setAvailability] = useState<AvailabilityDto | null>(null);
  const [availOpen, setAvailOpen] = useState(false);
  const open = (next: DeskView): void => setView(next);

  useEffect(() => {
    let cancelled = false;
    void getCommsCatalog()
      .then((c) => {
        if (!cancelled) setDepartments(c.departments);
      })
      .catch(() => undefined);
    void getMyAvailability()
      .then((a) => {
        if (!cancelled) setAvailability(a);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const onCreated = (result: DeskComposeResult): void => {
    setComposeOpen(false);
    setView(result.kind === 'ticket' ? 'tickets' : 'escalations');
    setFocusId(result.ticketId);
  };

  /** Conversation-header actions: the escalation ladder for an escalation, the lifecycle for a ticket. */
  const chatActions = (t: TicketDto) =>
    t.kind === 'escalation' && t.escalation ? (
      <DeskEscalationActions ticket={t} departments={departments} />
    ) : (
      <DeskTicketActions ticket={t} me={user.userId} admin={admin} />
    );

  const navSections: NavSection[] = [
    {
      id: 'desk',
      label: 'Support',
      items: [
        {
          key: 'new',
          label: 'New',
          icon: <Plus size={19} />,
          tone: 'var(--tone-emerald)',
          onClick: () => setComposeOpen(true),
          keywords: ['create', 'raise', 'ticket', 'escalation', 'compose'],
          primary: true,
        },
        {
          key: 'tickets',
          label: 'Tickets',
          icon: <Ticket size={19} />,
          tone: 'var(--tone-orange)',
          active: view === 'tickets',
          onClick: () => open('tickets'),
          keywords: ['requests', 'queue', 'cases'],
          primary: true,
        },
        {
          key: 'escalations',
          label: 'Escalations',
          icon: <TriangleAlert size={19} />,
          tone: 'var(--tone-rose)',
          active: view === 'escalations',
          onClick: () => open('escalations'),
          keywords: ['escalate', 'raise', 'ladder'],
          primary: true,
        },
        {
          key: 'analytics',
          label: 'Analytics',
          icon: <BarChart3 size={19} />,
          tone: 'var(--tone-violet)',
          active: view === 'analytics',
          onClick: () => open('analytics'),
          keywords: ['sla', 'dashboard', 'reports', 'metrics', 'stats'],
          primary: true,
        },
      ],
    },
  ];

  const availValue = availability?.availability ?? null;
  const footerNav: NavItem[] = [
    {
      key: 'availability',
      label: availValue ? AVAIL_LABEL[availValue] : 'Availability',
      icon: <Circle size={13} fill="currentColor" />,
      tone: availValue ? AVAIL_TONE[availValue] : 'var(--text-muted)',
      onClick: () => setAvailOpen(true),
      keywords: ['status', 'away', 'work mode', 'do not assign', 'presence'],
    },
    ...(admin
      ? [
          {
            key: 'settings',
            label: 'Routing',
            icon: <Settings size={19} />,
            tone: 'var(--tone-orange)',
            active: view === 'settings',
            onClick: () => open('settings'),
          },
        ]
      : []),
  ];

  return (
    <>
      <MytrionShell
        id="desk"
        navSections={navSections}
        footerNav={footerNav}
        enableNavSearch
        // The console owns its own scroll (list + thread panes) so the composer never leaves the
        // viewport; Settings and Analytics are normal pages, so they hand scrolling back to the shell.
        contentScroll={view === 'settings' || view === 'analytics' ? 'shell' : 'content'}
      >
        {view === 'tickets' ? (
          <TicketConsole
            mode="queue"
            kind="ticket"
            title="Tickets"
            emptyHint="Tickets filed to the desk appear here the moment they are raised."
            focusTicketId={view === 'tickets' ? focusId : null}
            onFocusConsumed={() => setFocusId(null)}
            chatActions={chatActions}
            enableBulk
            enableSavedViews
            viewsKey="desk:tickets"
          />
        ) : null}
        {view === 'escalations' ? (
          <TicketConsole
            mode="queue"
            kind="escalation"
            title="Escalations"
            emptyHint="Escalation requests routed to you appear here, newest first."
            focusTicketId={view === 'escalations' ? focusId : null}
            onFocusConsumed={() => setFocusId(null)}
            chatActions={chatActions}
            enableSavedViews
            viewsKey="desk:escalations"
          />
        ) : null}
        {view === 'analytics' ? <DeskAnalytics departments={departments} /> : null}
        {view === 'settings' && admin ? (
          <>
            <EscalationRouting />
            <AdminToastHost />
          </>
        ) : null}
      </MytrionShell>

      <DeskCompose open={composeOpen} onClose={() => setComposeOpen(false)} onCreated={onCreated} />
      <DeskAvailability
        open={availOpen}
        current={availability}
        onClose={() => setAvailOpen(false)}
        onChanged={setAvailability}
      />
    </>
  );
}
