import { useState } from 'react';
import { Inbox as InboxIcon, LayoutGrid, Users } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { Cases } from './Cases';
import { CASES, NOTIFICATIONS, POOL, poolCountByAssign, unreadCount } from './data';
import { Inbox } from './Inbox';
import { OpenPool } from './OpenPool';

type Tab = 'cases' | 'pool' | 'inbox';

/** Retention Mytrion — at-risk case kanban, open pool assignment, inbox. Ported from
 * the Retention Mytrion mockup. No AI Chat tab: MytrionShell docks a scoped chat already. */
export default function RetentionMytrion() {
  const [tab, setTab] = useState<Tab>('cases');

  const activeCases = CASES.filter((c) => c.stage !== 'saved' && c.stage !== 'lost').length;
  const availablePool = poolCountByAssign(POOL, 'Available');
  const unread = unreadCount(NOTIFICATIONS);

  const nav: NavItem[] = [
    {
      key: 'cases',
      label: `Retention Cases (${activeCases})`,
      icon: <LayoutGrid size={19} />,
      active: tab === 'cases',
      onClick: () => setTab('cases'),
    },
    {
      key: 'pool',
      label: `Open Pool (${availablePool})`,
      icon: <Users size={19} />,
      active: tab === 'pool',
      onClick: () => setTab('pool'),
    },
    {
      key: 'inbox',
      label: `Inbox (${unread})`,
      icon: <InboxIcon size={19} />,
      active: tab === 'inbox',
      onClick: () => setTab('inbox'),
    },
  ];

  return (
    <div data-mytrion="retention" className="contents">
      <MytrionShell id="retention" nav={nav}>
        {tab === 'cases' ? <Cases /> : null}
        {tab === 'pool' ? <OpenPool /> : null}
        {tab === 'inbox' ? <Inbox /> : null}
      </MytrionShell>
    </div>
  );
}
