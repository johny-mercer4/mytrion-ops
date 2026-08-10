import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './EmptyState.module.css';

/**
 * `page` — the empty state OWNS the region: a route with no records, a search with no hits, a
 *   workspace nobody has set up yet. Carries the horizon band (see `band`).
 * `panel` — the empty state fills a CARD inside a populated page: an empty related-list, a widget
 *   with no data this month. Flat, quiet, no atmosphere — a card that glows inside a dashboard of
 *   eleven other cards is a card that lies about its importance.
 */
export type EmptyStateSize = 'page' | 'panel';

/**
 * `empty` — nothing is here, and that is a legitimate state of the world.
 * `error` — we tried to find out and could not. A DIFFERENT fact, and it must not look the same:
 *   "no results" invites you to change the query, "load failed" invites you to retry. Painting them
 *   identically has taught users of this app to retype a search that never ran.
 */
export type EmptyStateTone = 'empty' | 'error';

interface TonePresentation {
  icon: IconName;
  /** Announced with the glyph on the error tone, so the failure is not carried by colour alone. */
  iconLabel: string;
}

const TONE: Record<EmptyStateTone, TonePresentation> = {
  empty: { icon: 'inbox', iconLabel: 'Empty' },
  error: { icon: 'error', iconLabel: 'Error' },
};

/** A lookup rather than a `h${level}` template, so the tag name is a checked literal, not a string. */
const HEADING = { 2: 'h2', 3: 'h3', 4: 'h4' } as const;

export interface EmptyStateProps
  extends Omit<HTMLAttributes<HTMLDivElement>, 'title' | 'children' | 'className' | 'style'> {
  /**
   * WHAT HAPPENED, in the user's terms — "No tickets match these filters", "Couldn't load the
   * carrier list". One line, sentence case, no full stop.
   *
   * Not "No results". "No results" is the system describing its own return value; the user already
   * knows the screen is blank, and a title that only restates the blankness is a dead end.
   */
  title: ReactNode;
  /**
   * WHAT TO TRY NEXT, and it is REQUIRED for that reason — a title alone leaves the user holding an
   * empty screen with no move to make.
   *
   * Be concrete. The best example already in this app is the action catalog's search miss, which
   * follows "No actions match your search" with "Try a code like C-16 or a keyword like fraud" —
   * it names the SHAPE of a query that works. "Try a different search" does not; it just tells
   * someone to guess again.
   *
   * For the `error` tone this is the recovery path, not an apology: "The DWH connection timed out.
   * Retry, or check the tunnel on :3307."
   */
  description: ReactNode;
  /**
   * Overrides the tone's default glyph (`inbox` for empty, `error` for error). Pick one that
   * describes the ABSENT thing — `search` for a query with no hits, `filter_alt` when filters are
   * doing the excluding, `schedule` for a period with no activity.
   */
  icon?: IconName | undefined;
  /** Defaults to `page`. See `EmptyStateSize` — this is a weight decision, not a scale one. */
  size?: EmptyStateSize | undefined;
  /** Defaults to `empty`. `ErrorState` below is this prop with a name. */
  tone?: EmptyStateTone | undefined;
  /**
   * The one move that fixes it — "Clear filters", "Create the first invitation", "Retry". Pass a
   * `<Button variant="primary">`. Rendered FIRST, left of the secondary: this is a centred block,
   * not a dialog footer, so the eye reads it in order rather than reaching for the far corner.
   */
  primaryAction?: ReactNode | undefined;
  /** The lesser escape — "Reset the date range", "Open the docs". Pass a secondary/ghost Button. */
  secondaryAction?: ReactNode | undefined;
  /**
   * Renders the title as `<h2>`/`<h3>`/`<h4>` instead of a `<p>`. Pass it when this empty state IS
   * the region's content and a screen-reader user should be able to jump to it. Do NOT pass it for
   * a panel inside a dashboard — twelve empty widgets would build a document outline out of
   * nothing-here, which is worse than no headings at all.
   */
  headingLevel?: 2 | 3 | 4 | undefined;
  /**
   * The horizon band behind a `page` empty state. Defaults to ON for `size='page'` with
   * `tone='empty'`, and is IGNORED at `panel` size.
   *
   * Empty states are one of the three surfaces where atmosphere is allowed (with shells and auth),
   * because there is no dense data here to compete with it. It is deliberately forced OFF for the
   * `error` tone: a failure is not an occasion for the brand to be pretty, and the ember band would
   * warm exactly the surface that needs to read as cold.
   */
  band?: boolean | undefined;
  /** Overrides the announced name of the error glyph. Ignored on the `empty` tone. */
  iconLabel?: string | undefined;
  /** Positioning class — lands on the root, which is the box a caller lays out. */
  className?: string | undefined;
  /** Positioning style — lands on the root, same reason. */
  style?: CSSProperties | undefined;
}

/**
 * The one empty state.
 *
 * Replaces ~95 distinct empty-state class names across twelve workspaces (`.ss-empty`, `.cs-none`,
 * `.hr-empty-card`, `.mg-nodata`, `.bm-empty-row`, …), most of which rendered a grey line of text
 * and stopped there.
 *
 * IT MUST SAY WHAT HAPPENED AND WHAT TO TRY NEXT. That is why `description` is required rather than
 * optional: an empty screen is a question the UI asked the user, and shipping it without an answer
 * is the single most common defect in the states this component replaces. A bare "No results" is a
 * dead end — name the shape of a query that would work, or the filter that is excluding everything,
 * or the button that creates the first record.
 *
 * NOTHING-HERE vs THIS-FAILED. `tone` is not decoration. An empty result is a fact about the data;
 * a failure is a fact about the system, and the user's next move differs completely. The error tone
 * drops the atmosphere, recolours the glyph to the danger intent, gives that glyph an accessible
 * name, and takes `role="alert"` so it is announced when it replaces content that was loading.
 *
 * COLOUR IS NEVER THE SIGNAL. The glyph, its label and the copy all carry the tone; the tint is the
 * fourth signal, not the first. Write a title that states the failure in words — "Couldn't load the
 * carrier list" — and the red is then confirmation rather than information.
 *
 * KEYBOARD — the block itself takes no focus. Tab order inside is DOM order: `primaryAction`, then
 * `secondaryAction`. Nothing is trapped and nothing is pointer-only.
 *
 * WHEN NOT TO USE IT
 * - While data is still loading. That is `Skeleton`. An empty state shown during a fetch tells the
 *   user there is nothing there, and they leave before the rows arrive.
 * - A failed agent turn inside a transcript. That is `TurnError`, which keeps the raw message and
 *   the retry beside the turn it belongs to.
 * - A stopped generation. That is `StoppedNote` — neutral, not a failure and not an absence.
 * - A single empty table cell or an unset field. Render a muted dash; a 320px block inside a table
 *   row is not a considered state, it is a layout accident.
 * - A permission refusal. "You don't have access" is not an empty state — the data exists and the
 *   copy must not imply otherwise. Say who to ask.
 * - As a place to put a marketing illustration. This is an internal ops tool; the space belongs to
 *   the sentence that tells someone what to do next.
 */
export function EmptyState({
  title,
  description,
  icon,
  size = 'page',
  tone = 'empty',
  primaryAction,
  secondaryAction,
  headingLevel,
  band,
  iconLabel,
  className,
  style,
  ...rest
}: EmptyStateProps) {
  const presentation = TONE[tone];
  const isError = tone === 'error';
  // The band is atmosphere, and atmosphere is wrong on a failure — see the `band` prop docs.
  const showBand = (band ?? true) && size === 'page' && !isError;
  const hasActions = Boolean(primaryAction) || Boolean(secondaryAction);

  // A capitalised binding, because JSX treats a lowercase identifier as a literal tag name rather
  // than as a component reference.
  const TitleTag = headingLevel ? HEADING[headingLevel] : 'p';

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      style={style}
      data-size={size}
      data-tone={tone}
      data-band={showBand || undefined}
      // An error that replaces content the user was waiting for is an interruption, and announcing
      // it costs nothing; an absence is just the content, and a live region for "there are no rows"
      // would shout every time a filter changes. `rest` is spread last so a caller who owns the
      // announcement themselves can override this.
      role={isError ? 'alert' : undefined}
      {...rest}
    >
      <span className={styles.glyph}>
        {/*
          Labelled on the error tone ONLY. There the glyph is the non-colour signal that this is a
          failure, so it is content. On the empty tone the title already says what is absent, and
          announcing "inbox" before it would just add a word nobody asked for.
        */}
        <Icon
          name={icon ?? presentation.icon}
          label={isError ? (iconLabel ?? presentation.iconLabel) : undefined}
        />
      </span>

      <TitleTag className={styles.title}>{title}</TitleTag>
      <p className={styles.description}>{description}</p>

      {hasActions ? (
        <div className={styles.actions}>
          {primaryAction}
          {secondaryAction}
        </div>
      ) : null}
    </div>
  );
}

export type ErrorStateProps = Omit<EmptyStateProps, 'tone'>;

/**
 * `EmptyState` with `tone='error'` — "we tried and could not", as opposed to "there is nothing".
 *
 * It exists as its own name because the choice between the two is a decision someone has to make at
 * the call site, and a `tone` prop buried in a props object is easy to leave at its default. If you
 * are rendering this after a rejected promise, you want this one.
 *
 * The `description` should carry the RECOVERY, not an apology — what to retry, what to check, who
 * to tell. Pair it with a `primaryAction` of "Retry" whenever re-running the request is safe.
 *
 * WHEN NOT TO USE IT
 * - Everything in `EmptyState`'s list above, plus: a failure the user caused and can fix in place
 *   (an invalid filter value, a malformed query). That is a field error next to the field, where
 *   the fix is, not a full-region takeover.
 */
export function ErrorState(props: ErrorStateProps) {
  return <EmptyState {...props} tone="error" />;
}
