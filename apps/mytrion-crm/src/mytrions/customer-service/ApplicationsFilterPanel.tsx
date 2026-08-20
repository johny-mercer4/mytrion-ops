/**
 * Applications/Clients collapsible filter panel — date range/stage/business type/agent/Love's
 * Verification + WEX status chips. Extracted out of Applications.tsx (over the line cap once facets
 * state landed). Option lists (`facets`) come from the server now — computed over the WHOLE
 * dataset, not just the loaded page (see applicationsListQuery.ts) — so a picked Stage no longer
 * makes every OTHER Stage option vanish from this same dropdown.
 *
 * No Company Name field here (QA feedback 2026-08-17: it duplicated the header search box, which
 * already matches on company name) — the date range is one grouped control instead of two separate
 * fields, for the same reason: fewer, denser controls read better than a long flat row of them.
 */
import type { CsApplicationsFacets } from '@/api/touchpointTypes';
import { Select } from '@/ds';
import { emptyFilters, type AppFilters } from './applicationsFilters';

export function ApplicationsFilterPanel({
  filters,
  setFilters,
  facets,
  filterCount,
}: {
  filters: AppFilters;
  setFilters: (update: (f: AppFilters) => AppFilters) => void;
  facets: CsApplicationsFacets;
  filterCount: number;
}) {
  return (
    <div className="cs-app-filter-panel">
      <div className="cs-app-filter-row">
        <div className="cs-app-filter-field cs-app-filter-daterange">
          <label className="cs-app-filter-label">Date Filled</label>
          <div className="cs-app-filter-daterange-inputs">
            <input
              type="date"
              className="cs-form-input"
              value={filters.dateFrom}
              aria-label="Date Filled from"
              onChange={(e) => setFilters((f) => ({ ...f, dateFrom: e.target.value }))}
            />
            <span className="cs-app-filter-daterange-sep" aria-hidden="true">
              –
            </span>
            <input
              type="date"
              className="cs-form-input"
              value={filters.dateTo}
              aria-label="Date Filled to"
              onChange={(e) => setFilters((f) => ({ ...f, dateTo: e.target.value }))}
            />
          </div>
        </div>
        <div className="cs-app-filter-field">
          <label className="cs-app-filter-label">Stage</label>
          <select
            className="cs-form-input"
            value={filters.stage}
            onChange={(e) => setFilters((f) => ({ ...f, stage: e.target.value }))}
          >
            <option value="">All</option>
            {facets.stage.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </div>
        <div className="cs-app-filter-field">
          <label className="cs-app-filter-label">Business Type</label>
          <select
            className="cs-form-input"
            value={filters.biz}
            onChange={(e) => setFilters((f) => ({ ...f, biz: e.target.value }))}
          >
            <option value="">All</option>
            {facets.biz.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </select>
        </div>
        <div className="cs-app-filter-field">
          <Select
            label="Agent (Deal)"
            placeholder="All"
            clearable
            options={facets.agent.map((a) => ({ value: a, label: a }))}
            value={filters.agent || null}
            onChange={(v) => setFilters((f) => ({ ...f, agent: v ?? '' }))}
          />
        </div>
        <div className="cs-app-filter-field">
          <label className="cs-app-filter-label">Love's Verification</label>
          <select
            className="cs-form-input"
            value={filters.loves}
            onChange={(e) => setFilters((f) => ({ ...f, loves: e.target.value }))}
          >
            <option value="">All</option>
            {facets.loves.map((l) => (
              <option key={l} value={l}>
                {l}
              </option>
            ))}
          </select>
        </div>
        {filterCount > 0 ? (
          <button
            type="button"
            className="cs-btn cs-btn-ghost cs-app-filter-clear"
            onClick={() => setFilters(emptyFilters)}
          >
            Clear filters
          </button>
        ) : null}
      </div>
      {facets.wex.length > 0 ? (
        <div className="cs-app-filter-wex-row">
          <span className="cs-app-filter-label">WEX Status</span>
          <div className="cs-app-filter-chips">
            {facets.wex.map((w) => {
              const active = filters.wex.has(w);
              return (
                <button
                  key={w}
                  type="button"
                  className={`cs-chip is-neutral${active ? ' active' : ''}`}
                  aria-pressed={active}
                  onClick={() =>
                    setFilters((f) => {
                      const next = new Set(f.wex);
                      if (next.has(w)) next.delete(w);
                      else next.add(w);
                      return { ...f, wex: next };
                    })
                  }
                >
                  {w}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}
