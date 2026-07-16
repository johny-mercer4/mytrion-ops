import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';

import { toggleOnboarding, type OnboardingField } from '@/api/cs';
import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { ApplicationEdit } from './ApplicationEdit';
import { ApplicationModal } from './ApplicationModal';
import { Toast, type ToastState } from './Toast';
import { type Application, bizMeta, creditTone, fullName, stageMeta } from './data';
import { loadApplications, useLoad } from './live';

type SubTab = 'apps' | 'clients';

const SEGMENTS: (keyof Pick<Application, 'ta' | 'efs' | 'lmt' | 'mob' | 'chn'>)[] = ['ta', 'efs', 'lmt', 'mob', 'chn'];

/** Widget parity: search fires debounced (App ID / Carrier ID / name / phone, server-side). */
const SEARCH_DEBOUNCE_MS = 400;

export function Applications() {
  const [subTab, setSubTab] = useState<SubTab>('apps');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [openApp, setOpenApp] = useState<Application | null>(null);
  const [editApp, setEditApp] = useState<Application | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [pendingToggle, setPendingToggle] = useState<string | null>(null);
  // Optimistic per-row overrides layered over the loaded page (tick-boxes update in place).
  const [overrides, setOverrides] = useState<Record<string, Partial<Application>>>({});

  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search);
      setPage(1);
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [search]);

  const pageData = useLoad(() => loadApplications(subTab, query, page), [subTab, query, page]);

  const rows = useMemo(() => {
    const base = pageData.data?.rows ?? [];
    return base.map((a) => (overrides[a.id] ? { ...a, ...overrides[a.id] } : a));
  }, [pageData.data, overrides]);

  const openRow = openApp ? (rows.find((r) => r.id === openApp.id) ?? openApp) : null;

  function notify(kind: ToastState['kind'], message: string) {
    setToast({ id: Date.now(), kind, message });
  }

  const SEG_TO_FIELD: Record<string, keyof Application> = {
    Email_to_TA: 'ta',
    TA_EFS_Added: 'efs',
    Limits_added: 'lmt',
    Mobile_Driver_App: 'mob',
    Chain_policy: 'chn',
  };

  async function onToggle(app: Application, field: OnboardingField, next: boolean) {
    const prop = SEG_TO_FIELD[field] as 'ta' | 'efs' | 'lmt' | 'mob' | 'chn';
    setPendingToggle(field);
    setOverrides((o) => ({ ...o, [app.id]: { ...o[app.id], [prop]: next ? 1 : 0 } }));
    try {
      const res = await toggleOnboarding(app.id, field, next);
      notify(res.warning ? 'info' : 'success', res.warning ?? `${field.replace(/_/g, ' ')}: ${next ? 'Yes' : 'No'}`);
    } catch (e) {
      setOverrides((o) => ({ ...o, [app.id]: { ...o[app.id], [prop]: next ? 0 : 1 } }));
      notify('error', `Failed to save: ${e instanceof Error ? e.message : e}`);
    } finally {
      setPendingToggle(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Applications</h2>
          <p className="text-sm text-muted-foreground">
            {pageData.loading ? 'Loading…' : `${rows.length}${pageData.data?.moreRecords ? '+' : ''} ${subTab === 'clients' ? 'clients' : 'applications in process'}`}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={pageData.reload} disabled={pageData.loading}>
          <RefreshCw className={cn('size-3.5', pageData.loading ? 'animate-spin' : undefined)} />
          Refresh
        </Button>
      </div>

      <SegmentedFilter
        options={[
          { id: 'apps', label: 'Apps in Process' },
          { id: 'clients', label: 'Clients' },
        ]}
        value={subTab}
        onChange={(id) => {
          setSubTab(id as SubTab);
          setPage(1);
        }}
      />

      <SearchBar
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search App ID, Carrier ID, company, phone…"
        className="max-w-sm"
      />

      {pageData.error ? (
        <div className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          Failed to load applications: {pageData.error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
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
          {pageData.loading && rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading applications…</div>
          ) : rows.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No {subTab === 'clients' ? 'clients' : 'applications'} found. Try adjusting your search.
            </div>
          ) : (
            rows.map((a) => {
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
                  <span>{a.biz ? <StatusBadge tone={bz.tone}>{a.biz}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
                  <span>{a.stage ? <StatusBadge tone={st.tone}>{a.stage}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
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

      <div className="flex items-center justify-end gap-2 text-xs text-muted-foreground">
        <span>Page {page}</span>
        <Button variant="outline" size="sm" disabled={page <= 1 || pageData.loading} onClick={() => setPage((p) => p - 1)}>
          <ChevronLeft className="size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          disabled={!pageData.data?.moreRecords || pageData.loading}
          onClick={() => setPage((p) => p + 1)}
        >
          <ChevronRight className="size-3.5" />
        </Button>
      </div>

      {openRow && !editApp ? (
        <ApplicationModal
          app={openRow}
          onClose={() => setOpenApp(null)}
          onEdit={() => setEditApp(openRow)}
          onToggle={onToggle}
          pendingToggle={pendingToggle}
        />
      ) : null}

      {editApp ? (
        <ApplicationEdit
          app={editApp}
          onClose={() => setEditApp(null)}
          onSaved={(warning) => {
            setEditApp(null);
            setOpenApp(null);
            notify(warning ? 'info' : 'success', warning ?? 'Application saved');
            pageData.reload();
          }}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}
