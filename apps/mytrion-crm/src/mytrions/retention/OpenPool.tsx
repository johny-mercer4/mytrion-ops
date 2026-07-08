import { useMemo, useState } from 'react';
import { RefreshCw, UserPlus } from 'lucide-react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  POOL,
  POOL_ASSIGN_TONE,
  type PoolAssignment,
  type PoolRow,
  poolCountByAssign,
} from './data';
import { Toast, useToasts } from './Toast';

const ASSIGN_FILTERS: { id: string; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'Available', label: 'Available' },
  { id: 'Requested', label: 'Requested' },
  { id: 'Assigned', label: 'Assigned' },
  { id: 'Rejected', label: 'Rejected' },
];

export function OpenPool() {
  const [pool, setPool] = useState<PoolRow[]>(POOL);
  const [search, setSearch] = useState('');
  const [assignFilter, setAssignFilter] = useState<'all' | PoolAssignment>('all');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const { toasts, push, dismiss } = useToasts();

  const filtered = useMemo(() => {
    let rows = pool;
    if (assignFilter !== 'all') rows = rows.filter((r) => r.assign === assignFilter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((r) => `${r.company} ${r.carrierId} ${r.fullName}`.toLowerCase().includes(q));
    return rows;
  }, [pool, assignFilter, search]);

  function toggleRow(id: string, row: PoolRow) {
    if (row.assign !== 'Available') return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function assignToMe() {
    if (selected.size === 0) return;
    const n = selected.size;
    setPool((prev) =>
      prev.map((r) => (selected.has(r.id) ? { ...r, assign: 'Assigned' as const, takenBy: 'You' } : r)),
    );
    setSelected(new Set());
    push('success', `${n} client(s) claimed into your retention queue.`);
  }

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="font-heading text-2xl font-bold">Open Pool</h2>
            <span className="rounded-xs border bg-secondary px-1.5 py-0.5 text-[10px] font-bold tracking-wide text-secondary-foreground uppercase">
              Deal Assignment
            </span>
          </div>
          <p className="text-sm text-muted-foreground">{pool.length} dormant clients · claim to your queue</p>
        </div>
        <div className="flex flex-none items-center gap-2">
          <Button disabled={selected.size === 0} onClick={assignToMe}>
            <UserPlus className="size-3.5" />
            Assign to Me{selected.size > 0 ? ` (${selected.size})` : ''}
          </Button>
          <button
            type="button"
            onClick={() => push('info', 'Refreshed')}
            className="flex size-8 flex-none items-center justify-center rounded-xs border bg-card text-muted-foreground hover:text-foreground"
            aria-label="Refresh"
          >
            <RefreshCw className="size-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatPill label="Total" value={pool.length} tone="neutral" />
        <StatPill label="Available" value={poolCountByAssign(pool, 'Available')} tone="good" />
        <StatPill label="Requested" value={poolCountByAssign(pool, 'Requested')} tone="info" />
        <StatPill label="Assigned" value={poolCountByAssign(pool, 'Assigned')} tone="warn" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company, carrier ID, full name…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={ASSIGN_FILTERS} value={assignFilter} onChange={(id) => setAssignFilter(id as 'all' | PoolAssignment)} />
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        {/* 11 columns — min-w + overflow-x-auto wrapper keeps this swipeable on phones
            instead of clipping the trailing columns (Billing DataCenter/Debtors pattern). */}
        <div className="min-w-270">
          <div className="grid grid-cols-[28px_32px_1fr_1.6fr_1.3fr_1.1fr_1fr_1.6fr_0.6fr_0.9fr_1fr] gap-2.5 border-b bg-muted/40 px-4 py-2.5 text-[9.5px] font-bold tracking-wide text-muted-foreground uppercase">
            <span />
            <span>#</span>
            <span>Carrier ID</span>
            <span>Company</span>
            <span>Full Name</span>
            <span>Assignment</span>
            <span>Last Txn</span>
            <span>Inactivity Reason</span>
            <span>Cards</span>
            <span>Status</span>
            <span>Taken By</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No pool rows match your search.</div>
          ) : (
            filtered.map((r, i) => {
              const isAvailable = r.assign === 'Available';
              const isSelected = selected.has(r.id);
              return (
                <div
                  key={r.id}
                  className={`grid grid-cols-[28px_32px_1fr_1.6fr_1.3fr_1.1fr_1fr_1.6fr_0.6fr_0.9fr_1fr] items-center gap-2.5 border-b px-4 py-3 text-left text-xs last:border-b-0 ${
                    isAvailable ? 'hover:bg-muted/40' : 'opacity-50'
                  } ${isSelected ? 'bg-primary/10' : ''}`}
                >
                  <span>
                    <input
                      type="checkbox"
                      checked={isSelected}
                      disabled={!isAvailable}
                      onChange={() => toggleRow(r.id, r)}
                      aria-label={`Select ${r.company}`}
                      className="size-3.5 accent-[var(--accent)] disabled:cursor-not-allowed"
                    />
                  </span>
                  <span className="text-muted-foreground">{i + 1}</span>
                  <span className="font-mono font-semibold text-primary">{r.carrierId}</span>
                  <span className="truncate text-sm font-semibold">{r.company}</span>
                  <span className="truncate text-muted-foreground">{r.fullName}</span>
                  <span>
                    <StatusBadge tone={POOL_ASSIGN_TONE[r.assign]}>{r.assign}</StatusBadge>
                  </span>
                  <span className="text-muted-foreground">{r.lastTx}</span>
                  <span className="truncate text-muted-foreground">{r.reason}</span>
                  <span className="font-mono">{r.cards}</span>
                  <span>
                    <StatusBadge tone={r.status === 'Active' ? 'good' : 'bad'}>{r.status}</StatusBadge>
                  </span>
                  <span className="truncate text-muted-foreground">{r.takenBy || '—'}</span>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2">
        {toasts.map((t) => (
          <Toast key={t.id} toast={t} onDismiss={dismiss} />
        ))}
      </div>
    </div>
  );
}

function StatPill({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: 'neutral' | 'good' | 'info' | 'warn';
}) {
  const toneClass: Record<typeof tone, string> = {
    neutral: 'text-foreground',
    good: 'text-good',
    info: 'text-primary',
    warn: 'text-warn',
  };
  return (
    <div className="flex items-center gap-2.5 rounded-xs border bg-card px-3.5 py-2.5">
      <span className={`font-heading text-xl font-bold ${toneClass[tone]}`}>{value}</span>
      <span className="text-[10.5px] tracking-wide text-muted-foreground uppercase">{label}</span>
    </div>
  );
}
