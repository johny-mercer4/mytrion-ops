import { useState } from 'react';
import { Inbox as InboxIcon, LayoutGrid, Sheet } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { ArrayReport } from './ArrayReport';
import { Cases } from './Cases';
import { Inbox } from './Inbox';

type Tab = 'cases' | 'array' | 'inbox';

/** Collection Mytrion — bad-debt escalation, Array agency filing, recovery cases. */
export default function CollectionMytrion() {
  const [tab, setTab] = useState<Tab>('cases');

  const nav: NavItem[] = [
    {
      key: 'cases',
      label: 'Collection Cases',
      icon: <LayoutGrid size={19} />,
      active: tab === 'cases',
      onClick: () => setTab('cases'),
    },
    {
      key: 'array',
      label: 'Array Report',
      icon: <Sheet size={19} />,
      active: tab === 'array',
      onClick: () => setTab('array'),
    },
    {
      key: 'inbox',
      label: 'Inbox',
      icon: <InboxIcon size={19} />,
      active: tab === 'inbox',
      onClick: () => setTab('inbox'),
    },
  ];

  return (
    <div data-mytrion="collection" className="contents">
      <MytrionShell id="collection" nav={nav}>
        {tab === 'cases' ? <Cases /> : null}
        {tab === 'array' ? <ArrayReport /> : null}
        {tab === 'inbox' ? <Inbox /> : null}
      </MytrionShell>
    </div>
  );
}
