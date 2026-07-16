import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { cn } from '@/lib/utils';
import { type CitiClient, citiDecisionMeta, citiRequestMeta, citiStatusMeta } from './data';

export function CitiModal({
  client,
  onClose,
  onEdit,
  onDelete,
}: {
  client: CitiClient;
  onClose: () => void;
  onEdit: () => void;
  onDelete?: () => void;
}) {
  const status = citiStatusMeta(client.status);
  const request = citiRequestMeta(client.request);
  const decision = citiDecisionMeta(client.decision);

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={client.name}
      badges={
        <>
          <StatusBadge tone={status.tone}>{client.status}</StatusBadge>
          <StatusBadge tone={request.tone}>{client.request}</StatusBadge>
        </>
      }
      footer={
        <>
          {onDelete ? (
            <Button variant="outline" className="mr-auto text-bad" onClick={onDelete}>
              Delete
            </Button>
          ) : null}
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit}>Edit Client</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Request
          </div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="App ID" v={<span className="font-mono">{client.appId}</span>} />
            <Row k="Status" v={<StatusBadge tone={status.tone}>{client.status}</StatusBadge>} />
            <Row k="Request" v={<StatusBadge tone={request.tone}>{client.request}</StatusBadge>} />
            <Row
              k="Final Decision"
              v={
                client.decision ? (
                  <span className={cn('font-semibold', client.decision === 'Debtor' ? 'text-bad' : undefined)}>
                    <StatusBadge tone={decision.tone}>{client.decision}</StatusBadge>
                  </span>
                ) : (
                  '—'
                )
              }
            />
            <Row k="Date of Request" v={client.date} />
          </dl>
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Contact
          </div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Email" v={client.email} />
            <Row k="Phone" v={client.phone} />
            <Row k="Agent" v={client.agent} />
          </dl>
        </section>

        <section>
          <div className="font-heading mb-2 text-xs font-bold tracking-wide text-primary uppercase">
            Notes
          </div>
          <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
            {client.notes || 'No notes on record.'}
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
