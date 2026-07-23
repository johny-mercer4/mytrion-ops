import { BarChart3 } from 'lucide-react';

import { MytrionShell, type NavItem } from '../_shared/MytrionShell';
import { Dashboard } from './Dashboard';

/** Analytics Mytrion — warehouse snapshots via shared AnalyticsDashboard components + the live analyst chat dock. */
export default function AnalystMytrion() {
  const nav: NavItem[] = [
    { key: 'overview', label: 'Overview', icon: <BarChart3 size={19} />, active: true },
  ];

  return (
    <div data-mytrion="analyst" className="contents">
      <MytrionShell id="analyst" nav={nav}>
        <Dashboard />
      </MytrionShell>
    </div>
  );
}
