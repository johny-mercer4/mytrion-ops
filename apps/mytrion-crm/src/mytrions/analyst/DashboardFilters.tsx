import { Eye } from 'lucide-react';

import type { CategoryDef, DashboardFilterParams, DateRangePreset } from './categories';
import { defaultCustomRange } from './categories';

const RANGE_OPTS: { id: DateRangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

export interface DashboardFiltersProps {
  category: CategoryDef;
  value: DashboardFilterParams;
  onChange: (next: DashboardFilterParams) => void;
}

/**
 * UI parameter bar for category dashboards — date range only.
 *
 * Agent scoping is NOT a control here: it follows the TopBar "View as" (impersonation) selection,
 * so one identity switch re-scopes the whole Mytrion instead of the dashboard carrying a second,
 * competing agent picker that could disagree with the rest of the app. This block only *reflects*
 * the already-resolved `value.agentName` that `index.tsx` computed — it must not re-derive the
 * identity, or the label could disagree with the numbers it sits above.
 */
export function DashboardFilters({ category, value, onChange }: DashboardFiltersProps) {
  const agentScoped = category.filters.includes('agent');
  const showRange = category.filters.includes('range');
  const showDates = category.filters.includes('dates') && value.range === 'custom';

  if (category.filters.length === 0) return null;

  function setRange(range: DateRangePreset) {
    if (range === 'custom') {
      const d = defaultCustomRange();
      onChange({
        ...value,
        range,
        from: value.from ?? d.from,
        to: value.to ?? d.to,
      });
      return;
    }
    onChange({ ...value, range, from: null, to: null });
  }

  const dateFiltered = value.range !== 'this_month' || Boolean(value.from || value.to);

  return (
    <div className="an-filters">
      <div className="an-filters-row">
        {showRange ? (
          <div className="an-filter-group">
            <span className="an-filter-label">Date</span>
            <div className="an-filter-pills">
              {RANGE_OPTS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="an-filter-pill"
                  aria-pressed={value.range === r.id}
                  onClick={() => setRange(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}

        {showDates ? (
          <div className="an-filter-group">
            <span className="an-filter-label">From / to</span>
            <div className="an-filter-dates">
              <input
                type="date"
                className="an-filter-input"
                value={value.from ?? ''}
                onChange={(e) => onChange({ ...value, from: e.target.value || null })}
              />
              <span className="an-filter-sep">→</span>
              <input
                type="date"
                className="an-filter-input"
                value={value.to ?? ''}
                onChange={(e) => onChange({ ...value, to: e.target.value || null })}
              />
            </div>
          </div>
        ) : null}

        {agentScoped ? (
          <div className="an-filter-group">
            <span className="an-filter-label">Sales agent</span>
            <div className="an-viewas" data-active={value.agentName ? 'true' : 'false'}>
              <Eye size={14} />
              {value.agentName ? (
                <span className="an-viewas-name">{value.agentName}</span>
              ) : (
                <span className="an-viewas-hint">
                  All agents · pick one with <strong>View as</strong>
                </span>
              )}
            </div>
          </div>
        ) : null}

        {dateFiltered ? (
          <button
            type="button"
            className="an-btn an-btn-ghost"
            onClick={() => onChange({ ...value, range: 'this_month', from: null, to: null })}
          >
            Clear dates
          </button>
        ) : null}
      </div>

      {(agentScoped && value.agentName) || dateFiltered ? (
        <div className="an-filter-chips">
          {agentScoped && value.agentName ? (
            <span className="an-chip">Agent · {value.agentName}</span>
          ) : null}
          <span className="an-chip">
            Date ·{' '}
            {value.range === 'custom'
              ? `${value.from ?? '…'} → ${value.to ?? '…'}`
              : RANGE_OPTS.find((r) => r.id === value.range)?.label}
          </span>
        </div>
      ) : null}
    </div>
  );
}
