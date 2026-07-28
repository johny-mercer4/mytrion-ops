import { useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';

import { isAdmin } from '@/access/resolveAccess';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { useUserContext } from '@/context/UserContextProvider';

import { MytrionShell, type NavSection } from '../_shared/MytrionShell';
import {
  ANALYTICS_CATEGORIES,
  categoryById,
  parseFilters,
  writeFilters,
  type AnalyticsCategory,
  type DashboardFilterParams,
} from './categories';
import { CategoryDashboard } from './tabs/CategoryDashboard';
import { AnalystReports } from './tabs/AnalystReports';
import './analyst.css';

/**
 * Analytics Mytrion — category dashboards in the sidebar (Sales, CRM, Customer Service, Finance,
 * Billing, Transactions) + Reports.
 *
 * The date window lives in the URL so a view stays shareable:
 *   /main/analystmytrion?category=sales&range=last_7_days
 * The agent does NOT: it follows the TopBar "View as" selection, which is already the app-wide way
 * to look at one rep's book and is persisted per Mytrion. The dashboard used to carry its own
 * "Sales agent" picker, which meant two controls could disagree about whose numbers were on screen.
 */
export default function AnalystMytrion() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { actingAs } = useImpersonation();
  const user = useUserContext();
  const category = categoryById(searchParams.get('category'));
  const urlFilters = useMemo(() => parseFilters(searchParams), [searchParams]);

  /**
   * Date window comes from the URL; the agent identity comes from "View as", not a second picker.
   *
   * Resolution order:
   *   1. Acting as someone (TopBar "View as") → that agent's book.
   *   2. Not an admin → their OWN book. A plain rep has no View-as control at all, so without this
   *      they would be stranded on org-wide figures; scoping to self is also what the backend
   *      would force anyway (analytics.routes.ts pins non-admins to their own Zoho id).
   *   3. Admin, not acting → org-wide.
   *
   * Only applied to categories flagged agent-scopable — Customer Service reads Zoho Desk, whose
   * assignee ids are a different org id space from CRM users, so an agent filter there is one the
   * warehouse cannot honor (see modules/analytics/dimensions/support.ts).
   */
  const agentScoped = category.filters.includes('agent');
  const filters = useMemo((): DashboardFilterParams => {
    if (!agentScoped) return { ...urlFilters, agentId: null, agentName: null };
    if (actingAs) {
      return { ...urlFilters, agentId: actingAs.zohoUserId, agentName: actingAs.name };
    }
    if (!isAdmin(user)) {
      return { ...urlFilters, agentId: user.userId, agentName: user.userName || user.userId };
    }
    return { ...urlFilters, agentId: null, agentName: null };
  }, [urlFilters, agentScoped, actingAs, user]);

  const setCategory = useCallback(
    (id: AnalyticsCategory) => {
      const next = new URLSearchParams(searchParams);
      next.set('category', id);
      // Drop dimension leftover from the old Dashboard tab.
      next.delete('dimension');
      setSearchParams(next, { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const onFiltersChange = useCallback(
    (nextFilters: DashboardFilterParams) => {
      setSearchParams(writeFilters(searchParams, nextFilters), { replace: true });
    },
    [searchParams, setSearchParams],
  );

  const navSections: NavSection[] = [
    {
      id: 'dashboards',
      label: 'Analytics',
      items: ANALYTICS_CATEGORIES.map((c) => ({
        key: c.id,
        label: c.label,
        icon: <c.icon size={19} />,
        tone: c.tone,
        active: category.id === c.id,
        onClick: () => setCategory(c.id),
        keywords: c.keywords,
      })),
    },
  ];

  return (
    <div data-mytrion="analyst" className="contents">
      <MytrionShell id="analyst" navSections={navSections} enableNavSearch>
        <div className="an-root">
          {category.id === 'reports' ? (
            <AnalystReports />
          ) : (
            <CategoryDashboard
              category={category}
              filters={filters}
              onFiltersChange={onFiltersChange}
            />
          )}
        </div>
      </MytrionShell>
    </div>
  );
}
