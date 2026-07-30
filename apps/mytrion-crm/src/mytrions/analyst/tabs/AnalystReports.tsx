import {
  BarChart3,
  Building2,
  Download,
  FileSpreadsheet,
  Fuel,
  Receipt,
  TrendingUp,
  Users,
  Wallet,
} from 'lucide-react';

/**
 * Analytics → Reports. The catalog of standing reports.
 *
 * STRUCTURAL ONLY — nothing generates a file yet. Each card names its real source so the later
 * build has an unambiguous starting point, and every action is disabled with a reason rather than
 * looking live and doing nothing.
 */

interface ReportDef {
  id: string;
  title: string;
  desc: string;
  /** The real table / endpoint this report will read when it is built. */
  source: string;
  icon: typeof BarChart3;
  tone: string;
}

const REPORTS: ReportDef[] = [
  {
    id: 'fuel-volume',
    title: 'Fuel volume',
    desc: 'Gallons and spend by carrier, product and period, with month-over-month movement.',
    source: 'octane.mart_transaction_line_items',
    icon: Fuel,
    tone: 'var(--an-s1)',
  },
  {
    id: 'receivables',
    title: 'Receivables ageing',
    desc: 'Outstanding balances bucketed by age, per carrier and per billing cycle.',
    source: 'public.cmp_invoice',
    icon: Wallet,
    tone: 'var(--an-s2)',
  },
  {
    id: 'pipeline',
    title: 'Pipeline conversion',
    desc: 'Lead → deal → first swipe conversion and stage dwell time across the sales org.',
    source: 'Zoho CRM · octane.dim_company',
    icon: TrendingUp,
    tone: 'var(--an-s3)',
  },
  {
    id: 'agent-perf',
    title: 'Agent performance',
    desc: 'Per-agent book size, gallons, retention and debt exposure.',
    source: 'octane.dim_company · mart_transaction_line_items',
    icon: Users,
    tone: 'var(--an-s4)',
  },
  {
    id: 'billing-recon',
    title: 'Billing reconciliation',
    desc: 'Invoiced vs collected by cycle, with unmapped payments and split allocations.',
    source: 'cmp_invoice · payment_transactions',
    icon: Receipt,
    tone: 'var(--an-s5)',
  },
  {
    id: 'client-health',
    title: 'Client health',
    desc: 'Activity, loyalty tier, debt and card utilisation in one per-carrier sheet.',
    source: 'dim_company · cmp_invoice · mart',
    icon: Building2,
    tone: 'var(--an-s6)',
  },
];

export function AnalystReports() {
  return (
    <div className="an-page">
      <header className="an-head">
        <div>
          <div className="an-kicker">Analytics</div>
          <h1 className="an-title">Reports</h1>
          <p className="an-sub">
            Standing reports across the warehouse. Each one names the source it will read — the
            generation and export path is not built yet.
          </p>
        </div>
      </header>

      <div className="an-banner">
        <FileSpreadsheet size={15} />
        <span>
          <strong>Catalog only.</strong> These reports are defined but not yet generated —
          running and exporting them lands with the reporting backend.
        </span>
      </div>

      <div className="an-rep-grid">
        {REPORTS.map((r) => (
          <article key={r.id} className="an-rep" style={{ ['--t' as string]: r.tone }}>
            <div className="an-rep-top">
              <span className="an-rep-glyph">
                <r.icon size={18} />
              </span>
              <span className="an-tag is-soon">Soon</span>
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
                disabled
                title="Report generation is not built yet."
              >
                <Download size={14} />
                Export
              </button>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
