import { CreditCard, Droplets, Truck, Wallet } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { type Client, fmtCompact, fmtCurrency, fuelActivityFor, statusTone } from './data';
import { useToast } from './Toast';

export function ClientDetailModal({
  client,
  onClose,
  onRunAction,
}: {
  client: Client;
  onClose: () => void;
  onRunAction: () => void;
}) {
  const { push } = useToast();
  const activity = fuelActivityFor(client);
  const owed = client.balance < 0;

  function quickAction(label: string) {
    onClose();
    onRunAction();
    push('info', `Opening ${label} for ${client.name}…`);
  }

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={client.name}
      subtitle={`Carrier #${client.id} · ${client.city}`}
      size="lg"
      badges={<StatusBadge tone={statusTone(client.status)}>{client.status}</StatusBadge>}
      footer={
        <Button variant="outline" onClick={onClose}>
          Close
        </Button>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Cell icon={Wallet} value={owed ? `-${fmtCurrency(client.balance)}` : fmtCurrency(client.balance)} label="Balance" tone={owed ? 'text-bad' : 'text-good'} />
          <Cell icon={Droplets} value={fmtCompact(client.gallons)} label="Gallons" tone="text-brand-purple" />
          <Cell icon={CreditCard} value={String(client.cards)} label="Cards" tone="text-primary" />
          <Cell icon={Truck} value={String(client.units)} label="Units" tone="text-foreground" />
        </div>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Recent Fuel Activity
          </div>
          <div className="flex flex-col gap-1.5">
            {activity.map((row) => (
              <div key={row.station} className="flex items-center justify-between rounded-xs border bg-muted/30 px-3 py-2 text-xs">
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{row.station}</div>
                  <div className="text-[10px] text-muted-foreground">{row.date}</div>
                </div>
                <div className="text-right">
                  <div className="font-mono font-semibold">{row.gallons} gal</div>
                  <div className="font-mono text-[10px] text-muted-foreground">{fmtCurrency(row.amount)}</div>
                </div>
              </div>
            ))}
          </div>
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
    <div className="rounded-xs border bg-muted/30 p-3">
      <Icon className={`size-4 ${tone}`} />
      <div className={`font-heading mt-1.5 text-lg font-bold ${tone}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
    </div>
  );
}
