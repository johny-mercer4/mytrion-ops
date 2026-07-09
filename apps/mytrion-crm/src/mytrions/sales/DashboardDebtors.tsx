import { useMemo, useState } from 'react';
import { AlertTriangle, RotateCw, Users, Wallet } from 'lucide-react';

import { callTouchpoint } from '@/api/touchpoints';
import { SearchBar } from '@/components/mytrion/search-bar';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { money, num, useLoad } from './live';

// mytriondbdebtorsinfo — the widget's Debtors dashboard: debtor cards with worst-status
// badge, hard-debtor pill (≥15 days), expandable invoice rows.

interface DebtorCard {
  key: string;
  company: string;
  carrierId: string;
  isHard: boolean;
  worstStatus: string;
  remaining: number;
  paid: number;
  owed: number;
  invoiceCount: number;
  maxDays: number;
  invoices: Array<Record<string, unknown>>;
}

function statusTone(status: string): StatusTone {
  if (/rejected/i.test(status)) return 'bad';
  if (/partial/i.test(status)) return 'warn';
  return 'info';
}

export function DashboardDebtors() {
  const load = useLoad(() => callTouchpoint('dashboard.debtors', {}), []);
  const [search, setSearch] = useState('');
  const [hardOnly, setHardOnly] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const debtors: DebtorCard[] = useMemo(
    () =>
      (load.data?.debtors ?? []).map((d, i) => ({
        key: `${d.carrier_id ?? i}`,
        company: String(d.company_name ?? d.deal_name ?? '(unnamed)'),
        carrierId: String(d.carrier_id ?? ''),
        isHard: Boolean(d.is_hard_debtor),
        worstStatus: String(d.worst_status ?? 'pending').replace(/_/g, ' '),
        remaining: Number(d.total_remaining ?? 0) || 0,
        paid: Number(d.total_paid ?? 0) || 0,
        owed: Number(d.total_owed ?? 0) || 0,
        invoiceCount: Number(d.invoice_count ?? d.invoices?.length ?? 0) || 0,
        maxDays: Number(d.max_debt_days ?? 0) || 0,
        invoices: d.invoices ?? [],
      })),
    [load.data],
  );

  const filtered = useMemo(() => {
    let out = debtors;
    if (hardOnly) out = out.filter((d) => d.isHard);
    const q = search.trim().toLowerCase();
    if (q) out = out.filter((d) => `${d.company} ${d.carrierId}`.toLowerCase().includes(q));
    return out;
  }, [debtors, hardOnly, search]);

  if (load.loading) {
    return <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">Loading debtors…</div>;
  }
  if (load.error) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm">
        <p className="text-bad">{load.error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load.reload}>
          Retry
        </Button>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        <StatCard icon={Users} value={num(load.data?.total_debtors ?? debtors.length)} label="Debtors" tint="warn" />
        <StatCard
          icon={AlertTriangle}
          value={num(load.data?.total_hard_debtors ?? debtors.filter((d) => d.isHard).length)}
          label="Hard Debtors (15d+)"
          tint="bad"
        />
        <StatCard
          icon={Wallet}
          value={money(load.data?.total_debt_amount ?? debtors.reduce((s, d) => s + d.remaining, 0))}
          label="Total Debt"
          tint="bad"
        />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or carrier ID…"
          className="max-w-sm flex-1"
        />
        <label className="flex items-center gap-2 text-xs font-semibold text-muted-foreground">
          <input type="checkbox" checked={hardOnly} onChange={(e) => setHardOnly(e.target.checked)} />
          Hard debtors only
        </label>
        <Button variant="ghost" size="sm" onClick={load.reload}>
          <RotateCw className="size-3.5" />
        </Button>
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          No debtors — clean book!
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {filtered.map((d) => (
            <div key={d.key} className="rounded-lg border bg-card p-4">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate font-semibold">{d.company}</div>
                  <div className="text-[10.5px] text-muted-foreground">#{d.carrierId}</div>
                </div>
                <div className="flex flex-none items-center gap-1.5">
                  {d.isHard ? <StatusBadge tone="bad">Hard · {d.maxDays}d</StatusBadge> : null}
                  <StatusBadge tone={statusTone(d.worstStatus)}>{d.worstStatus}</StatusBadge>
                </div>
              </div>
              <div className="font-heading mt-2 text-2xl font-bold text-bad">{money(d.remaining)}</div>
              <div className="mt-1 text-xs text-muted-foreground">
                {money(d.paid)} paid of {money(d.owed)} · {d.invoiceCount} invoice{d.invoiceCount === 1 ? '' : 's'}
              </div>
              {d.invoices.length > 0 ? (
                <button
                  className="mt-2 text-xs font-semibold text-primary hover:underline"
                  onClick={() => setExpanded(expanded === d.key ? null : d.key)}
                >
                  {expanded === d.key ? 'Hide invoices' : 'Show invoices'}
                </button>
              ) : null}
              {expanded === d.key ? (
                <div className="mt-2 flex flex-col gap-1.5">
                  {d.invoices.map((inv, i) => {
                    const r = inv as Record<string, unknown>;
                    return (
                      <div key={i} className="flex items-center justify-between rounded-md border bg-muted/30 px-2.5 py-1.5 text-xs">
                        <span className="font-mono">{String(r.invoice_id ?? '—')}</span>
                        <span className="text-muted-foreground">{String(r.status ?? '').replace(/_/g, ' ')}</span>
                        <span className="text-muted-foreground">{num(r.debt_days ?? 0)}d</span>
                        <span className="font-mono font-semibold">{money(r.remaining_amount ?? r.total_amount)}</span>
                      </div>
                    );
                  })}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
