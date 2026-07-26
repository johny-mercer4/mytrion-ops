import { ArrowRight, CalendarClock, Inbox, UserCheck, UserRound, Users } from 'lucide-react';
import { HrSection, PreviewBanner } from '../HrBits';
import { HR_TABS, type HrTabId } from '../hrNav';

/**
 * HR → Home. The landing: headcount at a glance, then a jump into each workspace.
 *
 * The stat figures are PLACEHOLDERS (see peoplePreview.ts) — the banner says so. When Zoho People is
 * wired, headcount comes from `Employeestatus` (Active / Terminated) and the department split from
 * `Department`, both of which the live inspection confirmed exist.
 */

interface Stat {
  label: string;
  value: string;
  sub: string;
  icon: typeof Users;
  tone: string;
}

const STATS: Stat[] = [
  { label: 'Headcount', value: '—', sub: 'all employees', icon: Users, tone: 'var(--tone-sky)' },
  { label: 'Active', value: '—', sub: 'Employeestatus = Active', icon: UserCheck, tone: 'var(--tone-emerald)' },
  { label: 'Checked in today', value: '—', sub: 'attendance feed', icon: CalendarClock, tone: 'var(--tone-teal)' },
  { label: 'Open requests', value: '—', sub: 'awaiting a decision', icon: Inbox, tone: 'var(--tone-amber)' },
];

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
            for. Records come from Zoho People; this workspace is the view onto them.
          </p>
        </div>
      </div>

      <PreviewBanner what="Home" />

      <HrSection title="At a glance">
        <div className="hr-stats">
          {STATS.map((s) => (
            <div key={s.label} className="hr-stat" style={{ ['--hr-tone' as string]: s.tone }}>
              <span className="hr-stat-l">
                <s.icon size={12} />
                {s.label}
              </span>
              <span className="hr-stat-n">{s.value}</span>
              <span className="hr-stat-s">{s.sub}</span>
            </div>
          ))}
        </div>
      </HrSection>

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
                <span className="hr-jump-title">{tab.label}</span>
                <span className="hr-jump-desc">{tab.description}</span>
              </button>
            );
          })}
        </div>
      </HrSection>
    </div>
  );
}
