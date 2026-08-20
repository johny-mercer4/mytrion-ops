/**
 * The numeric-field grid both Phase 6 reviews are built from, plus the small controls beside it.
 *
 * ONE COMPONENT because the credit and banking forms differ in their FIELDS, not in how a field
 * behaves: every one is an optional number that may be blank, carries a unit the reviewer should not
 * have to remember, and must survive a half-typed "-" or "12." without being rewritten under them.
 * Two hand-written grids would have drifted on the third of those within a week.
 */
import { Input } from '@/ds';
import type { ReviewField, ReviewFieldKind, ReviewValues } from './caseCreditBanking';

/**
 * The unit, as a suffix on the field's own label rather than smuggled into its name.
 *
 * SYMBOLS, NOT WORDS. `USD` and `months` spelled out pushed the label onto a second line on nearly
 * every money field — "Recurring weekly income ·" then a lone "USD" — and repeated the same three
 * letters fifteen times down one form. `$` and `mo` carry the same information in one or two
 * characters, so the label stays on its line and the unit stays quiet.
 */
const SUFFIX: Record<ReviewFieldKind, string | null> = {
  money: '$',
  pct: '%',
  months: 'mo',
  count: null,
  score: null,
};

/**
 * `inputMode` decides which keypad a phone offers, and it is not the same question as which
 * characters are legal: money and percentages need the decimal pad, counts do not.
 */
function inputModeFor(kind: ReviewFieldKind): 'numeric' | 'decimal' {
  return kind === 'money' || kind === 'pct' ? 'decimal' : 'numeric';
}

export function ReviewFieldGrid({
  fields,
  values,
  disabled,
  idPrefix,
  invalid,
  onChange,
}: {
  fields: readonly ReviewField[];
  values: ReviewValues;
  disabled: boolean;
  /** Namespaces the `id`/`htmlFor` pair — two grids on one pane would otherwise collide. */
  idPrefix: string;
  /** Field ids whose current text is not a number. Named so the reviewer can find the one cell. */
  invalid: ReadonlySet<string>;
  onChange: (id: string, next: string) => void;
}) {
  return (
    <div className="va-fields">
      {fields.map((field) => {
        const id = `${idPrefix}-${field.id}`;
        const suffix = SUFFIX[field.kind];
        const bad = invalid.has(field.id);
        return (
          <div className="va-field" key={field.id}>
            <label className="va-field-label" htmlFor={id}>
              {field.label}
              {suffix ? <span className="va-field-unit"> · {suffix}</span> : null}
            </label>
            <Input
              id={id}
              value={values[field.id] ?? ''}
              placeholder="Not recorded"
              inputMode={inputModeFor(field.kind)}
              disabled={disabled}
              fullWidth
              aria-invalid={bad || undefined}
              {...(bad ? { 'aria-describedby': `${id}-err` } : {})}
              onChange={(e) => onChange(field.id, e.currentTarget.value)}
            />
            {/* THE PROBLEM AND THE RECOVERY, on the field that has it. A save that silently dropped
                the cell would leave the reviewer certain they had recorded a number they had not. */}
            {bad ? (
              <span className="va-field-error" id={`${id}-err`}>
                {field.kind === 'count' || field.kind === 'score' || field.kind === 'months'
                  ? 'Whole number, or leave it blank'
                  : 'Numbers only, or leave it blank'}
              </span>
            ) : field.hint ? (
              <span className="va-field-hint">{field.hint}</span>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

/**
 * A short enum, as the plain `<select>` this pane family already uses.
 *
 * NOT `ds/Select`: that is a searchable popup built for long option lists, and a three-value trend
 * picker does not need a search box or a portal. The applicant-type pickers on Phase 4 and Phase 5
 * are plain selects for the same reason — consistency inside the pane beats reaching for the bigger
 * component.
 */
export function ReviewSelect<T extends string>({
  id,
  label,
  value,
  options,
  disabled,
  placeholder,
  onChange,
}: {
  id: string;
  label: string;
  value: T | null;
  options: ReadonlyArray<{ value: T; label: string }>;
  disabled: boolean;
  placeholder: string;
  onChange: (next: T | null) => void;
}) {
  return (
    <div className="va-field">
      <label className="va-field-label" htmlFor={id}>
        {label}
      </label>
      <select
        id={id}
        className="va-type-select"
        value={value ?? ''}
        disabled={disabled}
        onChange={(e) => {
          const next = e.currentTarget.value;
          onChange(next === '' ? null : (next as T));
        }}
      >
        <option value="">{placeholder}</option>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/** A recorded judgement that is a yes/no rather than a number. */
export function ReviewToggle({
  id,
  label,
  hint,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  checked: boolean;
  disabled: boolean;
  onChange: (next: boolean) => void;
}) {
  return (
    <label className="va-toggle" htmlFor={id}>
      <input
        id={id}
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.currentTarget.checked)}
      />
      <span className="va-toggle-copy">
        <span className="va-toggle-label">{label}</span>
        {hint ? <span className="va-field-hint">{hint}</span> : null}
      </span>
    </label>
  );
}
