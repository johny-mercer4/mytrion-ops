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
  /**
   * Right-aligned count on the sidebar row — an unread inbox, a queue depth.
   *
   * Deliberately per-tab and opt-in rather than derived: a count on every row turns the rail into a
   * dashboard, and most of these tabs have nothing a single number honestly summarises. Hidden when
   * the rail is collapsed (MytrionShell owns that).
   */
  trailing?: number | undefined;
  /**
   * Sidebar section label. Consecutive tabs that share a group become one NavSection.
   * A tab without a group starts an unlabelled section — no heading. Main sits above
   * Queue / Policy / Roster that way, instead of inheriting `navLabel`.
   */
  group?: string;
  /** Hide the page-head kicker — the title already names the page. */
  hideKicker?: boolean;
  /**
   * The tab renders its OWN `PageHead`, so the shell omits one.
   *
   * For a tab whose head carries controls that depend on the tab's own state — a search box, a
   * filter toggle — which cannot be declared in this static array. The tab is then responsible for
   * the title and description; it should pass the same strings it declares here.
   */
  ownHead?: boolean;
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
  /** Fallback id slug for an unlabelled section. Not shown as a heading. */
  navLabel: string;
  /** The Main/Home tab id — always first, always built (it's the launcher). */
  tabs: ModuleTab[];
  /**
   * A module's own Main page, replacing the built-in hero + Workspaces grid.
   *
   * Opt-in and unset for every module but Verification, whose Main is a decisioning dashboard
   * rather than a launcher. It receives the same `open` the sidebar uses — already re-checked
   * against the caller's tab grants — and the visible non-Main tabs, so a custom Main can render
   * its own launchers without reaching around the access layer to rebuild the list.
   */
  renderMain?: (api: { open: (tabId: string) => void; launchers: ModuleTab[] }) => ReactNode;
  /**
   * Controlled active tab. Omit BOTH of these for the shell's own state — which is every module
   * but Verification.
   *
   * Verification controls it because two of its surfaces navigate INTO a third: Main's "Needs you
   * today" and the Inbox's "Open case" both open a case in the New applicants workspace, and a tab
   * cannot switch a sibling from inside `content`. The alternative was a one-shot "requested tab"
   * prop, which cannot express "open case A, come back, open case B" — the second request carries
   * the same value as the first and nothing changes.
   *
   * `open()` still re-checks the Layer-2 predicate before calling `onViewChange`, so control does
   * not become a way around the access gate.
   */
  view?: string;
  onViewChange?: (tabId: string) => void;
}

/** Consecutive `group` values become one labelled section. Missing group → no heading. */
export function groupModuleTabs<T extends { id: string; group?: string }>(
  tabs: readonly T[],
  fallbackLabel: string,
): Array<{ id: string; label: string; items: T[] }> {
  const groups: Array<{ id: string; label: string; items: T[] }> = [];
  for (const tab of tabs) {
    const label = tab.group ?? '';
    const last = groups[groups.length - 1];
    if (last && last.label === label) {
      last.items.push(tab);
      continue;
    }
    groups.push({
      id: (label || fallbackLabel).toLowerCase().replace(/[^a-z0-9]+/g, '-') || tab.id,
      label,
      items: [tab],
    });
  }
  return groups;
}

export function ModuleShell({
  id,
  kicker,
  heroLead,
  heroAccent,
  heroBlurb,
  navLabel,
  tabs,
  renderMain,
  view: controlledView,
  onViewChange,
}: ModuleShellProps) {
  const user = useUserContext();
  // Layer-2 access predicate AND the permission-set tab grant. One line covers Verification and
  // Trailhead entirely — nav, launcher grid and the open() re-check all read `visible`.
  const visible = tabs.filter((t) => (t.access?.(user) ?? true) && canSeeTab(user, id, t.id));
  const [innerView, setInnerView] = useState<string>(visible[0]?.id ?? tabs[0]!.id);
  const view = controlledView ?? innerView;

  const open = (tabId: string): void => {
    // Re-check the Layer-2 predicate on switch so stale state can't reach a tab the user lost.
    if (!visible.some((t) => t.id === tabId)) return;
    if (onViewChange) onViewChange(tabId);
    else setInnerView(tabId);
  };

  const active = visible.find((t) => t.id === view) ?? visible[0];
  const isMain = active?.id === visible[0]?.id;
  const launchers = visible.slice(1);

  const pinIds = new Set(visible.filter((tab) => !tab.soon).slice(0, 4).map((tab) => tab.id));
  const navSections: NavSection[] = groupModuleTabs(visible, navLabel).map((section) => ({
    id: section.id,
    label: section.label,
    items: section.items.map((tab) => ({
      key: tab.id,
      label: tab.label,
      ...(tab.trailing === undefined ? {} : { trailing: tab.trailing }),
      // ModuleTab.soon is the ComingSoon panel's config; the rail only needs the fact.
      soon: Boolean(tab.soon),
      icon: <tab.icon size={19} />,
      tone: tab.tone,
      active: view === tab.id,
      onClick: () => open(tab.id),
      keywords: tab.keywords ?? [],
      primary: pinIds.has(tab.id),
    })),
  }));

  return (
    <div data-mytrion={id} className="contents">
      <MytrionShell id={id} navSections={navSections} enableNavSearch>
        <div className="ms-root">
          {active ? (
            <div className="ms-page">
              {isMain && renderMain ? (
                renderMain({ open, launchers })
              ) : isMain ? (
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
                  {active.ownHead ? null : (
                    <PageHead
                      {...(active.hideKicker ? {} : { kicker })}
                      title={active.label}
                      description={active.description}
                    />
                  )}
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
