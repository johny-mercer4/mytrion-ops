import type { CSSProperties, HTMLAttributes, ReactNode } from 'react';
import styles from './Skeleton.module.css';

export type SkeletonVariant = 'text' | 'circle' | 'rect';

/**
 * Which step of the type ladder the placeholder is standing in for. It sets the ROW height to that
 * step's `--lh-*`, so the block occupies exactly the space the real text will, and nothing below it
 * moves when the data lands.
 */
export type SkeletonTextSize = '2xs' | 'xs' | 'sm' | 'base' | 'md' | 'lg' | 'xl';

/** `rect` only. The same three radii the rest of the system has — there is no fourth. */
export type SkeletonRadius = 'control' | 'panel' | 'pill';

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   Deterministic ragged edge

   A paragraph's last line is short, and a skeleton whose lines are all 100% wide reads as a stack
   of bars rather than as text. So the last line gets a shorter width — but it must be DETERMINISTIC,
   not `Math.random()`:

     1. React renders components more than once (StrictMode renders twice in development, and any
        parent re-render re-runs this function). A random width changes on every one of those, so
        the skeleton visibly twitches while nothing is happening.
     2. It would differ between the server-rendered and client-rendered pass of the same markup.
     3. A test cannot assert on it.

   FNV-1a over the seed string. Cheap, no dependency, and well-spread over a 35-point band, which is
   all "looks randomised" needs to mean here.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

const LAST_LINE_MIN_PCT = 45;
const LAST_LINE_SPAN_PCT = 35;

function raggedLastLineWidth(seed: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < seed.length; i += 1) {
    hash ^= seed.charCodeAt(i);
    // imul keeps the 32-bit FNV prime multiply exact; a plain `*` overflows into a float and the
    // low bits — the only ones we read — stop being well distributed.
    hash = Math.imul(hash, 0x01000193);
  }
  return `${LAST_LINE_MIN_PCT + ((hash >>> 0) % LAST_LINE_SPAN_PCT)}%`;
}

export interface SkeletonProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /**
   * `text` — one or more lines of copy, with a short ragged last line.
   * `circle` — an avatar or a status dot. `width` is the DIAMETER; `height` is ignored.
   * `rect` — anything with a box: a tile, a chart, a thumbnail, a control.
   */
  variant?: SkeletonVariant;
  /** `text` only. Default 3. Values below 1 are clamped — a zero-line skeleton is a bug, not a state. */
  lines?: number;
  /** `text` only. The type step being stood in for; it fixes the row height. Default `sm`. */
  textSize?: SkeletonTextSize;
  /**
   * `text` only. Varies the ragged last line between sibling skeletons so a list does not show the
   * same notch on every card. Pass something stable — a row id, an index. Default: the line count.
   */
  seed?: string;
  /**
   * CSS length. `rect`/`text`: the width, default `100%`. `circle`: the diameter, default 32px.
   * A string rather than a number so a caller can mirror the real element exactly — `'12ch'`,
   * `'var(--layout-rail-w)'`, `'60%'`.
   */
  width?: string;
  /** CSS length. `rect` only — `text` derives its height from `textSize`, `circle` from `width`. */
  height?: string;
  /** `rect` only. Default `control`. Match the thing being replaced, or the corner pops on arrival. */
  radius?: SkeletonRadius;
}

/**
 * The loading placeholder.
 *
 * Replaces nine bespoke skeleton components (DashSkeleton, DataCenterSkeletons, HomeSkeleton,
 * table-skeleton, the four inline `.ss-skel-*` blocks, ui/skeleton) that each re-derived the same
 * sheen with their own sizes, radii and duration.
 *
 * IT MIRRORS THE REAL LAYOUT, or it is worse than nothing. The entire value of a skeleton is that
 * the page does not reflow when data arrives; a placeholder of the wrong height buys a moment of
 * "something is coming" and pays for it with a jump under the reader's eye. So `textSize` fixes the
 * row to the real `--lh-*`, and `width`/`height` take CSS lengths rather than a t-shirt scale — the
 * caller knows the real dimensions and must be able to say them.
 *
 * ACCESSIBILITY — a skeleton is not content and must never be announced. The root is `aria-hidden`
 * unconditionally (it is applied AFTER the prop spread, so it cannot be switched off by a caller
 * who thinks they know better). The BUSY state lives on the region instead: wrap the area in
 * `SkeletonRegion`, which owns `aria-busy` and the one polite announcement. A screen-reader user
 * hears "Loading invoices" once and then the invoices — never eleven grey rectangles.
 *
 * KEYBOARD — none. A skeleton takes no focus and holds no control. If the thing it replaces is
 * focusable, the region around it is what the user tabs to once the data lands; do not put a
 * tabindex on a placeholder, or Tab lands the user on a shape that will not exist in a second.
 *
 * MOTION — the sheen is the shared `--animate-shimmer` from global.css: an INDEFINITE ambient loop
 * at 1.4s, deliberately outside the 220ms transition ceiling and floored at >=1s so it reads as
 * "working" rather than as a transition that stalled. Under `prefers-reduced-motion` the global
 * block stops it dead, and that is safe here BY DESIGN: the shape, not the movement, is the signal,
 * so a reduced-motion user loses decoration and no information.
 *
 * WHEN NOT TO USE IT
 * - THE ONE-LOADER RULE. A region shows exactly ONE loading affordance. Never nest a skeleton
 *   inside a region that already shows a page loader, a spinner or a `loading` Button — two
 *   simultaneous loaders read as two pending operations, and the user waits for the second one to
 *   finish after the first has. If the page is already loading, render nothing here.
 * - A load you cannot predict the shape of. A skeleton claims "the answer is this tall"; when the
 *   result might be one row or four hundred, that claim is a lie and a spinner is honest.
 * - A load shorter than roughly 300ms. It will flash on and off and read as a glitch. Show the old
 *   content, or nothing, until you know the wait is real.
 * - A refetch of data already on screen (sort, page change, poll). Replacing live content with grey
 *   bars destroys the reader's place. Dim the region and leave the numbers up.
 * - An empty result. Nothing arriving is not the same as nothing having arrived yet — that is
 *   `EmptyState`, and shimmering forever is how a broken query looks like a slow one.
 * - An error. A failed load must say so; a skeleton left running says "still trying" forever.
 */
export function Skeleton({
  variant = 'text',
  lines = 3,
  textSize = 'sm',
  seed,
  width,
  height,
  radius = 'control',
  className,
  style,
  ...rest
}: SkeletonProps) {
  const count = Math.max(1, Math.floor(lines));

  // Custom properties carry the caller's dimensions instead of raw `width` / `height` declarations,
  // so the stylesheet keeps its defaults per variant and only the ones actually passed are
  // overridden. `as CSSProperties` because React's typings do not model custom properties.
  const rootStyle = {
    ...style,
    ...(width == null ? {} : { '--sk-w': width }),
    ...(height == null ? {} : { '--sk-h': height }),
  } as CSSProperties;

  const rootProps = {
    className: [styles.root, className].filter(Boolean).join(' '),
    'data-variant': variant,
    style: rootStyle,
  };

  if (variant !== 'text') {
    return (
      <div
        {...rootProps}
        data-radius={variant === 'rect' ? radius : undefined}
        {...rest}
        // Last, and on purpose — see the docblock. A placeholder must not enter the a11y tree.
        aria-hidden="true"
      />
    );
  }

  const lastWidth = raggedLastLineWidth(seed ?? String(count));

  return (
    <div {...rootProps} data-text-size={textSize} {...rest} aria-hidden="true">
      {Array.from({ length: count }, (_, i) => {
        // A single line is not a paragraph, so it has no ragged bottom to imitate — it takes the
        // full width. Notching a lone label placeholder just makes it look like a broken bar.
        const ragged = count > 1 && i === count - 1;
        return (
          <span
            key={i}
            className={styles.line}
            {...(ragged ? { style: { '--sk-line-w': lastWidth } as CSSProperties } : {})}
          />
        );
      })}
    </div>
  );
}

/* ══════════════════════════════════════════════════════════════════════════════════════════════
   SkeletonRegion

   Co-located with Skeleton rather than given its own folder because the two are ONE contract, and
   splitting them is how the contract gets half-implemented: the skeleton is `aria-hidden`, so
   without this wrapper a screen-reader user is told nothing at all while a screen loads. Keeping
   them in the same file means you cannot import one without seeing the other.
   ══════════════════════════════════════════════════════════════════════════════════════════════ */

export interface SkeletonRegionProps extends Omit<HTMLAttributes<HTMLDivElement>, 'children'> {
  /** Whether the region is still loading. Drives `aria-busy` and the announcement. */
  busy: boolean;
  /**
   * What is loading, as a sentence a person would say: "Loading invoices", "Loading the call
   * history". Announced once, politely, when `busy` becomes true. Not "Loading" — a screen with
   * three regions would then say the same word three times and locate none of them.
   */
  label: string;
  /** The skeletons while busy, the real content once it lands. Both, if a region fills in stages. */
  children: ReactNode;
}

/**
 * The busy wrapper around one or more `Skeleton`s — the half of the loading contract that talks.
 *
 * WHY THE LIVE REGION IS ALWAYS RENDERED: a `role="status"` node only announces content ADDED to it
 * after it is already in the accessibility tree. Mounting the region and its text together is the
 * classic bug where nothing is ever spoken. So the node is permanent and only its text changes —
 * `label` while busy, empty when not. Removal is silent, which is exactly right: the arriving
 * content should not be re-read, and on a 400-row table that would be catastrophic.
 *
 * `aria-busy` on the wrapper is the other half. It tells assistive tech that what is inside is
 * incomplete, so the content is not read as final while it is still assembling.
 *
 * KEYBOARD — none of its own; it is a passive wrapper and stays out of the tab order. Keep it
 * mounted across the busy → ready flip rather than swapping two different wrappers, so focus inside
 * the region survives the transition instead of falling back to `<body>`.
 *
 * WHEN NOT TO USE IT
 * - Nested inside another `SkeletonRegion`, or inside anything else that already announces a load.
 *   ONE loading affordance and ONE announcement per region — that is the whole rule.
 * - Around a control that is busy on its own, like a submitting Button. That control already
 *   carries its own `aria-busy`, and a region on top double-announces it.
 * - As a general-purpose layout div. It has one job; if it is not loading, it should not be there.
 */
export function SkeletonRegion({
  busy,
  label,
  children,
  className,
  ...rest
}: SkeletonRegionProps) {
  return (
    <div
      className={[styles.region, className].filter(Boolean).join(' ')}
      // `undefined` rather than "false": aria-busy="false" is the default, and emitting it on every
      // ready region is noise in the DOM for no behavioural difference.
      aria-busy={busy || undefined}
      data-busy={busy || undefined}
      {...rest}
    >
      <span className={styles.srOnly} role="status">
        {busy ? label : ''}
      </span>
      {children}
    </div>
  );
}
