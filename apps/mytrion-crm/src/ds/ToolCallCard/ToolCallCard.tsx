import {
  useId,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import { Button } from '../Button/Button';
import styles from './ToolCallCard.module.css';

/**
 * FIVE states, not four.
 *
 * The names are the wire's names, not prettier synonyms: the backend emits
 * `'ok' | 'error' | 'denied'` on `tool_result` (chatService), the client adds `'running'` when the
 * `tool_call` frame arrives, and `'pending'` covers a call the model has emitted but the runtime has
 * not started. Renaming them here would put a translation step between the server and the pixel, and
 * a translation step is exactly where `denied` gets folded into `error`.
 */
export type ToolCallStatus = 'pending' | 'running' | 'ok' | 'error' | 'denied';

/** Visible + announced wording per state. `denied` never uses failure words. */
export const TOOL_CALL_STATUS_LABEL: Record<ToolCallStatus, string> = {
  pending: 'Queued',
  running: 'Running',
  ok: 'Succeeded',
  error: 'Failed',
  denied: 'Not permitted',
};

/** Glyph per state. Shape carries the meaning so colour never carries it alone. */
const STATUS_ICON: Record<Exclude<ToolCallStatus, 'running'>, IconName> = {
  pending: 'schedule',
  ok: 'check_circle',
  error: 'warning',
  // A struck-through shield, not a warning triangle. Refusal is the access layer working, and the
  // glyph has to say so before anyone reads the label.
  denied: 'gpp_bad',
};

/**
 * Class-name join. Also the type bridge: CSS-module lookups are `string | undefined` under
 * `noUncheckedIndexedAccess`, and `className` takes a `string`.
 */
const cx = (...parts: Array<string | false | undefined>): string => parts.filter(Boolean).join(' ');

/** ms under a second, one decimal second above it. Never a bare number with no unit. */
function formatElapsed(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '';
  return ms < 1_000 ? `${Math.round(ms)} ms` : `${(ms / 1_000).toFixed(1)} s`;
}

/** Spoken form of the whole header: state first, then duration. One sentence, no punctuation soup. */
function statusSentence(status: ToolCallStatus, elapsedMs?: number): string {
  const label = TOOL_CALL_STATUS_LABEL[status];
  const took = elapsedMs === undefined ? '' : ` in ${formatElapsed(elapsedMs)}`;
  return status === 'running' || status === 'pending' ? label : `${label}${took}`;
}

export interface ToolCallStatusGlyphProps {
  status: ToolCallStatus;
  /**
   * Accessible name for the glyph. Omit inside a card header — the header already carries a
   * screen-reader sentence and a second announcement would double every row.
   */
  label?: string;
  className?: string;
}

/**
 * The status mark on its own: four font glyphs plus one ambient dot for `running`.
 *
 * `running` is a PULSE, not a spinner arc and never a progress bar — the runtime does not know how
 * long a tool takes, and a bar that fills at an invented rate is a lie the user will time.
 */
export function ToolCallStatusGlyph({ status, label, className }: ToolCallStatusGlyphProps) {
  const cls = cx(styles.glyph, className);
  if (status === 'running') {
    return (
      <span className={cls} data-status="running" {...(label ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })}>
        <span className={styles.pulse} />
      </span>
    );
  }
  return (
    <span className={cls} data-status={status} aria-hidden={label ? undefined : true}>
      <Icon name={STATUS_ICON[status]} size="sm" {...(label ? { label } : {})} />
    </span>
  );
}

export interface ToolCallCardProps {
  /** The tool's wire name, e.g. `dwh_query`. Rendered in `--tool-label-font`. */
  name: string;
  status: ToolCallStatus;
  /**
   * ONE line describing the arguments — `carrier_id=884 · window=30d`. The caller decides what
   * matters; this component will not guess at a JSON blob's headline. Truncated with an ellipsis,
   * never wrapped: the collapsed row is a fixed-height timeline entry.
   */
  summary?: string;
  /** Elapsed milliseconds. Omit while it is genuinely unknown — `0 ms` is a claim, blank is honest. */
  elapsedMs?: number;
  /** Full serialised arguments. Pass pretty-printed JSON; it renders in a clamped `<pre>`. */
  input?: string;
  /** Full serialised result. Same treatment. */
  output?: string;
  /**
   * Why it failed, or which authority refused it. On `denied` this is the sentence that stops a
   * support engineer from opening a bug against a tool that behaved correctly.
   */
  detail?: string;
  /** Uncontrolled initial disclosure state. Cards are collapsed by default, deliberately. */
  defaultOpen?: boolean;
  /** Controlled disclosure. Pass with `onOpenChange` when a parent owns "expand all". */
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  /**
   * Set by `ToolCallList`. The list owns the rail node, so the card drops its own glyph rather than
   * printing the status mark twice on one row.
   */
  railed?: boolean;
  /** Extra body content below the payloads (an approval control, a link to the audit row). */
  children?: ReactNode;
  className?: string;
  style?: CSSProperties;
}

/** Payload clamp: 12 lines is enough to recognise a shape, short enough to keep the thread scrollable. */
const CLAMP_LINES = 12;

/** Section heading for a non-neutral outcome. A refusal never borrows the word "Error". */
const OUTCOME_LABEL = { error: 'Error', denied: 'Refusal' } as const;

function Payload({ label, text, tone }: { label: string; text: string; tone?: 'error' | 'denied' }) {
  const [showAll, setShowAll] = useState(false);
  const lines = text.split('\n').length;
  const long = lines > CLAMP_LINES || text.length > 1_200;

  return (
    <div className={styles.section} data-tone={tone}>
      <div className={styles.sectionHead}>{label}</div>
      <pre className={styles.pre} data-clamped={long && !showAll ? 'true' : undefined}>
        {text}
      </pre>
      {long ? (
        <Button
          variant="link"
          size="sm"
          onClick={() => setShowAll((v) => !v)}
          aria-label={showAll ? `Collapse ${label}` : `Show all ${lines} lines of ${label}`}
        >
          {showAll ? 'Show less' : `Show more (${lines} lines)`}
        </Button>
      ) : null}
    </div>
  );
}

/**
 * One tool call in an agent turn: what ran, on what arguments, how it ended, how long it took, and —
 * behind a disclosure — the whole input and output.
 *
 * WHY FIVE STATES. `denied` is the access layer refusing the call. The tool did not break, the model
 * did not misbehave, and nothing needs retrying — the caller lacked authority, which is the system
 * working. The chat panel today paints denied with the same red X as `error` (MessageBubble's
 * `chipDenied`), which teaches every operator to read a correct RBAC refusal as an outage and file a
 * bug against a healthy tool. Denied gets the warning tone, a shield glyph, the words "Not
 * permitted", and no retry affordance; failure gets danger, a warning triangle, and "Failed".
 * Collapsing the two is the specific defect this component exists to prevent.
 *
 * ANATOMY — status glyph · tool name (monospace) · one-line argument summary · elapsed · disclosure.
 * Collapsed by default: a turn that ran nine tools must stay one screen tall.
 *
 * RUNNING shows an ambient pulse on a >=1s loop, never a progress bar. Duration is unknowable here,
 * and the pulse is never the only signal — the word "Running" sits beside it, so a reduced-motion
 * user (where the pulse is switched off entirely) loses nothing.
 *
 * PAYLOADS clamp to 12 lines behind "Show more" and render as `<pre>`. A 2,000-line result must not
 * push the conversation off screen.
 *
 * KEYBOARD — Tab reaches the disclosure; Enter/Space toggles it (it is a native `<button>` with
 * `aria-expanded` + `aria-controls`). Tab again reaches "Show more" inside an open card. No arrow-key
 * behaviour and no roving tabindex: this is a disclosure, not a composite widget.
 *
 * ANNOUNCEMENTS — the card has NO live region. Status changes reach assistive tech through the
 * streaming surface's single polite region (ChatPanel's `liveStatus`), which announces transitions
 * only. A live region per card means five tools re-announcing over each other mid-turn.
 *
 * WHEN NOT TO USE IT
 * - A tool the user must approve before it runs. That is an approval prompt with real affirmative
 *   and reject controls; this card reports, it does not ask.
 * - The runtime trace of a whole turn (route → model → rag → verification). That is TurnInspector's
 *   timeline; this is one tool call.
 * - A dense count of what ran, in a message header. That is a chip row — a stack of cards where a
 *   line of chips would do turns a two-tool answer into a wall.
 * - Long-running background jobs with a known percentage. Those have real progress; render a
 *   progress bar, not an ambient pulse.
 */
export function ToolCallCard({
  name,
  status,
  summary,
  elapsedMs,
  input,
  output,
  detail,
  defaultOpen = false,
  open,
  onOpenChange,
  railed = false,
  children,
  className,
  style,
}: ToolCallCardProps) {
  const [selfOpen, setSelfOpen] = useState(defaultOpen);
  const isControlled = open !== undefined;
  const isOpen = isControlled ? open : selfOpen;
  const bodyId = `${useId()}-body`;

  const hasBody = Boolean(input || output || detail || children);
  const elapsedText = elapsedMs === undefined ? '' : formatElapsed(elapsedMs);
  const statusLabel = TOOL_CALL_STATUS_LABEL[status];
  // Succeeded is the silent default: a word on every green row is noise. Every other state prints
  // its label, because "why did nothing happen" is answered by a word, not by a hue.
  const showStatusWord = status !== 'ok';
  // The two states whose payload is not a plain result. Kept as one value so the section heading and
  // its tone can never disagree about which of the two happened.
  const outcome = status === 'error' ? 'error' : status === 'denied' ? 'denied' : undefined;

  const toggle = () => {
    const next = !isOpen;
    if (!isControlled) setSelfOpen(next);
    onOpenChange?.(next);
  };

  return (
    <div
      className={cx(styles.root, className)}
      style={style}
      data-status={status}
      data-open={isOpen || undefined}
      data-railed={railed || undefined}
    >
      <button
        type="button"
        className={styles.header}
        // A disclosure, so both halves of the contract: what it controls and whether it is open.
        aria-expanded={hasBody ? isOpen : undefined}
        aria-controls={hasBody ? bodyId : undefined}
        // No body means nothing to disclose. `aria-disabled` rather than `disabled` keeps the row
        // focusable, so a keyboard user can still read the name and status.
        aria-disabled={hasBody ? undefined : true}
        onClick={hasBody ? toggle : undefined}
      >
        <ToolCallStatusGlyph status={status} />
        <code className={styles.name}>{name}</code>
        {/* The state in words, always, for assistive tech — visible or not. */}
        <span className={styles.srOnly}>{statusSentence(status, elapsedMs)}</span>
        {summary ? (
          <span className={styles.summary} title={summary}>
            {summary}
          </span>
        ) : null}
        <span className={styles.trailing}>
          {showStatusWord ? (
            <span className={styles.statusWord} aria-hidden="true">
              {statusLabel}
            </span>
          ) : null}
          {elapsedText ? (
            <span className={styles.elapsed} aria-hidden="true">
              {elapsedText}
            </span>
          ) : null}
          {/* Swapped, not rotated — a permanent transform promotes the row to its own layer. */}
          {hasBody ? (
            <Icon name={isOpen ? 'expand_more' : 'chevron_right'} size="sm" className={cx(styles.chevron)} />
          ) : null}
        </span>
      </button>

      {/* Rendered while collapsed and hidden with `hidden`, not unmounted: `aria-controls` above must
          point at an element that exists, and a "Show more" the user already opened must survive a
          collapse. A hidden <pre> costs one text node and zero layout. */}
      {hasBody ? (
        <div className={styles.body} id={bodyId} hidden={!isOpen}>
          {detail ? (
            <p className={styles.detail} data-tone={outcome}>
              {detail}
            </p>
          ) : null}
          {input ? <Payload label="Input" text={input} /> : null}
          {/* The result section is LABELLED by outcome, not styled into one: an error payload says
              "Error", a refusal says "Refusal", and neither is allowed to borrow the other's word. */}
          {output ? (
            <Payload
              label={outcome ? OUTCOME_LABEL[outcome] : 'Output'}
              text={output}
              {...(outcome ? { tone: outcome } : {})}
            />
          ) : null}
          {children}
        </div>
      ) : null}
    </div>
  );
}
