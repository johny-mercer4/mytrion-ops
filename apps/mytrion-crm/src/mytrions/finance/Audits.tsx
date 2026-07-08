import { useMemo, useState } from 'react';
import { AlertTriangle, ArrowDownCircle, ArrowUpCircle, RefreshCw } from 'lucide-react';

import { DetailDialog } from '@/components/mytrion/detail-dialog';
import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatCard } from '@/components/mytrion/stat-card';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import {
  EVENT_AUDITS,
  type AuditStatus,
  type AuditType,
  type EventAudit,
  dateTimeFull,
  fmtCurrency,
} from './data';

const TYPE_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'SWEEP', label: 'Sweeps' },
  { id: 'TOPUP', label: 'Top-Ups' },
];

const STATUS_FILTERS = [
  { id: 'all', label: 'All Status' },
  { id: 'SUCCESS', label: 'Success' },
  { id: 'FAILED', label: 'Failed' },
  { id: 'NOT_FOUND', label: 'Not Found' },
];

const STATUS_TONE: Record<AuditStatus, StatusTone> = { SUCCESS: 'good', FAILED: 'bad', NOT_FOUND: 'warn' };
const STATUS_LABEL: Record<AuditStatus, string> = { SUCCESS: 'Success', FAILED: 'Failed', NOT_FOUND: 'Not Found' };

export function Audits() {
  const [search, setSearch] = useState('');
  const [type, setType] = useState('all');
  const [status, setStatus] = useState('all');
  const [openAudit, setOpenAudit] = useState<EventAudit | null>(null);

  const filtered = useMemo(() => {
    let rows = EVENT_AUDITS;
    if (type !== 'all') rows = rows.filter((a) => a.type === (type as AuditType));
    if (status !== 'all') rows = rows.filter((a) => a.status === (status as AuditStatus));
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((a) => `${a.company} ${a.carrier}`.toLowerCase().includes(q));
    return rows;
  }, [search, type, status]);

  const isFiltered = type !== 'all' || status !== 'all' || search.trim() !== '';

  const sweeps = EVENT_AUDITS.filter((a) => a.type === 'SWEEP');
  const topups = EVENT_AUDITS.filter((a) => a.type === 'TOPUP');
  const sweptTotal = sweeps.reduce((s, a) => s + a.amount, 0);
  const toppedTotal = topups.reduce((s, a) => s + a.amount, 0);
  const notFoundCount = EVENT_AUDITS.filter((a) => a.status === 'NOT_FOUND').length;

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="font-heading text-2xl font-bold">Smart Balance Audits</h2>
          <p className="text-sm text-muted-foreground">
            {filtered.length}/{EVENT_AUDITS.length} loaded{isFiltered ? ' · filtered' : ''}
          </p>
        </div>
        <Button variant="outline" size="sm">
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatCard icon={ArrowUpCircle} value={String(EVENT_AUDITS.length)} label="Total Audits" tint="primary" />
        <StatCard icon={ArrowDownCircle} value={fmtCurrency(sweptTotal)} label={`Swept · ${sweeps.length} sweeps`} tint="good" />
        <StatCard icon={ArrowUpCircle} value={fmtCurrency(toppedTotal)} label={`Topped Up · ${topups.length} top-ups`} tint="purple" />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search company or carrier ID…"
          className="max-w-sm flex-1"
        />
        <SegmentedFilter options={TYPE_FILTERS} value={type} onChange={setType} />
        <SegmentedFilter options={STATUS_FILTERS} value={status} onChange={setStatus} />
      </div>

      {notFoundCount > 0 ? (
        <div className="flex items-center gap-2 rounded-xs border border-warn/30 bg-warn/10 px-3.5 py-2.5 text-sm font-semibold text-warn">
          <AlertTriangle className="size-4 flex-none" />
          {notFoundCount} audit{notFoundCount === 1 ? '' : 's'} pending EFS confirmation — will resolve on next cron tick.
        </div>
      ) : null}

      <div className="flex flex-col gap-2">
        {filtered.length === 0 ? (
          <div className="rounded-xs border bg-card p-10 text-center text-sm text-muted-foreground">
            No audits found. Try adjusting your search or filters.
          </div>
        ) : (
          filtered.map((a) => (
            <button
              key={a.id}
              onClick={() => setOpenAudit(a)}
              className="flex w-full items-center gap-3 rounded-xs border bg-card px-4 py-3 text-left text-sm shadow-sm hover:border-primary/45 hover:bg-muted/40"
            >
              <span
                className={`flex size-9 flex-none items-center justify-center rounded-xs ${a.type === 'SWEEP' ? 'bg-good/12 text-good' : 'bg-primary/12 text-primary'}`}
              >
                {a.type === 'SWEEP' ? <ArrowDownCircle className="size-4" /> : <ArrowUpCircle className="size-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{a.company}</div>
                <div className="truncate font-mono text-[11px] text-muted-foreground">
                  {a.ref} · {a.by} · {dateTimeFull(a.at)}
                </div>
              </div>
              <StatusBadge tone={a.type === 'SWEEP' ? 'info' : 'neutral'}>{a.type === 'SWEEP' ? 'Sweep' : 'Top-Up'}</StatusBadge>
              <StatusBadge tone={STATUS_TONE[a.status]}>{STATUS_LABEL[a.status]}</StatusBadge>
              <span className={`min-w-18.5 flex-none text-right font-mono text-sm font-bold ${a.status === 'NOT_FOUND' ? 'text-muted-foreground' : 'text-primary'}`}>
                {fmtCurrency(a.amount)}
              </span>
            </button>
          ))
        )}
      </div>

      {openAudit ? <AuditDetail audit={openAudit} onClose={() => setOpenAudit(null)} /> : null}
    </div>
  );
}

function AuditDetail({ audit, onClose }: { audit: EventAudit; onClose: () => void }) {
  return (
    <DetailDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={audit.company}
      subtitle={audit.id}
      badges={
        <>
          <StatusBadge tone={audit.type === 'SWEEP' ? 'info' : 'neutral'}>{audit.type === 'SWEEP' ? 'Sweep' : 'Top-Up'}</StatusBadge>
          <StatusBadge tone={STATUS_TONE[audit.status]}>{STATUS_LABEL[audit.status]}</StatusBadge>
        </>
      }
      footer={
        <button onClick={onClose} className="rounded-xs border px-4 py-2 text-sm font-semibold text-muted-foreground hover:text-foreground">
          Close
        </button>
      }
    >
      <div className="flex flex-col gap-3.5">
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Transfer Details</div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Transfer Type" v={audit.type === 'SWEEP' ? 'Sweep' : 'Top-Up'} />
            <Row k="Status" v={<StatusBadge tone={STATUS_TONE[audit.status]}>{STATUS_LABEL[audit.status]}</StatusBadge>} />
            <Row k="Amount" v={<span className="font-mono font-bold text-primary">{fmtCurrency(audit.amount)}</span>} />
            <Row k="Carrier ID" v={<span className="font-mono">{audit.carrier}</span>} />
            <Row k="Mode at Time" v={<StatusBadge tone={audit.mode === 'CRITICAL' ? 'bad' : 'warn'}>{audit.mode}</StatusBadge>} />
          </dl>
        </section>
        <section>
          <div className="font-heading mb-2.5 text-xs font-bold tracking-wide text-primary uppercase">Execution</div>
          <dl className="flex flex-col gap-1.5 text-sm">
            <Row k="Triggered By" v={audit.by} />
            <Row k="Executed At" v={dateTimeFull(audit.at)} />
            <Row k="Audit ID" v={<span className="font-mono text-muted-foreground">{audit.id}</span>} />
            <Row k="Smart Event" v={<span className="font-mono text-muted-foreground">{audit.ref}</span>} />
            <Row k="EFS Receipt" v={audit.efs} />
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
