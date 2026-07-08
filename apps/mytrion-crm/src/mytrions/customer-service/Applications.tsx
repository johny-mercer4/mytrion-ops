import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApplicationModal } from './ApplicationModal';
import { Toast, type ToastState } from './Toast';
import {
  APPLICATIONS,
  type Application,
  bizMeta,
  creditTone,
  fullName,
  isClient,
  stageMeta,
} from './data';

type SubTab = 'apps' | 'clients';

const SEGMENTS: (keyof Pick<Application, 'ta' | 'efs' | 'lmt' | 'mob' | 'chn'>)[] = ['ta', 'efs', 'lmt', 'mob', 'chn'];

export function Applications() {
  const [subTab, setSubTab] = useState<SubTab>('apps');
  const [search, setSearch] = useState('');
  const [openApp, setOpenApp] = useState<Application | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);

  const apps = useMemo(() => APPLICATIONS.filter((a) => !isClient(a)), []);
  const clients = useMemo(() => APPLICATIONS.filter((a) => isClient(a)), []);
  const source = subTab === 'apps' ? apps : clients;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return source;
    return source.filter((a) =>
      `${a.appId} ${a.carrierId} ${a.company} ${a.agent}`.toLowerCase().includes(q),
    );
  }, [source, search]);

  function editToast() {
    setToast({ id: Date.now(), kind: 'info', message: 'Read-only preview — Editing is available in the live Zoho workspace.' });
  }

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Applications</h2>
          <p className="text-sm text-muted-foreground">
            {source.length} {subTab === 'clients' ? 'clients' : 'applications in process'}
          </p>
        </div>
        <Button variant="outline" size="sm">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <SegmentedFilter
        options={[
          { id: 'apps', label: 'Apps in Process', count: apps.length },
          { id: 'clients', label: 'Clients', count: clients.length },
        ]}
        value={subTab}
        onChange={(id) => setSubTab(id as SubTab)}
      />

      <SearchBar
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search App ID, Carrier ID, company, agent…"
        className="max-w-sm"
      />

      <div className="overflow-x-auto rounded-xs border bg-card">
        {/* min-w keeps the 8-column grid from squishing on phones; overflow-x-auto on the
            wrapper above makes it swipeable instead of clipping the trailing columns. */}
        <div className="min-w-230">
          <div className="grid grid-cols-[1fr_1.8fr_1.1fr_1.2fr_1.2fr_0.8fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>{subTab === 'clients' ? 'Carrier ID' : 'App ID'}</span>
            <span>Company</span>
            <span>Business</span>
            <span>Stage</span>
            <span>Onboarding</span>
            <span>Credit</span>
            <span>Agent</span>
            <span className="text-right">Date Filled</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No {subTab === 'clients' ? 'clients' : 'applications'} found. Try adjusting your search.
            </div>
          ) : (
            filtered.map((a) => {
              const st = stageMeta(a.stage);
              const bz = bizMeta(a.biz);
              const credit = creditTone(a.credit);
              return (
                <button
                  key={a.id}
                  onClick={() => setOpenApp(a)}
                  className="grid w-full grid-cols-[1fr_1.8fr_1.1fr_1.2fr_1.2fr_0.8fr_1fr_1fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="font-mono text-xs text-muted-foreground">
                    {subTab === 'clients' ? a.carrierId : a.appId}
                  </span>
                  <span className="min-w-0">
                    <div className="truncate font-semibold">{a.company}</div>
                    <div className="truncate text-[11px] text-muted-foreground">{fullName(a)}</div>
                  </span>
                  <span>
                    <StatusBadge tone={bz.tone}>{a.biz}</StatusBadge>
                  </span>
                  <span>
                    <StatusBadge tone={st.tone}>{a.stage}</StatusBadge>
                  </span>
                  <span className="flex items-center gap-1">
                    {SEGMENTS.map((seg) => (
                      <span
                        key={seg}
                        className={cn('size-2 rounded-full', a[seg] ? 'bg-primary' : 'bg-muted')}
                        title={seg.toUpperCase()}
                      />
                    ))}
                  </span>
                  <span className={cn('font-mono text-xs', credit === 'good' ? 'text-good' : credit === 'warn' ? 'text-warn' : credit === 'bad' ? 'text-bad' : 'text-muted-foreground')}>
                    {a.credit ?? '—'}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">{a.agent}</span>
                  <span className="text-right text-xs text-muted-foreground">{a.date}</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {openApp ? (
        <ApplicationModal
          app={openApp}
          onClose={() => setOpenApp(null)}
          onEdit={() => {
            editToast();
            setOpenApp(null);
          }}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
