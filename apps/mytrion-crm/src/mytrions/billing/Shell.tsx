/**
 * Billing Mytrion — the panels, mounted inside the shared MytrionShell.
 *
 * This used to be a bespoke shell: its own 56px header (wordmark, badge, a Switch Mytrion link, a
 * hand-inlined sun/moon toggle, its own avatar), its own 216px sidebar with seven verbatim Zoho
 * icon paths, and a mobile bottom nav. All of that chrome is gone; the header, rail, collapse
 * preference, view-as and theme control are the ones every other workspace uses.
 *
 * `.bm-root` STAYS, on a content div. It is a token scope, not a style scope — ~7,000 lines of
 * `.bm-root .bm-*` panel CSS read custom properties declared on it, so dropping the class would
 * unset them all and the panels would render against var() fallbacks, i.e. transparent and black.
 * That looks like a CSS load failure rather than a scoping bug, which is what makes it worth
 * spelling out here.
 *
 * The mobile bottom nav is deleted rather than migrated: below 768px the shared rail is already a
 * horizontal strip, and shipping both would give a phone two navigation bars.
 */
import { useMemo, useState, type ReactNode } from 'react';
import type { BillingTabKey } from './billingTabs';
import {
  CreditCard,
  Database,
  MessagesSquare,
  Scale,
  Undo2,
  Users,
  Wallet,
} from 'lucide-react';

import { useImpersonation } from '../../context/ImpersonationProvider';
import { useTheme } from '../../hooks/useTheme';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { DataCenter } from './DataCenter';
import { Debtors } from './Debtors';
import { Ledger } from './Ledger';
import { TicketConsole } from '@/features/comms/TicketConsole';
import { Prepay } from './Prepay';
import { Returns } from './Returns';
import { Transactions } from './Transactions';

/**
 * Derived, not restated. This keeps the shell and the permission-set tab picker speaking the same
 * vocabulary — rename a key at either end and the other stops compiling. (A brand-new descriptor is
 * caught by tabRegistry.test.ts, not by the compiler; see the note in access/tabRegistry.ts.)
 */
type SectionId = BillingTabKey;

/**
 * PARKED (2026-08-03). Sales files tickets into Zoho Desk again, so this queue would read empty
 * while the real work sits in Desk. The console itself is untouched — flip this to un-park. It
 * gates both the nav row and the mount, so a deep link cannot open a queue the nav refuses to show.
 */
const TICKETS_PARKED = true;

export function BillingShell() {
  const { actingAs } = useImpersonation();
  /* The toggle is the header's now, but the class stays: 63 declarations under
     `.bm-root.light-mode` are Billing-specific values, not forked globals. It mirrors the shared
     preference — there was never a separate storage key, despite a stale comment claiming one. */
  const { theme } = useTheme();
  const actAsKey = actingAs?.zohoUserId ?? 'self';
  const [active, setActive] = useState<SectionId>('datacenter');
  // Widget parity: panels lazy-mount on first visit and stay mounted, so tab state survives hops.
  const [mounted, setMounted] = useState<Partial<Record<SectionId, boolean>>>({ datacenter: true });

  function navigate(id: SectionId): void {
    setActive(id);
    setMounted((m) => (m[id] ? m : { ...m, [id]: true }));
  }

  // Remount panels when View-as changes so data refetches under the new identity.
  const els = useMemo(
    () => ({
      datacenter: <DataCenter />,
      transactions: <Transactions />,
      debtors: <Debtors />,
      prepay: <Prepay />,
      returns: <Returns />,
      ledger: <Ledger />,
      ...(TICKETS_PARKED
        ? {}
        : { tickets: <TicketConsole mode="queue" department="billing" title="Billing tickets" /> }),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actAsKey],
  );

  const panel = (id: SectionId, node: ReactNode): ReactNode =>
    mounted[id] ? (
      <div style={{ display: active === id ? 'contents' : 'none' }}>{node}</div>
    ) : null;

  const item = (id: SectionId, label: string, icon: ReactNode, primary = false) => ({
    key: id,
    label,
    icon,
    active: active === id,
    onClick: () => navigate(id),
    ...(primary ? { primary: true as const } : {}),
  });

  /**
   * The seven verbatim Zoho `iconPath` strings are replaced by lucide, which also fixes a bug the
   * old file documented on itself: Debtors and Prepay shipped the identical path.
   */
  const navSections: NavSection[] = [
    {
      id: 'money',
      label: 'Money',
      items: [
        item('datacenter', 'Data Center', <Database size={19} />, true),
        item('transactions', 'Transactions', <CreditCard size={19} />, true),
        item('ledger', 'Ledger', <Scale size={19} />, true),
      ],
    },
    {
      id: 'recovery',
      label: 'Recovery',
      items: [
        item('debtors', 'Debtors', <Users size={19} />, true),
        item('prepay', 'Prepay', <Wallet size={19} />),
        item('returns', 'Returns', <Undo2 size={19} />),
      ],
    },
    {
      id: 'comms',
      label: 'Comms',
      items: [
        {
          key: 'tickets',
          label: 'Tickets',
          icon: <MessagesSquare size={19} />,
          // A real `soon` row now, instead of the hand-rolled disabled button + .nav-soon span.
          soon: TICKETS_PARKED,
          ...(TICKETS_PARKED ? {} : { active: active === 'tickets', onClick: () => navigate('tickets') }),
        },
      ],
    },
  ];

  return (
    <MytrionShell
      id="billing"
      navSections={navSections}
      enableNavSearch
      /* Ledger and Data Center virtualise against their own scroll ref (useWindowedRows). A second
         scroll parent silently corrupts the range math and renders the wrong rows, so the content
         keeps ownership of scrolling. */
      contentScroll="content"
    >
      <div className={`bm-root${theme === 'light' ? ' light-mode' : ''}`}>
        <main className="bm-content">
          {panel('datacenter', els.datacenter)}
          {panel('transactions', els.transactions)}
          {panel('debtors', els.debtors)}
          {panel('prepay', els.prepay)}
          {panel('returns', els.returns)}
          {panel('ledger', els.ledger)}
        </main>
      </div>
    </MytrionShell>
  );
}
