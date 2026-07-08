import { useMemo, useState } from 'react';
import { CreditCard, FileText, Layers, PiggyBank } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  DEALS,
  type Deal,
  type PayType,
  type Verify,
  dateFull,
  debtorFor,
  fmtCurrency,
  payMeta,
  stageMeta,
  transactionsForCarrier,
} from './data';

const PAY_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'Line of Credit', label: 'Line of Credit' },
  { id: 'Prepay', label: 'Prepay' },
  { id: 'Deposit', label: 'Deposit' },
  { id: 'none', label: 'No Type' },
];

const PAY_OPTIONS: PayType[] = ['', 'Line of Credit', 'Prepay', 'Deposit'];
const CYCLE_OPTIONS = ['', 'Weekly', 'Bi-Weekly', 'Monthly', 'Bi-Monthly'];
const VERIFY_OPTIONS: Verify[] = ['', 'Verified', 'Pending', 'Failed'];

export function DataCenter() {
  const [deals, setDeals] = useState<Deal[]>(DEALS);
  const [search, setSearch] = useState('');
  const [payFilter, setPayFilter] = useState('all');
  const [openDeal, setOpenDeal] = useState<Deal | null>(null);
  const [editDeal, setEditDeal] = useState<Deal | null>(null);

  const filtered = useMemo(() => {
    let rows = deals;
    if (payFilter === 'none') rows = rows.filter((d) => !d.payType);
    else if (payFilter !== 'all') rows = rows.filter((d) => d.payType === payFilter);
    const q = search.trim().toLowerCase();
    if (q) {
      rows = rows.filter((d) =>
        `${d.name} ${d.carrierId} ${d.stage} ${d.payType}`.toLowerCase().includes(q),
      );
    }
    return rows;
  }, [deals, payFilter, search]);

  const countByType = (t: PayType) => deals.filter((d) => d.payType === t).length;

  function saveEdit(id: string, patch: { payType: PayType; cycle: string; verify: Verify }) {
    setDeals((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    setEditDeal(null);
  }

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Data Center</h2>
        <p className="text-sm text-muted-foreground">{deals.length} deals loaded · carrier billing records</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard icon={Layers} value={String(deals.length)} label="Total Deals" tint="primary" />
        <StatCard icon={CreditCard} value={String(countByType('Line of Credit'))} label="Line of Credit" tint="good" />
        <StatCard icon={PiggyBank} value={String(countByType('Prepay'))} label="Prepay" tint="purple" />
        <StatCard icon={FileText} value={String(countByType('Deposit'))} label="Deposit" tint="warn" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search deal name, carrier ID, stage…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={PAY_FILTERS} value={payFilter} onChange={setPayFilter} />
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="font-heading flex items-center gap-2 text-sm font-bold">
            <Layers className="size-4 text-primary" />
            Deal Records
          </div>
          <span className="rounded-xs border bg-secondary px-2.5 py-0.5 font-mono text-[11px] font-semibold text-secondary-foreground">
            {filtered.length} records
          </span>
        </div>
        {/* min-w keeps the 6-column grid from squishing on phones; overflow-x-auto on the
            wrapper above makes it swipeable instead of clipping the trailing columns. */}
        <div className="min-w-180">
          <div className="grid grid-cols-[2fr_1fr_1.5fr_1.2fr_1.1fr_24px] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Deal Name</span>
            <span>Carrier ID</span>
            <span>Stage</span>
            <span>Application</span>
            <span>Payment Type</span>
            <span />
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">
              No deals found. Try adjusting your search or filters.
            </div>
          ) : (
            filtered.map((d) => {
              const st = stageMeta(d.stage);
              const pm = payMeta(d.payType);
              return (
                <button
                  key={d.id}
                  onClick={() => setOpenDeal(d)}
                  className="grid w-full grid-cols-[2fr_1fr_1.5fr_1.2fr_1.1fr_24px] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="truncate font-semibold">{d.name}</span>
                  <span className="font-mono text-xs text-muted-foreground">{d.carrierId}</span>
                  <span>
                    <StatusBadge tone={st.tone}>{d.stage}</StatusBadge>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {new Date(d.appDate + 'T12:00:00').toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' })}
                  </span>
                  <span>
                    <StatusBadge tone={pm.tone}>{pm.label}</StatusBadge>
                  </span>
                  <span className="text-muted-foreground">›</span>
                </button>
              );
            })
          )}
        </div>
      </div>

      {openDeal ? (
        <DealDetail
          deal={openDeal}
          onClose={() => setOpenDeal(null)}
          onEdit={() => {
            setEditDeal(openDeal);
            setOpenDeal(null);
          }}
        />
      ) : null}

      {editDeal ? (
        <EditDeal deal={editDeal} onCancel={() => setEditDeal(null)} onSave={saveEdit} />
      ) : null}
    </div>
  );
}

function DealDetail({ deal, onClose, onEdit }: { deal: Deal; onClose: () => void; onEdit: () => void }) {
  const st = stageMeta(deal.stage);
  const pm = payMeta(deal.payType);
  const debtor = debtorFor(deal.carrierId);
  const isPrepay = deal.payType === 'Prepay';
  const txns = transactionsForCarrier(deal.carrierId).slice(0, 4);
  const verifyTone: Record<string, StatusTone> = { Verified: 'good', Pending: 'warn', Failed: 'bad', '': 'neutral' };
  // ?? 'neutral' below: noUncheckedIndexedAccess types this lookup as possibly undefined even
  // though every Verify value is covered above.

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={deal.name}
      badges={
        <>
          <StatusBadge tone={pm.tone}>{pm.label}</StatusBadge>
          <StatusBadge tone={st.tone}>{deal.stage}</StatusBadge>
          {debtor ? (
            <StatusBadge tone="bad">DEBTOR · {debtor.age}d</StatusBadge>
          ) : null}
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit}>Edit Deal</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Deal Info
          </div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Carrier ID" v={<span className="font-mono">{deal.carrierId}</span>} />
            <Row k="Application Date" v={dateFull(deal.appDate)} />
            <Row
              k="Avg Days to Pay"
              v={
                <span className={cn(deal.avgDays == null ? 'text-muted-foreground' : deal.avgDays >= 20 ? 'text-bad' : deal.avgDays >= 12 ? 'text-warn' : 'text-good', 'font-mono')}>
                  {deal.avgDays == null ? '—' : `${deal.avgDays} day${deal.avgDays === 1 ? '' : 's'}`}
                </span>
              }
            />
            <Row k="Billing Cycle" v={deal.cycle || '—'} />
            <Row k="Billing Verification" v={<StatusBadge tone={verifyTone[deal.verify] ?? 'neutral'}>{deal.verify || '—'}</StatusBadge>} />
          </dl>
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Debtor Status
          </div>
          {debtor ? (
            <div className="rounded-xs border border-bad/24 bg-bad/8 p-3.5">
              <div className="mb-2 flex items-center gap-1.5 text-xs font-bold text-bad">
                Active Debtor {debtor.isHard ? <StatusBadge tone="bad">HARD</StatusBadge> : null}
              </div>
              <Row k="Total Remaining" v={<span className="font-mono font-bold text-bad">{fmtCurrency(debtor.totalRemaining)}</span>} />
              <Row k="Oldest Debt" v={`${debtor.age} days`} />
              <Row k="Open Invoices" v={String(debtor.invoiceCount)} />
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-xs border border-good/24 bg-good/8 px-3.5 py-3 text-sm font-semibold text-good">
              ✓ No outstanding debt on record
            </div>
          )}
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            {isPrepay ? 'Prepay Balance' : 'Invoices'}
          </div>
          {isPrepay ? (
            <div className="rounded-xs border border-primary/24 bg-primary/8 p-3.5">
              <StatusBadge tone="info">PREPAY ACCOUNT</StatusBadge>
              <div className="mt-2.5 text-sm text-muted-foreground">
                Active prepay account — top-ups draw down against fuel and card activity as it posts.
              </div>
            </div>
          ) : debtor && debtor.invoices.length > 0 ? (
            <div className="flex flex-col gap-2">
              {debtor.invoices.map((iv) => {
                const paid = iv.total - iv.remaining;
                const status = iv.remaining <= 0 ? 'Paid' : paid > 0 ? 'Partial' : 'Pending';
                return (
                  <div key={iv.num} className="rounded-xs border bg-muted/30 p-3">
                    <div className="mb-2 flex items-center justify-between">
                      <span className="font-mono text-xs font-bold">#{iv.num}</span>
                      <StatusBadge tone={status === 'Paid' ? 'good' : 'warn'}>{status}</StatusBadge>
                    </div>
                    <div className="flex gap-3.5 text-xs">
                      <span>Total <b className="font-mono">{fmtCurrency(iv.total)}</b></span>
                      <span>Paid <b className="font-mono text-good">{fmtCurrency(paid)}</b></span>
                      {iv.remaining > 0 ? <span>Remaining <b className="font-mono text-bad">{fmtCurrency(iv.remaining)}</b></span> : null}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No invoices on record.</div>
          )}
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Recent Transactions
          </div>
          {txns.length > 0 ? (
            <div className="flex flex-col gap-1.5">
              {txns.map((t) => (
                <div key={t.recordId} className="flex items-center gap-2.5 rounded-xs border bg-muted/30 px-2.5 py-2 text-xs">
                  <span className="rounded-xs bg-secondary px-1.5 py-0.5 font-mono font-bold text-secondary-foreground uppercase">
                    {t.source}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">{t.sender}</span>
                  <span className="font-mono font-bold text-good">{fmtCurrency(t.amount)}</span>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-sm text-muted-foreground">No transactions mapped to this carrier.</div>
          )}
        </section>
      </div>
    </DetailDialog>
  );
}

function EditDeal({
  deal,
  onCancel,
  onSave,
}: {
  deal: Deal;
  onCancel: () => void;
  onSave: (id: string, patch: { payType: PayType; cycle: string; verify: Verify }) => void;
}) {
  const [payType, setPayType] = useState<PayType>(deal.payType);
  const [cycle, setCycle] = useState(deal.cycle);
  const [verify, setVerify] = useState<Verify>(deal.verify);

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onCancel()}
      title="Edit Deal"
      subtitle={`${deal.name} · ${deal.carrierId}`}
      size="md"
      footer={
        <>
          <Button variant="outline" onClick={onCancel}>
            Cancel
          </Button>
          <Button onClick={() => onSave(deal.id, { payType, cycle, verify })}>Save Changes</Button>
        </>
      }
    >
      <div className="flex flex-col gap-3.5">
        <Field label="Payment Type / Billing">
          <select value={payType} onChange={(e) => setPayType(e.target.value as PayType)} className={selectClass}>
            {PAY_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p || '— None —'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Billing Cycle">
          <select value={cycle} onChange={(e) => setCycle(e.target.value)} className={selectClass}>
            {CYCLE_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {c || '— None —'}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Billing Verification">
          <select value={verify} onChange={(e) => setVerify(e.target.value as Verify)} className={selectClass}>
            {VERIFY_OPTIONS.map((v) => (
              <option key={v} value={v}>
                {v || '— None —'}
              </option>
            ))}
          </select>
        </Field>
      </div>
    </DetailDialog>
  );
}

const selectClass =
  'w-full rounded-xs border bg-muted/40 px-3 py-2 text-sm outline-none focus:border-primary/55 focus:ring-3 focus:ring-primary/12';

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-semibold text-muted-foreground">{label}</span>
      {children}
    </label>
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

function cn(...cls: (string | false | undefined)[]) {
  return cls.filter(Boolean).join(' ');
}
