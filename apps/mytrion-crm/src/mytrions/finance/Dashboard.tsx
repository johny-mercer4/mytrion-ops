import { useState } from 'react';

import { DashboardDebtors } from './DashboardDebtors';
import { DashboardFueling } from './DashboardFueling';
import { DashboardPayments } from './DashboardPayments';
import { DashboardSegments } from './DashboardSegments';

type SubTab = 'debtors' | 'payments' | 'fueling' | 'segmentation';

const SUB_TABS: { id: SubTab; label: string }[] = [
  { id: 'debtors', label: 'Debtors' },
  { id: 'payments', label: 'Payments' },
  { id: 'fueling', label: 'Fueling Patterns' },
  { id: 'segmentation', label: 'Segmentation' },
];

export function Dashboard() {
  const [tab, setTab] = useState<SubTab>('debtors');

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-heading text-2xl font-bold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Debtors, payments, fueling patterns & segmentation</p>
      </div>

      <div className="flex gap-1 border-b">
        {SUB_TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3.5 py-2.5 text-sm font-bold transition-colors ${
              tab === t.id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'debtors' ? <DashboardDebtors /> : null}
      {tab === 'payments' ? <DashboardPayments /> : null}
      {tab === 'fueling' ? <DashboardFueling /> : null}
      {tab === 'segmentation' ? <DashboardSegments /> : null}
    </div>
  );
}
