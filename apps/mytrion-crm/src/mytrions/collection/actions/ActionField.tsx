/**
 * A labelled field row.
 *
 * `Input`, `Textarea` and `DateField` deliberately do not own a label — only `Select` does — so
 * every workspace wraps them itself (see `recruit-field`, `hr-field`). This is Collection's, and
 * it exists once rather than four times across the dialogs.
 *
 * A real `<label>` element, not a styled div: clicking the text focuses the control, which is the
 * whole reason to have a label rather than a heading.
 */
import type { ReactNode } from 'react';

export function ActionField({
  label,
  hint,
  children,
}: {
  label: string;
  /** One line under the control — what the value means, not how to type it. */
  hint?: ReactNode;
  children: ReactNode;
}) {
  return (
    <label className="ca-field">
      <span className="ca-label">{label}</span>
      {children}
      {hint ? <span className="ca-hint">{hint}</span> : null}
    </label>
  );
}

/** A block of consequence a person must read before they commit. Never colour alone. */
export function ActionNote({
  tone = 'info',
  children,
}: {
  tone?: 'info' | 'warning' | 'danger';
  children: ReactNode;
}) {
  return (
    <p className="ca-note" data-tone={tone}>
      {children}
    </p>
  );
}
