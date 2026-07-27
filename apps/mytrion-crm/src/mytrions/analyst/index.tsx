import { useCallback, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { BarChart3, FileSpreadsheet } from 'lucide-react';
import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import { AnalystDashboard } from './tabs/AnalystDashboard';
import { AnalystReports } from './tabs/AnalystReports';
import type { AnalyticsDimension } from './data';
import './analyst.css';

/**
 * Analytics Mytrion — Dashboard (live warehouse snapshots) + Reports (catalog).
 *
 * The dashboard's DATA path is untouched: `useAnalyticsSnapshot` → GET /v1/analytics/:dimension.
 * What changed is presentation — the Tailwind `AnalyticsDashboard` was replaced by marks built on
 * the module's own Horizon tokens, matching Manager / HR / Finance.
 *
 * The active dimension stays in the URL (`?dimension=transactions`) so a view is linkable, which is
 * how the previous module behaved and what any "send me this chart" workflow depends on.
 */
type ViewId = 'dashboard' | 'reports';

const DIMENSIONS: AnalyticsDimension[] = ['pipeline', 'transactions', 'billing'];

function readDimension(v: string | null): AnalyticsDimension {
  return DIMENSIONS.includes(v as AnalyticsDimension) ? (v as AnalyticsDimension) : 'pipeline';
}

export default function AnalystMytrion() {
  const [view, setView] = useState<ViewId>('dashboard');
  const [searchParams, setSearchParams] = useSearchParams();
  const dimension = readDimension(searchParams.get('dimension'));

  const onDimensionChange = useCallback(
    (next: AnalyticsDimension) => {
      const params = new URLSearchParams(searchParams);
      params.set('dimension', next);
      setSearchParams(params, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const navSections: NavSection[] = [
    {
      id: 'analytics',
      label: 'Analytics',
      items: [
        {
          key: 'dashboard',
          label: 'Dashboard',
          icon: <BarChart3 size={19} />,
          tone: 'var(--tone-sky)',
          active: view === 'dashboard',
          onClick: () => setView('dashboard'),
          keywords: ['kpis', 'trend', 'pipeline', 'transactions', 'billing'],
        },
        {
          key: 'reports',
          label: 'Reports',
          icon: <FileSpreadsheet size={19} />,
          tone: 'var(--tone-violet)',
          active: view === 'reports',
          onClick: () => setView('reports'),
          keywords: ['export', 'sheet', 'catalog'],
        },
      ],
    },
  ];

  return (
    <div data-mytrion="analyst" className="contents">
      <MytrionShell id="analyst" navSections={navSections} enableNavSearch>
        <div className="an-root">
          {view === 'dashboard' ? (
            <AnalystDashboard dimension={dimension} onDimensionChange={onDimensionChange} />
          ) : (
            <AnalystReports />
          )}
        </div>
      </MytrionShell>
    </div>
  );
}
