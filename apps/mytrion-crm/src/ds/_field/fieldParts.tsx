import { useId, type ReactNode } from 'react';
import { Icon } from '../Icon/Icon';
import styles from './fieldParts.module.css';

/*
 * Machinery shared by Input and Textarea, and by nothing else.
 *
 * WHY A `_field` FOLDER AND NOT A COMPONENT FOLDER: the leading underscore is the same signal
 * `mytrions/_shared` already uses in this codebase — "this is a composition layer, not a public
 * component". Nothing here is exported from `src/ds/index.ts`, because none of it is usable on its
 * own: `FieldMessage` without a field to describe is a paragraph with an icon.
 *
 * The two things that live here are the two things that DRIFT when they are written twice: the
 * aria-describedby wiring, and the message row. Everything else (the shell chrome, the sizes) is
 * duplicated in each component's stylesheet on purpose — an inline row with a fixed height and a
 * multi-line block with a growing one share a border and nothing more, and `composes:` across
 * module boundaries would tie their cascade order together to buy that one border back.
 */

/** Both fields ship the same two sizes as Button, and for the same reason: they sit in the same rows. */
export type FieldSize = 'sm' | 'md';

/**
 * Joins class names, dropping the absent ones, and always returns a `string`.
 *
 * The return type is the entire point. `noUncheckedIndexedAccess` types every CSS-module lookup as
 * `string | undefined`, and `exactOptionalPropertyTypes` then REFUSES that value for a prop declared
 * `className?: string` — which is how `<Icon className={styles.leading} />` fails to typecheck while
 * looking perfectly correct. Button's inline `[a, b].filter(Boolean).join(' ')` is the same trick
 * written out longhand; this is that idiom with a name, because these two components reach for it
 * six times between them.
 */
export function cx(...parts: ReadonlyArray<string | undefined | false>): string {
  return parts.filter(Boolean).join(' ');
}

export interface FieldIds {
  /** The id on the control itself. A caller-supplied `id` always wins — it may be a `<label for>` target. */
  fieldId: string;
  /** The message paragraph. Referenced from `aria-describedby`, never rendered without it. */
  messageId: string;
  prefixId: string;
  suffixId: string;
}

/**
 * One `useId` call, four derived ids.
 *
 * React's `useId` returns a value containing colons (`:r3:`). That is deliberate on React's part —
 * it cannot collide with a hand-written id — and it is safe everywhere we use it, because
 * `aria-describedby` and `for` are ID-reference attributes, not selectors. Do NOT feed these to
 * `querySelector` without escaping.
 */
export function useFieldIds(id?: string): FieldIds {
  const auto = useId();
  const base = id ?? `fld${auto}`;
  return {
    fieldId: base,
    messageId: `${base}-msg`,
    prefixId: `${base}-pre`,
    suffixId: `${base}-suf`,
  };
}

/**
 * Joins the id references a field wants to describe itself with, dropping the ones that are not
 * rendered. Returns `undefined` rather than an empty string: `aria-describedby=""` is a reference to
 * a non-existent element, which some screen readers report as a broken relationship rather than as
 * no relationship at all.
 */
export function describedBy(...ids: ReadonlyArray<string | undefined | false>): string | undefined {
  const present = ids.filter((v): v is string => typeof v === 'string' && v.length > 0);
  return present.length > 0 ? present.join(' ') : undefined;
}

export interface FieldMessageProps {
  /** Must match the field's `aria-describedby`. Callers get this from `useFieldIds`. */
  id: string;
  /** Switches the row to the danger tone AND adds the error glyph. Never one without the other. */
  invalid?: boolean;
  children: ReactNode;
}

/**
 * The message row under a field — a hint when the field is fine, the error when it is not.
 *
 * COLOUR IS NOT THE SIGNAL. An invalid message is red *and* carries the `error` glyph, because red
 * text at 12px against a dark ground is exactly the case that deuteranopia and a dimmed laptop
 * screen both destroy. The glyph is `aria-hidden`: assistive tech already knows the field is invalid
 * from `aria-invalid`, and announcing "error icon" before the message would be the third time the
 * user hears about it.
 *
 * NOT a live region. The message is wired through `aria-describedby`, so it is announced when the
 * field takes focus. Wrapping it in `role="alert"` would fire on every keystroke of a validate-as-
 * you-type form and talk over the user.
 */
export function FieldMessage({ id, invalid = false, children }: FieldMessageProps) {
  return (
    <p id={id} className={cx(styles.message)} data-invalid={invalid || undefined}>
      {invalid ? <Icon name="error" size="sm" className={cx(styles.messageIcon)} /> : null}
      <span className={cx(styles.messageText)}>{children}</span>
    </p>
  );
}
