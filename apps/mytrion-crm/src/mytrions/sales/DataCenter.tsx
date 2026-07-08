import { useMemo, useState } from 'react';
import { AlertTriangle, Droplets, Users, Wallet } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { CLIENTS, type Client, fmtCompact, fmtCurrency, statusTone } from './data';
import { ClientDetailModal } from './ClientDetailModal';

type Filter = 'all' | 'active' | 'inactive' | 'stuck' | 'owes';

export function DataCenter({ onOpenAutomations }: { onOpenAutomations: () => void }) {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openClient, setOpenClient] = useState<Client | null>(null);

  const counts = useMemo(
    () => ({
      all: CLIENTS.length,
      active: CLIENTS.filter((c) => c.status === 'active').length,
      inactive: CLIENTS.filter((c) => c.status === 'inactive').length,
      stuck: CLIENTS.filter((c) => c.status === 'stuck').length,
      owes: CLIENTS.filter((c) => c.balance < 0).length,
    }),
    [],
  );

  const filtered = useMemo(() => {
    let rows = CLIENTS;
    if (filter === 'owes') rows = rows.filter((c) => c.balance < 0);
    else if (filter !== 'all') rows = rows.filter((c) => c.status === filter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((c) => `${c.name} ${c.id} ${c.city}`.toLowerCase().includes(q));
    return rows;
  }, [filter, search]);

  const totalGallons = CLIENTS.reduce((s, c) => s + c.gallons, 0);
  const totalOwed = CLIENTS.reduce((s, c) => s + (c.balance < 0 ? c.balance : 0), 0);

  const filterOptions = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'active', label: 'Active', count: counts.active },
    { id: 'inactive', label: 'Inactive', count: counts.inactive },
    { id: 'stuck', label: 'Stuck', count: counts.stuck },
    { id: 'owes', label: 'Owes money', count: counts.owes },
  ];

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Data Center</h2>
        <p className="text-sm text-muted-foreground">Your assigned clients — balances, cards, fueling activity.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <StatCard icon={Users} value={String(counts.all)} label="Total Clients" tint="primary" />
        <StatCard icon={Users} value={String(counts.active)} label="Active" tint="good" />
        <StatCard icon={AlertTriangle} value={String(counts.inactive + counts.stuck)} label="Need Attention" tint="warn" />
        <StatCard icon={Droplets} value={fmtCompact(totalGallons)} label="Gallons (cyc)" tint="purple" />
        <StatCard icon={Wallet} value={`-${fmtCurrency(Math.abs(totalOwed))}`} label="Money Owed" tint="bad" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, carrier ID, city…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={filterOptions} value={filter} onChange={(v) => setFilter(v as Filter)} />
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="min-w-160">
          <div className="grid grid-cols-[2fr_1fr_1fr_1fr_0.8fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Company</span>
            <span>Status</span>
            <span className="text-right">Balance</span>
            <span className="text-right">Gallons (cyc)</span>
            <span className="text-right">Cards</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No clients match your search.</div>
          ) : (
            filtered.map((c) => {
              const owed = c.balance < 0;
              return (
                <button
                  key={c.id}
                  onClick={() => setOpenClient(c)}
                  className="grid w-full grid-cols-[2fr_1fr_1fr_1fr_0.8fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.name}</span>
                    <span className="block text-[10.5px] text-muted-foreground">#{c.id} · {c.city}</span>
                  </span>
                  <span>
                    <StatusBadge tone={statusTone(c.status)}>{c.status}</StatusBadge>
                  </span>
                  <span className={`text-right font-mono ${owed ? 'font-bold text-bad' : 'text-muted-foreground'}`}>
                    {owed ? `-${fmtCurrency(c.balance)}` : fmtCurrency(c.balance)}
                  </span>
                  <span className="text-right font-mono text-muted-foreground">{fmtCompact(c.gallons)}</span>
                  <span className="text-right font-mono text-muted-foreground">{c.cards}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {openClient ? (
        <ClientDetailModal
          client={openClient}
          onClose={() => setOpenClient(null)}
          onRunAction={onOpenAutomations}
        />
      ) : null}
    </div>
  );
}
