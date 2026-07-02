import { ArrowRight, RefreshCw, Users, Wallet } from 'lucide-react';

import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  PARENT_SNAPSHOT,
  deadZoneCount,
  fmtCurrency,
  greeting,
  readyCount,
  sweptToday,
} from './data';

type FinanceTab = 'home' | 'smart-balance' | 'audits' | 'transactions' | 'dashboard' | 'clients';

const MODE_TONE = { CRITICAL: 'bad', WARNING: 'warn', HEALTHY: 'good' } as const;

export function Home({ onNavigate }: { onNavigate: (tab: FinanceTab) => void }) {
  const today = new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });

  return (
    <div className="flex flex-col gap-5 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Good {greeting()}, Dana</h2>
          <p className="text-sm text-muted-foreground">{today} — Finance Workspace</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full border border-good/30 bg-good/10 px-2.5 py-1 text-[10px] font-bold tracking-wide text-good uppercase">
          <span className="size-1.5 animate-pulse rounded-full bg-good" />
          Live
        </span>
      </div>

      <div className="rounded-lg border border-l-4 border-l-primary bg-card p-5 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-muted-foreground">Parent Balance · EFS Account</div>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge tone={MODE_TONE[PARENT_SNAPSHOT.mode]}>{PARENT_SNAPSHOT.mode}</StatusBadge>
            <Button variant="outline" size="sm">
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        <div className="font-mono text-[38px] leading-none font-bold text-primary">
          {fmtCurrency(PARENT_SNAPSHOT.balance)}
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Captured {PARENT_SNAPSHOT.captured} · auto-sweep keeps the master account above the critical floor
        </p>

        <div className="mt-4 grid grid-cols-3 gap-3 border-t pt-4">
          <div>
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Swept Today</div>
            <div className="font-mono text-lg font-bold text-good">{fmtCurrency(sweptToday())}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Cards in Dead Zone</div>
            <div className="font-mono text-lg font-bold text-bad">{deadZoneCount()}</div>
          </div>
          <div>
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Ready Cards</div>
            <div className="font-mono text-lg font-bold">{readyCount()}</div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <ShortcutCard
          icon={<Wallet className="size-5" />}
          title="Smart Balance"
          desc="Live sweep events & dead-zone cards"
          onClick={() => onNavigate('smart-balance')}
        />
        <ShortcutCard
          icon={<Users className="size-5" />}
          title="Debtors"
          desc="Overdue invoices & aging analysis"
          onClick={() => onNavigate('dashboard')}
        />
        <ShortcutCard
          icon={<Users className="size-5" />}
          title="Clients"
          desc="Accounts, invoices, fuel & payments"
          onClick={() => onNavigate('clients')}
        />
      </div>
    </div>
  );
}

function ShortcutCard({
  icon,
  title,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-3.5 rounded-lg border bg-card p-4 text-left shadow-sm transition-colors hover:border-primary/45 hover:bg-muted/40"
    >
      <span className="flex size-10 flex-none items-center justify-center rounded-md bg-primary/12 text-primary">
        {icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-heading text-sm font-bold">{title}</div>
        <div className="truncate text-xs text-muted-foreground">{desc}</div>
      </div>
      <ArrowRight className="size-4 flex-none text-muted-foreground" />
    </button>
  );
}
