/**
 * Data Center — CRM Deals with billing-field edits (ported from the widget's
 * datacenter-panel, which was fully built but nav-disabled in Zoho). Full load via the
 * cs.datacenter.deals touchpoint with sessionStorage cache + delta sync; edits go through
 * POST /cs/data-center/deals/:id (allowlisted billing fields, audited).
 */
import { useMemo, useState } from 'react';
import { RefreshCw } from 'lucide-react';

import { updateDealBilling } from '@/api/cs';
import type { CsDataCenterDeal } from '@/api/touchpointTypes';
import { SearchBar } from '@/components/mytrion/search-bar';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { cn } from '@/lib/utils';
import { Toast, type ToastState } from './Toast';
import { stageMeta } from './data';
import { fmtDate, invalidateDealsCache, loadDeals, useLoad } from './live';

const PAY_OPTIONS = ['Prepay', 'Deposit', 'LOC'];
const CYCLE_OPTIONS = ['1 Billing Cycle', '2 Billing Cycle', 'Thursday - Wednesday'];
const VERIFICATION_OPTIONS = ['Yes', 'No'];

const inputCls =
  'w-full rounded-md border bg-card px-2.5 py-1.5 text-sm outline-none focus:border-primary/55';

const s = (v: unknown): string => (v == null ? '' : String(v));

export function DataCenter() {
  const [search, setSearch] = useState('');
  const [openDeal, setOpenDeal] = useState<CsDataCenterDeal | null>(null);
  const [toast, setToast] = useState<ToastState | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);

  const deals = useLoad(() => loadDeals(refreshTick > 0), [refreshTick]);

  const filtered = useMemo(() => {
    const rows = deals.data ?? [];
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((d) =>
      `${s(d.Deal_Name)} ${s(d.Carrier_ID)} ${s(d.Stage)}`.toLowerCase().includes(q),
    );
  }, [deals.data, search]);

  function notify(kind: ToastState['kind'], message: string) {
    setToast({ id: Date.now(), kind, message });
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Data Center</h2>
          <p className="text-sm text-muted-foreground">
            {deals.loading ? 'Loading…' : `${filtered.length} deals · billing fields editable`}
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            invalidateDealsCache();
            setRefreshTick((t) => t + 1);
            deals.reload();
          }}
          disabled={deals.loading}
        >
          <RefreshCw className={cn('size-3.5', deals.loading ? 'animate-spin' : undefined)} />
          Refresh
        </Button>
      </div>

      <SearchBar
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search deal, carrier ID, stage…"
        className="max-w-sm"
      />

      {deals.error ? (
        <div className="rounded-lg border border-bad/30 bg-bad/10 p-3 text-sm text-bad">
          Failed to load deals: {deals.error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="min-w-210">
          <div className="grid grid-cols-[1.8fr_1fr_1.2fr_1fr_1.2fr_1fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Deal</span>
            <span>Carrier ID</span>
            <span>Stage</span>
            <span>Payment Type</span>
            <span>Billing Cycle</span>
            <span>Verification</span>
            <span className="text-right">Closing</span>
          </div>
          {deals.loading && filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">Loading deals…</div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No deals found.</div>
          ) : (
            filtered.slice(0, 300).map((d) => {
              const st = stageMeta(s(d.Stage));
              return (
                <button
                  key={s(d.id)}
                  onClick={() => setOpenDeal(d)}
                  className="grid w-full grid-cols-[1.8fr_1fr_1.2fr_1fr_1.2fr_1fr_1fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
                >
                  <span className="truncate font-semibold">{s(d.Deal_Name) || '—'}</span>
                  <span className="font-mono text-xs text-muted-foreground">{s(d.Carrier_ID) || '—'}</span>
                  <span>{d.Stage ? <StatusBadge tone={st.tone}>{s(d.Stage)}</StatusBadge> : <span className="text-muted-foreground">—</span>}</span>
                  <span className="text-xs">{s(d.Payment_Type_Billing) || '—'}</span>
                  <span className="text-xs">{s(d.Billing_Cycle) || '—'}</span>
                  <span className="text-xs">{s(d.Billing_Verification) || '—'}</span>
                  <span className="text-right text-xs text-muted-foreground">{fmtDate(d.Closing_Date)}</span>
                </button>
              );
            })
          )}
        </div>
      </div>
      {filtered.length > 300 ? (
        <p className="text-right text-xs text-muted-foreground">Showing first 300 — refine the search to narrow down.</p>
      ) : null}

      {openDeal ? (
        <DealBillingModal
          deal={openDeal}
          onClose={() => setOpenDeal(null)}
          onSaved={() => {
            setOpenDeal(null);
            notify('success', 'Deal billing fields updated');
            invalidateDealsCache();
            deals.reload();
          }}
          onError={(m) => notify('error', m)}
        />
      ) : null}

      {toast ? <Toast toast={toast} onDismiss={() => setToast(null)} /> : null}
    </div>
  );
}

function DealBillingModal({
  deal,
  onClose,
  onSaved,
  onError,
}: {
  deal: CsDataCenterDeal;
  onClose: () => void;
  onSaved: () => void;
  onError: (message: string) => void;
}) {
  const [pay, setPay] = useState(s(deal.Payment_Type_Billing));
  const [cycle, setCycle] = useState(s(deal.Billing_Cycle));
  const [verification, setVerification] = useState(s(deal.Billing_Verification));
  const [saving, setSaving] = useState(false);

  async function save() {
    const changes: Record<string, string | null> = {};
    if (pay !== s(deal.Payment_Type_Billing)) changes.Payment_Type_Billing = pay || null;
    if (cycle !== s(deal.Billing_Cycle)) changes.Billing_Cycle = cycle || null;
    if (verification !== s(deal.Billing_Verification)) changes.Billing_Verification = verification || null;
    if (Object.keys(changes).length === 0) {
      onClose();
      return;
    }
    setSaving(true);
    try {
      await updateDealBilling(s(deal.id), changes);
      onSaved();
    } catch (e) {
      setSaving(false);
      onError(`Save failed: ${e instanceof Error ? e.message : e}`);
    }
  }

  const select = (value: string, onChange: (v: string) => void, options: string[]) => (
    <select className={inputCls} value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">—</option>
      {options.concat(options.includes(value) || !value ? [] : [value]).map((o) => (
        <option key={o} value={o}>
          {o}
        </option>
      ))}
    </select>
  );

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={s(deal.Deal_Name) || 'Deal'}
      {...(s(deal.Carrier_ID) ? { subtitle: `Carrier ${s(deal.Carrier_ID)}` } : {})}
      footer={
        <>
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={save} disabled={saving}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 gap-3">
        <label>
          <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Payment Type
          </span>
          {select(pay, setPay, PAY_OPTIONS)}
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Billing Cycle
          </span>
          {select(cycle, setCycle, CYCLE_OPTIONS)}
        </label>
        <label>
          <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted-foreground uppercase">
            Billing Verification
          </span>
          {select(verification, setVerification, VERIFICATION_OPTIONS)}
        </label>
      </div>
    </DetailDialog>
  );
}
