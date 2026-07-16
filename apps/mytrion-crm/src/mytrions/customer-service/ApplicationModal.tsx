import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { cn } from '@/lib/utils';
import type { OnboardingField } from '@/api/cs';
import { type Application, creditTone, fullName, isClient, onboardingCount, stageMeta } from './data';

const SEGMENTS: {
  key: keyof Pick<Application, 'ta' | 'efs' | 'lmt' | 'mob' | 'chn'>;
  label: string;
  crmField: OnboardingField;
}[] = [
  { key: 'ta', label: 'TA', crmField: 'Email_to_TA' },
  { key: 'efs', label: 'EFS', crmField: 'TA_EFS_Added' },
  { key: 'lmt', label: 'LMT', crmField: 'Limits_added' },
  { key: 'mob', label: 'MOB', crmField: 'Mobile_Driver_App' },
  { key: 'chn', label: 'CHN', crmField: 'Chain_policy' },
];

export function ApplicationModal({
  app,
  onClose,
  onEdit,
  onToggle,
  pendingToggle,
}: {
  app: Application;
  onClose: () => void;
  onEdit: () => void;
  /** Optimistic onboarding tick-box toggle (widget parity). Absent = read-only preview. */
  onToggle?: (app: Application, field: OnboardingField, next: boolean) => void;
  pendingToggle?: string | null;
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
            {SEGMENTS.map((seg) => {
              const on = Boolean(app[seg.key]);
              const busy = pendingToggle === seg.crmField;
              return (
                <button
                  key={seg.key}
                  type="button"
                  disabled={!onToggle || busy}
                  onClick={() => onToggle?.(app, seg.crmField, !on)}
                  title={onToggle ? `Toggle ${seg.label}` : seg.label}
                  className={cn('flex flex-1 flex-col items-center gap-1', onToggle ? 'cursor-pointer' : 'cursor-default')}
                >
                  <div
                    className={cn(
                      'h-1.5 w-full rounded-full transition-colors',
                      on ? 'bg-primary' : 'bg-muted',
                      busy ? 'animate-pulse' : undefined,
                    )}
                  />
                  <span className="text-[9.5px] font-semibold text-muted-foreground">{seg.label}</span>
                </button>
              );
            })}
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
            <div className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">{app.notes}</div>
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
