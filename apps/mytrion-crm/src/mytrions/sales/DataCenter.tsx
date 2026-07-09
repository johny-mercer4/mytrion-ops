import { useMemo, useState } from 'react';
import { AlertTriangle, RotateCw, Users, Wallet } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { ClientDetailModal } from './ClientDetailModal';
import { loadClients, loadLeads, money, useLoad, type ClientRow, type LeadRow } from './live';

// Widget Data Center: Clients (servercrm by-agent roster + CMP debt) and Leads
// (mytriondatacenterleads, grouped by lead status). CRM Deals / Money Codes: later.
type Tab = 'clients' | 'leads';
type ClientFilter = 'all' | 'loc' | 'prepay' | 'active';
type LeadFilter = 'all' | 'unconverted' | 'converted';

const CLIENT_TONE: Record<ClientRow['status'], StatusTone> = {
  active: 'good',
  inactive: 'neutral',
  suspended: 'bad',
};

export function DataCenter({ onOpenAutomations }: { onOpenAutomations: () => void }) {
  const [tab, setTab] = useState<Tab>('clients');
  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Data Center</h2>
          <p className="text-sm text-muted-foreground">Your clients and leads, straight from CRM + servercrm.</p>
        </div>
        <SegmentedFilter
          options={[
            { id: 'clients', label: 'Clients' },
            { id: 'leads', label: 'Leads' },
          ]}
          value={tab}
          onChange={(v) => setTab(v as Tab)}
        />
      </div>
      {tab === 'clients' ? <ClientsTab onOpenAutomations={onOpenAutomations} /> : <LeadsTab />}
    </div>
  );
}

function LoadState({ loading, error, onRetry }: { loading: boolean; error: string | null; onRetry: () => void }) {
  if (loading)
    return <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">Loading…</div>;
  if (error)
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm">
        <p className="text-bad">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={onRetry}>
          Retry
        </Button>
      </div>
    );
  return null;
}

function ClientsTab({ onOpenAutomations }: { onOpenAutomations: () => void }) {
  const clients = useLoad(loadClients, []);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<ClientFilter>('all');
  const [openClient, setOpenClient] = useState<ClientRow | null>(null);

  const rows = clients.data ?? [];
  const filtered = useMemo(() => {
    let out = rows;
    if (filter === 'loc') out = out.filter((c) => /loc/i.test(c.terms));
    if (filter === 'prepay') out = out.filter((c) => /prepay/i.test(c.terms));
    if (filter === 'active') out = out.filter((c) => c.status === 'active');
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((c) => `${c.company} ${c.carrierId} ${c.terms} ${c.dealStage} ${c.dot}`.toLowerCase().includes(q));
    return out;
  }, [rows, filter, search]);

  const debtors = rows.filter((c) => c.isDebtor);
  const totalDebt = debtors.reduce((s, c) => s + c.debt, 0);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} value={String(rows.length)} label="Total Clients" tint="primary" />
        <StatCard icon={Users} value={String(rows.filter((c) => c.status === 'active').length)} label="Active" tint="good" />
        <StatCard icon={AlertTriangle} value={String(debtors.length)} label="Debtors" tint="warn" />
        <StatCard icon={Wallet} value={totalDebt > 0 ? `-${money(totalDebt)}` : '$0'} label="Money Owed" tint="bad" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, carrier ID, terms, stage, DOT…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter
          options={[
            { id: 'all', label: 'All', count: rows.length },
            { id: 'loc', label: 'LOC', count: rows.filter((c) => /loc/i.test(c.terms)).length },
            { id: 'prepay', label: 'Prepay', count: rows.filter((c) => /prepay/i.test(c.terms)).length },
            { id: 'active', label: 'Active', count: rows.filter((c) => c.status === 'active').length },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as ClientFilter)}
        />
        <Button variant="ghost" size="sm" onClick={clients.reload} disabled={clients.loading}>
          <RotateCw className="size-3.5" />
        </Button>
      </div>

      <LoadState loading={clients.loading} error={clients.error} onRetry={clients.reload} />
      {!clients.loading && !clients.error ? (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <div className="min-w-160">
            <div className="grid grid-cols-[2fr_1fr_0.9fr_1.2fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              <span>Company</span>
              <span>Terms</span>
              <span>Status</span>
              <span className="text-right">Balance / Limit</span>
              <span className="text-right">Debt</span>
            </div>
            {filtered.length === 0 ? (
              <div className="p-10 text-center text-sm text-muted-foreground">No clients match your search.</div>
            ) : (
              filtered.map((c) => (
                <button
                  key={c.carrierId}
                  onClick={() => setOpenClient(c)}
                  className="grid w-full grid-cols-[2fr_1fr_0.9fr_1.2fr_1fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{c.company}</span>
                    <span className="block text-[10.5px] text-muted-foreground">
                      #{c.carrierId}
                      {c.dealStage ? ` · ${c.dealStage}` : ''}
                    </span>
                  </span>
                  <span>
                    {c.terms ? (
                      <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
                        {c.terms}
                      </span>
                    ) : (
                      <span className="text-xs text-muted-foreground">—</span>
                    )}
                  </span>
                  <span>
                    <StatusBadge tone={CLIENT_TONE[c.status]}>{c.status}</StatusBadge>
                  </span>
                  <span className="text-right font-mono text-muted-foreground">{c.limitText}</span>
                  <span className={`text-right font-mono ${c.isDebtor ? 'font-bold text-bad' : 'text-muted-foreground'}`}>
                    {c.debt > 0 ? `-${money(c.debt)}${c.debtDays > 0 ? ` · ${c.debtDays}d` : ''}` : '—'}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      ) : null}

      {openClient ? (
        <ClientDetailModal client={openClient} onClose={() => setOpenClient(null)} onRunAction={onOpenAutomations} />
      ) : null}
    </>
  );
}

const LEAD_STATUS_TONE: Array<{ match: RegExp; tone: StatusTone }> = [
  { match: /interested/i, tone: 'good' },
  { match: /application/i, tone: 'good' },
  { match: /not interested|unqualified/i, tone: 'bad' },
  { match: /follow/i, tone: 'warn' },
  { match: /call/i, tone: 'info' },
];

function leadTone(status: string): StatusTone {
  return LEAD_STATUS_TONE.find((t) => t.match.test(status))?.tone ?? 'neutral';
}

function LeadsTab() {
  const leads = useLoad(loadLeads, []);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<LeadFilter>('all');

  const all = useMemo(() => {
    if (!leads.data) return [];
    if (filter === 'converted') return leads.data.converted;
    if (filter === 'unconverted') return leads.data.unconverted;
    return [...leads.data.unconverted, ...leads.data.converted];
  }, [leads.data, filter]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return all;
    return all.filter((l) =>
      `${l.fullName} ${l.email} ${l.phone} ${l.status} ${l.source} ${l.company}`.toLowerCase().includes(q),
    );
  }, [all, search]);

  const grouped = useMemo(() => {
    const map = new Map<string, LeadRow[]>();
    for (const lead of filtered) {
      const list = map.get(lead.status) ?? [];
      list.push(lead);
      map.set(lead.status, list);
    }
    return [...map.entries()];
  }, [filtered]);

  return (
    <>
      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, phone, status, source…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter
          options={[
            { id: 'all', label: 'All', count: (leads.data?.converted.length ?? 0) + (leads.data?.unconverted.length ?? 0) },
            { id: 'unconverted', label: 'Unconverted', count: leads.data?.unconverted.length ?? 0 },
            { id: 'converted', label: 'Converted', count: leads.data?.converted.length ?? 0 },
          ]}
          value={filter}
          onChange={(v) => setFilter(v as LeadFilter)}
        />
        <Button variant="ghost" size="sm" onClick={leads.reload} disabled={leads.loading}>
          <RotateCw className="size-3.5" />
        </Button>
      </div>

      <LoadState loading={leads.loading} error={leads.error} onRetry={leads.reload} />
      {!leads.loading && !leads.error && grouped.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">No leads found.</div>
      ) : null}

      {grouped.map(([status, rows]) => (
        <div key={status}>
          <div className="mb-2 flex items-center gap-2">
            <StatusBadge tone={leadTone(status)}>{status}</StatusBadge>
            <span className="text-xs text-muted-foreground">{rows.length}</span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2 xl:grid-cols-3">
            {rows.map((l) => (
              <div key={l.id} className="rounded-lg border bg-card p-3.5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold">{l.fullName}</div>
                    {l.company ? <div className="truncate text-xs text-muted-foreground">{l.company}</div> : null}
                  </div>
                  {l.converted ? <StatusBadge tone="good">Converted</StatusBadge> : null}
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground">
                  {l.source ? <span className="rounded-md border bg-secondary px-1.5 py-0.5 font-semibold">{l.source}</span> : null}
                  {l.utm ? <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">{l.utm}</span> : null}
                  <span>{l.created}</span>
                </div>
                <div className="mt-1.5 text-xs font-mono text-muted-foreground">
                  {l.phone}
                  {l.email ? ` · ${l.email}` : ''}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </>
  );
}
