import { useMemo, useState } from 'react';

import { SearchBar } from '@/components/mytrion/search-bar';
import { SegmentedFilter } from '@/components/mytrion/segmented-filter';
import { StatusBadge } from '@/components/mytrion/status-badge';
import { Button } from '@/components/ui/button';
import { CARRIERS, type Carrier, carrierStatusLabel, carrierStatusTone } from './data';
import { CarrierDetailModal } from './CarrierDetailModal';

type Filter = 'all' | 'eligible' | 'active';

export function Carriers() {
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [openCarrier, setOpenCarrier] = useState<Carrier | null>(null);

  const counts = useMemo(
    () => ({
      all: CARRIERS.length,
      eligible: CARRIERS.filter((c) => c.status === 'eligible').length,
      active: CARRIERS.filter((c) => c.status === 'active').length,
    }),
    [],
  );

  const filtered = useMemo(() => {
    let rows = CARRIERS;
    if (filter !== 'all') rows = rows.filter((c) => c.status === filter);
    const q = search.trim().toLowerCase();
    if (q) rows = rows.filter((c) => `${c.name} ${c.id} ${c.phone} ${c.mc}`.toLowerCase().includes(q));
    return rows;
  }, [filter, search]);

  const filterOptions = [
    { id: 'all', label: 'All', count: counts.all },
    { id: 'eligible', label: 'Eligible', count: counts.eligible },
    { id: 'active', label: 'Clients', count: counts.active },
  ];

  return (
    <div className="flex flex-col gap-3.5 p-5">
      <div>
        <h2 className="font-heading text-2xl font-bold">Carrier Search</h2>
        <p className="text-sm text-muted-foreground">
          Search the broker snapshot by DOT number, company name, or phone — then create a lead.
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <SearchBar
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search DOT, company, or phone…"
          className="max-w-sm flex-1"
        />
        <Button variant="outline" size="sm">
          Search
        </Button>
        <SegmentedFilter options={filterOptions} value={filter} onChange={(v) => setFilter(v as Filter)} />
      </div>

      <div className="overflow-x-auto rounded-xs border bg-card">
        <div className="min-w-160">
          <div className="grid grid-cols-[2fr_1.2fr_0.7fr_1.1fr_1.1fr] gap-3 border-b bg-muted/40 px-4 py-2.5 text-[10px] font-bold tracking-wide text-muted-foreground uppercase">
            <span>Company</span>
            <span>DOT · MC</span>
            <span className="text-right">Units</span>
            <span>Phone</span>
            <span>Status</span>
          </div>
          {filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-muted-foreground">No carriers match your search.</div>
          ) : (
            filtered.map((c) => (
              <button
                key={c.id}
                onClick={() => setOpenCarrier(c)}
                className="grid w-full grid-cols-[2fr_1.2fr_0.7fr_1.1fr_1.1fr] items-center gap-3 border-b px-4 py-3 text-left text-sm last:border-b-0 hover:bg-muted/40"
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{c.name}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{c.city}</span>
                </span>
                <span className="font-mono text-[11px] leading-tight text-muted-foreground">
                  <span className="block">DOT {c.id}</span>
                  <span className="block">{c.mc}</span>
                </span>
                <span className="text-right font-mono text-muted-foreground">{c.units}</span>
                <span className="text-muted-foreground">{c.phone || '—'}</span>
                <span>
                  <StatusBadge tone={carrierStatusTone(c.status)}>{carrierStatusLabel(c.status)}</StatusBadge>
                </span>
              </button>
            ))
          )}
        </div>
      </div>

      {openCarrier ? <CarrierDetailModal carrier={openCarrier} onClose={() => setOpenCarrier(null)} /> : null}
    </div>
  );
}
