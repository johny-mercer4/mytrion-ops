import { useEffect, useState } from 'react';
import { CreditCard, Plus, RefreshCw, Send, Users } from 'lucide-react';

import { deleteCitifuel } from '@/api/cs';
import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { CitiEdit } from './CitiEdit';
import { CitiModal } from './CitiModal';
import { Toast, type ToastState } from './Toast';
import { citiDecisionMeta, citiRequestMeta, citiStatusMeta } from './data';
import { loadCiti, loadCitiStats, useLoad, type CitiRow } from './live';

const SEARCH_DEBOUNCE_MS = 400;

export function CitiFuel() {
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [openClient, setOpenClient] = useState<CitiRow | null>(null);
  const [editClient, setEditClient] = useState<CitiRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const list = useLoad(() => loadCiti(status, query, page), [status, query, page]);
  const stats = useLoad(loadCitiStats, []);

  const rows = list.data?.rows ?? [];
  const byStatus = stats.data?.byStatus ?? {};
  const statVal = (label: string): string =>
    stats.data ? String(byStatus[label] ?? 0) : '…';

  const statusFilters = [
    { id: 'all', label: 'All' },
    ...Object.keys(byStatus).map((s) => ({ id: s, label: s })),
  ];

  function notify(kind: ToastState['kind'], message: string) {
    setToast({ id: Date.now(), kind, message });
  }

  function refreshAll() {
    list.reload();
    stats.reload();
  }

  async function onDelete(client: CitiRow) {
    // Real deletion (widget parity) — a browser confirm is the widget's guard too.
    if (!window.confirm(`Delete "${client.name}" from Citifuel Clients? This cannot be undone.`)) return;
    try {
      await deleteCitifuel(client.id);
      notify('success', `Deleted ${client.name}`);
      setOpenClient(null);
      refreshAll();
    } catch (e) {
      notify('error', `Delete failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">CITI Fuel Clients</h2>
          <p className="text-sm text-muted-foreground">
            {stats.data ? `${stats.data.total} clients · CITI Fuel program` : 'CITI Fuel program'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button onClick={() => setCreating(true)}>
            <Plus className="size-3.5" />
            Add Client
          </Button>
          <Button variant="outline" size="sm" onClick={refreshAll} disabled={list.loading}>
            <RefreshCw className={cn('size-3.5', list.loading ? 'animate-spin' : undefined)} />
            Refresh
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} value={stats.data ? String(stats.data.total) : '…'} label="Total Clients" tint="primary" />
        <StatCard icon={Send} value={statVal('In process')} label="In Process" tint="warn" />
        <StatCard icon={CreditCard} value={statVal('Cards sent')} label="Cards Sent" tint="primary" />
        <StatCard icon={Users} value={statVal('Closed')} label="Closed" tint="bad" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, email, phone, App ID…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter
          options={statusFilters}
          value={status}
          onChange={(id) => {
            setStatus(id);
            setPage(1);
          }}
        />
      </div>

      {list.error ? (
        <div className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          Failed to load clients: {list.error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
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
          {list.loading && rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading clients…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No clients found. Try adjusting your search or filters.
            </div>
          ) : (
            rows.map((c) => {
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
                  <span className="font-mono text-xs text-muted-foreground">{c.appId || '—'}</span>
                  <span>{c.status ? <StatusBadge tone={st.tone}>{c.status}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
                  <span>{c.request ? <StatusBadge tone={rq.tone}>{c.request}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
                  <span>{c.decision ? <StatusBadge tone={dc.tone}>{c.decision}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
                  <span className="text-right text-xs text-muted-foreground">{c.date}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {list.data?.moreRecords || page > 1 ? (
        <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
          <span>Page {page}</span>
          <Button variant="outline" size="sm" disabled={page <= 1 || list.loading} onClick={() => setPage((p) => p - 1)}>
            Prev
          </Button>
          <Button variant="outline" size="sm" disabled={!list.data?.moreRecords || list.loading} onClick={() => setPage((p) => p + 1)}>
            Next
          </Button>
        </div>
      ) : null}

      {openClient && !editClient ? (
        <CitiModal
          client={openClient}
          onClose={() => setOpenClient(null)}
          onEdit={() => setEditClient(openClient)}
          onDelete={() => onDelete(openClient)}
        />
      ) : null}

      {creating || editClient ? (
        <CitiEdit
          client={editClient}
          onClose={() => {
            setCreating(false);
            setEditClient(null);
          }}
          onSaved={() => {
            setCreating(false);
            setEditClient(null);
            setOpenClient(null);
            notify('success', editClient ? 'Client updated' : 'Client created');
            refreshAll();
          }}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
