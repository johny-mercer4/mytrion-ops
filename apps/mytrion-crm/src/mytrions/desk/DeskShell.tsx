import { useState } from 'react';
import { MessagesSquare, Settings, Ticket, TriangleAlert } from 'lucide-react';
import { isAdmin } from '../../access/resolveAccess';
import { useUserContext } from '../../context/UserContextProvider';
import { MytrionShell, type NavItem, type NavSection } from '../_shared/MytrionShell';
import { ComingSoon } from '../_shared/ComingSoon';
import type { DeskTabKey } from './deskTabs';

/** Derived — see the note in access/tabRegistry.ts. */
export type DeskView = DeskTabKey;

/**
 * Mytrion Desk — the support workspace over the existing `comms` backend (tickets, escalations,
 * threads). Stage 1 is the registered shell + navigation; each tab lands its live surface next.
 */
export function DeskShell() {
  const user = useUserContext();
  const admin = isAdmin(user);
  const [view, setView] = useState<DeskView>('tickets');
  const open = (next: DeskView): void => setView(next);

  const navSections: NavSection[] = [
    {
      id: 'desk',
      label: 'Support',
      items: [
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
          keywords: ['messages', 'conversation', 'thread'],
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
    <MytrionShell id="desk" navSections={navSections} footerNav={footerNav} enableNavSearch>
      {view === 'tickets' ? (
        <ComingSoon
          title="Ticket queue"
          body="The support ticket queue — round-robin assigned by department, with a live chat thread per ticket. Wiring to the comms backend next."
          icon={<Ticket size={26} />}
          tone="var(--tone-orange)"
          sources={['mytrion_tickets', 'mytrion_threads', 'mytrion_department_agents']}
        />
      ) : null}
      {view === 'escalations' ? (
        <ComingSoon
          title="Escalations"
          body="Escalation requests auto-assigned by reason, walked up the four-level escalation ladder."
          icon={<TriangleAlert size={26} />}
          tone="var(--tone-rose)"
          sources={['mytrion_escalations', 'mytrion_escalation_hops', 'mytrion_ticket_types']}
        />
      ) : null}
      {view === 'chat' ? (
        <ComingSoon
          title="Chat"
          body="Real-time ticket conversations — messages and file attachments streamed over the comms WebSocket."
          icon={<MessagesSquare size={26} />}
          tone="var(--tone-sky)"
          sources={['mytrion_thread_messages', 'mytrion_thread_attachments', 'useCommsSocket']}
        />
      ) : null}
      {view === 'settings' && admin ? (
        <ComingSoon
          title="Desk settings"
          body="Round-robin and escalation-routing configuration, reusing Mytrion Admin → Escalation Routing."
          icon={<Settings size={26} />}
          tone="var(--tone-orange)"
          sources={['mytrion_department_config', 'mytrion_comms_settings']}
        />
      ) : null}
    </MytrionShell>
  );
}
