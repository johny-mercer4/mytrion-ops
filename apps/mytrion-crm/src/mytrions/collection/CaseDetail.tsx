import { Check, Circle, FileArchive } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  ESCALATION_NODES,
  type CollectionCase,
  type StageTone,
  escalationState,
  fmtCurrency,
  initials,
  outstandingInvoices,
  priorityLabel,
  recoveryActivity,
  stageTitle,
  stageTone,
} from './data';

const BADGE_TONE: Record<StageTone, StatusTone> = {
  bad: 'bad',
  warn: 'warn',
  purple: 'info',
  good: 'good',
  neutral: 'neutral',
};

export function CaseDetail({
  c,
  onClose,
  onLogContact,
  onAdvance,
  onFileToArray,
  onMarkRecovered,
  onWriteOff,
}: {
  c: CollectionCase;
  onClose: () => void;
  onLogContact: () => void;
  onAdvance: () => void;
  onFileToArray: () => void;
  onMarkRecovered: () => void;
  onWriteOff: () => void;
}) {
  const tone = stageTone(c.stage);
  const isRecovered = c.stage === 'recovered';
  const amount = isRecovered ? (c.recoveredAmt ?? 0) : c.outstanding;
  const invoices = outstandingInvoices(c);
  const activity = recoveryActivity(c);
  const states = escalationState(c);

  const timelineNote =
    c.stage === 'baddebt'
      ? `Written off ${c.writeoffDate}`
      : isRecovered
        ? `Resolved ${c.resolved}`
        : `§3.10 · ${c.oldestDays}d elapsed`;

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={c.company}
      subtitle={`Carrier ${c.carrierId} · ${c.reason}`}
      size="xl"
      badges={
        <>
          <StatusBadge tone={BADGE_TONE[tone]}>{stageTitle(c.stage)}</StatusBadge>
          <StatusBadge tone="neutral">{priorityLabel(c.priority)} priority</StatusBadge>
        </>
      }
      footer={
        <>
          <Button variant="outline" onClick={onLogContact} className="mr-auto">
            Log Contact
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <StageActions
            c={c}
            onAdvance={onAdvance}
            onFileToArray={onFileToArray}
            onMarkRecovered={onMarkRecovered}
            onWriteOff={onWriteOff}
          />
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <div className="grid grid-cols-3 gap-3">
          <StatCell label={isRecovered ? 'Recovered' : 'Total Outstanding'} value={fmtCurrency(amount)} tint="good" />
          <StatCell label="Unpaid Invoices" value={String(c.invoices)} tint="neutral" />
          <StatCell
            label="Days Overdue"
            value={isRecovered ? '—' : `${c.oldestDays}d`}
            tint={c.oldestDays >= 150 ? 'bad' : c.oldestDays >= 60 ? 'warn' : 'neutral'}
          />
        </div>

        <div className="text-xs text-muted-foreground">
          Deactivated {c.deactivated} · Billing owner {c.billingOwner} · Collector {c.owner} · Last contact {c.lastContact}
        </div>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <div className="font-heading text-xs font-bold tracking-wide text-primary uppercase">
              Bad-Debt Escalation Timeline
            </div>
            <span className="text-[11px] text-muted-foreground">{timelineNote}</span>
          </div>
          <EscalationStepper states={states} />
        </section>

        <div className="grid grid-cols-1 gap-3.5 md:grid-cols-2">
          <section>
            <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
              Outstanding Invoices
            </div>
            <div className="flex flex-col gap-2">
              {invoices.length === 0 ? (
                <div className="text-sm text-muted-foreground">No invoices on record.</div>
              ) : (
                invoices.map((iv) => (
                  <div key={iv.id} className="flex items-center justify-between rounded-xs border bg-muted/30 px-3 py-2 text-xs">
                    <div>
                      <div className="font-mono font-bold">{iv.id}</div>
                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                        {isRecovered ? `paid ${c.resolved}` : `overdue ${iv.overdueDays}d`}
                      </div>
                    </div>
                    <span className="font-mono font-bold">{fmtCurrency(iv.amount)}</span>
                  </div>
                ))
              )}
            </div>
          </section>

          <section>
            <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
              Recovery Activity
            </div>
            <div className="flex flex-col gap-2">
              {activity.map((a, i) => (
                <div key={i} className="flex items-start gap-2.5 rounded-xs border bg-muted/30 px-3 py-2 text-xs">
                  <span className="mt-0.5 flex size-6 flex-none items-center justify-center rounded-xs bg-primary/12 font-mono text-[9px] font-bold text-primary uppercase">
                    {initials(a.channel)}
                  </span>
                  <div className="min-w-0">
                    <div className="font-semibold">{a.text}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-muted-foreground">
                      {a.channel} · {a.time}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </div>

        {c.arrayRef ? (
          <div className="flex items-center gap-3 rounded-xs border border-brand-purple/28 bg-brand-purple/8 p-3.5">
            <FileArchive className="size-5 flex-none text-brand-purple" />
            <div className="min-w-0 flex-1">
              <div className="text-sm font-bold text-brand-purple">Filed to Array collection agency</div>
              <div className="mt-0.5 text-xs text-muted-foreground">
                Ref {c.arrayRef} · submitted {c.submitted}
              </div>
            </div>
            <StatusBadge tone="info">In Progress</StatusBadge>
          </div>
        ) : null}

        {c.stage === 'plan' ? (
          <div className="rounded-xs border border-good/28 bg-good/8 p-3.5">
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-good">Active payment plan</span>
              <span className="font-mono text-xs text-muted-foreground">
                {fmtCurrency(c.planAmt ?? 0)}/wk · next {c.planNext}
              </span>
            </div>
            <div className="mt-2.5 h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-good" style={{ width: `${c.planPct ?? 0}%` }} />
            </div>
            <div className="mt-1.5 flex items-center justify-between text-[11px] text-muted-foreground">
              <span>{c.planPct}% recovered</span>
              <span>{fmtCurrency(c.outstanding)} remaining</span>
            </div>
          </div>
        ) : null}
      </div>
    </DetailDialog>
  );
}

function StageActions({
  c,
  onAdvance,
  onFileToArray,
  onMarkRecovered,
  onWriteOff,
}: {
  c: CollectionCase;
  onAdvance: () => void;
  onFileToArray: () => void;
  onMarkRecovered: () => void;
  onWriteOff: () => void;
}) {
  if (c.stage === 'handoff') {
    return (
      <>
        <Button variant="outline" onClick={onFileToArray}>
          File to Array
        </Button>
        <Button onClick={onAdvance}>Start Contacting</Button>
      </>
    );
  }
  if (c.stage === 'contacting') {
    return (
      <>
        <Button variant="outline" onClick={onFileToArray}>
          File to Array
        </Button>
        <Button onClick={onMarkRecovered}>Mark Recovered</Button>
      </>
    );
  }
  if (c.stage === 'array') {
    return (
      <>
        <Button variant="outline" onClick={onWriteOff}>
          Write Off
        </Button>
        <Button onClick={onMarkRecovered}>Mark Recovered</Button>
      </>
    );
  }
  if (c.stage === 'plan') {
    return (
      <>
        <Button variant="outline" onClick={onFileToArray}>
          File to Array
        </Button>
        <Button onClick={onMarkRecovered}>Mark Recovered</Button>
      </>
    );
  }
  return null;
}

function StatCell({ label, value, tint }: { label: string; value: string; tint: 'good' | 'bad' | 'warn' | 'neutral' }) {
  const cls =
    tint === 'good' ? 'bg-good/10 text-good' : tint === 'bad' ? 'bg-bad/10 text-bad' : tint === 'warn' ? 'bg-warn/10 text-warn' : 'bg-muted text-foreground';
  return (
    <div className={`rounded-xs border p-3.5 ${cls}`}>
      <div className="font-mono text-lg font-bold">{value}</div>
      <div className="mt-1 text-[10px] tracking-wide uppercase opacity-80">{label}</div>
    </div>
  );
}

function EscalationStepper({ states }: { states: ('done' | 'current' | 'todo')[] }) {
  return (
    <div className="flex items-center">
      {ESCALATION_NODES.map((node, i) => {
        const state = states[i] ?? 'todo';
        return (
          <div key={node.key} className="flex flex-1 items-center last:flex-none">
            <div className="flex flex-col items-center gap-1.5">
              <span
                className={`flex size-7 flex-none items-center justify-center rounded-full border-2 ${
                  state === 'done'
                    ? 'border-good bg-good/15 text-good'
                    : state === 'current'
                      ? 'border-primary bg-primary/15 text-primary'
                      : 'border-border text-muted-foreground'
                }`}
              >
                {state === 'done' ? <Check className="size-3.5" /> : <Circle className="size-2.5 fill-current" />}
              </span>
              <span className="max-w-24 text-center text-[10px] leading-tight text-muted-foreground">{node.label}</span>
            </div>
            {i < ESCALATION_NODES.length - 1 ? (
              <span className={`mx-1 h-0.5 flex-1 ${state === 'done' ? 'bg-good' : 'bg-border'}`} />
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
