import { useMemo, useState } from 'react';
import { CheckCircle2, Clock, RefreshCw } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  PARENT_SNAPSHOT,
  SMART_BALANCE_EVENTS,
  type SmartBalanceEvent,
  dateTimeFull,
  fmtCurrency,
  maskCard,
} from './data';

const MODE_TONE = { CRITICAL: 'bad', WARNING: 'warn', HEALTHY: 'good' } as const;

export function SmartBalance() {
  const [search, setSearch] = useState('');
  const [openEvent, setOpenEvent] = useState<SmartBalanceEvent | null>(null);
  const today = new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return SMART_BALANCE_EVENTS;
    return SMART_BALANCE_EVENTS.filter((e) =>
      `${e.company} ${e.ref} ${e.loc}`.toLowerCase().includes(q),
    );
  }, [search]);

  return (
    <div className="flex flex-col gap-4 p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Smart Balance Events</h2>
          <p className="text-sm text-muted-foreground">{SMART_BALANCE_EVENTS.length} records · {today}</p>
        </div>
        <Button variant="outline" size="sm">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="rounded-lg border bg-card p-4 shadow-sm">
        <div className="mb-3 flex items-center justify-between">
          <div className="font-heading text-xs font-bold tracking-wide text-muted-foreground uppercase">
            Parent Snapshot
          </div>
          <StatusBadge tone={MODE_TONE[PARENT_SNAPSHOT.mode]}>{PARENT_SNAPSHOT.mode}</StatusBadge>
        </div>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Balance (USD)</div>
            <div className="font-mono text-2xl font-bold text-primary">{fmtCurrency(PARENT_SNAPSHOT.balance)}</div>
          </div>
          <div className="text-right">
            <div className="text-[10px] tracking-wide text-muted-foreground uppercase">Captured At</div>
            <div className="text-sm font-semibold">{PARENT_SNAPSHOT.captured}</div>
          </div>
        </div>
      </div>

      <SearchBar
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Search company, reference, location…"
        className="max-w-sm"
      />

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
            No events found. Try adjusting your search.
          </div>
        ) : (
          filtered.map((e) => {
            const isDeadZone = e.status === 'IN_DEAD_ZONE';
            return (
              <button
                key={e.recordId}
                onClick={() => setOpenEvent(e)}
                className="flex w-full items-center gap-3 rounded-lg border bg-card px-4 py-3 text-left text-sm shadow-sm hover:border-primary/45 hover:bg-muted/40"
              >
                <span
                  className={`flex size-9 flex-none items-center justify-center rounded-md ${isDeadZone ? 'bg-bad/12 text-bad' : 'bg-good/12 text-good'}`}
                >
                  {isDeadZone ? <Clock className="size-4" /> : <CheckCircle2 className="size-4" />}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="truncate font-semibold">{e.company}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {e.loc} · {dateTimeFull(e.tx)}
                  </div>
                  {isDeadZone ? (
                    <div className="mt-0.5 text-[11px] font-semibold text-bad">
                      ⏳ Returns {dateTimeFull(e.dzu)}
                    </div>
                  ) : null}
                </div>
                <StatusBadge tone={isDeadZone ? 'bad' : 'good'}>
                  {isDeadZone ? 'Dead Zone' : 'Ready'}
                </StatusBadge>
                <span className="min-w-16 flex-none rounded-md bg-secondary px-1.5 py-0.5 text-center font-mono text-[10.5px] font-bold text-secondary-foreground">
                  PRE {fmtCurrency(e.pre)}
                </span>
                <span className="min-w-18.5 flex-none text-right font-mono text-sm font-bold text-primary">
                  {fmtCurrency(e.cash)}
                </span>
              </button>
            );
          })
        )}
      </div>

      {openEvent ? <SmartEventDetail event={openEvent} onClose={() => setOpenEvent(null)} /> : null}
    </div>
  );
}

function SmartEventDetail({ event, onClose }: { event: SmartBalanceEvent; onClose: () => void }) {
  const isDeadZone = event.status === 'IN_DEAD_ZONE';
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={event.company}
      subtitle={event.ref}
      badges={<StatusBadge tone={isDeadZone ? 'bad' : 'good'}>{isDeadZone ? 'Dead Zone' : 'Ready'}</StatusBadge>}
      footer={
        <button onClick={onClose} className="rounded-md border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Close
        </button>
      }
    >
      <div className="flex flex-col gap-4">
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Sweep Summary</div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Pre-Sweep Balance" v={<span className="font-mono font-bold">{fmtCurrency(event.pre)}</span>} />
            <Row k="Swept Amount" v={<span className="font-mono font-bold text-good">{fmtCurrency(event.child)}</span>} />
            <Row k="Dead Zone Until" v={dateTimeFull(event.dzu)} />
            <Row k="Transaction Date" v={dateTimeFull(event.tx)} />
            <Row k="Gallons" v={`${event.gal.toFixed(2)} gal`} />
            <Row k="Dead Zone Hours" v={`${event.dzh.toFixed(2)}h`} />
          </dl>
        </section>
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Details</div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Status" v={<StatusBadge tone={isDeadZone ? 'bad' : 'good'}>{isDeadZone ? 'Dead Zone' : 'Ready'}</StatusBadge>} />
            <Row k="Location" v={`${event.loc}, ${event.state}`} />
            <Row k="Net Total" v={<span className="font-mono">{fmtCurrency(event.net)}</span>} />
            <Row k="Contract ID" v={<span className="font-mono">{event.contractId}</span>} />
            <Row k="Carrier ID" v={<span className="font-mono">{event.carrierId}</span>} />
            <Row k="Card Number" v={<span className="font-mono">{maskCard(event.card)}</span>} />
            <Row k="EFS Balance" v={event.efs} />
            <Row k="Parent Mode" v={<StatusBadge tone={event.mode === 'CRITICAL' ? 'bad' : 'warn'}>{event.mode}</StatusBadge>} />
            <Row k="Reference" v={<span className="font-mono text-muted-foreground">{event.ref}</span>} />
          </dl>
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
