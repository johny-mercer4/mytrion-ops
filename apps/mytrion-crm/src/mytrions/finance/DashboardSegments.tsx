import { useMemo, useState } from 'react';

import { StatusBadge } from '@/components/mytrion/status-badge';
import {
  CLASSIFIED_CLIENTS,
  PATTERN_META,
  TERMS_BREAKDOWN,
  TOP_CARRIERS,
  type FuelingPattern,
  fmtCurrency,
} from './data';

function fmtCompact(n: number): string {
  return '$' + Math.round(n).toLocaleString('en-US');
}

const PATTERNS = Object.keys(PATTERN_META) as FuelingPattern[];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function DashboardSegments() {
  const [activePattern, setActivePattern] = useState<FuelingPattern | null>(null);
  const [dow, setDow] = useState(5);

  const total = PATTERNS.reduce((s, p) => s + PATTERN_META[p].count, 0);

  const gradient = useMemo(() => {
    let acc = 0;
    const stops = PATTERNS.map((p) => {
      const pct = (PATTERN_META[p].count / total) * 100;
      const start = acc;
      acc += pct;
      return `${PATTERN_META[p].color} ${start}% ${acc}%`;
    });
    return `conic-gradient(${stops.join(', ')})`;
  }, [total]);

  const classified = activePattern ? CLASSIFIED_CLIENTS.filter((c) => c.pattern === activePattern) : CLASSIFIED_CLIENTS;

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Fueling Pattern Mix
        </div>
        <div className="flex flex-wrap items-center gap-6">
          <div className="relative flex size-40 flex-none items-center justify-center rounded-full" style={{ background: gradient }}>
            <div className="flex size-24 flex-col items-center justify-center rounded-full bg-card">
              <span className="font-mono text-xl font-bold">{total}</span>
              <span className="text-[9px] text-muted-foreground uppercase">Classified</span>
            </div>
          </div>
          <div className="flex flex-1 flex-col gap-1.5">
            {PATTERNS.map((p) => {
              const meta = PATTERN_META[p];
              const active = activePattern === p;
              return (
                <button
                  key={p}
                  onClick={() => setActivePattern(active ? null : p)}
                  className={`flex items-center gap-2.5 rounded-md border px-3 py-1.5 text-left text-xs transition-colors ${
                    active ? 'border-primary/55 bg-primary/8' : 'border-transparent hover:bg-muted/40'
                  }`}
                >
                  <span className="size-2.5 flex-none rounded-full" style={{ backgroundColor: meta.color }} />
                  <span className="flex-1 font-semibold">{meta.label}</span>
                  <span className="font-mono text-muted-foreground">{meta.count}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="min-w-140">
          <div className="border-b px-4 py-2.5 font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Fleet Breakdown by Terms
          </div>
          <div className="grid grid-cols-5 gap-2.5 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Terms</span>
            <span>Clients</span>
            <span>Spend</span>
            <span>Wknd</span>
            <span>Night</span>
          </div>
          {TERMS_BREAKDOWN.map((t) => (
            <div key={t.terms} className="grid grid-cols-5 items-center gap-2.5 border-b px-4 py-3 text-sm last:border-b-0">
              <span>
                <StatusBadge tone={t.terms === 'LOC' ? 'info' : t.terms === 'Prepay' ? 'good' : 'neutral'}>{t.terms}</StatusBadge>
              </span>
              <span className="font-mono">{t.clients}</span>
              <span className="font-mono">{fmtCompact(t.spend)}</span>
              <span className="font-mono text-brand-purple">{t.wknd}%</span>
              <span className="font-mono text-primary">{t.night}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border bg-card">
        <div className="min-w-140">
          <div className="flex items-center justify-between border-b px-4 py-2.5">
            <span className="font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
              Classified Clients
            </span>
            {activePattern ? (
              <button onClick={() => setActivePattern(null)} className="text-[11px] font-semibold text-primary hover:underline">
                Clear filter
              </button>
            ) : null}
          </div>
          <div className="grid grid-cols-[2fr_1.4fr_0.8fr_0.8fr_1fr] gap-2.5 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Carrier</span>
            <span>Pattern</span>
            <span>Wknd%</span>
            <span>Night%</span>
            <span className="text-right">Spend</span>
          </div>
          {classified.map((c) => {
            const meta = PATTERN_META[c.pattern];
            return (
              <div key={c.carrier} className="grid grid-cols-[2fr_1.4fr_0.8fr_0.8fr_1fr] items-center gap-2.5 border-b px-4 py-3 text-sm last:border-b-0">
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate font-semibold">{c.company}</span>
                    <StatusBadge tone={c.terms === 'LOC' ? 'info' : c.terms === 'Prepay' ? 'good' : 'neutral'}>{c.terms}</StatusBadge>
                  </div>
                  <div className="text-[11px] text-muted-foreground">#{c.carrier} · {c.tx} tx</div>
                </div>
                <div className="flex items-center gap-1.5 text-xs">
                  <span className="size-2 flex-none rounded-full" style={{ backgroundColor: meta.color }} />
                  {meta.label}
                </div>
                <span className="font-mono text-brand-purple">{c.wknd}%</span>
                <span className="font-mono text-primary">{c.night}%</span>
                <span className="text-right font-mono font-bold">{fmtCurrency(c.spend)}</span>
              </div>
            );
          })}
        </div>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
          Who fueled on {DAYS[dow]}
        </div>
        <div className="mb-3 flex flex-wrap gap-1.5">
          {DAYS.map((d, i) => (
            <button
              key={d}
              onClick={() => setDow(i)}
              className={`rounded-md border px-3 py-1.5 text-xs font-semibold transition-colors ${
                dow === i ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-card text-muted-foreground hover:text-foreground'
              }`}
            >
              {d.slice(0, 3)}
            </button>
          ))}
        </div>
        <div className="flex flex-col gap-2">
          {TOP_CARRIERS.slice(0, 4).map((c, i) => (
            <div key={c.carrier} className="flex items-center gap-3 rounded-md border bg-muted/30 px-3 py-2 text-xs">
              <span className="flex size-6 flex-none items-center justify-center rounded-full bg-primary/12 text-[10px] font-bold text-primary">
                {i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5">
                  <span className="truncate font-semibold">{c.company}</span>
                  <StatusBadge tone={c.terms === 'LOC' ? 'info' : c.terms === 'Prepay' ? 'good' : 'neutral'}>{c.terms}</StatusBadge>
                </div>
                <div className="text-[10px] text-muted-foreground">#{c.carrier} · {c.tx} tx · {c.gal.toLocaleString('en-US')} gal</div>
              </div>
              <span className="font-mono font-bold text-primary">{fmtCompact(c.spend)}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
