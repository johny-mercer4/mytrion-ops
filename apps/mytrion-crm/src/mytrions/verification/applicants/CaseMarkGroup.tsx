/**
 * The verdict control — one per check, on Identity and Screening.
 *
 * WHAT IT REPLACES. Both panes rendered their options as `ds/Button` with `variant="ghost"` and the
 * chosen one switched to `"secondary"`. Two problems, and the second is the serious one. Selected read
 * as a faint 1px border — on a row of three, "which did I pick" took a second look — and the tone
 * carried NO meaning: "OK", "Missing" and "Inconsistent" were the same grey, so a reviewer scanning
 * seven rows for the one they flagged had to read every label. A verdict control whose verdicts look
 * identical is a list of words.
 *
 * COLOUR IS NEVER THE ONLY CHANNEL. Each option owns a glyph — a tick, an upload cloud, a warning —
 * so the state survives greyscale and colour-blindness, and the pressed option is the only filled one,
 * so it survives a monochrome screenshot too.
 *
 * A RADIO GROUP, not three toggles. These are mutually exclusive verdicts, so the group is
 * `role="radiogroup"` and each option `role="radio"` with `aria-checked` — the shape assistive tech
 * announces as "1 of 3". `aria-pressed` on three buttons announces three independent toggles, which is
 * what the panes had and is a different control from the one they mean.
 *
 * Arrow keys move between options because that is what a radio group does; `useRovingRadio` is the
 * app's own implementation of it, already used by the Sales applicant-type picker.
 */
import { Icon, type IconName } from '@/ds';
import { useRovingRadio } from '../../_shared/useRovingRadio';
import './caseMarks.css';

/** `good` satisfies the check; `warn` needs an action; `bad` is a finding against the applicant. */
export type MarkTone = 'good' | 'warn' | 'bad';

export interface MarkOption<T extends string> {
  id: T;
  label: string;
  icon: IconName;
  tone: MarkTone;
  /** Longer than the label, for the control's tooltip and accessible description. */
  hint?: string;
}

export function CaseMarkGroup<T extends string>({
  ariaLabel,
  options,
  value,
  disabled,
  onChange,
}: {
  ariaLabel: string;
  options: readonly MarkOption<T>[];
  value: T | null;
  disabled?: boolean | undefined;
  onChange: (next: T) => void;
}) {
  const roving = useRovingRadio(
    options.map((o) => o.id),
    value ?? ('' as T),
    onChange,
  );

  return (
    <div className="va-marks" role="radiogroup" aria-label={ariaLabel}>
      {options.map((option) => {
        const on = value === option.id;
        return (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={on}
            className="va-mark"
            data-tone={option.tone}
            disabled={disabled}
            title={option.hint ?? option.label}
            {...roving(option.id)}
            onClick={() => onChange(option.id)}
          >
            <Icon name={option.icon} size="sm" className="va-mark-glyph" />
            <span className="va-mark-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
}
