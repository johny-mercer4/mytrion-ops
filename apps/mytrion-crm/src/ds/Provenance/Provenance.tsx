import type { HTMLAttributes, ReactNode } from 'react';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './Provenance.module.css';

/**
 * How well an answer is backed by retrieved evidence.
 *
 * `verified`   — every claim traced to a source the system can name.
 * `partial`    — some of the answer is sourced, some is the model's own composition.
 * `ungrounded` — the model answered from its weights. Not an error, not a failure — but the reader
 *                has to know, because nothing here can be checked.
 */
export type GroundingState = 'verified' | 'partial' | 'ungrounded';

export interface ProvenanceProps extends HTMLAttributes<HTMLDivElement> {
  state: GroundingState;
  /** Number of sources behind the answer. Composed into the evidence phrase. */
  sources?: number;
  /** Number of retrieved passages. Composed into the evidence phrase. */
  passages?: number;
  /** Replaces the composed evidence phrase entirely — "Zoho CRM · last 30 days". */
  detail?: ReactNode;
  /** Overrides the state word. Rarely right: the three words are the vocabulary. */
  label?: ReactNode;
  /** The hairline above the row. On by default — it is a footnote under an answer. */
  rule?: boolean;
  /** Trailing slot, pushed to the end. A `ConfidenceMeter` is the intended occupant. */
  children?: ReactNode;
}

const LABEL: Record<GroundingState, string> = {
  verified: 'Grounded',
  partial: 'Partly grounded',
  ungrounded: 'Ungrounded',
};

// Three distinguishable SHAPES, not three tints of one glyph: a seal, an info disc, and a broken
// link. The row stays readable in greyscale and to anyone who cannot separate green from amber.
const GLYPH: Record<GroundingState, IconName> = {
  verified: 'verified',
  partial: 'info',
  ungrounded: 'link_off',
};

function evidencePhrase(sources?: number, passages?: number): string {
  const parts: string[] = [];
  if (sources != null) parts.push(`${sources} source${sources === 1 ? '' : 's'}`);
  if (passages != null) parts.push(`${passages} passage${passages === 1 ? '' : 's'}`);
  return parts.join(' · ');
}

/**
 * The provenance footnote: whether an answer is grounded, and in what.
 *
 * One line under an answer — icon, state word, evidence — plus a trailing slot for a
 * `ConfidenceMeter`. It answers the only question that matters about an AI answer in an ops tool:
 * can I act on this, or do I have to go check?
 *
 * THREE STATES, NOT TWO. Collapsing `partial` into `verified` is the failure mode this component
 * exists to prevent: an answer where two of five claims are sourced is not a grounded answer, and
 * a green tick on it is a lie the interface tells on the model's behalf. `ungrounded` is likewise
 * not an error state — it is an honest one, and it is coloured muted rather than red so that
 * honesty does not read as breakage.
 *
 * NEVER COLOUR ALONE — each state carries a distinct glyph shape AND a distinct word. Greyscale it
 * and it still reads.
 *
 * KEYBOARD — none. This is a static row. If you need it to open the evidence, put a `SourceList`
 * in the trailing slot; that is the control, and it owns its own keyboard contract.
 *
 * NO LIVE REGION. Grounding resolves at the end of a turn, which is exactly the transition the
 * streaming surface's single polite region already announces ("Done"). A second region here would
 * talk over it.
 *
 * WHEN NOT TO USE IT
 * - To report a failed turn. A tool that errored or a refused call is a turn error, not weak
 *   grounding — do not launder an error into "ungrounded".
 * - As a per-source row. That is `SourceList`; this is one claim about the whole answer.
 * - On a user message, or on any content the model did not author. Provenance is a statement about
 *   generated text.
 * - To imply correctness. Grounded means traceable, not right — keep the copy to the three words.
 */
export function Provenance({
  state,
  sources,
  passages,
  detail,
  label,
  rule = true,
  children,
  className,
  ...rest
}: ProvenanceProps) {
  // Parenthesised deliberately — `??` and `||` cannot be mixed unparenthesised in JS.
  const evidence: ReactNode = detail ?? (evidencePhrase(sources, passages) || null);

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      data-state={state}
      data-rule={rule || undefined}
      {...rest}
    >
      {/* Unlabelled: the state word sits right beside it, and labelling the glyph would make a
          screen reader say "grounded grounded". */}
      <Icon name={GLYPH[state]} size="sm" className={styles.icon} />
      <span className={styles.label}>{label ?? LABEL[state]}</span>
      {evidence ? (
        <>
          <span className={styles.sep} aria-hidden="true">
            ·
          </span>
          <span className={styles.detail}>{evidence}</span>
        </>
      ) : null}
      {children ? <span className={styles.trailing}>{children}</span> : null}
    </div>
  );
}
