import { useEffect, useId, useRef, useState, type CSSProperties, type KeyboardEvent } from 'react';
import { Button } from '../Button/Button';
import { Icon, type IconName } from '../Icon/Icon';
import styles from './ElicitationPicker.module.css';

export interface ElicitationOption {
  /** What is sent back to the agent. Not shown. */
  value: string;
  /** What the user reads. */
  label: string;
  /** One line of disambiguation — an account number, a date, a scope. Not a description field. */
  hint?: string;
  /** Optional leading glyph. Use it when the options are of different KINDS, not for decoration. */
  icon?: IconName;
  /**
   * Offered but not choosable. Stays focusable (`aria-disabled`), so a keyboard user can reach the
   * `hint` that explains why — put the reason there.
   */
  disabled?: boolean;
}

export type ElicitationSelect = 'single' | 'multi';

export interface ElicitationPickerProps {
  /** The question. Becomes the group's accessible name, so write it as a question. */
  prompt: string;
  /** Optional second line — a constraint or a consequence ("this starts the transfer"). */
  hint?: string;
  options: ElicitationOption[];
  /** `single` (default) sends on pick. `multi` collects and sends on Confirm. */
  select?: ElicitationSelect;
  /** Controlled selection. Omit for uncontrolled. Always an array, including for `single`. */
  value?: string[];
  defaultValue?: string[];
  /** Fires on every selection change, in both modes. */
  onChange?: (values: string[]) => void;
  /** The answer. Fires immediately on pick in `single`, on Confirm in `multi`. */
  onSubmit?: (values: string[]) => void;
  /**
   * The answer has been given and the agent has acted on it. The picker becomes a read-only RECORD
   * of what was chosen. Not a styling flag — see the docblock.
   */
  answered?: boolean;
  /** Replaces the default "Answered" footnote, e.g. "Answered · used for the quote". */
  answeredNote?: string;
  /** Label on the multi-select confirm control. */
  confirmLabel?: string;
  /** The answer is in flight. Blocks re-submission and keeps the control's width. */
  busy?: boolean;
  /**
   * Move focus to the first option on mount. Off by default — a primitive that grabs focus on its
   * own will steal it from the composer the moment an agent streams one of these mid-turn. The chat
   * surface decides.
   */
  autoFocus?: boolean;
  className?: string;
  style?: CSSProperties;
}

/**
 * ElicitationPicker — the generative-UI control an agent renders when it needs the user to choose.
 *
 * The agent stops and asks: which client, which invoice, which of these three fixes. The answer is
 * not form input — it IS the next turn of the conversation. That is the whole design constraint, and
 * two consequences follow from it.
 *
 * FIRST: selecting sends. In `single` mode a pick submits immediately, because a Confirm button for
 * a one-of-N question is a second click on every single turn. Which is also why arrow keys move
 * focus WITHOUT selecting, deviating from the usual radiogroup behaviour where arrowing selects:
 * here selecting fires a message to an agent that may go and do something. ARIA permits focus-only
 * movement precisely when selection has consequences, and this is that case. Space or Enter commits.
 *
 * SECOND, AND THE IMPORTANT ONE: once answered it is a READ-ONLY RECORD. `answered` swaps the
 * buttons for a static list of what was chosen. An elicitation that stays editable after the agent
 * has acted on it is a lie about the conversation's history — the transcript above it was produced
 * from the old answer, and re-picking cannot retroactively change what the agent already did. If the
 * user wants a different answer, that is a new turn, not an edit of an old one. Never leave
 * `answered` false to keep it "convenient".
 *
 * KEYBOARD
 * - Tab / Shift+Tab — into and out of the group. The group is one tab stop (roving tabindex), so a
 *   twelve-option picker does not cost twelve tabs to skip.
 * - Arrow Up / Left, Arrow Down / Right — move focus between options, wrapping. Does not select.
 * - Home / End — first / last option.
 * - Space, Enter — select (single: sends; multi: toggles).
 * - Multi only: Tab to Confirm, then Enter or Space.
 *
 * ROLES — `radiogroup` of `radio` for single, `group` of `checkbox` for multi, named by the prompt
 * and described by the hint. Selection is shown by a check glyph in a circle (single) or a square
 * (multi) as well as by colour, so it survives greyscale and forced colours.
 *
 * WHEN NOT TO USE IT
 * - A form field. If the value is going into a record rather than into the conversation, that is a
 *   Select or a RadioGroup with a label and a submit — a picker implies an agent is waiting.
 * - More than ~12 options, or options the user must search. That is a combobox or an entity picker;
 *   a wall of cards is not a search interface.
 * - A destructive confirmation ("delete these 40 rows?"). Approval of a proposed action has its own
 *   language (`--approve-*` / `--reject-*`) and must not look like picking from a menu.
 * - Free text. If the agent needs a sentence, it should ask in the composer, where the user already
 *   has history, editing and attachments.
 */
export function ElicitationPicker({
  prompt,
  hint,
  options,
  select = 'single',
  value,
  defaultValue,
  onChange,
  onSubmit,
  answered = false,
  answeredNote,
  confirmLabel = 'Confirm',
  busy = false,
  autoFocus = false,
  className,
  style,
}: ElicitationPickerProps) {
  const multi = select === 'multi';
  const baseId = useId();
  const promptId = `${baseId}-prompt`;
  const hintId = `${baseId}-hint`;

  const [uncontrolled, setUncontrolled] = useState<string[]>(defaultValue ?? []);
  const selected = value ?? uncontrolled;

  const firstEnabled = Math.max(
    0,
    options.findIndex((o) => !o.disabled),
  );
  const [focusIndex, setFocusIndex] = useState(firstEnabled);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  useEffect(() => {
    if (autoFocus && !answered) optionRefs.current[firstEnabled]?.focus();
    // Mount only: re-focusing on every prop change would yank focus out of whatever the user moved to.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const commit = (next: string[]) => {
    if (value === undefined) setUncontrolled(next);
    onChange?.(next);
    return next;
  };

  const pick = (option: ElicitationOption) => {
    if (answered || busy || option.disabled) return;
    if (multi) {
      commit(
        selected.includes(option.value)
          ? selected.filter((v) => v !== option.value)
          : [...selected, option.value],
      );
      return;
    }
    // Single: the pick IS the answer. No intermediate "selected but not sent" state to explain.
    onSubmit?.(commit([option.value]));
  };

  const moveFocus = (from: number, delta: number) => {
    const n = options.length;
    for (let step = 1; step <= n; step += 1) {
      const i = (((from + delta * step) % n) + n) % n;
      // A disabled option is skipped rather than focused-and-refused: landing on a dead target and
      // having nothing happen reads as a broken keyboard, not as a disabled option.
      if (!options[i]?.disabled) {
        setFocusIndex(i);
        optionRefs.current[i]?.focus();
        return;
      }
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (event.key) {
      case 'ArrowDown':
      case 'ArrowRight':
        event.preventDefault();
        moveFocus(index, 1);
        break;
      case 'ArrowUp':
      case 'ArrowLeft':
        event.preventDefault();
        moveFocus(index, -1);
        break;
      case 'Home':
        event.preventDefault();
        moveFocus(-1, 1);
        break;
      case 'End':
        event.preventDefault();
        moveFocus(0, -1);
        break;
      default:
        // Space and Enter are left to the native <button>, which already fires click for both.
        break;
    }
  };

  const chosen = options.filter((o) => selected.includes(o.value));

  return (
    <div
      className={[styles.root, className].filter(Boolean).join(' ')}
      style={style}
      data-answered={answered || undefined}
      data-select={select}
    >
      <p className={styles.prompt} id={promptId}>
        {prompt}
      </p>
      {hint ? (
        <p className={styles.hint} id={hintId}>
          {hint}
        </p>
      ) : null}

      {answered ? (
        // A RECORD, not a control. No buttons, nothing focusable, nothing that suggests the answer
        // can still be changed — because it cannot: the agent already acted on it.
        <ul className={styles.options} aria-labelledby={promptId}>
          {options.map((option) => {
            const on = selected.includes(option.value);
            return (
              <li
                key={option.value}
                className={styles.option}
                data-on={on || undefined}
                data-static="true"
              >
                <span className={styles.mark} data-shape={multi ? 'box' : 'dot'} aria-hidden="true">
                  {on ? <Icon name="check" size="sm" /> : null}
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>
                    {option.icon ? <Icon name={option.icon} size="sm" /> : null}
                    {option.label}
                  </span>
                  {option.hint ? <span className={styles.optHint}>{option.hint}</span> : null}
                </span>
                {/* Not colour alone: the chosen rows say so. */}
                {on ? <span className={styles.chosenTag}>Chosen</span> : null}
              </li>
            );
          })}
        </ul>
      ) : (
        <div
          className={styles.options}
          role={multi ? 'group' : 'radiogroup'}
          aria-labelledby={promptId}
          {...(hint ? { 'aria-describedby': hintId } : {})}
        >
          {options.map((option, i) => {
            const on = selected.includes(option.value);
            return (
              <button
                key={option.value}
                ref={(el) => {
                  optionRefs.current[i] = el;
                }}
                type="button"
                role={multi ? 'checkbox' : 'radio'}
                aria-checked={on}
                // aria-disabled, never `disabled`: the reason lives in the hint, and a removed-from-
                // tab-order option is an option nobody can read the reason for.
                {...(option.disabled ? { 'aria-disabled': true } : {})}
                // Roving tabindex — the whole group is ONE tab stop.
                tabIndex={i === focusIndex ? 0 : -1}
                className={styles.option}
                data-on={on || undefined}
                data-disabled={option.disabled || undefined}
                onFocus={() => setFocusIndex(i)}
                onKeyDown={(event) => onKeyDown(event, i)}
                onClick={() => pick(option)}
              >
                <span className={styles.mark} data-shape={multi ? 'box' : 'dot'} aria-hidden="true">
                  {on ? <Icon name="check" size="sm" /> : null}
                </span>
                <span className={styles.text}>
                  <span className={styles.label}>
                    {option.icon ? <Icon name={option.icon} size="sm" /> : null}
                    {option.label}
                  </span>
                  {option.hint ? <span className={styles.optHint}>{option.hint}</span> : null}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {multi && !answered ? (
        <div className={styles.footer}>
          <Button
            variant="primary"
            size="sm"
            loading={busy}
            disabled={selected.length === 0}
            onClick={() => onSubmit?.(selected)}
          >
            {selected.length > 0 ? `${confirmLabel} (${selected.length})` : confirmLabel}
          </Button>
        </div>
      ) : null}

      {answered ? (
        <p className={styles.answeredNote}>
          <Icon name="lock" size="sm" />
          {answeredNote ?? 'Answered — sent to the agent and no longer editable.'}
        </p>
      ) : null}

      {/* ONE polite region, and it speaks on ONE transition: the moment this becomes a record.
          Announcing every toggle would narrate the user's own keystrokes back at them. */}
      <p className={styles.srOnly} role="status" aria-live="polite">
        {answered && chosen.length > 0 ? `Answered: ${chosen.map((o) => o.label).join(', ')}` : ''}
      </p>
    </div>
  );
}
