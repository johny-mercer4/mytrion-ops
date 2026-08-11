import { useState, type CSSProperties, type ReactNode } from 'react';
import { canSeeTab } from '../../access/resolveAccess';
import type { LucideIcon } from 'lucide-react';
import { ArrowRight } from 'lucide-react';
import { MytrionShell, type NavSection } from './MytrionShell';
import { PageHead } from './page';
import { useUserContext } from '../../context/UserContextProvider';
import type { UserContext } from '../../context/userContext';
import type { MytrionId } from '../../access/mytrions.config';
import { ComingSoon } from './ComingSoon';
import './moduleShell.css';

/**
 * A whole Mytrion from a tab list.
 *
 * Manager, HR, Finance, Analytics and Collection each hand-rolled the same shell: a flat sidebar,
 * a Main tab with a hero + launcher, and per-tab pages. This packages that so a module whose tabs
 * are mostly unbuilt is a single declarative array — no nav file, no shell, no stylesheet.
 *
 * A tab either renders its own `content`, or declares `soon` and gets the shared <ComingSoon />.
 * There is deliberately no third option that fabricates rows.
 */

export interface ModuleTab {
  id: string;
  label: string;
  /** One line on the tab's page head — what someone comes here to do. */
  description: string;
  icon: LucideIcon;
  /** Wayfinding hue from the shared --tone-* scale (see styles/horizon.css). */
  tone: string;
  /** Extra sidebar-search terms; the label is always searched. */
  keywords?: string[];
  /** Layer-2 gate. Defaults to open — narrow it rather than hiding the item in the shell. */
  access?: (user: UserContext) => boolean;
  /** Unbuilt: renders <ComingSoon />. Mutually exclusive with `content`. */
  soon?: {
    /** Headline inside the panel; defaults to the tab label. */
    title?: string;
    body: string;
    /** Real tables/APIs this tab will read once built. */
    sources?: string[];
  };
  /** A built tab's page. Ignored when `soon` is set. */
  content?: ReactNode;
}

export interface ModuleShellProps {
  id: MytrionId;
  /** Small uppercase label above the module name. */
  kicker: string;
  /**
   * Rendered as `<lead><accent>` with NO separator — include a trailing space in `heroLead` when
   * you want two words ("Verification " + "Mytrion"), omit it to split one ("Trail" + "head").
   */
  heroLead: string;
  heroAccent: string;
  heroBlurb: string;
  /** Sidebar group label. */
  navLabel: string;
  /** The Main/Home tab id — always first, always built (it's the launcher). */
  tabs: ModuleTab[];
}

export function ModuleShell({
  id,
  kicker,
  heroLead,
  heroAccent,
  heroBlurb,
  navLabel,
  tabs,
}: ModuleShellProps) {
  const user = useUserContext();
  // Layer-2 access predicate AND the permission-set tab grant. One line covers Verification and
  // Trailhead entirely — nav, launcher grid and the open() re-check all read `visible`.
  const visible = tabs.filter((t) => (t.access?.(user) ?? true) && canSeeTab(user, id, t.id));
  const [view, setView] = useState<string>(visible[0]?.id ?? tabs[0]!.id);

  const open = (tabId: string): void => {
    // Re-check the Layer-2 predicate on switch so stale state can't reach a tab the user lost.
    if (visible.some((t) => t.id === tabId)) setView(tabId);
  };

  const active = visible.find((t) => t.id === view) ?? visible[0];
  const isMain = active?.id === visible[0]?.id;
  const launchers = visible.slice(1);

  const navSections: NavSection[] = [
    {
      id: 'main',
      label: navLabel,
      items: visible.map((tab) => ({
        key: tab.id,
        label: tab.label,
        // ModuleTab.soon is the ComingSoon panel's config; the rail only needs the fact.
        soon: Boolean(tab.soon),
        icon: <tab.icon size={19} />,
        tone: tab.tone,
        active: view === tab.id,
        onClick: () => open(tab.id),
        keywords: tab.keywords ?? [],
      })),
    },
  ];

  return (
    <div data-mytrion={id} className="contents">
      <MytrionShell id={id} navSections={navSections} enableNavSearch>
        <div className="ms-root">
          {active ? (
            <div className="ms-page">
              {isMain ? (
                <>
                  <div className="ms-hero">
                    <div className="ms-hero-glow" />
                    <div className="ms-hero-inner">
                      <div className="ms-kicker">{kicker}</div>
                      <h1 className="ms-hero-title">
                        {heroLead}
                        <span>{heroAccent}</span>
                      </h1>
                      <p className="ms-sub">{heroBlurb}</p>
                    </div>
                  </div>

                  <section className="ms-section">
                    <div className="ms-section-head">
                      <h2 className="ms-section-title">Workspaces</h2>
                      <span className="ms-section-line" />
                    </div>
                    <div className="ms-jump-grid">
                      {launchers.map((tab) => (
                        <button
                          key={tab.id}
                          type="button"
                          className="ms-jump"
                          style={{ '--ms-tone': tab.tone } as CSSProperties}
                          onClick={() => open(tab.id)}
                        >
                          <span className="ms-jump-shimmer" />
                          <div className="ms-jump-top">
                            <span className="ms-glyph">
                              <tab.icon size={21} />
                            </span>
                            <ArrowRight size={17} className="ms-jump-arrow" />
                          </div>
                          <span className="ms-jump-title">
                            {tab.label}
                            {tab.soon ? <span className="ms-soon">Soon</span> : null}
                          </span>
                          <span className="ms-jump-desc">{tab.description}</span>
                        </button>
                      ))}
                    </div>
                  </section>
                </>
              ) : (
                <>
                  <PageHead
                    kicker={kicker}
                    title={active.label}
                    description={active.description}
                  />
                  {active.soon ? (
                    <ComingSoon
                      icon={<active.icon size={26} />}
                      title={active.soon.title ?? active.label}
                      body={active.soon.body}
                      {...(active.soon.sources ? { sources: active.soon.sources } : {})}
                      tone={active.tone}
                    />
                  ) : (
                    active.content
                  )}
                </>
              )}
            </div>
          ) : null}
        </div>
      </MytrionShell>
    </div>
  );
}
