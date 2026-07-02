import { useState } from 'react';
import { LayoutGrid, Receipt, Users } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { DataCenter } from './DataCenter';
import { Debtors } from './Debtors';
import { Transactions } from './Transactions';

type Tab = 'datacenter' | 'transactions' | 'debtors';

/** Billing Mytrion — invoices, transactions, debtors. Ported from Billing Mytrion.dc.html. */
export default function BillingMytrion() {
  const [tab, setTab] = useState<Tab>('datacenter');

  const nav: NavItem[] = [
    { key: 'datacenter', label: 'Data Center', icon: <LayoutGrid size={19} />, active: tab === 'datacenter', onClick: () => setTab('datacenter') },
    { key: 'transactions', label: 'Transactions', icon: <Receipt size={19} />, active: tab === 'transactions', onClick: () => setTab('transactions') },
    { key: 'debtors', label: 'Debtors', icon: <Users size={19} />, active: tab === 'debtors', onClick: () => setTab('debtors') },
  ];

  return (
    <div data-mytrion="billing" className="contents">
      <MytrionShell id="billing" nav={nav}>
        {tab === 'datacenter' ? <DataCenter /> : null}
        {tab === 'transactions' ? <Transactions /> : null}
        {tab === 'debtors' ? <Debtors /> : null}
      </MytrionShell>
    </div>
  );
}
