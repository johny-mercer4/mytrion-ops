import { useMemo, useState } from 'react';
import { CheckCircle2, Clock3, DollarSign, RefreshCw, Sheet } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  ARRAY_ROWS,
  type ArrayRow,
  type ArrayStatus,
  type StageTone,
  arrayStatusTone,
  fmtCurrency,
} from './data';

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'Pending Submission', label: 'Pending' },
  { id: 'In Array', label: 'In Array' },
  { id: 'Returned', label: 'Returned' },
  { id: 'Recovered', label: 'Recovered' },
];

const BADGE_TONE: Record<StageTone, StatusTone> = {
  bad: 'bad',
  warn: 'warn',
  purple: 'info',
  good: 'good',
  neutral: 'neutral',
};

const STATUS_DOT: Record<ArrayStatus, string> = {
  'Pending Submission': 'bg-warn',
  'In Array': 'bg-brand-purple',
  Returned: 'bg-muted-foreground',
  Recovered: 'bg-good',
};

function todayStamp(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function ArrayReport() {
  const [rows, setRows] = useState<ArrayRow[]>(ARRAY_ROWS);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ label: string; msg: string } | null>(null);

  const filtered = useMemo(() => {
    let out = rows;
    if (status !== 'all') out = out.filter((r) => r.status === (status as ArrayStatus));
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((r) => `${r.company} ${r.carrierId} ${r.debtor}`.toLowerCase().includes(q));
    return out;
  }, [rows, status, search]);

  const totalOwed = rows.reduce((s, r) => s + r.owed, 0);
  const updatedToday = rows.filter((r) => r.lastUpdate.includes('Today')).length;
  const recoveredCount = rows.filter((r) => r.status === 'Recovered').length;

  const openRow = rows.find((r) => r.id === openId) ?? null;

  function showToast(label: string, msg: string) {
    setToast({ label, msg });
    window.setTimeout(() => setToast(null), 3200);
  }

  function exportExcel() {
    showToast('Export ready', `${filtered.length} rows exported → array_debtors_${todayStamp()}.xlsx`);
  }

  function exportRow(r: ArrayRow) {
    showToast('Row exported', `${r.company} row exported → array_debtors_${todayStamp()}.xlsx`);
  }

  function addDailyUpdate(r: ArrayRow) {
    setRows((prev) =>
      prev.map((row) =>
        row.id === r.id
          ? { ...row, updates: [{ date: 'Just now', note: `Daily status refreshed by ${row.collector}.` }, ...row.updates] }
          : row,
      ),
    );
    showToast('Update added', `Logged a daily update for ${r.company}.`);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Array Template Report</h2>
          <p className="text-sm text-muted-foreground">
            Updated today · {rows.length} debtors · {fmtCurrency(totalOwed)} owed
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSearch('')}
            title="Refresh"
            aria-label="Refresh"
            className="flex size-8 flex-none items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
          >
            <RefreshCw className="size-3.5" />
          </button>
          <Button onClick={exportExcel} className="bg-good text-white hover:bg-good/85">
            <Sheet className="size-4" />
            Export to Excel
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Sheet} value={String(rows.length)} label="In Report" tint="primary" />
        <StatCard icon={DollarSign} value={fmtCurrency(totalOwed)} label="Total Owed" tint="bad" />
        <StatCard icon={Clock3} value={String(updatedToday)} label="Updated Today" tint="purple" />
        <StatCard icon={CheckCircle2} value={String(recoveredCount)} label="Recovered" tint="good" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, carrier ID, debtor…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={STATUS_FILTERS} value={status} onChange={setStatus} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        {/* min-w keeps the 10-column grid from squishing on phones; overflow-x-auto on the
            wrapper above makes it swipeable instead of clipping the trailing columns. */}
        <div className="min-w-270">
          <div className="grid grid-cols-[32px_1fr_1.6fr_1.1fr_1fr_0.6fr_1fr_1fr_1fr_1.2fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[9.5px] font-bold tracking-wide text-muted-foreground uppercase sticky top-0">
            <span>#</span>
            <span>Carrier ID</span>
            <span>Company</span>
            <span>Debtor</span>
            <span>Total Owed</span>
            <span>Inv</span>
            <span>Oldest Inv</span>
            <span>Overdue</span>
            <span>Last Update</span>
            <span>Status</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No debtors match your search.</div>
          ) : (
            filtered.map((r, i) => (
              <button
                key={r.id}
                onClick={() => setOpenId(r.id)}
                className="grid w-full grid-cols-[32px_1fr_1.6fr_1.1fr_1fr_0.6fr_1fr_1fr_1fr_1.2fr] items-center gap-3 border-b px-4 py-3 text-left text-xs last:border-b-0 hover:bg-muted/40"
              >
                <span className="font-mono text-muted-foreground">{i + 1}</span>
                <span className="font-mono font-semibold text-primary">{r.carrierId}</span>
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{r.company}</span>
                  <span className="block truncate text-[10.5px] text-muted-foreground">{r.collector}</span>
                </span>
                <span className="truncate">{r.debtor}</span>
                <span className="font-mono font-bold">{fmtCurrency(r.owed)}</span>
                <span className="font-mono text-muted-foreground">{r.invoices}</span>
                <span className="text-muted-foreground">{r.oldestInv}</span>
                <span className={r.daysOverdue >= 150 ? 'font-mono font-semibold text-bad' : r.daysOverdue > 0 ? 'font-mono font-semibold text-warn' : 'font-mono text-muted-foreground'}>
                  {r.daysOverdue > 0 ? `${r.daysOverdue}d` : '—'}
                </span>
                <span className="font-mono text-muted-foreground">{r.lastUpdate}</span>
                <span className="flex items-center gap-1.5">
                  <span className={`size-1.5 flex-none rounded-full ${STATUS_DOT[r.status]}`} />
                  <StatusBadge tone={BADGE_TONE[arrayStatusTone(r.status)]}>{r.status}</StatusBadge>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {openRow ? (
        <ArrayRecordDetail
          r={openRow}
          onClose={() => setOpenId(null)}
          onAddUpdate={() => addDailyUpdate(openRow)}
          onExport={() => exportRow(openRow)}
        />
      ) : null}

      {toast ? (
        <div className="fixed right-5 bottom-5 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-l-4 border-l-good bg-card px-4 py-3 shadow-lg">
          <span className="mt-1 size-2 flex-none rounded-full bg-good" />
          <div>
            <div className="text-sm font-bold">{toast.label}</div>
            <div className="mt-0.5 text-xs text-muted-foreground">{toast.msg}</div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function ArrayRecordDetail({
  r,
  onClose,
  onAddUpdate,
  onExport,
}: {
  r: ArrayRow;
  onClose: () => void;
  onAddUpdate: () => void;
  onExport: () => void;
}) {
  const cells: { label: string; value: string }[] = [
    { label: 'Carrier ID', value: r.carrierId },
    { label: 'Company', value: r.company },
    { label: 'Debtor', value: r.debtor },
    { label: 'Total Owed', value: fmtCurrency(r.owed) },
    { label: 'Invoices', value: String(r.invoices) },
    { label: 'Oldest Invoice', value: r.oldestInv },
    { label: 'Days Overdue', value: r.daysOverdue > 0 ? `${r.daysOverdue}d` : '—' },
    { label: 'Status', value: r.status },
    { label: 'Collector', value: r.collector },
    { label: 'Last Update', value: r.lastUpdate },
  ];

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={r.company}
      subtitle={`Carrier ${r.carrierId} · Debtor ${r.debtor}`}
      size="xl"
      badges={<StatusBadge tone={BADGE_TONE[arrayStatusTone(r.status)]}>{r.status}</StatusBadge>}
      footer={
        <>
          <Button variant="outline" onClick={onAddUpdate} className="mr-auto">
            Add Daily Update
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onExport} className="bg-good text-white hover:bg-good/85">
            Export Row
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <div className="mb-2 flex items-center gap-2">
            <Sheet className="size-4 text-good" />
            <span className="font-heading text-xs font-bold tracking-wide text-primary uppercase">Excel Row Preview</span>
            <span className="font-mono text-[10.5px] text-muted-foreground">← Array template</span>
          </div>
          <div className="overflow-x-auto rounded-md border">
            <div className="flex min-w-fit">
              {cells.map((cell) => (
                <div key={cell.label} className="min-w-30 flex-none border-r px-3 py-2.5 last:border-r-0">
                  <div className="text-[9.5px] tracking-wide text-muted-foreground uppercase">{cell.label}</div>
                  <div className="mt-1 truncate font-mono text-[13px] font-bold">{cell.value}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section>
          <div className="font-heading mb-2 text-xs font-bold tracking-wide text-primary uppercase">Collector Notes</div>
          <div className="rounded-md border bg-muted/30 p-3.5 text-sm text-muted-foreground">{r.notes}</div>
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Daily Update Log</div>
          <div className="flex flex-col gap-0">
            {r.updates.map((u, i) => (
              <div key={i} className="relative flex gap-3 pb-4 last:pb-0">
                <div className="flex flex-none flex-col items-center">
                  <span className="mt-1 size-2 flex-none rounded-full bg-primary" />
                  {i < r.updates.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                </div>
                <div className="min-w-0 pb-1">
                  <div className="text-sm">{u.note}</div>
                  <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">{u.date}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DetailDialog>
  );
}
