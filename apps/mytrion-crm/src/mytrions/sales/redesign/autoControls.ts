/**
 * The Automations tab's control geometry, in one place.
 *
 * Five files each declared their own near-identical input constant — `inp40` (AutoWexPanel),
 * `inp42` (AutoTab, AutoResultPanels, AutoBocaCloseForm), `inputCss` (AutoReportFilters) and a
 * 44px one in AutoPicklist — differing only in height and horizontal padding. A single automation
 * modal could therefore show three control heights at once (the WEX search fields at 40, the
 * config fields at 42, the deal picker at 44), which is most of why the tab reads as unstandardised.
 *
 * 42px is the height three of the five already used, so this is the smallest possible move.
 *
 * These are inline style STRINGS rather than a class because this module styles inline throughout
 * (see the `s()` helper); a class here would be the only one of its kind and would lose to the
 * inline declarations already on these elements.
 */

/** The one control height. Inputs, selects and the picker trigger all sit on it. */
export const AUTO_CONTROL_H = 42;

/** Text input / select. Every field in the tab reads this. */
export const AUTO_INPUT =
  `width:100%;height:${AUTO_CONTROL_H}px;padding:0 12px;border-radius:var(--radius-md);` +
  'border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:14px';

/**
 * The primary action. `--on-accent`, never `#fff`: --accent is a pale cyan in dark (#a5e7ff) and
 * --accent-2 a pale pink, so white ink on this fill is ~1.35:1 — an invisible label.
 */
export const AUTO_BTN_PRIMARY =
  'border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));' +
  'color:var(--on-accent);font-weight:700;cursor:pointer';
