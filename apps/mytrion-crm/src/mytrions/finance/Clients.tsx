import { useMemo, useState } from 'react';
import { Fuel, RefreshCw, Users, Wallet, XCircle } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  CLIENTS,
  type Client,
  type ClientFuel,
  type ClientInvoice,
  type ClientPayment,
  activeClientCount,
  debtorClientCount,
  dateFull,
  fmtCurrency,
  fueledRecentCount,
  suspendedCount,
} from './data';

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'inactive', label: 'Inactive' },
];

const TERMS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'LOC', label: 'LOC' },
  { id: 'Prepay', label: 'Prepay' },
  { id: 'WEX', label: 'WEX' },
];

const INV_TONE: Record<ClientInvoice['st'], StatusTone> = { PAID: 'good', OVERDUE: 'bad', PARTIALLY_PAID: 'warn' };
const INV_LABEL: Record<ClientInvoice['st'], string> = { PAID: 'Paid', OVERDUE: 'Overdue', PARTIALLY_PAID: 'Partial' };

function initials(company: string): string {
  return company
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
}

export function Clients() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [terms, setTerms] = useState('all');
  const [suspendedOnly, setSuspendedOnly] = useState(false);
  const [debtorOnly, setDebtorOnly] = useState(false);
  const [openClient, setOpenClient] = useState<Client | null>(null);

  const filtered = useMemo(() => {
    let rows = CLIENTS;
    if (status === 'active') rows = rows.filter((c) => c.active);
    else if (status === 'inactive') rows = rows.filter((c) => !c.active);
    if (terms !== 'all') rows = rows.filter((c) => c.terms === terms);
    if (suspendedOnly) rows = rows.filter((c) => c.suspended);
    if (debtorOnly) rows = rows.filter((c) => c.debt > 0);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((c) => `${c.company} ${c.carrier}`.toLowerCase().includes(q));
    return rows;
  }, [search, status, terms, suspendedOnly, debtorOnly]);

  const isFiltered = status !== 'all' || terms !== 'all' || suspendedOnly || debtorOnly || search.trim() !== '';

  function clearFilters() {
    setStatus('all');
    setTerms('all');
    setSuspendedOnly(false);
    setDebtorOnly(false);
    setSearch('');
  }

  const inactiveCount = CLIENTS.length - activeClientCount();

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Clients</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length} of {CLIENTS.length} clients{isFiltered ? ' · filtered' : ''}
          </p>
        </div>
        <Button variant="outline" size="sm">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Users} value={String(activeClientCount())} label={`${inactiveCount} inactive`} tint="good" />
        <StatCard
          icon={Wallet}
          value={fmtCurrency(CLIENTS.reduce((s, c) => s + c.debt, 0))}
          label={`${debtorClientCount()} debtors`}
          tint="bad"
        />
        <StatCard icon={XCircle} value={String(suspendedCount())} label="LOC Suspended" tint="warn" />
        <StatCard icon={Fuel} value={String(fueledRecentCount())} label="Fueled (30d)" tint="purple" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or carrier ID…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={STATUS_FILTERS} value={status} onChange={setStatus} />
        <SegmentedFilter options={TERMS_FILTERS} value={terms} onChange={setTerms} />
        <ToggleChip active={suspendedOnly} label="Suspended" onClick={() => setSuspendedOnly((v) => !v)} />
        <ToggleChip active={debtorOnly} label="Debtor" onClick={() => setDebtorOnly((v) => !v)} />
        {isFiltered ? (
          <button onClick={clearFilters} className="text-xs font-semibold text-primary hover:underline">
            Clear
          </button>
        ) : null}
      </div>

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
            No clients found. Try adjusting your search or filters.
          </div>
        ) : (
          filtered.map((c) => {
            const avatarClass = c.suspended ? 'bg-bad/14 text-bad' : c.active ? 'bg-primary/14 text-primary' : 'bg-muted text-muted-foreground';
            return (
              <button
                key={c.carrier}
                onClick={() => setOpenClient(c)}
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left text-sm shadow-sm hover:border-primary/45 hover:bg-muted/40"
              >
                <span className={`flex size-9 flex-none items-center justify-center rounded-full text-xs font-bold ${avatarClass}`}>
                  {initials(c.company)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{c.company}</div>
                  <div className={`truncate text-[11px] ${c.debt > 0 ? 'text-bad' : 'text-muted-foreground'}`}>
                    #{c.carrier} · DOT {c.dot} · {c.city}, {c.state}
                    {c.debt > 0 ? ` · ${c.debtDays}d overdue · ${c.overdue} inv` : ''}
                  </div>
                </div>
                {c.suspended ? <StatusBadge tone="bad">SUSPENDED</StatusBadge> : null}
                {c.wex ? <StatusBadge tone="info">WEX</StatusBadge> : null}
                <StatusBadge tone={c.terms === 'LOC' ? 'info' : c.terms === 'Prepay' ? 'good' : 'neutral'}>{c.terms}</StatusBadge>
                <StatusBadge tone={c.active ? 'good' : 'neutral'}>{c.active ? 'Active' : 'Inactive'}</StatusBadge>
                <span className={`min-w-20 flex-none text-right font-mono text-sm font-bold ${c.debt > 0 ? 'text-bad' : 'text-muted-foreground'}`}>
                  {c.debt > 0 ? fmtCurrency(c.debt) : c.credit === 'WEX' ? 'WEX' : c.credit || '—'}
                </span>
              </button>
            );
          })
        )}
      </div>

      {openClient ? <ClientDrilldown client={openClient} onClose={() => setOpenClient(null)} /> : null}
    </div>
  );
}

function ToggleChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      data-active={active}
      className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
        active ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
      }`}
    >
      {label}
    </button>
  );
}

type DrillTab = 'invoices' | 'payments' | 'fuel' | 'info';

function ClientDrilldown({ client, onClose }: { client: Client; onClose: () => void }) {
  const [tab, setTab] = useState<DrillTab>('invoices');
  const tabs: { id: DrillTab; label: string; count: number }[] = [
    { id: 'invoices', label: 'Invoices', count: client.invoices.length },
    { id: 'payments', label: 'Payments', count: client.payments.length },
    { id: 'fuel', label: 'Recent Fuel', count: client.fuel.length },
    { id: 'info', label: 'Info', count: 0 },
  ];

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={client.company}
      subtitle={`#${client.carrier} · ${client.city}, ${client.state}`}
      size="xl"
      badges={
        <>
          <StatusBadge tone={client.terms === 'LOC' ? 'info' : client.terms === 'Prepay' ? 'good' : 'neutral'}>{client.terms}</StatusBadge>
          {client.suspended ? <StatusBadge tone="bad">SUSPENDED</StatusBadge> : null}
          {client.wex ? <StatusBadge tone="info">WEX FUNDED</StatusBadge> : null}
        </>
      }
      footer={
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Close
        </button>
      }
    >
      <div className="mb-4 grid grid-cols-3 gap-3 border-b pb-4">
        <div>
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Total Billed</div>
          <div className="font-mono text-lg font-bold">{fmtCurrency(client.summary.billed)}</div>
        </div>
        <div>
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Paid · {client.summary.paidCount}</div>
          <div className="font-mono text-lg font-bold text-good">{fmtCurrency(client.summary.paid)}</div>
        </div>
        <div>
          <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Open · {client.summary.openCount}</div>
          <div className={`font-mono text-lg font-bold ${client.summary.open > 0 ? 'text-bad' : 'text-muted-foreground'}`}>
            {fmtCurrency(client.summary.open)}
          </div>
        </div>
      </div>

      <div className="mb-4 flex gap-1 border-b">
        {tabs.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={`px-3 py-2 text-xs font-bold ${
              tab === t.id ? 'border-b-2 border-primary text-primary' : 'text-muted-foreground hover:text-foreground'
            }`}
          >
            {t.label}
            {t.count > 0 ? ` (${t.count})` : ''}
          </button>
        ))}
      </div>

      {tab === 'invoices' ? <InvoicesTab invoices={client.invoices} /> : null}
      {tab === 'payments' ? <PaymentsTab payments={client.payments} /> : null}
      {tab === 'fuel' ? <FuelTab fuel={client.fuel} /> : null}
      {tab === 'info' ? <InfoTab client={client} /> : null}
    </DetailDialog>
  );
}

function InvoicesTab({ invoices }: { invoices: ClientInvoice[] }) {
  if (invoices.length === 0) return <div className="text-sm text-muted-foreground">No invoices on record.</div>;
  return (
    <div className="overflow-x-auto">
      <div className="min-w-140">
        <div className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] gap-2.5 border-b px-2 py-2 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
          <span>Invoice</span>
          <span>Due</span>
          <span>Status</span>
          <span className="text-right">Total</span>
          <span className="text-right">Paid</span>
          <span className="text-right">Open</span>
        </div>
        {invoices.map((iv) => (
          <div key={iv.n} className="grid grid-cols-[1.4fr_1fr_1fr_1fr_1fr_1fr] items-center gap-2.5 border-b px-2 py-2.5 text-xs last:border-b-0">
            <div>
              <div className="font-mono font-semibold">{iv.n}</div>
              {iv.over > 0 ? <div className="text-[10px] font-semibold text-bad">{iv.over}d overdue</div> : null}
            </div>
            <span className="text-muted-foreground">{dateFull(iv.due)}</span>
            <span>
              <StatusBadge tone={INV_TONE[iv.st]}>{INV_LABEL[iv.st]}</StatusBadge>
            </span>
            <span className="text-right font-mono">{fmtCurrency(iv.total)}</span>
            <span className="text-right font-mono text-good">{fmtCurrency(iv.paid)}</span>
            <span className={`text-right font-mono font-bold ${iv.open > 0 ? 'text-bad' : 'text-muted-foreground'}`}>{fmtCurrency(iv.open)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function PaymentsTab({ payments }: { payments: ClientPayment[] }) {
  if (payments.length === 0) return <div className="text-sm text-muted-foreground">No payments on record.</div>;
  return (
    <div className="flex flex-col gap-2">
      {payments.map((p, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
          <span className="min-w-13 flex-none rounded-md bg-secondary px-1.5 py-1 text-center font-mono text-[9px] font-extrabold tracking-wide text-secondary-foreground uppercase">
            {p.src}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{p.det}</div>
            <div className="text-[10px] text-muted-foreground">
              {dateFull(p.date)} · <StatusBadge tone="good">{p.st}</StatusBadge>
            </div>
          </div>
          <span className="font-mono font-bold text-good">{fmtCurrency(p.amt)}</span>
        </div>
      ))}
    </div>
  );
}

function FuelTab({ fuel }: { fuel: ClientFuel[] }) {
  if (fuel.length === 0) return <div className="text-sm text-muted-foreground">No fuel history on record.</div>;
  return (
    <div className="flex flex-col gap-2">
      {fuel.map((f, i) => (
        <div key={i} className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2.5 text-xs">
          <span className="flex size-8 flex-none items-center justify-center rounded-md bg-primary/12 text-primary">
            <Fuel className="size-3.5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate font-semibold">{f.loc}</div>
            <div className="text-[10px] text-muted-foreground">
              {dateFull(f.date)} · {f.grade} · {fmtCurrency(f.ppu)}/gal
            </div>
          </div>
          <span className="rounded-md bg-warn/12 px-1.5 py-0.5 text-center font-mono text-[10.5px] font-bold text-warn">{f.gal.toFixed(2)} gal</span>
          <span className="min-w-16 flex-none text-right font-mono font-bold">{fmtCurrency(f.amt)}</span>
        </div>
      ))}
    </div>
  );
}

function InfoTab({ client }: { client: Client }) {
  return (
    <div className="flex flex-col gap-4">
      <section>
        <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Company</div>
        <dl className="flex flex-col gap-1.5 text-sm">
          <Row k="Carrier ID" v={<span className="font-mono">{client.carrier}</span>} />
          <Row k="DOT" v={<span className="font-mono">{client.dot}</span>} />
          <Row k="Email" v={client.email} />
          <Row k="Phone" v={client.phone} />
          <Row k="Location" v={`${client.city}, ${client.state}`} />
        </dl>
      </section>
      <section>
        <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Sales</div>
        <dl className="flex flex-col gap-1.5 text-sm">
          <Row k="Agent" v={client.agent} />
          <Row k="Deal" v={client.deal} />
          <Row k="Stage" v={client.stage} />
          <Row k="Payment Terms" v={client.terms} />
        </dl>
      </section>
    </div>
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
