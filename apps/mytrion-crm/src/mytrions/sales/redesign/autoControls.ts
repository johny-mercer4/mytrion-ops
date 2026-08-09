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

/**
 * The pending pill — the ONE "a read is in flight" affordance in the automation modals.
 *
 * AutoWexEligibility and AutoCardCredentials each hand-rolled this, identical except that one used
 * 13px of vertical padding and the other 14px. Two loaders that are nearly-but-not-quite the same
 * read as sloppier than two that are obviously different, because the eye registers the mismatch
 * without being able to name it.
 *
 * The spinner beside the text needs `.ss-spin`, which is defined in redesign/theme.css — it was
 * missing for a long time, and the glyph rendered motionless for the whole request.
 */
export const AUTO_PENDING_PILL =
  'display:flex;align-items:center;gap:10px;padding:13px 15px;border-radius:var(--radius-md);' +
  'border:1px solid var(--border);background:var(--alt);color:var(--muted);font-size:13px';
