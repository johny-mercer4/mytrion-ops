import {
  ArrowRight,
  Building2,
  CalendarClock,
  Inbox,
  Network,
  Settings,
  Users,
} from 'lucide-react';
import { accessibleHrTabs, type HrTabId } from '../hrNav';
import { HrSection } from '../HrBits';
import { useUserContext } from '../../../context/UserContextProvider';

/**
 * HR → Home. The landing and launcher.
 *
 * Jump cards respect Layer-2 access (Settings is admin-only). Profile is not listed — it lives on
 * the sidebar username at the bottom of the shell.
 */
const JUMP_ICON: Record<HrTabId, typeof Users> = {
  home: Users,
  employees: Users,
  departments: Building2,
  org: Network,
  attendance: CalendarClock,
  requests: Inbox,
  settings: Settings,
};

export function HrHome({ onOpen }: { onOpen: (tab: HrTabId) => void }) {
  const user = useUserContext();
  const jumps = accessibleHrTabs(user).filter((t) => t.id !== 'home');

  return (
    <div className="hr-page">
      <div className="hr-hero">
        <div className="hr-hero-glow" />
        <div className="hr-hero-inner">
          <div className="hr-kicker">People Operations</div>
          <h1 className="hr-hero-title">
            HR <span>Mytrion</span>
          </h1>
          <p className="hr-sub">
            The people side of Octane — who works here, when they work, and what they&apos;re asking
            for. The employee directory lives in Mytrion&apos;s own database; other people workspaces
            are still coming online.
          </p>
        </div>
      </div>

      <HrSection title="Workspaces">
        <div className="hr-jump-grid">
          {jumps.map((tab) => {
            const Icon = JUMP_ICON[tab.id];
            return (
              <button
                key={tab.id}
                type="button"
                className="hr-jump"
                style={{ ['--hr-tone' as string]: tab.tone }}
                onClick={() => onOpen(tab.id)}
              >
                <span className="hr-jump-shimmer" />
                <div className="hr-jump-top">
                  <span className="hr-glyph">
                    <Icon size={21} />
                  </span>
                  <ArrowRight size={17} className="hr-jump-arrow" />
                </div>
                <span className="hr-jump-title">
                  {tab.label}
                  {tab.soon ? <span className="hr-soon">Soon</span> : null}
                </span>
                <span className="hr-jump-desc">{tab.description}</span>
              </button>
            );
          })}
        </div>
      </HrSection>
    </div>
  );
}
