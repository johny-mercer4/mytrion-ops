import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { CaseDetail } from './CaseDetail';
import {
  CASES,
  STAGE_ORDER,
  type CaseStage,
  type CollectionCase,
  type Priority,
  fmtCurrency,
  initials,
  priorityColorClass,
  priorityDotClass,
  priorityLabel,
  stageTitle,
} from './data';

const PRIORITY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const COLUMN_DOT: Record<CaseStage, string> = {
  handoff: 'bg-bad',
  contacting: 'bg-warn',
  array: 'bg-brand-purple',
  plan: 'bg-good',
  recovered: 'bg-good',
  baddebt: 'bg-muted-foreground',
};

const NEXT_STAGE: Partial<Record<CaseStage, CaseStage>> = {
  handoff: 'contacting',
  contacting: 'array',
  array: 'plan',
  plan: 'recovered',
};

let arrayRefSeq = 20515;

export function Cases() {
  const [cases, setCases] = useState<CollectionCase[]>(CASES);
  const [search, setSearch] = useState('');
  const [priority, setPriority] = useState('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [toast, setToast] = useState<{ kind: 'success' | 'info' | 'warn'; label: string; msg: string } | null>(null);

  const filtered = useMemo(() => {
    let rows = cases;
    if (priority !== 'all') rows = rows.filter((c) => c.priority === (priority as Priority));
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((c) => `${c.company} ${c.carrierId} ${c.owner}`.toLowerCase().includes(q));
    return rows;
  }, [cases, priority, search]);

  const activeCount = cases.filter((c) => c.stage !== 'recovered' && c.stage !== 'baddebt').length;
  const totalOutstanding = cases.reduce((s, c) => s + c.outstanding, 0);

  const openCase = cases.find((c) => c.id === openId) ?? null;

  function showToast(kind: 'success' | 'info' | 'warn', label: string, msg: string) {
    setToast({ kind, label, msg });
    window.setTimeout(() => setToast(null), 3200);
  }

  function patch(id: string, fields: Partial<CollectionCase>) {
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, ...fields } : c)));
  }

  function advanceCase(c: CollectionCase) {
    const next = NEXT_STAGE[c.stage] ?? 'recovered';
    patch(c.id, { stage: next });
    showToast('success', 'Stage advanced', `${c.company} moved to ${stageTitle(next)}.`);
  }

  function fileToArray(c: CollectionCase) {
    const ref = `AR-${arrayRefSeq++}`;
    patch(c.id, { stage: 'array', arrayRef: ref, submitted: 'Today' });
    showToast('info', 'Filed to Array', `${c.company} filed to Array agency (Ref ${ref}).`);
  }

  function markRecovered(c: CollectionCase) {
    patch(c.id, { stage: 'recovered', recoveredAmt: c.outstanding, outstanding: 0, resolved: 'Today' });
    showToast('success', 'Marked recovered', `${c.company} marked as recovered.`);
  }

  function writeOff(c: CollectionCase) {
    patch(c.id, { stage: 'baddebt', writeoffDate: 'Today' });
    showToast('warn', 'Written off', `${c.company} written off as bad debt.`);
  }

  function logContact(c: CollectionCase) {
    patch(c.id, { lastContact: 'Just now' });
    showToast('info', 'Contact logged', `Logged a new contact attempt for ${c.company}.`);
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-heading text-2xl font-bold">Collection Cases</h2>
        <p className="text-sm text-muted-foreground">
          {activeCount} active cases · {fmtCurrency(totalOutstanding)} outstanding
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, carrier ID, owner…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={PRIORITY_FILTERS} value={priority} onChange={setPriority} />
        <button
          type="button"
          onClick={() => setSearch('')}
          title="Refresh"
          aria-label="Refresh"
          className="flex size-8 flex-none items-center justify-center rounded-md border bg-card text-muted-foreground hover:text-foreground"
        >
          <RefreshCw className="size-3.5" />
        </button>
      </div>

      {/* Kanban board: 6 fixed-width columns in a flex row. On phones the row
          scrolls horizontally (overflow-x-auto) rather than squeezing columns
          down to unreadable widths — same swipeable idiom as Billing's tables. */}
      <div className="overflow-x-auto pb-2">
        <div className="flex min-w-fit gap-3">
          {STAGE_ORDER.map((stage) => {
            const rows = filtered.filter((c) => c.stage === stage);
            return (
              <div key={stage} className="w-70 flex-none rounded-lg border bg-card/60">
                <div className="flex items-center gap-2 border-b px-3 py-2.5">
                  <span className={`size-2 flex-none rounded-full ${COLUMN_DOT[stage]}`} />
                  <span className="font-heading text-xs font-bold uppercase">{stageTitle(stage)}</span>
                  <span className="ml-auto rounded-md border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-secondary-foreground">
                    {rows.length}
                  </span>
                </div>
                <div className="flex flex-col gap-2 p-2.5">
                  {rows.length === 0 ? (
                    <div className="p-4 text-center text-[11px] text-muted-foreground">No cases</div>
                  ) : (
                    rows.map((c) => <CaseCard key={c.id} c={c} onClick={() => setOpenId(c.id)} />)
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {openCase ? (
        <CaseDetail
          c={openCase}
          onClose={() => setOpenId(null)}
          onLogContact={() => logContact(openCase)}
          onAdvance={() => advanceCase(openCase)}
          onFileToArray={() => fileToArray(openCase)}
          onMarkRecovered={() => markRecovered(openCase)}
          onWriteOff={() => writeOff(openCase)}
        />
      ) : null}

      {toast ? <Toast kind={toast.kind} label={toast.label} msg={toast.msg} /> : null}
    </div>
  );
}

function CaseCard({ c, onClick }: { c: CollectionCase; onClick: () => void }) {
  const isRecovered = c.stage === 'recovered';
  const isBadDebt = c.stage === 'baddebt';
  const amount = isRecovered ? (c.recoveredAmt ?? 0) : c.outstanding;
  const amountColor = isRecovered ? 'text-good' : isBadDebt ? 'text-muted-foreground' : 'text-foreground';

  let sub: string;
  if (isRecovered) sub = `resolved ${c.resolved}`;
  else if (c.stage === 'plan') sub = `${c.invoices} inv · rem.`;
  else sub = `${c.invoices} inv · ${c.oldestDays}d`;

  let meta: { text: string; color: string };
  if (c.stage === 'handoff') meta = { text: `Deact ${c.deactivated}`, color: 'text-muted-foreground' };
  else if (c.stage === 'contacting') meta = { text: `${c.attempts} attempts`, color: 'text-warn' };
  else if (c.stage === 'array') meta = { text: c.arrayRef ?? '', color: 'text-brand-purple' };
  else if (c.stage === 'plan') meta = { text: `${c.planPct}% · ${c.planNext}`, color: 'text-good' };
  else if (isRecovered) meta = { text: 'Recovered', color: 'text-good' };
  else meta = { text: `Written off ${c.writeoffDate}`, color: 'text-muted-foreground' };

  return (
    <button
      onClick={onClick}
      className="flex w-full flex-col gap-2 rounded-md border bg-card p-3 text-left transition-colors hover:border-primary/45"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold">{c.company}</div>
          <div className="font-mono text-[10.5px] text-muted-foreground">{c.carrierId}</div>
        </div>
        <span className={`flex-none rounded-md bg-muted px-1.5 py-0.5 text-[9.5px] font-bold uppercase ${priorityColorClass(c.priority)}`}>
          {priorityLabel(c.priority)}
        </span>
      </div>

      <div className="line-clamp-2 text-[11.5px] text-muted-foreground">{c.reason}</div>

      <div className={`font-mono text-sm font-bold ${amountColor}`}>{fmtCurrency(amount)}</div>
      <div className="text-[10.5px] text-muted-foreground">{sub}</div>

      <div className="flex items-center justify-between border-t pt-2">
        <span className="flex size-5 flex-none items-center justify-center rounded-md bg-secondary font-mono text-[9px] font-bold text-secondary-foreground">
          {initials(c.owner)}
        </span>
        <span className={`text-[10.5px] font-semibold ${meta.color}`}>{meta.text}</span>
      </div>

      <span className={`h-0.5 w-6 rounded-full ${priorityDotClass(c.priority)}`} />
    </button>
  );
}

function Toast({ kind, label, msg }: { kind: 'success' | 'info' | 'warn'; label: string; msg: string }) {
  const border = kind === 'success' ? 'border-l-good' : kind === 'warn' ? 'border-l-warn' : 'border-l-primary';
  const dot = kind === 'success' ? 'bg-good' : kind === 'warn' ? 'bg-warn' : 'bg-primary';
  return (
    <div className={`fixed right-5 bottom-5 z-50 flex max-w-sm items-start gap-3 rounded-lg border border-l-4 bg-card px-4 py-3 shadow-lg ${border}`}>
      <span className={`mt-1 size-2 flex-none rounded-full ${dot}`} />
      <div>
        <div className="text-sm font-bold">{label}</div>
        <div className="mt-0.5 text-xs text-muted-foreground">{msg}</div>
      </div>
    </div>
  );
}
