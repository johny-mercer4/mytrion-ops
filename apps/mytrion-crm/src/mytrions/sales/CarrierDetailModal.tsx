import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { type Carrier, carrierStatusLabel, carrierStatusTone } from './data';
import { useToast } from './Toast';

export function CarrierDetailModal({ carrier, onClose }: { carrier: Carrier; onClose: () => void }) {
  const { push } = useToast();

  function createLead() {
    onClose();
    push('success', `New lead added to CRM for ${carrier.name}.`);
  }

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={carrier.name}
      subtitle={carrier.city}
      size="md"
      badges={<StatusBadge tone={carrierStatusTone(carrier.status)}>{carrierStatusLabel(carrier.status)}</StatusBadge>}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={createLead}>Create Lead</Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-3">
        <Cell label="DOT" value={carrier.id} />
        <Cell label="MC" value={carrier.mc} />
        <Cell label="Power Units" value={String(carrier.units)} />
        <Cell label="Phone" value={carrier.phone || '—'} />
      </div>
    </DetailDialog>
  );
}

function Cell({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-md border bg-muted/30 p-3">
      <div className="text-[10px] text-muted-foreground uppercase">{label}</div>
      <div className="mt-1 font-mono text-sm font-semibold">{value}</div>
    </div>
  );
}
