import { useState } from 'react';
import { MessagesSquare, Plus, Settings, Ticket, TriangleAlert } from 'lucide-react';
import { TicketConsole } from '@/features/comms/TicketConsole';
import { isAdmin } from '../../access/resolveAccess';
import { useUserContext } from '../../context/UserContextProvider';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { DeskCompose, type DeskComposeResult } from './DeskCompose';
import { DeskSettings } from './DeskSettings';
import type { DeskTabKey } from './deskTabs';

/** Derived — see the note in access/tabRegistry.ts. */
export type DeskView = DeskTabKey;

/**
 * Mytrion Desk — the support workspace over the existing `comms` backend. Every tab is the shared
 * `TicketConsole` (list + live chat thread, wired to /v1/comms + the comms WebSocket), scoped per
 * tab: Tickets = ticket threads, Escalations = escalation threads, Chat = everything. "New" opens the
 * compose modal (ticket or escalation); on create, the console opens the new item live. Visibility is
 * decided server-side by the comms reader filter, so there is no Mytrion-specific gating here.
 */
export function DeskShell() {
  const user = useUserContext();
  const admin = isAdmin(user);
  const [view, setView] = useState<DeskView>('tickets');
  const [composeOpen, setComposeOpen] = useState(false);
  /** Ticket id to auto-open in the active console after a create; cleared once honoured. */
  const [focusId, setFocusId] = useState<string | null>(null);
  const open = (next: DeskView): void => setView(next);

  const onCreated = (result: DeskComposeResult): void => {
    setComposeOpen(false);
    setView(result.kind === 'ticket' ? 'tickets' : 'escalations');
    setFocusId(result.ticketId);
  };

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
          key: 'chat',
          label: 'Chat',
          icon: <MessagesSquare size={19} />,
          tone: 'var(--tone-sky)',
          active: view === 'chat',
          onClick: () => open('chat'),
          keywords: ['messages', 'conversation', 'thread', 'inbox'],
          primary: true,
        },
      ],
    },
  ];

  const footerNav: NavItem[] = admin
    ? [
        {
          key: 'settings',
          label: 'Settings',
          icon: <Settings size={19} />,
          tone: 'var(--tone-orange)',
          active: view === 'settings',
          onClick: () => open('settings'),
        },
      ]
    : [];

  return (
    <>
      <MytrionShell
        id="desk"
        navSections={navSections}
        footerNav={footerNav}
        enableNavSearch
        // The console owns its own scroll (list + thread panes) so the composer never leaves the
        // viewport; Settings is a normal page, so it hands scrolling back to the shell.
        contentScroll={view === 'settings' ? 'shell' : 'content'}
      >
        {view === 'tickets' ? (
          <TicketConsole
            mode="queue"
            kind="ticket"
            title="Tickets"
            emptyHint="Tickets filed to the desk appear here the moment they are raised."
            focusTicketId={view === 'tickets' ? focusId : null}
            onFocusConsumed={() => setFocusId(null)}
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
          />
        ) : null}
        {view === 'chat' ? (
          <TicketConsole
            mode="queue"
            title="Conversations"
            emptyHint="Every ticket and escalation conversation you can see, in one inbox."
          />
        ) : null}
        {view === 'settings' && admin ? <DeskSettings /> : null}
      </MytrionShell>

      <DeskCompose open={composeOpen} onClose={() => setComposeOpen(false)} onCreated={onCreated} />
    </>
  );
}
