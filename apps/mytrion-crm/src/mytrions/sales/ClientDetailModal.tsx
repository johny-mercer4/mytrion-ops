import { AlertTriangle, CalendarClock, CreditCard, Wallet } from 'lucide-react';

import { callTouchpoint } from '@/api/touchpoints';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { money, useLoad, type ClientRow } from './live';
import { useToast } from './Toast';

const CLIENT_TONE: Record<ClientRow['status'], StatusTone> = {
  active: 'good',
  inactive: 'neutral',
  suspended: 'bad',
};

/** Client drilldown — live recent fuel activity from servercrm (widget parity). */
export function ClientDetailModal({
  client,
  onClose,
  onRunAction,
}: {
  client: ClientRow;
  onClose: () => void;
  onRunAction: () => void;
}) {
  const { push } = useToast();
  const recent = useLoad(
    () => callTouchpoint('clients.recent_transactions', { carrierId: client.carrierId, limit: 8 }),
    [client.carrierId],
  );

  function quickAction(label: string) {
    onClose();
    onRunAction();
    push('info', `Opening ${label} for ${client.company}…`);
  }

  const fmt = (v: unknown): string => (v == null || v === '' ? '—' : String(v));
  const rows = (recent.data?.data ?? []).map((tx) => {
    const r = tx as Record<string, unknown>;
    return {
      key: String(r.transaction_id ?? Math.random()),
      station: fmt(r.location_name),
      date: String(r.transaction_date ?? '').slice(0, 10),
      gallons: Number(r.transaction_fuel_quantity ?? r.fuel_quantity ?? 0) || 0,
      amount: Number(r.net_total ?? r.amount ?? 0) || 0,
    };
  });

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={client.company}
      subtitle={`Carrier #${client.carrierId}${client.dealStage ? ` · ${client.dealStage}` : ''}`}
      size="lg"
      badges={
        <>
          <StatusBadge tone={CLIENT_TONE[client.status]}>{client.status}</StatusBadge>
          {client.terms ? (
            <span className="rounded-md border border-primary/30 bg-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-primary">
              {client.terms}
            </span>
          ) : null}
        </>
      }
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell icon={Wallet} value={client.limitText} label="Balance / Limit" tone="text-primary" />
          <Cell
            icon={AlertTriangle}
            value={client.debt > 0 ? `-${money(client.debt)}` : '$0'}
            label="Outstanding Debt"
            tone={client.isDebtor ? 'text-bad' : 'text-good'}
          />
          <Cell icon={CalendarClock} value={client.debtDays > 0 ? `${client.debtDays}d` : '—'} label="Debt Age" tone="text-warn" />
          <Cell icon={CreditCard} value={client.dot || '—'} label="DOT" tone="text-foreground" />
        </div>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Recent Fuel Activity
          </div>
          {recent.loading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">Loading…</div>
          ) : recent.error ? (
            <div className="py-4 text-center text-sm text-bad">{recent.error}</div>
          ) : rows.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">No recent transactions.</div>
          ) : (
            <div className="flex flex-col gap-1.5">
              {rows.map((row) => (
                <div key={row.key} className="flex items-center justify-between rounded-md border bg-muted/30 px-3 py-2 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{row.station}</div>
                    <div className="text-[10px] text-muted-foreground">{row.date}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-mono font-semibold">{row.gallons.toFixed(1)} gal</div>
                    <div className="font-mono text-[10px] text-muted-foreground">{money(row.amount)}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Quick Actions
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => quickAction('Balance Check')}>
              Balance Check
            </Button>
            <Button variant="outline" size="sm" onClick={() => quickAction('Transactions Report')}>
              Transactions Report
            </Button>
            <Button variant="outline" size="sm" onClick={() => quickAction('Request Invoices')}>
              Request Invoices
            </Button>
          </div>
        </section>
      </div>
    </DetailDialog>
  );
}

function Cell({ icon: Icon, value, label, tone }: { icon: typeof Wallet; value: string; label: string; tone: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <Icon className={`size-4 ${tone}`} />
      <div className={`font-heading mt-1.5 truncate text-lg font-bold ${tone}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
