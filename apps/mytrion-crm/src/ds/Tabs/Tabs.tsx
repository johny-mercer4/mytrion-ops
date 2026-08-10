import {
  forwardRef,
  useId,
  useRef,
  useState,
  type HTMLAttributes,
  type KeyboardEvent as ReactKeyboardEvent,
  type FocusEvent as ReactFocusEvent,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Tabs.module.css';

export type TabsVariant = 'line' | 'pill';
export type TabsSize = 'sm' | 'md';

export interface TabItem {
  /** Stable identity. Used for selection AND to derive the tab/panel id pair, so keep it URL-safe. */
  value: string;
  /** Visible label. Keep it a noun — a tab names a view, it does not command one. */
  label: ReactNode;
  /** Leading icon. Reserve it for tabs whose label is ambiguous without one. */
  icon?: IconName;
  /**
   * Optional count badge. Pass a NUMBER, not a formatted string — the badge sets tabular figures so
   * a row of counts aligns, and a pre-formatted string would defeat that.
   */
  count?: number;
  /**
   * Renders `aria-disabled`, NOT the native `disabled` attribute, so the tab stays focusable and a
   * keyboard user can still reach whatever explains why it is unavailable (pass `title`).
   */
  disabled?: boolean;
  /** Tooltip. The place to explain a `disabled` tab. */
  title?: string;
}

export interface TabsProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children' | 'onChange'> {
  items: TabItem[];
  /** The selected `TabItem.value`. Controlled — this component holds no selection state. */
  value: string;
  onValueChange: (value: string) => void;
  /**
   * `line` — underlined, the default. Sits directly above the content it switches.
   * `pill` — a segmented track. For a tab set inside a card or a toolbar, where an underline would
   *   read as a divider belonging to the card rather than to the tabs.
   */
  variant?: TabsVariant;
  /** `md` (36px) is the default. `sm` (28px) is for tabs inside a panel header or a toolbar. */
  size?: TabsSize;
  /**
   * Id prefix for the generated `tab`/`tabpanel` id pair. Defaults to a `useId()` value, which is
   * correct whenever `children` renders the panel. Pass an explicit one ONLY when you render the
   * panel yourself with `<TabPanel>` somewhere else in the tree — both sides must agree, or
   * `aria-controls` points at nothing.
   */
  idBase?: string;
  /**
   * Panel content for the SELECTED tab. When present, Tabs renders the `tabpanel` itself and the
   * ARIA wiring cannot drift. Omit it and render `<TabPanel>` yourself when the panel is not a DOM
   * sibling of the tab list.
   */
  children?: ReactNode;
}

/** Ids may not contain whitespace, and a tab value is author-supplied text. Fold it once, here. */
function slug(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]+/g, '-');
}

/** The two id halves. Exported implicitly through TabPanel so both sides compute the same string. */
function tabId(idBase: string, value: string): string {
  return `${idBase}-tab-${slug(value)}`;
}
function panelId(idBase: string, value: string): string {
  return `${idBase}-panel-${slug(value)}`;
}

/**
 * The one tab set. WAI-ARIA tabs pattern: `role=tablist` / `role=tab` / `role=tabpanel`, with
 * `aria-selected` and `aria-controls` wired from the same id pair on both ends.
 *
 * MANUAL ACTIVATION, DELIBERATELY. Arrow keys move FOCUS only; Enter or Space activates. The APG
 * allows automatic activation (selection follows focus) and it is the nicer feel — but only when
 * every panel is already in the DOM. In this app a tab panel is a fetch: arrowing from the first of
 * six tabs to the last with automatic activation fires five requests nobody wanted, and the fifth
 * response can land after the sixth and paint the wrong panel. Manual activation costs one keypress
 * and removes a whole class of race. If you ever build a tab set whose panels are all local and
 * free, that is still not a reason to fork this — it is a reason to accept the extra keypress.
 *
 * KEYBOARD
 *   Tab            enters the tab list at the SELECTED tab (roving tabindex), leaves to the panel
 *   ArrowLeft/Right  move focus between tabs, wrapping at both ends
 *   Home / End     first / last tab
 *   Enter / Space  activate the focused tab (native `<button>` behaviour — not re-implemented)
 *
 * OVERFLOW — the tab list scrolls horizontally; it never wraps to a second row. A wrapping tab set
 * changes its own height when the viewport narrows, which pushes the panel down mid-read and makes
 * the tab you were aiming at move under the cursor. The scrollbar is hidden because a 8px gutter
 * under the tabs would shift the underline off the rail on the platforms that reserve one; keyboard
 * navigation scrolls the focused tab into view instead, so nothing is unreachable.
 *
 * SELECTED STATE is never colour alone: `line` draws a 2px accent bar under the tab, `pill` fills
 * the tab and gives it a border. Font weight deliberately does NOT change with selection — a
 * heavier label is wider, and in a horizontal scroller that re-lays out every tab to the right of
 * the one you just clicked.
 *
 * WHEN NOT TO USE IT
 * - Navigation between routes. Tabs swap a panel in place; if the URL changes, that is a nav rail
 *   or a set of links, and rendering it as tabs breaks middle-click and back.
 * - More than about seven tabs, or labels you cannot predict. That is a select, or a list with a
 *   detail pane — a scroller full of tabs hides most of its own options.
 * - A wizard or any ordered sequence. Tabs are peers with no order; steps need a stepper that can
 *   express "done", "current" and "not yet reachable".
 * - One tab. A tab set of one is a heading.
 */
export const Tabs = forwardRef<HTMLDivElement, TabsProps>(function Tabs(
  {
    items,
    value,
    onValueChange,
    variant = 'line',
    size = 'md',
    idBase,
    children,
    className,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    ...rest
  },
  ref,
) {
  const generatedId = useId();
  const base = idBase ?? generatedId;

  const listRef = useRef<HTMLDivElement | null>(null);
  const tabRefs = useRef<Array<HTMLButtonElement | null>>([]);

  // Roving tabindex. `null` means "focus is not in the list", in which case the tab stop is the
  // SELECTED tab — so tabbing back in returns you to where the content actually is, rather than to
  // wherever you happened to arrow to last time.
  const [focusIndex, setFocusIndex] = useState<number | null>(null);
  const selectedIndex = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  const stopIndex = focusIndex ?? selectedIndex;

  function moveFocus(next: number): void {
    const el = tabRefs.current[next];
    if (!el) return;
    el.focus();
    // `block: 'nearest'` so revealing a tab never scrolls the page vertically as a side effect —
    // only the tab list's own horizontal scroller moves.
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }

  function handleKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void {
    if (items.length === 0) return;
    const last = items.length - 1;
    let next: number | null = null;

    if (event.key === 'ArrowRight') next = stopIndex === last ? 0 : stopIndex + 1;
    else if (event.key === 'ArrowLeft') next = stopIndex === 0 ? last : stopIndex - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    // Enter and Space are NOT handled here on purpose. Each tab is a native <button>, which already
    // fires click on both keys; intercepting them would mean calling preventDefault and then
    // re-implementing activation, which is how a component ends up firing twice.

    if (next === null) return;
    // Arrow keys otherwise scroll the nearest scroll container, which here is the tab list itself.
    event.preventDefault();
    moveFocus(next);
  }

  function handleBlur(event: ReactFocusEvent<HTMLDivElement>): void {
    const to = event.relatedTarget as Node | null;
    if (to && listRef.current?.contains(to)) return;
    setFocusIndex(null);
  }

  return (
    <div
      ref={ref}
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-variant={variant}
      data-size={size}
      {...rest}
    >
      <div
        ref={listRef}
        role="tablist"
        // A tab list is a landmark for keyboard users; without a name a screen reader announces
        // "tab list" and nothing about which one.
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        className={styles.list}
        onKeyDown={handleKeyDown}
        onBlur={handleBlur}
      >
        {items.map((item, index) => {
          const selected = item.value === value;
          return (
            <button
              key={item.value}
              ref={(node) => {
                tabRefs.current[index] = node;
              }}
              // Explicit, for the same reason Button is: a tab set inside a form must not submit it.
              type="button"
              role="tab"
              id={tabId(base, item.value)}
              aria-controls={panelId(base, item.value)}
              aria-selected={selected}
              aria-disabled={item.disabled || undefined}
              title={item.title}
              // Exactly one tab is in the tab order at a time — that is the roving tabindex, and it
              // is what stops a six-tab set from costing six Tab presses to walk past.
              tabIndex={index === stopIndex ? 0 : -1}
              className={styles.tab}
              data-state={selected ? 'selected' : 'idle'}
              onFocus={() => setFocusIndex(index)}
              onClick={() => {
                // aria-disabled leaves the button clickable, so the guard is ours to write.
                if (item.disabled || selected) return;
                onValueChange(item.value);
              }}
            >
              {item.icon ? (
                // FILL marks the selected tab, matching the rail: one glyph, two states.
                <Icon name={item.icon} size="sm" filled={selected} />
              ) : null}
              <span className={styles.label}>{item.label}</span>
              {item.count !== undefined ? (
                // Not aria-hidden: "Deals 12" is what a sighted user reads, so it is what a screen
                // reader should hear. The tab's accessible name is its full text content.
                <span className={styles.count}>{item.count}</span>
              ) : null}
            </button>
          );
        })}
      </div>

      {children !== undefined ? (
        <TabPanel idBase={base} value={value}>
          {children}
        </TabPanel>
      ) : null}
    </div>
  );
});

export interface TabPanelProps extends HTMLAttributes<HTMLDivElement> {
  /** Must be the SAME string passed to `<Tabs idBase>`, or `aria-controls` resolves to nothing. */
  idBase: string;
  /** The `TabItem.value` this panel belongs to. Render only the panel for the selected tab. */
  value: string;
  children?: ReactNode;
}

/**
 * The `role=tabpanel` half of the pattern. `<Tabs>` renders one for you when you pass `children`;
 * use this directly only when the panel cannot be a DOM sibling of the tab list — a split layout, a
 * panel that lives in a different grid area.
 *
 * Render ONLY the selected panel. Keeping the inactive ones mounted with `hidden` looks like a
 * cheap optimisation and is not: their contents stay in the accessibility tree's document order,
 * their in-flight requests keep resolving, and their focusable children stay reachable by find-in-page.
 *
 * KEYBOARD — `tabIndex=0`, so Tab from the tab list lands on the panel itself. That is what makes a
 * panel whose content is not focusable (a chart, a paragraph, a table) scrollable from the keyboard
 * at all. The ring only paints under `:focus-visible`, so a mouse user never sees it.
 *
 * WHEN NOT TO USE IT
 * - Anywhere there is no `role=tablist` pointing at it. An orphan `tabpanel` is a worse `<section>`.
 */
export function TabPanel({ idBase, value, children, className, ...rest }: TabPanelProps) {
  return (
    <div
      role="tabpanel"
      id={panelId(idBase, value)}
      aria-labelledby={tabId(idBase, value)}
      tabIndex={0}
      className={[styles.panel, className].filter(Boolean).join(' ')}
      {...rest}
    >
      {children}
    </div>
  );
}
