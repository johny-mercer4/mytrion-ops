import { useMemo, useState } from 'react';
import { Clock, RefreshCw, Zap } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { CaseDetail, daysToneClass } from './CaseDetail';
import {
  CASES,
  KANBAN_COLUMNS,
  STAGE_META,
  type RetentionCase,
  type Risk,
  type Stage,
  fmtMrr,
  initials,
  mrrTone,
  nextStage,
  riskTone,
} from './data';
import { Toast, useToasts } from './Toast';

const RISK_FILTERS: { id: string; label: string; dot?: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'high', label: 'High' },
  { id: 'medium', label: 'Medium' },
  { id: 'low', label: 'Low' },
];

const MRR_CLASS: Record<ReturnType<typeof mrrTone>, string> = {
  bad: 'text-bad',
  warn: 'text-warn',
  neutral: 'text-foreground',
};

export function Cases() {
  const [cases, setCases] = useState<RetentionCase[]>(CASES);
  const [search, setSearch] = useState('');
  const [riskFilter, setRiskFilter] = useState<'all' | Risk>('all');
  const [openCase, setOpenCase] = useState<RetentionCase | null>(null);
  const { toasts, push, dismiss } = useToasts();

  const filtered = useMemo(() => {
    let rows = cases;
    if (riskFilter !== 'all') rows = rows.filter((c) => c.risk === riskFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((c) =>
        `${c.company} ${c.carrierId} ${c.owner} ${c.competitor}`.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [cases, riskFilter, search]);

  const activeCount = cases.filter((c) => c.stage !== 'saved' && c.stage !== 'lost').length;
  const savedThisMonth = cases.filter((c) => c.stage === 'saved').length;

  function markChurned(id: string) {
    setCases((prev) => prev.map((c) => (c.id === id ? { ...c, stage: 'lost', days: 0 } : c)));
    setOpenCase(null);
    push('error', 'Marked churned');
  }

  function advance(id: string) {
    setCases((prev) =>
      prev.map((c) => {
        if (c.id !== id) return c;
        const next = nextStage(c.stage);
        return { ...c, stage: next, days: 0 };
      }),
    );
    const target = cases.find((c) => c.id === id);
    const landedOnSaved = target ? nextStage(target.stage) === 'saved' : false;
    if (landedOnSaved) setOpenCase(null);
    push('success', 'Case advanced');
  }

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Retention Cases</h2>
          <p className="text-sm text-muted-foreground">
            {activeCount} active cases · {savedThisMonth} saved this month
          </p>
        </div>
        <button
          type="button"
          onClick={() => push('info', 'Refreshed')}
          className="flex size-8 flex-none items-center justify-center rounded-xs border bg-card text-muted-foreground hover:text-foreground"
          aria-label="Refresh"
        >
          <RefreshCw className="size-4" />
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, carrier ID, owner, competitor…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={RISK_FILTERS} value={riskFilter} onChange={(id) => setRiskFilter(id as 'all' | Risk)} />
      </div>

      <div className="flex gap-3 overflow-x-auto pb-2">
        {KANBAN_COLUMNS.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            cases={filtered.filter((c) => c.stage === stage)}
            onOpen={setOpenCase}
          />
        ))}
      </div>

      {openCase ? (
        <CaseDetail
          case={openCase}
          onClose={() => setOpenCase(null)}
          onMarkChurned={markChurned}
          onAdvance={advance}
        />
      ) : null}

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

function KanbanColumn({
  stage,
  cases,
  onOpen,
}: {
  stage: Stage;
  cases: RetentionCase[];
  onOpen: (c: RetentionCase) => void;
}) {
  const meta = STAGE_META[stage];
  return (
    <div
      className="flex w-72 flex-none flex-col gap-2.5 rounded-xs border-t-2 bg-card/60 p-2.5"
      style={{ borderTopColor: meta.colorVar }}
    >
      <div className="flex items-center justify-between px-1">
        <span className="font-heading text-xs font-bold tracking-wide uppercase">{meta.label}</span>
        <span className="rounded-xs border bg-secondary px-1.5 py-0.5 font-mono text-[10px] font-semibold text-secondary-foreground">
          {cases.length}
        </span>
      </div>
      <div className="flex flex-col gap-2">
        {cases.length === 0 ? (
          <div className="rounded-xs border border-dashed p-4 text-center text-[11px] text-muted-foreground">
            No cases
          </div>
        ) : (
          cases.map((c) => <CaseCard key={c.id} c={c} onOpen={onOpen} />)
        )}
      </div>
    </div>
  );
}

function CaseCard({ c, onOpen }: { c: RetentionCase; onOpen: (c: RetentionCase) => void }) {
  return (
    <button
      type="button"
      onClick={() => onOpen(c)}
      className="flex flex-col gap-2.5 rounded-xs border bg-card p-3 text-left shadow-sm hover:border-primary/40"
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">{c.company}</div>
          <div className="font-mono text-[11px] text-muted-foreground">{c.carrierId}</div>
        </div>
        <StatusBadge tone={riskTone(c.risk)} className="flex-none uppercase">
          {c.risk}
        </StatusBadge>
      </div>

      <p className="line-clamp-2 text-xs text-muted-foreground">{c.reason}</p>

      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className="flex size-5 flex-none items-center justify-center rounded-full bg-primary/15 text-[9px] font-bold text-primary">
            {initials(c.owner)}
          </span>
          {c.competitor ? (
            <span className="flex items-center gap-0.5 truncate rounded-xs bg-secondary px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <Zap className="size-2.5" />
              {c.competitor}
            </span>
          ) : null}
        </div>
        <span className={`flex-none font-mono text-sm font-bold ${MRR_CLASS[mrrTone(c.mrr)]}`}>
          {fmtMrr(c.mrr)}
        </span>
      </div>

      <div className="flex items-center justify-between border-t pt-2 text-[10.5px]">
        <span className="text-muted-foreground">Last txn {c.lastTx}</span>
        <span className={`flex items-center gap-1 font-semibold ${daysToneClass(c.days)}`}>
          <Clock className="size-3" />
          {c.days}d
        </span>
      </div>
    </button>
  );
}
