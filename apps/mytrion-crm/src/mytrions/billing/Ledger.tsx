/**
 * Billing Ledger panel — the AR accounting module (TZ §5).
 *
 * Owns the chrome shared by every ledger surface: the grouped sub-nav, the period bar and the filter
 * bar. Each sub-surface is its own component; this file never renders a table.
 *
 * Sub-nav rather than seven sidebar tabs: the shell already owns the left rail, and the prototype's
 * second vertical rail would be cramped inside a 216px-offset content area. Sub-surfaces lazy-MOUNT
 * on first visit and stay mounted (display:contents/none), which is the shell's own trick — state
 * survives a hop.
 *
 * The period bar is APPLY-GATED: only `applied` is ever in a `useLoad` dep list. The prototype also
 * recomputes on every date `change` event; a cumulative recompute per keystroke is not something to
 * port. Applying RESETS the mount map to just the active surface, so exactly one request fires per
 * Apply and numbers computed for a previous period can never sit under a new period label.
 */
import { useMemo, useState, type ReactNode } from 'react';

import { useUserContext } from '../../context/UserContextProvider';
import { canWriteMytrion } from '../../access/resolveAccess';
import { LedgerStatementModal } from './LedgerStatementModal';
import { LedgerTable, type StatementTarget } from './LedgerTable';
import { OpeningBalances } from './OpeningBalances';
import { OpeningManualModal } from './OpeningManualModal';
import {
  LEDGER_DEFAULT_TAB,
  LEDGER_GROUPS,
  LEDGER_TABS,
  getLedgerTab,
  type LedgerTabId,
} from './ledgerSections';
import type { LedgerSectionId } from '../../api/ledgerTypes';
import { defaultRange, isValidRange, rangesEqual, type LedgerRange } from './ledgerModel';

const P_SEARCH = 'M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z';
const P_CLOSE = 'M6 18L18 6M6 6l12 12';

/** Filters the ledger surfaces share. Rendered CONDITIONALLY — see `visibleFilters`. */
export interface LedgerFilters {
  carrierId: string;
  company: string;
  billingCycle: string;
  date: string;
}

const EMPTY_FILTERS: LedgerFilters = { carrierId: '', company: '', billingCycle: '', date: '' };

/**
 * Which filter inputs actually do something on a given surface.
 *
 * The prototype renders all four on every panel, where Date and Billing Cycle match `[data-col]`
 * cells that exist on only some of them — so two of the four inputs are dead on four of seven panels.
 * Rendering an input that provably cannot filter anything is worse than omitting it.
 */
function visibleFilters(tab: LedgerTabId): (keyof LedgerFilters)[] {
  if (tab === 'openings') return [];
  if (tab === 'unbilled') return ['carrierId', 'company', 'billingCycle'];
  if (tab === 'transitions' || tab === 'payments') return ['carrierId', 'company', 'date'];
  return ['carrierId', 'company'];
}

export function Ledger() {
  const user = useUserContext();
  const canWrite = canWriteMytrion(user, 'billing');

  const [active, setActive] = useState<LedgerTabId>(LEDGER_DEFAULT_TAB);
  const [mounted, setMounted] = useState<Partial<Record<LedgerTabId, boolean>>>({
    [LEDGER_DEFAULT_TAB]: true,
  });

  // Period: `draft` is what the inputs show, `applied` is what any fetch may use.
  const [draft, setDraft] = useState<LedgerRange>(defaultRange);
  const [applied, setApplied] = useState<LedgerRange>(defaultRange);
  const [filters, setFilters] = useState<LedgerFilters>(EMPTY_FILTERS);
  const [statement, setStatement] = useState<StatementTarget | null>(null);
  /** Set from a section row's "no opening balance" caption — fix the gap where it is discovered. */
  const [fixOpeningFor, setFixOpeningFor] = useState<string | null>(null);
  /** Bumped after a manual save so the visible section recomputes with the new opening. */
  const [dataVersion, setDataVersion] = useState(0);

  const activeDef = getLedgerTab(active);
  const shown = visibleFilters(active);
  const dirty = !rangesEqual(draft, applied);
  const canApply = isValidRange(draft) && dirty;

  function navigate(id: LedgerTabId, disabled?: boolean): void {
    if (disabled) return;
    setActive(id);
    setMounted((m) => (m[id] ? m : { ...m, [id]: true }));
  }

  function applyPeriod(): void {
    if (!canApply) return;
    setApplied(draft);
    // Drop every period-driven surface so only the visible one refetches. Surfaces that ignore the
    // period keep their mount — unmounting them would be pure waste.
    setMounted((m) => {
      const next: Partial<Record<LedgerTabId, boolean>> = { [active]: true };
      for (const tab of LEDGER_TABS) {
        if (!tab.periodDriven && m[tab.id]) next[tab.id] = true;
      }
      return next;
    });
  }

  function clearFilters(): void {
    setFilters(EMPTY_FILTERS);
  }

  const surfaces = useMemo<Partial<Record<LedgerTabId, ReactNode>>>(() => {
    const map: Partial<Record<LedgerTabId, ReactNode>> = {
      openings: <OpeningBalances canWrite={canWrite} />,
    };
    // One generic table, five configured sections — see ./LedgerTable.tsx.
    for (const tab of LEDGER_TABS) {
      if (!tab.isBalanceSection || tab.disabled) continue;
      map[tab.id] = (
        <LedgerTable
          // Keyed on the applied period so a stale reply can never render under a new period label.
          key={`${tab.id}:${applied.from}:${applied.to}:${dataVersion}`}
          section={tab.id as LedgerSectionId}
          range={applied}
          filters={filters}
          canWrite={canWrite}
          onOpenStatement={setStatement}
          onFixOpening={setFixOpeningFor}
        />
      );
    }
    return map;
  }, [canWrite, applied, filters, dataVersion]);

  const surface = (id: LedgerTabId): ReactNode => {
    const node = surfaces[id];
    if (!node || !mounted[id]) return null;
    return <div style={{ display: active === id ? 'contents' : 'none' }}>{node}</div>;
  };

  const filterLabels: Record<keyof LedgerFilters, string> = {
    carrierId: 'Carrier ID',
    company: 'Company',
    billingCycle: 'Billing Cycle',
    date: 'Date',
  };
  const filterPlaceholders: Record<keyof LedgerFilters, string> = {
    carrierId: 'e.g. 5762018',
    company: 'e.g. ONZMOVE',
    billingCycle: 'e.g. Weekly',
    date: 'yyyy-mm-dd',
  };

  return (
    <div className="bm-panel bm-ledger-panel">
      <div className="bm-header-row">
        <div>
          <h2 className="bm-title">Ledger</h2>
          <div className="bm-subtitle">
            Separate sub-ledgers per client type — Closing = Opening + Debit − Credit, each reconciled
            against EFS or CMP
          </div>
        </div>
      </div>

      {/* ── Grouped sub-nav ── */}
      <nav className="lg-subnav" aria-label="Ledger sections">
        {LEDGER_GROUPS.map((group) => {
          const tabs = LEDGER_TABS.filter((t) => t.group === group);
          if (!tabs.length) return null;
          return (
            <div className="lg-subnav-group" key={group}>
              <span className="lg-subnav-label">{group}</span>
              <div className="lg-subnav-btns">
                {tabs.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    className={`lg-subnav-btn${active === tab.id ? ' lg-subnav-btn-active' : ''}${
                      tab.disabled ? ' lg-subnav-btn-parked' : ''
                    }`}
                    disabled={tab.disabled}
                    aria-current={active === tab.id ? 'page' : undefined}
                    title={tab.disabled ? 'Coming soon' : tab.label}
                    onClick={() => navigate(tab.id, tab.disabled)}
                  >
                    <span className="lg-subnav-btn-text">{tab.shortLabel}</span>
                    {tab.disabled ? <span className="lg-subnav-soon">Soon</span> : null}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </nav>

      {/* ── Period bar — hidden where it would do nothing ── */}
      {activeDef.periodDriven ? (
        <div className={`lg-period-bar${dirty ? ' lg-period-dirty' : ''}`}>
          <span className="lg-period-label">Period</span>
          <input
            type="date"
            className="lg-period-input"
            value={draft.from}
            max={draft.to || undefined}
            onChange={(e) => setDraft((r) => ({ ...r, from: e.target.value }))}
            aria-label="Period start"
          />
          <span className="lg-period-dash">—</span>
          <input
            type="date"
            className="lg-period-input"
            value={draft.to}
            min={draft.from || undefined}
            onChange={(e) => setDraft((r) => ({ ...r, to: e.target.value }))}
            aria-label="Period end"
          />
          <button type="button" className="lg-period-apply" disabled={!canApply} onClick={applyPeriod}>
            Apply
          </button>
          <span className="lg-period-hint">
            {dirty
              ? 'Press Apply to recompute — the figures below are still for the previous period.'
              : 'Opening is the balance at the period start, accumulated from each carrier’s opening-balance date. Both dates are inclusive.'}
          </span>
        </div>
      ) : null}

      {/* ── Filter bar — only the inputs that apply to this surface ── */}
      {shown.length ? (
        <div className="lg-filter-bar">
          {shown.map((key) => (
            <label className="lg-filter-field" key={key}>
              <span className="lg-filter-label">{filterLabels[key]}</span>
              <input
                type="text"
                value={filters[key]}
                placeholder={filterPlaceholders[key]}
                onChange={(e) => setFilters((f) => ({ ...f, [key]: e.target.value }))}
              />
            </label>
          ))}
          <button type="button" className="lg-filter-clear" onClick={clearFilters}>
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_CLOSE} />
            </svg>
            Reset
          </button>
          <span className="lg-filter-hint">
            <svg width="12" height="12" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d={P_SEARCH} />
            </svg>
            Filters the rows already computed for this section
          </span>
        </div>
      ) : null}

      {/* ── Surfaces ── */}
      {LEDGER_TABS.map((tab) => (
        <div key={tab.id}>{surface(tab.id)}</div>
      ))}

      {/* Parked entries (transitions, payments) have no surface, so say so rather than render blank. */}
      {activeDef.disabled ? (
        <div className="db-empty-state">{activeDef.label} is not available yet.</div>
      ) : null}

      {statement ? (
        <LedgerStatementModal
          key={`${statement.carrierId}:${statement.section}:${applied.from}:${applied.to}`}
          carrierId={statement.carrierId}
          companyName={statement.companyName}
          section={statement.section}
          sectionLabel={getLedgerTab(statement.section).label}
          column={statement.column}
          range={applied}
          onClose={() => setStatement(null)}
        />
      ) : null}

      {fixOpeningFor !== null ? (
        <OpeningManualModal
          key={`fix-${fixOpeningFor}`}
          initialCarrierId={fixOpeningFor}
          onClose={() => setFixOpeningFor(null)}
          onSaved={() => {
            setFixOpeningFor(null);
            // The section's opening changed, so the whole computation for it is stale.
            setDataVersion((v) => v + 1);
          }}
        />
      ) : null}
    </div>
  );
}
