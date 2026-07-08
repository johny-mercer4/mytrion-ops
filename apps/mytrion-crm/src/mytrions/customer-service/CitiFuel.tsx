import { useMemo, useState } from 'react';
import { CreditCard, Plus, RefreshCw, Send, Users } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { CitiModal } from './CitiModal';
import { Toast, type ToastState } from './Toast';
import {
  CITI_CLIENTS,
  type CitiClient,
  citiDecisionMeta,
  citiRequestMeta,
  citiStatusMeta,
} from './data';

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'In process', label: 'In Process' },
  { id: 'Cards sent', label: 'Cards Sent' },
  { id: 'Closed', label: 'Closed' },
];

export function CitiFuel() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [openClient, setOpenClient] = useState<CitiClient | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const filtered = useMemo(() => {
    let rows = CITI_CLIENTS;
    if (status !== 'all') rows = rows.filter((c) => c.status === status);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((c) =>
        `${c.name} ${c.email} ${c.phone} ${c.appId}`.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [status, search]);

  const inProcess = CITI_CLIENTS.filter((c) => c.status === 'In process').length;
  const cardsSent = CITI_CLIENTS.filter((c) => c.status === 'Cards sent').length;
  const debtors = CITI_CLIENTS.filter((c) => c.decision === 'Debtor').length;

  function infoToast(message: string) {
    setToast({ id: Date.now(), kind: 'info', message });
  }

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">CITI Fuel Clients</h2>
          <p className="text-sm text-muted-foreground">{CITI_CLIENTS.length} clients · CITI Fuel program</p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => infoToast('Client creation opens in the live Zoho workspace.')}>
            <Plus className="size-3.5" />
            Add Client
          </Button>
          <Button variant="outline" size="sm">
            <RefreshCw className="size-3.5" />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} value={String(CITI_CLIENTS.length)} label="Total Clients" tint="primary" />
        <StatCard icon={Send} value={String(inProcess)} label="In Process" tint="warn" />
        <StatCard icon={CreditCard} value={String(cardsSent)} label="Cards Sent" tint="primary" />
        <StatCard icon={Users} value={String(debtors)} label="Debtors" tint="bad" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, phone, App ID…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={STATUS_FILTERS} value={status} onChange={setStatus} />
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        {/* min-w keeps the 6-column grid from squishing on phones; overflow-x-auto on the
            wrapper above makes it swipeable instead of clipping the trailing columns. */}
        <div className="min-w-190">
          <div className="grid grid-cols-[1.8fr_0.9fr_1.1fr_1.1fr_1.2fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Client Name</span>
            <span>App ID</span>
            <span>Status</span>
            <span>Request</span>
            <span>Final Decision</span>
            <span className="text-right">Date</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No clients found. Try adjusting your search or filters.
            </div>
          ) : (
            filtered.map((c) => {
              const st = citiStatusMeta(c.status);
              const rq = citiRequestMeta(c.request);
              const dc = citiDecisionMeta(c.decision);
              return (
                <button
                  key={c.id}
                  onClick={() => setOpenClient(c)}
                  className="grid w-full grid-cols-[1.8fr_0.9fr_1.1fr_1.1fr_1.2fr_1fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="min-w-0">
                    <div className="truncate font-semibold">{c.name}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{c.email}</div>
                  </span>
                  <span className="font-mono text-xs text-muted-foreground">{c.appId}</span>
                  <span>
                    <StatusBadge tone={st.tone}>{c.status}</StatusBadge>
                  </span>
                  <span>
                    <StatusBadge tone={rq.tone}>{c.request}</StatusBadge>
                  </span>
                  <span>{c.decision ? <StatusBadge tone={dc.tone}>{c.decision}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
                  <span className="text-right text-xs text-muted-foreground">{c.date}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {openClient ? (
        <CitiModal
          client={openClient}
          onClose={() => setOpenClient(null)}
          onEdit={() => {
            infoToast('Read-only preview — Editing is available in the live Zoho workspace.');
            setOpenClient(null);
          }}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
