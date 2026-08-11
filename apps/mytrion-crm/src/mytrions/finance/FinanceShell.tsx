import { useState } from 'react';
import type { FinanceTabKey } from './financeTabs';
import { Home, Users } from 'lucide-react';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { FinanceClients } from './tabs/FinanceClients';
import { FinanceHome } from './tabs/FinanceHome';
import './finance.css';

/**
 * Finance Mytrion shell — standard Mytrion chrome (TopBar + sidebar) via MytrionShell.
 *
 * Two tabs, both real: Home (the EFS parent balance) and Clients (the receivables roster). The
 * previous Finance module had a dashboard, transactions, audits and segment panels built entirely
 * on mock data; all of it was removed rather than carried forward, because a convincing fake
 * dashboard in a finance tool is worse than no dashboard.
 */
/** Derived — see the note in billing/Shell.tsx and access/tabRegistry.ts. */
type ViewId = FinanceTabKey;

const TABS: { id: ViewId; label: string; icon: typeof Home; tone: string; keywords: string[] }[] = [
  { id: 'home', label: 'Home', icon: Home, tone: 'var(--tone-emerald)', keywords: ['balance', 'efs', 'parent', 'treasury'] },
  { id: 'clients', label: 'Clients', icon: Users, tone: 'var(--tone-sky)', keywords: ['carriers', 'debtors', 'invoices', 'receivables'] },
];

export function FinanceShell() {
  const [view, setView] = useState<ViewId>('home');

  const navSections: NavSection[] = [
    {
      id: 'finance',
      label: 'Finance',
      items: TABS.map((t) => ({
        key: t.id,
        label: t.label,
        icon: <t.icon size={19} />,
        tone: t.tone,
        active: view === t.id,
        onClick: () => setView(t.id),
        keywords: t.keywords,
      })),
    },
  ];

  return (
    <MytrionShell id="finance" navSections={navSections} enableNavSearch>
      <div className="fi-root">
        {view === 'home' ? <FinanceHome /> : null}
        {view === 'clients' ? <FinanceClients /> : null}
      </div>
    </MytrionShell>
  );
}
