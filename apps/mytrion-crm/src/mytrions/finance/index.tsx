import { useState } from 'react';
import { ClipboardList, Home as HomeIcon, LayoutDashboard, Receipt, Users, Wallet } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { Audits } from './Audits';
import { Clients } from './Clients';
import { Dashboard } from './Dashboard';
import { Home } from './Home';
import { SmartBalance } from './SmartBalance';
import { Transactions } from './Transactions';

type Tab = 'home' | 'smart-balance' | 'audits' | 'transactions' | 'dashboard' | 'clients';

/** Finance Mytrion — parent balance, smart-balance sweeps, event audits, transactions, clients, dashboard. */
export default function FinanceMytrion() {
  const [tab, setTab] = useState<Tab>('home');

  const nav: NavItem[] = [
    { key: 'home', label: 'Home', icon: <HomeIcon size={19} />, active: tab === 'home', onClick: () => setTab('home') },
    { key: 'smart-balance', label: 'Smart Balance', icon: <Wallet size={19} />, active: tab === 'smart-balance', onClick: () => setTab('smart-balance') },
    { key: 'audits', label: 'Event Audits', icon: <ClipboardList size={19} />, active: tab === 'audits', onClick: () => setTab('audits') },
    { key: 'transactions', label: 'Transactions', icon: <Receipt size={19} />, active: tab === 'transactions', onClick: () => setTab('transactions') },
    { key: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard size={19} />, active: tab === 'dashboard', onClick: () => setTab('dashboard') },
    { key: 'clients', label: 'Clients', icon: <Users size={19} />, active: tab === 'clients', onClick: () => setTab('clients') },
  ];

  return (
    <div data-mytrion="finance" className="contents">
      <MytrionShell id="finance" nav={nav}>
        {tab === 'home' ? <Home onNavigate={setTab} /> : null}
        {tab === 'smart-balance' ? <SmartBalance /> : null}
        {tab === 'audits' ? <Audits /> : null}
        {tab === 'transactions' ? <Transactions /> : null}
        {tab === 'dashboard' ? <Dashboard /> : null}
        {tab === 'clients' ? <Clients /> : null}
      </MytrionShell>
    </div>
  );
}
