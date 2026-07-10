import { useState } from 'react';

import { DashboardSales } from './DashboardSales';
import { DashboardCompany } from './DashboardCompany';
import { DashboardDebtors } from './DashboardDebtors';
import { DashboardPerformance } from './DashboardPerformance';

// Widget dashboard tabs: Sales / Company / Debtors / Performance (Power BI stays in Zoho).
type SubTab = 'sales' | 'company' | 'debtors' | 'performance';

export function Dashboard() {
  const [subTab, setSubTab] = useState<SubTab>('sales');

  const tabs: { id: SubTab; label: string }[] = [
    { id: 'sales', label: 'Sales' },
    { id: 'company', label: 'Company' },
    { id: 'debtors', label: 'Debtors' },
    { id: 'performance', label: 'Performance' },
  ];

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-heading text-2xl font-bold">Dashboard</h2>
        <p className="text-sm text-muted-foreground">Sales performance, company targets, and debtor tracking.</p>
      </div>

      <div className="flex items-center gap-1 border-b">
        {tabs.map((t) => {
          const active = subTab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setSubTab(t.id)}
              className={`relative flex items-center gap-1.5 px-3.5 py-2.5 text-sm font-semibold transition-colors ${
                active ? 'text-primary' : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {t.label}
              {active ? <span className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary" /> : null}
            </button>
          );
        })}
      </div>

      {subTab === 'sales' ? <DashboardSales /> : null}
      {subTab === 'company' ? <DashboardCompany /> : null}
      {subTab === 'debtors' ? <DashboardDebtors /> : null}
      {subTab === 'performance' ? <DashboardPerformance /> : null}
    </div>
  );
}
