import { useState } from 'react';
import { BarChart3, CreditCard, FileText, Home as HomeIcon } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { Analytics } from './Analytics';
import { Applications } from './Applications';
import { CitiFuel } from './CitiFuel';
import { Home } from './Home';
import { APPLICATIONS, isClient } from './data';

type Tab = 'home' | 'applications' | 'citi' | 'analytics';

/** Customer Service Mytrion — applications, CITI Fuel clients, analytics. Ported from the
 * Customer Service mockup (Home/Applications/CITI Fuel Clients/Analytics screens). */
export default function CustomerServiceMytrion() {
  const [tab, setTab] = useState<Tab>('home');

  const pendingAppsCount = APPLICATIONS.filter((a) => !isClient(a)).length;

  const nav: NavItem[] = [
    { key: 'home', label: 'Home', icon: <HomeIcon size={19} />, active: tab === 'home', onClick: () => setTab('home') },
    { key: 'applications', label: `Applications (${pendingAppsCount})`, icon: <FileText size={19} />, active: tab === 'applications', onClick: () => setTab('applications') },
    { key: 'citi', label: 'CITI Fuel Clients', icon: <CreditCard size={19} />, active: tab === 'citi', onClick: () => setTab('citi') },
    { key: 'analytics', label: 'Analytics', icon: <BarChart3 size={19} />, active: tab === 'analytics', onClick: () => setTab('analytics') },
  ];

  return (
    <div data-mytrion="customer-service" className="contents">
      <MytrionShell id="customer-service" nav={nav}>
        {tab === 'home' ? <Home /> : null}
        {tab === 'applications' ? <Applications /> : null}
        {tab === 'citi' ? <CitiFuel /> : null}
        {tab === 'analytics' ? <Analytics /> : null}
      </MytrionShell>
    </div>
  );
}
