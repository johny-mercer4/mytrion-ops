import { useMemo, useState } from 'react';
import { MoreHorizontal } from 'lucide-react';
import { Drawer } from '../../ds/Drawer';
import type { NavItem, NavSection } from './MytrionShell';
import styles from './MobileTabBar.module.css';

/** Four destinations plus More. Five 75px slots on a 375px screen; six would be 62px and too tight. */
const SLOTS = 4;

/**
 * Pick the bar's destinations.
 *
 * A workspace opts in by marking items `primary`. When none does — which is ten of the thirteen —
 * the first four reachable destinations in nav order are used, which is a genuinely good default
 * because every workspace already orders its first section by how often it is opened.
 *
 * `soon` items are excluded from the bar in both paths. An unbuilt destination in a five-slot bar
 * is a disabled button occupying a fifth of the app's primary navigation; it stays in the More
 * sheet, where the "Soon" pill has room to explain itself.
 */
export function tabBarItems(sections: readonly NavSection[]): NavItem[] {
  const reachable = sections.flatMap((section) => section.items).filter((item) => !item.soon);
  const pinned = reachable.filter((item) => item.primary);
  return (pinned.length > 0 ? pinned : reachable).slice(0, SLOTS);
}

export interface MobileTabBarProps {
  sections: readonly NavSection[];
  onSelect: (item: NavItem) => void;
  /** Accessible name for the bar, e.g. "Sales navigation". */
  label: string;
}

/**
 * Primary navigation below the structure line.
 *
 * IT IS A FLOW SIBLING OF `.body`, NOT `position: fixed`, and that is the whole design.
 *
 * A fixed bar overlays content, so every workspace becomes responsible for reserving a matching
 * strip of bottom padding — a number it cannot see and that changes whenever the bar does. This app
 * has already run that experiment: `sales/redesign/theme.css` carried an orphaned
 * `padding: 16px 12px 132px !important` for a bottom nav that never shipped, and Sales was the only
 * one of thirteen workspaces that ever remembered to add it.
 *
 * Being in flow also makes it structurally incapable of the defect `MytrionShell.module.css`
 * documents at length: it needs no `z-index`, so it adds no stacking context to `.shell` or `.body`,
 * so it cannot trap the app's legacy `position: fixed` modals behind the header. The More sheet is a
 * `ds/Drawer` — a native `<dialog>` in the top layer — for the same reason, and likewise carries no
 * `z-index` at all.
 *
 * And it keeps `.center` as the app's single `overflow-y: auto` region, which is what makes iOS
 * momentum scrolling and tap-the-status-bar-to-scroll-to-top behave like a native app.
 *
 * It replaces a wrapping horizontal strip that pushed the rail's full contents — sections, labels,
 * dividers and all — across the top of the page. On Sales that was twelve destinations in four
 * labelled groups, which wrapped to three rows and ate a third of a phone screen before any content.
 */
export function MobileTabBar({ sections, onSelect, label }: MobileTabBarProps) {
  const [moreOpen, setMoreOpen] = useState(false);
  const items = useMemo(() => tabBarItems(sections), [sections]);

  const activeIndex = items.findIndex((item) => item.active);
  // The current destination lives in the More sheet: mark More itself rather than leaving the bar
  // with nothing lit, which reads as "you are nowhere".
  const activeInMore = activeIndex === -1 && sections.some((s) => s.items.some((i) => i.active));
  const indicatorIndex = activeIndex === -1 ? (activeInMore ? SLOTS : -1) : activeIndex;

  const choose = (item: NavItem): void => {
    setMoreOpen(false);
    onSelect(item);
  };

  return (
    <>
      <nav className={styles.bar} aria-label={label}>
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            // Explicit, matching NavItemButton: the visible content is "Inbox" plus a count badge,
            // and without this the accessible name becomes "Inbox 3" — a screen reader reading the
            // queue depth as part of the destination's name, every time it moves focus.
            aria-label={item.label}
            className={styles.slot}
            data-active={item.active ? 'true' : undefined}
            {...(item.active ? { 'aria-current': 'page' as const } : {})}
            onClick={() => choose(item)}
          >
            <span className={styles.icon} aria-hidden="true">
              {item.icon}
            </span>
            <span className={styles.label}>{item.label}</span>
            {item.trailing !== undefined && item.trailing !== '' ? (
              <span className={styles.count}>{item.trailing}</span>
            ) : null}
          </button>
        ))}

        <button
          type="button"
          className={styles.slot}
          data-active={activeInMore ? 'true' : undefined}
          aria-haspopup="dialog"
          aria-expanded={moreOpen}
          onClick={() => setMoreOpen(true)}
        >
          <span className={styles.icon} aria-hidden="true">
            <MoreHorizontal />
          </span>
          <span className={styles.label}>More</span>
        </button>

        {/*
          One shared indicator that slides, rather than a border on each active slot. It reads as the
          same object moving between destinations, and it animates `translate` — a compositor-only
          property — so it never triggers layout on a device that has little to spare.
        */}
        {indicatorIndex >= 0 ? (
          <span
            className={styles.indicator}
            style={{ translate: `calc(${indicatorIndex} * 100%) 0` }}
            aria-hidden="true"
          />
        ) : null}
      </nav>

      <Drawer
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        title="Go to"
        subtitle={label}
        size="lg"
      >
        <div className={styles.sheet}>
          {sections.map((section) => (
            <div key={section.id} className={styles.sheetSection}>
              {section.label ? <div className={styles.sheetLabel}>{section.label}</div> : null}
              {section.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  // Same reason as the bar: the row renders a "Soon" pill or a count beside the
                  // name, and the destination alone is what the control is called.
                  aria-label={item.label}
                  className={styles.sheetRow}
                  disabled={item.soon ?? false}
                  data-active={item.active ? 'true' : undefined}
                  {...(item.active ? { 'aria-current': 'page' as const } : {})}
                  onClick={() => choose(item)}
                >
                  <span className={styles.sheetIcon} aria-hidden="true">
                    {item.icon}
                  </span>
                  <span className={styles.sheetName}>{item.label}</span>
                  {item.soon ? (
                    <span className={styles.sheetSoon}>Soon</span>
                  ) : item.trailing !== undefined && item.trailing !== '' ? (
                    <span className={styles.count}>{item.trailing}</span>
                  ) : null}
                </button>
              ))}
            </div>
          ))}
        </div>
      </Drawer>
    </>
  );
}
