import { ArrowRight, CalendarClock, Inbox, UserRound, Users } from 'lucide-react';
import { HrSection } from '../HrBits';
import { HR_TABS, type HrTabId } from '../hrNav';

/**
 * HR → Home. The landing and launcher.
 *
 * There is no "at a glance" figure row: headcount, check-ins and open requests all depend on tabs
 * that are not wired to Zoho People yet, and a row of em-dashes is scaffolding pretending to be a
 * dashboard. It comes back when there is something real to count.
 */
const JUMP_ICON: Record<HrTabId, typeof Users> = {
  home: Users,
  employees: Users,
  attendance: CalendarClock,
  requests: Inbox,
  profile: UserRound,
};

export function HrHome({ onOpen }: { onOpen: (tab: HrTabId) => void }) {
  const jumps = HR_TABS.filter((t) => t.id !== 'home');

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
            for. Records will come from Zoho People; this workspace is the view onto them.
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
