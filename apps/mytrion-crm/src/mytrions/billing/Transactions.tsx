import { useMemo, useState } from 'react';
import { Banknote, CheckSquare, ListChecks, XCircle } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import {
  TRANSACTIONS,
  type Transaction,
  dateFull,
  dateLabel,
  fmtCurrency,
  srcLabel,
  srcLong,
} from './data';

const SOURCE_OPTIONS = ['all', 'zelle', 'chase', 'mx', 'stripe', 'ach', 'wire', 'check', 'card'];
const selectClass =
  'rounded-xs border bg-card px-3 py-2 text-xs font-semibold text-muted-foreground outline-none focus:border-primary/55';

export function Transactions() {
  const [search, setSearch] = useState('');
  const [source, setSource] = useState('all');
  const [carrierFilter, setCarrierFilter] = useState('all');
  const [openTx, setOpenTx] = useState<Transaction | null>(null);

  const filtered = useMemo(() => {
    let rows = TRANSACTIONS;
    if (source !== 'all') rows = rows.filter((t) => t.source === source);
    if (carrierFilter === 'mapped') rows = rows.filter((t) => t.carrierId && !t.isInvoiceMapped);
    else if (carrierFilter === 'invoice') rows = rows.filter((t) => t.isInvoiceMapped);
    else if (carrierFilter === 'unmapped') rows = rows.filter((t) => !t.carrierId);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((t) =>
        `${t.sender} ${t.memo ?? ''} ${t.txn} ${t.carrierId ?? ''}`.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [search, source, carrierFilter]);

  const groups = useMemo(() => {
    const map = new Map<string, Transaction[]>();
    filtered.forEach((t) => {
      const arr = map.get(t.postingDate) ?? [];
      arr.push(t);
      map.set(t.postingDate, arr);
    });
    // Newest date group first; relies on postingDate being ISO yyyy-mm-dd (lexicographic == chronological).
    return Array.from(map.entries()).sort((a, b) => (a[0] < b[0] ? 1 : -1));
  }, [filtered]);

  const total = filtered.reduce((s, t) => s + t.amount, 0);
  const mapped = filtered.filter((t) => t.isInvoiceMapped).length;
  const unmapped = filtered.filter((t) => !t.carrierId).length;

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Payment Transactions</h2>
        <p className="text-sm text-muted-foreground">{TRANSACTIONS.length} total records · live ledger</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={ListChecks} value={String(filtered.length)} label="Results" tint="primary" />
        <StatCard icon={Banknote} value={fmtCurrency(total)} label="Total Amount" tint="good" />
        <StatCard icon={CheckSquare} value={String(mapped)} label="Invoice Mapped" tint="primary" />
        <StatCard icon={XCircle} value={String(unmapped)} label="Unmapped" tint="bad" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search sender, memo, transaction #…"
          className="max-w-sm flex-1"
        />
        <select value={source} onChange={(e) => setSource(e.target.value)} className={selectClass}>
          {SOURCE_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s === 'all' ? 'All Sources' : srcLong(s as Transaction['source'])}
            </option>
          ))}
        </select>
        <select value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)} className={selectClass}>
          <option value="all">All Carriers</option>
          <option value="mapped">Carrier Matched</option>
          <option value="invoice">Invoice Mapped</option>
          <option value="unmapped">Unmapped</option>
        </select>
      </div>

      <div className="flex flex-col gap-3.5">
        {groups.length === 0 ? (
          <div className="rounded-xs border bg-card p-10 text-center text-sm text-muted-foreground">
            No transactions found. Try adjusting your search or filters.
          </div>
        ) : (
          groups.map(([date, items]) => (
            <div key={date}>
              <div className="mb-2 flex items-center gap-2 px-0.5">
                <span className="font-heading text-xs font-bold tracking-wide text-foreground uppercase">
                  {dateLabel(date)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {items.length} txn · {fmtCurrency(items.reduce((s, t) => s + t.amount, 0))}
                </span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="overflow-hidden rounded-xs border bg-card">
                {items.map((t) => (
                  <button
                    key={t.recordId}
                    onClick={() => setOpenTx(t)}
                    className="flex w-full items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                  >
                    <span className="min-w-13 flex-none rounded-xs bg-secondary px-1.5 py-1 text-center font-mono text-[9px] font-extrabold tracking-wide text-secondary-foreground uppercase">
                      {srcLabel(t.source)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-semibold">{t.sender}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {t.memo ? `${t.memo} · ` : ''}
                        <span className="font-mono opacity-70">#{t.txn}</span>
                      </div>
                    </div>
                    {t.isInvoiceMapped ? (
                      <StatusBadge tone="info">Invoice Mapped</StatusBadge>
                    ) : t.carrierId ? (
                      <StatusBadge tone="good">#{t.carrierId}</StatusBadge>
                    ) : (
                      <StatusBadge tone="neutral">Unmapped</StatusBadge>
                    )}
                    <div className="flex-none text-right">
                      <div className="font-mono text-sm font-bold text-good">{fmtCurrency(t.amount)}</div>
                      <div className="text-[10px] text-muted-foreground">{t.time}</div>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ))
        )}
      </div>

      {openTx ? <TransactionDetail tx={openTx} onClose={() => setOpenTx(null)} /> : null}
    </div>
  );
}

function TransactionDetail({ tx, onClose }: { tx: Transaction; onClose: () => void }) {
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tx.sender}
      subtitle={`${srcLong(tx.source)} · ${dateFull(tx.postingDate)}`}
      size="md"
      badges={<StatusBadge tone="good">{fmtCurrency(tx.amount)}</StatusBadge>}
      footer={
        <button onClick={onClose} className="rounded-xs border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Close
        </button>
      }
    >
      <div className="flex flex-col gap-3.5">
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Transaction Details
          </div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Transaction #" v={<span className="font-mono">{tx.txn}</span>} />
            {tx.memo ? <Row k="Memo" v={tx.memo} /> : null}
            {tx.status ? <Row k="Status" v={tx.status} /> : null}
            <Row k="Record ID" v={<span className="font-mono text-muted-foreground">{tx.recordId}</span>} />
            <Row k="Source" v={srcLong(tx.source)} />
            <Row k="Posting Date" v={dateFull(tx.postingDate)} />
            <Row k="Amount" v={<span className="font-mono font-bold text-good">{fmtCurrency(tx.amount)}</span>} />
          </dl>
        </section>
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Carrier Assignment
          </div>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Status</span>
            <StatusBadge tone={tx.carrierId ? 'good' : 'bad'}>
              {tx.carrierId ? `Matched · ${tx.carrierId}` : 'Unmatched'}
            </StatusBadge>
          </div>
        </section>
      </div>
    </DetailDialog>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between border-b py-1.5 last:border-b-0">
      <span className="text-xs text-muted-foreground">{k}</span>
      <span className="text-right text-[13px] font-semibold">{v}</span>
    </div>
  );
}
