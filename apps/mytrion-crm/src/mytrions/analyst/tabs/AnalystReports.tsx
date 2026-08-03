import { useState } from 'react';
import {
  BarChart3,
  Building2,
  Check,
  Download,
  Fuel,
  Loader2,
  Receipt,
  TrendingUp,
  TriangleAlert,
  Users,
  Wallet,
} from 'lucide-react';

import { fetchAnalyticsReport } from '@/api/analytics';

import type { DashboardFilterParams, DateRangePreset } from '../categories';
import { defaultCustomRange } from '../categories';
import { exportReportXlsx } from '../reportsExport';

/**
 * Analytics → Reports. Standing reports, run against the warehouse and exported as .xlsx.
 *
 * Was catalog-only: every card was disabled with "not built yet". Each one now runs
 * `GET /v1/analytics/reports/:id` for the selected window and writes a styled workbook in the
 * browser (see ../reportsExport.ts).
 *
 * The date filter matches the dashboards — Today / Last 7 days / This month / Custom — so a report
 * covers exactly the window the user was just looking at. Agent scope follows the TopBar "View as"
 * selection, applied server-side, the same as every other analytics read.
 */

interface ReportCard {
  id: string;
  title: string;
  desc: string;
  source: string;
  icon: typeof BarChart3;
  tone: string;
}

const REPORTS: ReportCard[] = [
  {
    id: 'fuel-volume',
    title: 'Fuel volume',
    desc: 'Gallons and spend by carrier, with cards, transactions and average price per gallon.',
    source: 'mart_sales_dashboard_card_base',
    icon: Fuel,
    tone: 'var(--an-s1)',
  },
  {
    id: 'receivables',
    title: 'Receivables ageing',
    desc: 'Open invoices per carrier bucketed by age, with the overdue split.',
    source: 'public.cmp_invoice',
    icon: Wallet,
    tone: 'var(--an-s2)',
  },
  {
    id: 'pipeline',
    title: 'Pipeline conversion',
    desc: 'Per-agent deal funnel — app fills through cards sent and first swipe.',
    source: 'zoho_deals · zoho_users',
    icon: TrendingUp,
    tone: 'var(--an-s3)',
  },
  {
    id: 'agent-perf',
    title: 'Agent performance',
    desc: 'Per-agent book size, volume, revenue and debt exposure.',
    source: 'card_base · dim_company',
    icon: Users,
    tone: 'var(--an-s4)',
  },
  {
    id: 'billing-recon',
    title: 'Billing reconciliation',
    desc: 'Invoiced vs collected per carrier and cycle, with the gap and failed payments.',
    source: 'cmp_invoice · cmp_invoice_payment',
    icon: Receipt,
    tone: 'var(--an-s5)',
  },
  {
    id: 'client-health',
    title: 'Client health',
    desc: 'Activity, tier, cards, debt and volume in one per-carrier sheet.',
    source: 'dim_company · card_base',
    icon: Building2,
    tone: 'var(--an-s6)',
  },
];

const RANGE_OPTS: { id: DateRangePreset; label: string }[] = [
  { id: 'today', label: 'Today' },
  { id: 'last_7_days', label: 'Last 7 days' },
  { id: 'this_month', label: 'This month' },
  { id: 'custom', label: 'Custom' },
];

function rangeLabel(f: DashboardFilterParams): string {
  if (f.range === 'custom') return `${f.from ?? '…'} → ${f.to ?? '…'}`;
  return RANGE_OPTS.find((r) => r.id === f.range)?.label ?? 'This month';
}

type CardState = { status: 'idle' | 'running' | 'done' | 'error'; message?: string };

export interface AnalystReportsProps {
  /** Agent scope from the shell — follows the TopBar "View as" selection. */
  filters: DashboardFilterParams;
}

export function AnalystReports({ filters }: AnalystReportsProps) {
  const [range, setRange] = useState<DateRangePreset>('this_month');
  const [custom, setCustom] = useState(() => defaultCustomRange());
  const [state, setState] = useState<Record<string, CardState>>({});

  const active: DashboardFilterParams = {
    ...filters,
    range,
    from: range === 'custom' ? custom.from : null,
    to: range === 'custom' ? custom.to : null,
  };

  async function runExport(reportId: string) {
    setState((s) => ({ ...s, [reportId]: { status: 'running' } }));
    try {
      const result = await fetchAnalyticsReport(reportId, {
        agent: active.agentId,
        agentName: active.agentName,
        range: active.range,
        from: active.from,
        to: active.to,
      });
      if (result.rows.length === 0) {
        setState((s) => ({
          ...s,
          [reportId]: { status: 'error', message: 'No rows in this window' },
        }));
        return;
      }
      await exportReportXlsx(result, {
        rangeLabel: rangeLabel(active),
        agentName: active.agentName,
      });
      setState((s) => ({
        ...s,
        [reportId]: { status: 'done', message: `${result.rows.length.toLocaleString('en-US')} rows` },
      }));
    } catch (e) {
      setState((s) => ({
        ...s,
        [reportId]: { status: 'error', message: e instanceof Error ? e.message : 'Export failed' },
      }));
    }
  }

  return (
    <div className="an-page">
      <header className="an-head">
        <div>
          <div className="an-kicker">Analytics</div>
          <h1 className="an-title">Reports</h1>
          <p className="an-sub">
            Standing reports across the warehouse. Pick a window and export a spreadsheet.
          </p>
        </div>
      </header>

      <div className="an-filters">
        <div className="an-filters-row">
          <div className="an-filter-group">
            <span className="an-filter-label">Date</span>
            <div className="an-filter-pills">
              {RANGE_OPTS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  className="an-filter-pill"
                  aria-pressed={range === r.id}
                  onClick={() => setRange(r.id)}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>

          {range === 'custom' ? (
            <div className="an-filter-group">
              <span className="an-filter-label">From / to</span>
              <div className="an-filter-dates">
                <input
                  type="date"
                  className="an-filter-input"
                  value={custom.from}
                  max={custom.to}
                  onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value || c.from }))}
                />
                <span className="an-filter-sep">→</span>
                <input
                  type="date"
                  className="an-filter-input"
                  value={custom.to}
                  min={custom.from}
                  onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value || c.to }))}
                />
              </div>
            </div>
          ) : null}
        </div>

        <div className="an-filter-chips">
          {filters.agentName ? <span className="an-chip">Agent · {filters.agentName}</span> : null}
          <span className="an-chip">Date · {rangeLabel(active)}</span>
        </div>
      </div>

      <div className="an-rep-grid">
        {REPORTS.map((r) => {
          const st = state[r.id] ?? { status: 'idle' as const };
          const running = st.status === 'running';
          return (
            <article key={r.id} className="an-rep" style={{ ['--t' as string]: r.tone }}>
              <div className="an-rep-top">
                <span className="an-rep-glyph">
                  <r.icon size={18} />
                </span>
                <span className="an-tag">xlsx</span>
              </div>
              <span className="an-rep-title">{r.title}</span>
              <span className="an-rep-desc">{r.desc}</span>
              <div className="an-rep-foot">
                <span className="an-tag">{r.source}</span>
              </div>
              <div className="an-rep-foot">
                <button
                  type="button"
                  className="an-btn"
                  onClick={() => void runExport(r.id)}
                  disabled={running}
                >
                  {running ? (
                    <Loader2 size={14} className="an-spin" />
                  ) : st.status === 'done' ? (
                    <Check size={14} />
                  ) : (
                    <Download size={14} />
                  )}
                  {running ? 'Building…' : 'Export'}
                </button>
                {st.status !== 'idle' && !running && st.message ? (
                  <span
                    className={st.status === 'error' ? 'an-rep-note is-err' : 'an-rep-note'}
                    role={st.status === 'error' ? 'alert' : undefined}
                  >
                    {st.status === 'error' ? <TriangleAlert size={12} /> : null}
                    {st.message}
                  </span>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
