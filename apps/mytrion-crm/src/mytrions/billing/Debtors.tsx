import { useMemo, useState } from 'react';
import { AlertTriangle, DollarSign, Users } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { DEBTORS, type Debtor, fmtCurrency } from './data';

const selectClass =
  'rounded-xs border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground outline-none focus:border-primary/55';

export function Debtors() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [age, setAge] = useState('all');
  const [openDebtor, setOpenDebtor] = useState<Debtor | null>(null);

  const filtered = useMemo(() => {
    let rows = DEBTORS;
    if (status === 'pending') rows = rows.filter((d) => d.worstStatus !== 'partially_paid');
    else if (status === 'partial') rows = rows.filter((d) => d.worstStatus === 'partially_paid');
    if (age === 'hard') rows = rows.filter((d) => d.isHard);
    else if (age === 'recent') rows = rows.filter((d) => !d.isHard);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((d) => `${d.carrierId} ${d.company}`.toLowerCase().includes(q));
    return [...rows].sort((a, b) => b.totalRemaining - a.totalRemaining);
  }, [status, age, search]);

  const totalDebt = DEBTORS.reduce((s, d) => s + d.totalRemaining, 0);
  const hardCount = DEBTORS.filter((d) => d.isHard).length;

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Debtors Dashboard</h2>
        <p className="text-sm text-muted-foreground">Company-wide accounts with pending or partial payments</p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={DollarSign} value={fmtCurrency(totalDebt)} label="Total Debt" tint="bad" />
        <StatCard icon={Users} value={String(DEBTORS.length)} label="Total Debtors" tint="primary" />
        <StatCard icon={AlertTriangle} value={String(hardCount)} label="Hard Debtors · ≥15d" tint="warn" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search Carrier ID or Company…"
          className="max-w-xs flex-1"
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectClass}>
          <option value="all">All Statuses</option>
          <option value="pending">Pending</option>
          <option value="partial">Partial</option>
        </select>
        <select value={age} onChange={(e) => setAge(e.target.value)} className={selectClass}>
          <option value="all">All Ages</option>
          <option value="hard">Hard Debt (≥15d)</option>
          <option value="recent">Recent (&lt;15d)</option>
        </select>
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        {/* min-w keeps the 8-column grid (incl. the Remaining $ figure) from squishing on
            phones; overflow-x-auto on the wrapper above makes it swipeable instead of clipping it. */}
        <div className="min-w-200">
          <div className="grid grid-cols-[0.9fr_1.8fr_1fr_0.9fr_0.9fr_0.7fr_1fr_1fr] gap-2.5 border-b bg-muted/40 px-4 py-2.5 text-[9.5px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Carrier</span>
            <span>Company</span>
            <span>Cycle</span>
            <span>Status</span>
            <span>Oldest</span>
            <span>Inv</span>
            <span>Owed</span>
            <span className="text-right">Remaining</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No debtors match your search.</div>
          ) : (
            filtered.map((d) => (
              <button
                key={d.carrierId}
                onClick={() => setOpenDebtor(d)}
                className="grid w-full grid-cols-[0.9fr_1.8fr_1fr_0.9fr_0.9fr_0.7fr_1fr_1fr] items-center gap-2.5 border-b px-4 py-3 text-left text-xs last:border-b-0 hover:bg-muted/40"
              >
                <span className="font-mono font-semibold text-primary">{d.carrierId}</span>
                <span className="truncate font-semibold text-sm">{d.company}</span>
                <span className="text-muted-foreground">{d.cycle || '—'}</span>
                <span>
                  <StatusBadge tone={d.worstStatus === 'partially_paid' ? 'warn' : 'bad'}>
                    {d.worstStatus === 'partially_paid' ? 'Partial' : 'Pending'}
                  </StatusBadge>
                </span>
                <span className={`font-mono font-semibold ${d.isHard ? 'text-bad' : 'text-warn'}`}>{d.age}d</span>
                <span className="font-mono text-muted-foreground">{d.invoiceCount}</span>
                <span className="font-mono text-muted-foreground">{fmtCurrency(d.totalOwed)}</span>
                <span className="text-right font-mono font-bold text-bad">{fmtCurrency(d.totalRemaining)}</span>
              </button>
            ))
          )}
          {filtered.length > 0 ? (
            <div className="border-t bg-muted/40 px-4 py-2.5 text-[10.5px] text-muted-foreground">
              Showing {filtered.length} of {DEBTORS.length} debtors
            </div>
          ) : null}
        </div>
      </div>

      {openDebtor ? <DebtorDetail debtor={openDebtor} onClose={() => setOpenDebtor(null)} /> : null}
    </div>
  );
}

function DebtorDetail({ debtor, onClose }: { debtor: Debtor; onClose: () => void }) {
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={debtor.company}
      subtitle={`Carrier #${debtor.carrierId}`}
      badges={
        <StatusBadge tone={debtor.worstStatus === 'partially_paid' ? 'warn' : 'bad'}>
          {debtor.worstStatus === 'partially_paid' ? 'Partial' : 'Pending'}
        </StatusBadge>
      }
      footer={
        <button onClick={onClose} className="rounded-xs border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Close
        </button>
      }
    >
      <div className="mb-5 flex flex-wrap gap-6 border-b pb-4">
        <div>
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Total Remaining</div>
          <div className="font-mono text-xl font-bold text-bad">{fmtCurrency(debtor.totalRemaining)}</div>
        </div>
        <div>
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Oldest Debt</div>
          <div className={`text-lg font-bold ${debtor.isHard ? 'text-bad' : 'text-warn'}`}>{debtor.age} days</div>
        </div>
        <div>
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Status</div>
          <StatusBadge tone={debtor.worstStatus === 'partially_paid' ? 'warn' : 'bad'}>
            {debtor.worstStatus === 'partially_paid' ? 'Partial' : 'Pending'}
          </StatusBadge>
        </div>
      </div>
      <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-muted-foreground uppercase">
        Invoices ({debtor.invoiceCount})
      </div>
      <div className="flex flex-col gap-2">
        {debtor.invoices.map((iv) => (
          <div
            key={iv.num}
            className={`grid grid-cols-4 gap-2.5 rounded-xs border bg-muted/30 p-3 text-xs ${iv.age >= 15 ? 'border-bad/30' : ''}`}
          >
            <div>
              <div className="font-mono font-bold">#{iv.num}</div>
              <div className="mt-0.5 text-[10px] text-muted-foreground">{iv.created}</div>
            </div>
            <div>
              <div className="text-[9.5px] text-muted-foreground uppercase">Age</div>
              <div className={`font-semibold ${iv.age >= 15 ? 'text-bad' : 'text-warn'}`}>{iv.age}d</div>
            </div>
            <div>
              <div className="text-[9.5px] text-muted-foreground uppercase">Total</div>
              <div className="font-mono font-semibold">{fmtCurrency(iv.total)}</div>
            </div>
            <div className="text-right">
              <div className="text-[9.5px] text-muted-foreground uppercase">Remaining</div>
              <div className="font-mono font-bold text-bad">{fmtCurrency(iv.remaining)}</div>
            </div>
          </div>
        ))}
      </div>
    </DetailDialog>
  );
}
