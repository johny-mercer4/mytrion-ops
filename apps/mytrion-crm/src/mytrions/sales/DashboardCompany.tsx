import { RotateCw } from 'lucide-react';

import { callTouchpoint } from '@/api/touchpoints';
import { Button } from '@/components/ui/button';
import { num, useLoad } from './live';

// mytrioncompanydashboard — company-wide application fills + gallon volume vs the
// widget's fixed targets (fills 15/105/450 per day/week/month; gallons month 6.7M).

const TARGETS = {
  fills_today: 15,
  fills_this_week: 105,
  fills_this_month: 450,
  gallons_this_month: 6_700_000,
} as const;

interface GaugeSpec {
  label: string;
  value: number;
  target: number | null;
}

export function DashboardCompany() {
  const load = useLoad(async () => {
    const res = await callTouchpoint('dashboard.company', {});
    return res.data ?? {};
  }, []);

  if (load.loading) {
    return <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">Loading company dashboard…</div>;
  }
  if (load.error) {
    return (
      <div className="rounded-lg border bg-card p-10 text-center text-sm">
        <p className="text-bad">{load.error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={load.reload}>
          Retry
        </Button>
      </div>
    );
  }

  const d = load.data ?? {};
  const n = (k: string): number => Number((d as Record<string, unknown>)[k] ?? 0) || 0;

  const fills: GaugeSpec[] = [
    { label: 'Today', value: n('fills_today'), target: TARGETS.fills_today },
    { label: 'This Week', value: n('fills_this_week'), target: TARGETS.fills_this_week },
    { label: 'This Month', value: n('fills_this_month'), target: TARGETS.fills_this_month },
  ];
  const gallons: GaugeSpec[] = [
    { label: 'Today', value: n('gallons_today'), target: null },
    { label: 'This Week', value: n('gallons_this_week'), target: null },
    { label: 'This Month', value: n('gallons_this_month'), target: TARGETS.gallons_this_month },
  ];

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-muted-foreground">
          {d.as_of ? `As of ${d.as_of}` : ''}
          {d.week_start ? ` · week starts ${d.week_start}` : ''}
        </span>
        <Button variant="ghost" size="sm" onClick={load.reload}>
          <RotateCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <GaugeRow title="Applications Filled" gauges={fills} />
      <GaugeRow title="Gallon Volume" gauges={gallons} unit="gal" />
    </div>
  );
}

function GaugeRow({ title, gauges, unit }: { title: string; gauges: GaugeSpec[]; unit?: string }) {
  return (
    <div className="rounded-lg border bg-card p-5">
      <div className="font-heading mb-3 text-sm font-bold">{title}</div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {gauges.map((g) => {
          const pct = g.target ? Math.min((g.value / g.target) * 100, 100) : null;
          return (
            <div key={g.label} className="rounded-md border bg-muted/30 p-4">
              <div className="text-[10.5px] font-bold tracking-wide text-muted-foreground uppercase">{g.label}</div>
              <div className="font-heading mt-1 text-2xl font-bold text-primary">
                {num(g.value)}
                {unit ? <span className="ml-1 text-sm font-semibold text-muted-foreground">{unit}</span> : null}
              </div>
              {pct !== null ? (
                <>
                  <div className="mt-3 h-2 w-full rounded-full bg-muted">
                    <div
                      className={`h-2 rounded-full ${pct >= 100 ? 'bg-good' : pct >= 60 ? 'bg-primary' : 'bg-warn'}`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                  <div className="mt-1.5 text-[10.5px] text-muted-foreground">
                    {Math.round(pct)}% of {num(g.target)}
                  </div>
                </>
              ) : (
                <div className="mt-1.5 text-[10.5px] text-muted-foreground">No target</div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
