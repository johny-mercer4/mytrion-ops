import { useMemo, useState } from 'react';
import { FileClock, FileText, RefreshCw, Users } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { ApplicationModal } from './ApplicationModal';
import { ToastViewport, useToast } from './Toast';
import {
  CLIENT_REQUESTS,
  NEW_APPLICATIONS,
  fmtCurrency,
  initials,
  type Application,
  type ClientRequest,
  type NewApplication,
} from './data';

type SubTab = 'new' | 'req';

const NEW_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'In Review', label: 'In Review' },
  { id: 'Pending Docs', label: 'Pending Docs' },
  { id: 'Ready for Decision', label: 'Ready' },
  { id: 'WEX Routing', label: 'WEX' },
];

const REQ_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'Limit Increase', label: 'Limit Increase' },
  { id: 'Reactivation', label: 'Reactivation' },
  { id: 'Card Request', label: 'Card Request' },
  { id: 'Billing Cycle Change', label: 'Billing Cycle' },
];

const NEW_STATUS_TONE: Record<string, StatusTone> = {
  'In Review': 'info',
  'Pending Docs': 'warn',
  'Ready for Decision': 'good',
  'WEX Routing': 'info',
  'Prepay Only': 'warn',
};

const REQ_STATUS_TONE: Record<string, StatusTone> = {
  Eligible: 'good',
  'Type A': 'info',
  'On Hold': 'warn',
  Review: 'info',
};

const pendingDocsCount = NEW_APPLICATIONS.filter((a) => a.docs.length > 0).length;

export function Applications() {
  const [subTab, setSubTab] = useState<SubTab>('new');
  const [search, setSearch] = useState('');
  const [newFilter, setNewFilter] = useState('all');
  const [reqFilter, setReqFilter] = useState('all');
  const [openApp, setOpenApp] = useState<Application | null>(null);
  const { toast, show } = useToast();

  const filteredNew = useMemo(() => {
    let rows: NewApplication[] = NEW_APPLICATIONS;
    if (newFilter !== 'all') rows = rows.filter((a) => a.status === newFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((a) =>
        `${a.company} ${a.carrierId} ${a.mc} ${a.dot} ${a.agent}`.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [newFilter, search]);

  const filteredReq = useMemo(() => {
    let rows: ClientRequest[] = CLIENT_REQUESTS;
    if (reqFilter !== 'all') rows = rows.filter((r) => r.reqType === reqFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((r) => `${r.company} ${r.carrierId} ${r.agent}`.toLowerCase().includes(q));
    }
    return rows;
  }, [reqFilter, search]);

  function handleDecision(app: Application, label: string) {
    setOpenApp(null);
    show('success', `${app.company} — ${label}.`);
  }

  function handleRequestDocs(app: Application) {
    show('info', 'Documents requested', `Emailed client & notified ${app.agent} (72h SLA).`);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Applications</h2>
          <p className="text-sm text-muted-foreground">
            {NEW_APPLICATIONS.length} new applications · {CLIENT_REQUESTS.length} client requests · {pendingDocsCount} pending docs
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => show('info', 'Refreshed', 'Applications list is up to date.')}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={FileText} value={String(NEW_APPLICATIONS.length)} label="New Applications" tint="primary" />
        <StatCard icon={Users} value={String(CLIENT_REQUESTS.length)} label="Client Requests" tint="purple" />
        <StatCard icon={FileClock} value={String(pendingDocsCount)} label="Pending Docs" tint="warn" />
        <StatCard
          icon={FileText}
          value={String(NEW_APPLICATIONS.filter((a) => a.status === 'Ready for Decision').length)}
          label="Ready for Decision"
          tint="good"
        />
      </div>

      <div className="flex items-center gap-5 border-b">
        <SubTabButton active={subTab === 'new'} onClick={() => setSubTab('new')} label="New Applications" count={NEW_APPLICATIONS.length} />
        <SubTabButton active={subTab === 'req'} onClick={() => setSubTab('req')} label="Client Requests" count={CLIENT_REQUESTS.length} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, carrier ID, MC/DOT, agent…"
          className="max-w-sm flex-1"
        />
        {subTab === 'new' ? (
          <SegmentedFilter options={NEW_FILTERS} value={newFilter} onChange={setNewFilter} />
        ) : (
          <SegmentedFilter options={REQ_FILTERS} value={reqFilter} onChange={setReqFilter} />
        )}
      </div>

      {subTab === 'new' ? (
        <NewApplicationsTable rows={filteredNew} onOpen={setOpenApp} />
      ) : (
        <ClientRequestsTable rows={filteredReq} onOpen={setOpenApp} />
      )}

      {openApp ? (
        <ApplicationModal app={openApp} onClose={() => setOpenApp(null)} onDecision={handleDecision} onRequestDocs={handleRequestDocs} />
      ) : null}

      <ToastViewport toast={toast} />
    </div>
  );
}

function SubTabButton({ active, onClick, label, count }: { active: boolean; onClick: () => void; label: string; count: number }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`-mb-px flex items-center gap-1.5 border-b-2 px-1 pb-2.5 text-sm font-semibold transition-colors ${
        active ? 'border-primary text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
      <span className="rounded-md border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-secondary-foreground">{count}</span>
    </button>
  );
}

function StepDots({ step }: { step: number }) {
  return (
    <div className="flex items-center gap-1">
      {[1, 2, 3, 4].map((n) => (
        <span key={n} className={`size-1.5 rounded-full ${n <= step ? 'bg-primary' : 'bg-border'}`} />
      ))}
    </div>
  );
}

const STEP_LABELS = ['Carrier Lookup', 'Financial', 'Credit', 'Limit & Decision'];

function NewApplicationsTable({ rows, onOpen }: { rows: NewApplication[]; onOpen: (a: Application) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      {/* min-w keeps the 7-column grid from squishing on phones; overflow-x-auto on the
          wrapper above makes it swipeable instead of clipping the trailing columns. */}
      <div className="min-w-240">
        <div className="grid grid-cols-[1.8fr_1.4fr_0.9fr_1.6fr_1.2fr_1fr_0.8fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
          <span>Company</span>
          <span>Carrier / MC · DOT</span>
          <span>Type</span>
          <span>Verification Step</span>
          <span>Sales Agent</span>
          <span>Status</span>
          <span>Received</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No applications match your search or filters.</div>
        ) : (
          rows.map((a) => (
            <button
              key={a.id}
              onClick={() => onOpen(a)}
              className="grid w-full grid-cols-[1.8fr_1.4fr_0.9fr_1.6fr_1.2fr_1fr_0.8fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
            >
              <span className="min-w-0">
                <div className="truncate font-semibold">{a.company}</div>
                <div className="text-[11px] text-muted-foreground">{a.cards} cards · {a.track}</div>
              </span>
              <span className="font-mono text-[11px] leading-tight text-muted-foreground">
                <div>{a.carrierId} · {a.mc}</div>
                <div>{a.dot}</div>
              </span>
              <span>
                <StatusBadge tone="neutral">{a.type}</StatusBadge>
              </span>
              <span className="flex items-center gap-2">
                <StepDots step={a.step} />
                <span className="truncate text-[11px] text-muted-foreground">{STEP_LABELS[a.step - 1]}</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span className="flex size-6 flex-none items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {initials(a.agent)}
                </span>
                <span className="truncate text-xs">{a.agent}</span>
              </span>
              <span>
                <StatusBadge tone={NEW_STATUS_TONE[a.status] ?? 'neutral'}>{a.status}</StatusBadge>
              </span>
              <span className="text-xs text-muted-foreground">{a.received}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}

const REQ_ICON_LABEL: Record<string, string> = {
  'Limit Increase': '↑',
  Reactivation: '↻',
  'Card Request': '▤',
  'Billing Cycle Change': '⟳',
};

function ClientRequestsTable({ rows, onOpen }: { rows: ClientRequest[]; onOpen: (a: Application) => void }) {
  return (
    <div className="overflow-x-auto rounded-lg border bg-card">
      {/* min-w keeps the 7-column grid from squishing on phones; overflow-x-auto on the
          wrapper above makes it swipeable instead of clipping the trailing columns. */}
      <div className="min-w-220">
        <div className="grid grid-cols-[1.8fr_1fr_1.6fr_1fr_1.2fr_1fr_0.7fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
          <span>Company</span>
          <span>Carrier ID</span>
          <span>Request</span>
          <span>Current Limit</span>
          <span>Sales Agent</span>
          <span>Status</span>
          <span>Age</span>
        </div>
        {rows.length === 0 ? (
          <div className="p-10 text-center text-sm text-muted-foreground">No client requests match your search or filters.</div>
        ) : (
          rows.map((r) => (
            <button
              key={r.id}
              onClick={() => onOpen(r)}
              className="grid w-full grid-cols-[1.8fr_1fr_1.6fr_1fr_1.2fr_1fr_0.7fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
            >
              <span className="min-w-0">
                <div className="truncate font-semibold">{r.company}</div>
                <div className="text-[11px] text-muted-foreground">{r.tenure}</div>
              </span>
              <span className="font-mono text-xs text-muted-foreground">{r.carrierId}</span>
              <span className="flex items-center gap-1.5 truncate text-xs">
                <span className="flex size-5 flex-none items-center justify-center rounded-md bg-secondary text-[11px] font-bold text-secondary-foreground">
                  {REQ_ICON_LABEL[r.reqType] ?? '•'}
                </span>
                {r.reqType}
              </span>
              <span className="font-mono text-xs">{fmtCurrency(r.currentLimit)}</span>
              <span className="flex items-center gap-1.5">
                <span className="flex size-6 flex-none items-center justify-center rounded-full bg-primary/15 text-[10px] font-bold text-primary">
                  {initials(r.agent)}
                </span>
                <span className="truncate text-xs">{r.agent}</span>
              </span>
              <span>
                <StatusBadge tone={REQ_STATUS_TONE[r.status] ?? 'neutral'}>{r.status}</StatusBadge>
              </span>
              <span className="text-xs text-muted-foreground">{r.received}</span>
            </button>
          ))
        )}
      </div>
    </div>
  );
}
