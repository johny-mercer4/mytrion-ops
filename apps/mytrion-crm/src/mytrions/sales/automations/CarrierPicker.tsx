/**
 * Debounced client typeahead over the DWH client directory (GET /v1/carrier-clients via
 * searchClients) — replaces the modal's hardcoded demo carrier. Emits an AutomationTarget;
 * entries without a carrier id are selectable only for application-keyed automations.
 */
import { useEffect, useRef, useState } from 'react';
import { Loader2, Search, X } from 'lucide-react';

import { searchClients, type DwhClient } from '@/api/carrierUsers';
import type { AutomationTarget } from './specs';

export function CarrierPicker({
  value,
  onChange,
  needsApplicationId = false,
}: {
  value: AutomationTarget | null;
  onChange: (target: AutomationTarget | null) => void;
  needsApplicationId?: boolean;
}) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<DwhClient[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const seq = useRef(0);

  useEffect(() => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const mySeq = ++seq.current;
    const timer = window.setTimeout(() => {
      searchClients(q, 8)
        .then((clients) => {
          if (seq.current !== mySeq) return;
          setResults(clients);
          setOpen(true);
        })
        .catch(() => seq.current === mySeq && setResults([]))
        .finally(() => seq.current === mySeq && setSearching(false));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  if (value) {
    return (
      <div className="flex items-center justify-between rounded-md border bg-muted/40 px-3 py-2 text-sm">
        <span className="font-semibold">
          {value.companyName}
          <span className="ml-2 font-normal text-muted-foreground">
            {value.carrierId ? `#${value.carrierId}` : `app ${value.applicationId ?? '?'}`}
          </span>
        </span>
        <button
          type="button"
          aria-label="Clear client"
          onClick={() => onChange(null)}
          className="rounded p-0.5 text-muted-foreground hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-md border bg-muted/40 px-3 py-2">
        {searching ? (
          <Loader2 className="size-4 animate-spin text-muted-foreground" />
        ) : (
          <Search className="size-4 text-muted-foreground" />
        )}
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onFocus={() => results.length > 0 && setOpen(true)}
          placeholder="Search your clients — company, carrier id, application id"
          className="w-full bg-transparent text-sm outline-none"
        />
      </div>
      {open && results.length > 0 ? (
        <ul className="absolute z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 shadow-md">
          {results.map((c, i) => {
            const selectable = needsApplicationId ? Boolean(c.applicationId) : Boolean(c.carrierId);
            return (
              <li key={`${c.carrierId ?? c.applicationId ?? i}`}>
                <button
                  type="button"
                  disabled={!selectable}
                  onClick={() => {
                    onChange({
                      carrierId: c.carrierId,
                      applicationId: c.applicationId,
                      companyName: c.companyName ?? '(unnamed)',
                    });
                    setOpen(false);
                    setQuery('');
                  }}
                  className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-sm hover:bg-accent disabled:opacity-40"
                >
                  <span className="truncate font-medium">{c.companyName ?? '(unnamed)'}</span>
                  <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                    {c.carrierId ? `#${c.carrierId}` : c.applicationId ? `app ${c.applicationId}` : 'no id'}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
