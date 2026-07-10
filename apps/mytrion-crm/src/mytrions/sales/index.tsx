import { useState } from 'react';
import {
  Home as HomeIcon,
  Inbox as InboxIcon,
  LayoutGrid,
  LayoutDashboard,
  PlusCircle,
  Truck,
  Zap,
} from 'lucide-react';

import { useImpersonation } from '@/context/ImpersonationProvider';
import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { Home } from './Home';
import { Automations } from './Automations';
import { Inbox } from './Inbox';
import { DataCenter } from './DataCenter';
import { Create } from './Create';
import { Carriers } from './Carriers';
import { Dashboard } from './Dashboard';
import { useInboxFeed } from './live';
import { ToastProvider } from './Toast';

type Tab = 'home' | 'inbox' | 'datacenter' | 'create' | 'automations' | 'dashboard' | 'carriers';

/**
 * Sales Mytrion — home, automations, inbox, data center, create, carriers, dashboard.
 * Panels are LIVE (touchpoints). Admin act-as: switching the target in the TopBar picker
 * remounts the whole module (the `key` below), so every panel refetches AS that agent —
 * the React equivalent of the widget's currentUser.id watchers.
 */
export default function SalesMytrion() {
  const { actingAs } = useImpersonation();
  return <SalesMytrionInner key={actingAs?.zohoUserId ?? 'self'} />;
}

function SalesMytrionInner() {
  const [tab, setTab] = useState<Tab>('home');
  const inbox = useInboxFeed();

  const nav: NavItem[] = [
    { key: 'home', label: 'Home', icon: <HomeIcon size={19} />, active: tab === 'home', onClick: () => setTab('home') },
    {
      key: 'inbox',
      label: inbox.unread > 0 ? `Inbox (${inbox.unread})` : 'Inbox',
      icon: <InboxIcon size={19} />,
      active: tab === 'inbox',
      onClick: () => setTab('inbox'),
    },
    { key: 'datacenter', label: 'Data Center', icon: <LayoutGrid size={19} />, active: tab === 'datacenter', onClick: () => setTab('datacenter') },
    { key: 'create', label: 'Create', icon: <PlusCircle size={19} />, active: tab === 'create', onClick: () => setTab('create') },
    { key: 'automations', label: 'Automations', icon: <Zap size={19} />, active: tab === 'automations', onClick: () => setTab('automations') },
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={19} />, active: tab === 'dashboard', onClick: () => setTab('dashboard') },
    { key: 'carriers', label: 'Carriers', icon: <Truck size={19} />, active: tab === 'carriers', onClick: () => setTab('carriers') },
  ];

  return (
    <div data-mytrion="sales" className="contents">
      <ToastProvider>
        <MytrionShell id="sales" nav={nav}>
          {tab === 'home' ? (
            <Home inbox={inbox} onOpenAutomations={() => setTab('automations')} onOpenInbox={() => setTab('inbox')} />
          ) : null}
          {tab === 'inbox' ? <Inbox feed={inbox} /> : null}
          {tab === 'datacenter' ? <DataCenter onOpenAutomations={() => setTab('automations')} /> : null}
          {tab === 'create' ? <Create /> : null}
          {tab === 'automations' ? <Automations /> : null}
          {tab === 'dashboard' ? <Dashboard /> : null}
          {tab === 'carriers' ? <Carriers /> : null}
        </MytrionShell>
      </ToastProvider>
    </div>
  );
}
