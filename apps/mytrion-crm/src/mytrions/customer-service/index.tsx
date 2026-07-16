import { useState } from 'react';
import { BarChart3, CreditCard, Database, FileText, Home as HomeIcon, Inbox, LifeBuoy } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { Analytics } from './Analytics';
import { Applications } from './Applications';
import { CitiFuel } from './CitiFuel';
import { DataCenter } from './DataCenter';
import { Home } from './Home';

type Tab = 'home' | 'applications' | 'citi' | 'analytics' | 'datacenter';

/** Customer Service Mytrion — live port of zoho-octane/app/mytrion-customer-service
 * (Home / Applications / CITI Fuel Clients / Analytics + the previously-gated Data
 * Center). Inbox and Service Center stay "Soon" stubs, exactly like the widget's nav. */
export default function CustomerServiceMytrion() {
  const [tab, setTab] = useState<Tab>('home');

  const nav: NavItem[] = [
    { key: 'home', label: 'Home', icon: <HomeIcon size={19} />, active: tab === 'home', onClick: () => setTab('home') },
    { key: 'applications', label: 'Applications', icon: <FileText size={19} />, active: tab === 'applications', onClick: () => setTab('applications') },
    { key: 'citi', label: 'CITI Fuel Clients', icon: <CreditCard size={19} />, active: tab === 'citi', onClick: () => setTab('citi') },
    { key: 'analytics', label: 'Analytics', icon: <BarChart3 size={19} />, active: tab === 'analytics', onClick: () => setTab('analytics') },
    { key: 'datacenter', label: 'Data Center', icon: <Database size={19} />, active: tab === 'datacenter', onClick: () => setTab('datacenter') },
    // Widget-parity "Soon" stubs — visible, inert (the old widget disabled them the same way).
    { key: 'inbox', label: 'Inbox · Soon', icon: <Inbox size={19} /> },
    { key: 'service', label: 'Service Center · Soon', icon: <LifeBuoy size={19} /> },
  ];

  return (
    <div data-mytrion="customer-service" className="contents">
      <MytrionShell id="customer-service" nav={nav}>
        {tab === 'home' ? <Home /> : null}
        {tab === 'applications' ? <Applications /> : null}
        {tab === 'citi' ? <CitiFuel /> : null}
        {tab === 'analytics' ? <Analytics /> : null}
        {tab === 'datacenter' ? <DataCenter /> : null}
      </MytrionShell>
    </div>
  );
}
