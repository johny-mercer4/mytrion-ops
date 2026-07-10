import { AlertTriangle, Building2, Clock, TrendingDown } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  STAGE_META,
  advanceLabel,
  daysTone,
  fmtMrr,
  initials,
  riskTone,
  type RetentionCase,
} from './data';

interface RiskFactor {
  label: string;
  detail: string;
  tone: 'bad' | 'warn' | 'purple';
}

function riskFactors(c: RetentionCase): RiskFactor[] {
  const factors: RiskFactor[] = [
    { label: 'Declining volume', detail: c.reason, tone: 'bad' },
    { label: 'Days since last transaction', detail: `${c.lastTx} · ${c.days} days in stage`, tone: 'warn' },
  ];
  if (c.competitor) {
    factors.push({ label: 'Competitor interest', detail: `Considering ${c.competitor}`, tone: 'purple' });
  }
  return factors;
}

const FACTOR_CLASS: Record<RiskFactor['tone'], string> = {
  bad: 'border-bad/24 bg-bad/8 text-bad',
  warn: 'border-warn/24 bg-warn/8 text-warn',
  purple: 'border-brand-purple/24 bg-brand-purple/8 text-brand-purple',
};

const FACTOR_ICON: Record<RiskFactor['tone'], typeof TrendingDown> = {
  bad: TrendingDown,
  warn: Clock,
  purple: Building2,
};

export function CaseDetail({
  case: c,
  onClose,
  onMarkChurned,
  onAdvance,
}: {
  case: RetentionCase;
  onClose: () => void;
  onMarkChurned: (id: string) => void;
  onAdvance: (id: string) => void;
}) {
  const stageMeta = STAGE_META[c.stage];
  const timeline = [
    { label: 'Case created — flagged at risk', when: `${c.days} days ago` },
    { label: 'Outreach call logged', when: `${Math.max(0, c.days - 2)} days ago` },
    { label: 'Retention offer prepared', when: 'recently' },
  ];

  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={c.company}
      subtitle={`Carrier ${c.carrierId}`}
      badges={
        <>
          <StatusBadge tone={c.stage === 'lost' ? 'bad' : c.stage === 'saved' ? 'good' : 'neutral'}>
            {stageMeta.label}
          </StatusBadge>
          <StatusBadge tone={riskTone(c.risk)}>{c.risk.toUpperCase()} RISK</StatusBadge>
        </>
      }
      footer={
        <>
          <Button
            variant="outline"
            className="text-bad hover:text-bad sm:mr-auto"
            onClick={() => onMarkChurned(c.id)}
          >
            Mark Churned
          </Button>
          <Button variant="outline" onClick={onClose}>
            Close
          </Button>
          <Button onClick={() => onAdvance(c.id)}>{advanceLabel(c.stage)}</Button>
        </>
      }
    >
      <div className="flex flex-col gap-5">
        <section className="grid grid-cols-3 gap-3">
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Value at Risk</div>
            <div className="mt-1 font-mono text-lg font-bold text-bad">{fmtMrr(c.mrr)}</div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Owner</div>
            <div className="mt-1 flex items-center gap-1.5 text-sm font-bold text-primary">
              <span className="flex size-5 items-center justify-center rounded-full bg-primary/15 text-[10px]">
                {initials(c.owner)}
              </span>
              {c.owner}
            </div>
          </div>
          <div className="rounded-md border bg-muted/30 p-3">
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Days in Stage</div>
            <div className={`mt-1 text-lg font-bold ${c.days >= 14 ? 'text-bad' : 'text-foreground'}`}>
              {c.days}d
            </div>
          </div>
        </section>

        <section>
          <div className="font-heading mb-2.5 flex items-center gap-1.5 text-xs font-bold tracking-wide text-primary uppercase">
            <AlertTriangle className="size-3.5" />
            Risk Factors
          </div>
          <div className="flex flex-col gap-2">
            {riskFactors(c).map((f) => {
              const Icon = FACTOR_ICON[f.tone];
              return (
                <div key={f.label} className={`flex gap-2.5 rounded-md border p-3 text-xs ${FACTOR_CLASS[f.tone]}`}>
                  <Icon className="mt-0.5 size-3.5 flex-none" />
                  <div>
                    <div className="font-bold">{f.label}</div>
                    <div className="mt-0.5 opacity-90">{f.detail}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">
            Retention Timeline
          </div>
          <div className="flex flex-col gap-0">
            {timeline.map((t, i) => (
              <div key={t.label} className="relative flex gap-3 pb-4 last:pb-0">
                <div className="flex flex-none flex-col items-center">
                  <span className="mt-1 size-2.5 rounded-full bg-primary" />
                  {i < timeline.length - 1 ? <span className="w-px flex-1 bg-border" /> : null}
                </div>
                <div className="min-w-0 pb-1">
                  <div className="text-sm font-semibold">{t.label}</div>
                  <div className="text-[11px] text-muted-foreground">{t.when}</div>
                </div>
              </div>
            ))}
          </div>
        </section>
      </div>
    </DetailDialog>
  );
}

export function daysToneClass(days: number): string {
  const tone = daysTone(days);
  if (tone === 'bad') return 'text-bad';
  if (tone === 'warn') return 'text-warn';
  return 'text-muted-foreground';
}
