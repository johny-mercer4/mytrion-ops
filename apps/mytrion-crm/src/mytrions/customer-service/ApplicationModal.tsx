import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { cn } from '@/lib/utils';
import { type Application, creditTone, fullName, isClient, onboardingCount, stageMeta } from './data';

const SEGMENTS: { key: keyof Pick<Application, 'ta' | 'efs' | 'lmt' | 'mob' | 'chn'>; label: string }[] = [
  { key: 'ta', label: 'TA' },
  { key: 'efs', label: 'EFS' },
  { key: 'lmt', label: 'LMT' },
  { key: 'mob', label: 'MOB' },
  { key: 'chn', label: 'CHN' },
];

export function ApplicationModal({
  app,
  onClose,
  onEdit,
}: {
  app: Application;
  onClose: () => void;
  onEdit: () => void;
}) {
  const st = stageMeta(app.stage);
  const client = isClient(app);
  const count = onboardingCount(app);
  const credit = creditTone(app.credit);

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={app.company}
      subtitle={client ? `Carrier ${app.carrierId}` : app.appId}
      badges={
        <>
          <StatusBadge tone={st.tone}>{app.stage}</StatusBadge>
          {app.verified ? <StatusBadge tone="good">Verified</StatusBadge> : null}
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={onEdit}>Edit Application</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section>
          <div className="mb-2.5 flex items-center justify-between">
            <div className="font-heading text-xs font-bold tracking-wide text-primary uppercase">
              Onboarding Progress
            </div>
            <span className="font-mono text-xs font-bold text-muted-foreground">{count}/5</span>
          </div>
          <div className="flex items-center gap-1.5">
            {SEGMENTS.map((seg) => (
              <div key={seg.key} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className={cn(
                    'h-1.5 w-full rounded-full',
                    app[seg.key] ? 'bg-primary' : 'bg-muted',
                  )}
                />
                <span className="text-[9.5px] font-semibold text-muted-foreground">{seg.label}</span>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Application Details
          </div>
          <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
            <Row k="App ID" v={<span className="font-mono">{app.appId}</span>} />
            <Row k="Company" v={app.company} />
            <Row k="Contact" v={fullName(app)} />
            <Row k="Phone" v={app.phone} />
            <Row k="Email" v={app.email} />
            <Row k="MC / DOT" v={<span className="font-mono">{app.mc} / {app.dot}</span>} />
            <Row k="Location" v={`${app.city}, ${app.state}`} />
            <Row k="Business" v={app.biz} />
            <Row k="WEX Status" v={app.wex} />
            <Row
              k="Credit Score"
              v={
                <span className={cn('font-mono', credit === 'good' ? 'text-good' : credit === 'warn' ? 'text-warn' : credit === 'bad' ? 'text-bad' : 'text-muted-foreground')}>
                  {app.credit ?? '—'}
                </span>
              }
            />
            <Row k="Trucks / Cards" v={`${app.trucks} / ${app.cards}`} />
            <Row k="Payment Type" v={app.pay || '—'} />
            <Row k="Date Filled" v={app.date} />
            {client ? <Row k="Carrier ID" v={<span className="font-mono">{app.carrierId}</span>} /> : null}
          </dl>
        </section>

        {app.notes ? (
          <section>
            <div className="font-heading mb-2 text-xs font-bold tracking-wide text-primary uppercase">
              CS Notes
            </div>
            <div className="rounded-xs border bg-muted/30 p-3 text-sm text-muted-foreground">{app.notes}</div>
          </section>
        ) : null}
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
