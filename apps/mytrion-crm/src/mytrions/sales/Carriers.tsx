import { useMemo, useState } from 'react';
import { ExternalLink, Loader2, Search } from 'lucide-react';

import type { CarrierSearchRow } from '@/api/touchpointTypes';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge, type StatusTone } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { createLeadFromCarrier, leadUrl, searchCarriers, type LeadOutcome } from './live';
import { useToast } from './Toast';

// Widget carrier-search: POST /api/sales/carriers/search {query, limit}; client-side
// status filters over the fetched window; per-row Create Lead (mytrioncreatelead).
type StatusFilter = 'all' | 'authorized' | 'not-authorized' | 'oos';

function statusKey(status: string | undefined): StatusFilter {
  const s = (status ?? '').toLowerCase();
  if (/^authorized/.test(s) || s === 'active') return 'authorized';
  if (/out.of.service|revoked/.test(s)) return 'oos';
  return 'not-authorized';
}

function statusTone(status: string | undefined): StatusTone {
  const key = statusKey(status);
  return key === 'authorized' ? 'good' : key === 'oos' ? 'bad' : 'warn';
}

export function Carriers() {
  const { push } = useToast();
  const [query, setQuery] = useState('');
  const [limit, setLimit] = useState(200);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [rows, setRows] = useState<CarrierSearchRow[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [leadBusy, setLeadBusy] = useState<string | null>(null);
  const [leadResults, setLeadResults] = useState<Record<string, LeadOutcome>>({});

  async function runSearch() {
    const q = query.trim();
    if (!q || searching) return;
    setSearching(true);
    setError(null);
    try {
      const res = await searchCarriers(q, limit);
      setRows(res.carriers ?? []);
      setTotal(res.total ?? res.carriers?.length ?? 0);
      setFilter('all');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setSearching(false);
    }
  }

  const rowKey = (r: CarrierSearchRow): string => String(r.id ?? r.dot_number ?? '');

  const counts = useMemo(
    () => ({
      all: rows.length,
      authorized: rows.filter((r) => statusKey(r.operating_status) === 'authorized').length,
      'not-authorized': rows.filter((r) => statusKey(r.operating_status) === 'not-authorized').length,
      oos: rows.filter((r) => statusKey(r.operating_status) === 'oos').length,
    }),
    [rows],
  );

  const filtered = useMemo(
    () => (filter === 'all' ? rows : rows.filter((r) => statusKey(r.operating_status) === filter)),
    [rows, filter],
  );

  async function createLead(row: CarrierSearchRow) {
    const key = rowKey(row);
    if (leadBusy) return;
    setLeadBusy(key);
    try {
      const outcome = await createLeadFromCarrier(row);
      setLeadResults((prev) => ({ ...prev, [key]: outcome }));
      if (outcome.status === 'created') push('success', `Lead created for ${row.owner_full_name ?? 'carrier'}.`);
      else if (outcome.status === 'duplicate') push('info', 'This carrier already has a lead in CRM.');
      else push('error', outcome.message);
    } catch (err) {
      push('error', err instanceof Error ? err.message : 'Lead creation failed.');
    } finally {
      setLeadBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4 p-6">
      <div>
        <h2 className="font-heading text-2xl font-bold">Carrier Search</h2>
        <p className="text-sm text-muted-foreground">
          FMCSA broker snapshot — search by DOT, company, or phone; create leads in one click.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="flex max-w-md flex-1 items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
          <Search className="size-4 text-muted-foreground" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void runSearch()}
            placeholder="DOT number, company name, or phone…"
            className="w-full bg-transparent text-sm outline-none"
          />
        </div>
        <select
          value={limit}
          onChange={(e) => setLimit(Number(e.target.value))}
          className="rounded-md border bg-muted/40 px-2 py-2 text-xs font-semibold"
          aria-label="Fetch limit"
        >
          <option value={200}>200 results</option>
          <option value={500}>500 results</option>
        </select>
        <Button onClick={() => void runSearch()} disabled={searching || !query.trim()}>
          {searching ? <Loader2 className="size-4 animate-spin" /> : <Search className="size-4" />}
          Search
        </Button>
      </div>

      {rows.length > 0 ? (
        <div className="flex flex-wrap items-center gap-3">
          <SegmentedFilter
            options={[
              { id: 'all', label: 'All', count: counts.all },
              { id: 'authorized', label: 'Authorized', count: counts.authorized },
              { id: 'not-authorized', label: 'Not Authorized', count: counts['not-authorized'] },
              { id: 'oos', label: 'Out of Service', count: counts.oos },
            ]}
            value={filter}
            onChange={(v) => setFilter(v as StatusFilter)}
          />
          {total != null ? (
            <span className="text-xs text-muted-foreground">
              {total.toLocaleString('en-US')} match{total === 1 ? '' : 'es'}
            </span>
          ) : null}
        </div>
      ) : null}

      {error ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm">
          <p className="text-bad">{error}</p>
          <Button variant="outline" size="sm" className="mt-3" onClick={() => void runSearch()}>
            Retry
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-lg border bg-card p-10 text-center text-sm text-muted-foreground">
          {searching ? 'Searching…' : 'Search the FMCSA snapshot to find carrier prospects.'}
        </div>
      ) : (
        <div className="overflow-x-auto rounded-lg border bg-card">
          <div className="min-w-200">
            <div className="grid grid-cols-[0.7fr_1.8fr_1fr_1.4fr_1fr_0.6fr_1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
              <span>DOT</span>
              <span>Owner</span>
              <span>Phone</span>
              <span>Email</span>
              <span>Status</span>
              <span className="text-right">Units</span>
              <span className="text-right">Lead</span>
            </div>
            {filtered.map((r) => {
              const key = rowKey(r);
              const outcome = leadResults[key];
              return (
                <div
                  key={key}
                  className="grid grid-cols-[0.7fr_1.8fr_1fr_1.4fr_1fr_0.6fr_1fr] items-center gap-3 border-b px-4 py-3 text-sm last:border-b-0"
                >
                  <span className="font-mono text-xs">{r.dot_number ?? '—'}</span>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold">{r.owner_full_name ?? '—'}</span>
                    {r.physical_address ? (
                      <span className="block truncate text-[10.5px] text-muted-foreground">{r.physical_address}</span>
                    ) : null}
                  </span>
                  <span className="font-mono text-xs">{r.phone_number ?? '—'}</span>
                  <span className="truncate text-xs">{r.email ?? '—'}</span>
                  <span>
                    <StatusBadge tone={statusTone(r.operating_status)}>{r.operating_status ?? 'unknown'}</StatusBadge>
                  </span>
                  <span className="text-right font-mono text-xs">{r.power_units ?? '—'}</span>
                  <span className="text-right">
                    {outcome && outcome.status !== 'failed' ? (
                      outcome.leadId ? (
                        <a
                          href={leadUrl(outcome.leadId)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                        >
                          <ExternalLink className="size-3" />
                          {outcome.status === 'created' ? `Lead #${outcome.leadId.slice(-6)}` : 'Exists'}
                        </a>
                      ) : (
                        <span className="text-xs text-muted-foreground">Exists</span>
                      )
                    ) : (
                      <Button variant="outline" size="sm" disabled={leadBusy !== null} onClick={() => void createLead(r)}>
                        {leadBusy === key ? <Loader2 className="size-3 animate-spin" /> : null}
                        Create Lead
                      </Button>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
