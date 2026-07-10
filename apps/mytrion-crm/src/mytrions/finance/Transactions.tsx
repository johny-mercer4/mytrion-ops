import { useMemo, useState } from 'react';
import { Droplets, Fuel, ListChecks, PiggyBank, RefreshCw } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  TRANSACTION_LINES,
  type TransactionLine,
  dateTimeFull,
  discountSaved,
  fmtCurrency,
  fundedTotal,
  maskCard,
  totalFuelGal,
  txCount,
} from './data';

const PERIOD_PRESETS = [
  { id: 'all', label: 'All' },
  { id: 'cycle', label: 'This Cycle' },
  { id: 'month', label: 'This Month' },
  { id: 'quarter', label: 'This Quarter' },
  { id: 'half', label: 'Half-Year' },
  { id: 'year', label: 'Year' },
];

export function Transactions() {
  const [search, setSearch] = useState('');
  const [period, setPeriod] = useState('all');
  const [openTx, setOpenTx] = useState<TransactionLine | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return TRANSACTION_LINES;
    return TRANSACTION_LINES.filter((t) => `${t.company} ${t.carrier}`.toLowerCase().includes(q));
  }, [search]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Transactions</h2>
          <p className="text-sm text-muted-foreground">
            {TRANSACTION_LINES.length} line items · {txCount()} transactions
          </p>
        </div>
        <Button variant="outline" size="sm">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={ListChecks} value={String(txCount())} label={`${TRANSACTION_LINES.length} line items`} tint="primary" />
        <StatCard icon={PiggyBank} value={fmtCurrency(fundedTotal())} label="Funded Total" tint="good" />
        <StatCard icon={Fuel} value={`${totalFuelGal().toFixed(0)} gal`} label="Total Fuel" tint="purple" />
        <StatCard icon={Droplets} value={fmtCurrency(discountSaved())} label="Discount Saved" tint="warn" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or carrier ID…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={PERIOD_PRESETS} value={period} onChange={setPeriod} />
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="min-w-160 divide-y">
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No transactions found. Try adjusting your search.
            </div>
          ) : (
            filtered.map((t, i) => (
              <button
                key={`${t.txId}-${i}`}
                onClick={() => setOpenTx(t)}
                className="flex w-full items-center gap-3 px-4 py-3 text-left text-sm hover:bg-muted/40"
              >
                <span className="flex size-9 flex-none items-center justify-center rounded-md bg-primary/12 text-primary">
                  <Fuel className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{t.company}</div>
                  <div className="truncate font-mono text-[11px] text-muted-foreground">
                    {t.txId} · {t.loc}, {t.state} · {dateTimeFull(t.date)}
                  </div>
                </div>
                <StatusBadge tone={t.grade === 'DEF' ? 'info' : 'neutral'}>{t.grade}</StatusBadge>
                <span className="min-w-16.5 flex-none rounded-md bg-warn/12 px-1.5 py-0.5 text-center font-mono text-[10.5px] font-bold text-warn">
                  {t.gal.toFixed(2)} gal
                </span>
                <span className="min-w-18.5 flex-none text-right font-mono text-sm font-bold text-primary">
                  {fmtCurrency(t.amount)}
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {openTx ? <TransactionDetail tx={openTx} onClose={() => setOpenTx(null)} /> : null}
    </div>
  );
}

function TransactionDetail({ tx, onClose }: { tx: TransactionLine; onClose: () => void }) {
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={tx.company}
      subtitle={`${tx.txId} · ${dateTimeFull(tx.date)}`}
      size="md"
      badges={
        <>
          <StatusBadge tone={tx.grade === 'DEF' ? 'info' : 'neutral'}>{tx.grade}</StatusBadge>
          <StatusBadge tone={tx.active ? 'good' : 'neutral'}>{tx.active ? 'Active' : 'Inactive'}</StatusBadge>
        </>
      }
      footer={
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Close
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Transaction</div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Line Amount" v={<span className="font-mono font-bold text-primary">{fmtCurrency(tx.amount)}</span>} />
            <Row k="Transaction Date" v={dateTimeFull(tx.date)} />
            <Row k="Carrier ID" v={<span className="font-mono">{tx.carrier}</span>} />
            <Row k="Card Number" v={<span className="font-mono">{maskCard(tx.card)}</span>} />
            <Row k="Payment Terms" v={tx.terms} />
            <Row k="Company Status" v={<StatusBadge tone={tx.active ? 'good' : 'neutral'}>{tx.active ? 'Active' : 'Inactive'}</StatusBadge>} />
          </dl>
        </section>
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Fuel</div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Fuel Grade" v={tx.grade} />
            <Row k="Quantity" v={`${tx.gal.toFixed(2)} gal`} />
            <Row k="Price/Unit" v={<span className="font-mono">{fmtCurrency(tx.ppu)}</span>} />
            <Row k="Retail Price" v={<span className="font-mono">{fmtCurrency(tx.retail)}</span>} />
            <Row k="Discount" v={<span className="font-mono font-bold text-good">−{fmtCurrency(tx.disc)}</span>} />
            <Row k="Location" v={`${tx.loc}, ${tx.state}`} />
          </dl>
        </section>
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Reference</div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Transaction ID" v={<span className="font-mono text-muted-foreground">{tx.txId}</span>} />
          </dl>
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
