import { useMemo, useState } from 'react';
import {
  BadgeCheck,
  Ban,
  Banknote,
  ChevronRight,
  Clock,
  CreditCard,
  FileSearch,
  FileText,
  Key,
  LayoutList,
  Package,
  ReceiptText,
  RefreshCw,
  ShieldAlert,
  Wallet,
} from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { AUTOMATIONS, type Automation } from './data';
import { AutomationModal } from './AutomationModal';

const ICON_BY_ID: Record<string, typeof LayoutList> = {
  'wex-tasks': LayoutList,
  invoices: ReceiptText,
  transactions: FileText,
  balance: Wallet,
  'card-activation': CreditCard,
  payments: Banknote,
  tracking: Package,
  'account-status': BadgeCheck,
  'card-replacement': RefreshCw,
  'fraud-hold': ShieldAlert,
  'billing-form': FileSearch,
  'efs-login': Key,
  'money-code': Ban,
};

export function Automations() {
  const [search, setSearch] = useState('');
  const [openAutomation, setOpenAutomation] = useState<Automation | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return AUTOMATIONS;
    return AUTOMATIONS.filter((a) =>
      `${a.title} ${a.desc} ${a.codes.join(' ')}`.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Self-Service Actions</h2>
        <p className="text-sm text-muted-foreground">Run common carrier and billing actions without leaving the assistant.</p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by name, code, or keyword…"
          className="max-w-sm flex-1"
        />
        <span className="text-xs text-muted-foreground">{filtered.length} of {AUTOMATIONS.length} actions</span>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {filtered.map((a) => {
          const Icon = ICON_BY_ID[a.id] ?? Clock;
          const actionable = !a.comingSoon;
          return (
            <button
              key={a.id}
              disabled={!actionable}
              onClick={() => actionable && setOpenAutomation(a)}
              className={`flex flex-col items-start gap-2.5 rounded-xs border bg-card p-4 text-left transition-colors ${
                actionable ? 'hover:bg-muted/40' : 'cursor-not-allowed opacity-55'
              }`}
            >
              <div className="flex w-full items-start justify-between">
                <span className="flex size-9 items-center justify-center rounded-xs bg-primary/12 text-primary">
                  <Icon className="size-4.5" />
                </span>
                {a.comingSoon ? (
                  <span className="rounded-xs border border-warn/30 bg-warn/10 px-1.5 py-0.5 text-[9.5px] font-bold text-warn">SOON</span>
                ) : actionable ? (
                  <ChevronRight className="size-4 text-muted-foreground" />
                ) : null}
              </div>
              <div className="font-semibold">{a.title}</div>
              <div className="flex flex-wrap gap-1.5">
                {a.codes.map((c) => (
                  <span key={c} className="rounded-xs border bg-secondary px-1.5 py-0.5 font-mono text-[9.5px] font-bold text-secondary-foreground">
                    {c}
                  </span>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">{a.desc}</p>
            </button>
          );
        })}
        {filtered.length === 0 ? (
          <div className="col-span-full rounded-xs border bg-card p-10 text-center text-sm text-muted-foreground">
            No automations match your search.
          </div>
        ) : null}
      </div>

      {openAutomation ? <AutomationModal automation={openAutomation} onClose={() => setOpenAutomation(null)} /> : null}
    </div>
  );
}
