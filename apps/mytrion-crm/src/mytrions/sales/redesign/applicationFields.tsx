/**
 * Field primitives for the application intake wizard.
 *
 * Split from `applicationIntake.tsx` for the 600-line cap. Uses the Sales-desk idiom (`s()` inline
 * styles), not `ds/` — the whole redesign tree is built that way and mixing the two inside one form
 * is what makes a screen look assembled rather than designed.
 *
 * MOUNTED IN BOTH MYTRIONS: Sales renders these in the intake wizard, Verification renders them in
 * the Phase 6 review panes. Every token below is therefore a GLOBAL one — see the note on LABEL.
 *
 * Every field takes its "missing" state from the SERVER's verdict rather than re-deriving
 * completeness in the browser. One evaluator, one answer, no chance of the card and the form
 * disagreeing about what is outstanding.
 */
import type { ReactNode } from 'react';
import { useRovingRadio } from '../../_shared/useRovingRadio';
import { s } from './dc';
import { Icon } from './icons';

/**
 * Field styles declared locally, on GLOBAL tokens, rather than reusing `createTicketShared`'s
 * FIELD/LABEL.
 *
 * Those constants read `--text` and `--muted`, which `sales/redesign/theme.css` declares under
 * `.ss-root`. These components are also mounted by the Verification desk's review panes, which
 * render through ModuleShell and never enter that scope — there the Sales names resolve to nothing
 * and CSS drops the whole declaration silently.
 *
 * `--text-primary` / `--text-muted` are what `.ss-root` aliases anyway, so this is identical inside
 * Sales and correct outside it.
 */
const LABEL =
  'font-size:12px;font-weight:700;color:var(--text-muted);margin-bottom:8px;text-transform:uppercase;letter-spacing:.05em';
const FIELD =
  'width:100%;min-height:44px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text-primary);font-size:14px';

/** A field the server says is outstanding gets a visible edge, not just a colour. */
const FIELD_MISSING = `${FIELD};border-color:var(--danger);box-shadow:0 0 0 1px var(--danger)`;

export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <section style={s('display:grid;gap:14px')}>
      <div>
        <h3 style={s('margin:0;font-size:15px;font-weight:800;color:var(--text-primary)')}>{title}</h3>
        {hint ? (
          <p style={s('margin:4px 0 0;font-size:13px;color:var(--text-muted);line-height:1.5')}>{hint}</p>
        ) : null}
      </div>
      <div style={s('display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))')}>
        {children}
      </div>
    </section>
  );
}

export function Field({
  label,
  name,
  value,
  onChange,
  missing,
  type = 'text',
  placeholder,
  inputMode,
  maxLength,
  hint,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  missing?: boolean | undefined;
  type?: string | undefined;
  placeholder?: string | undefined;
  inputMode?: 'text' | 'numeric' | 'decimal' | 'tel' | 'email' | undefined;
  maxLength?: number | undefined;
  hint?: string | undefined;
}) {
  const id = `app-${name}`;
  return (
    <div style={s('display:flex;flex-direction:column')}>
      <label htmlFor={id} style={s(LABEL)}>
        {label}
        {missing ? <span style={s('color:var(--danger);margin-left:6px')}>needed</span> : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        placeholder={placeholder ?? ''}
        maxLength={maxLength ?? undefined}
        inputMode={inputMode ?? 'text'}
        aria-invalid={missing ? true : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={s(missing ? FIELD_MISSING : FIELD)}
      />
      {hint ? (
        <span style={s('margin-top:6px;font-size:12px;color:var(--text-muted);line-height:1.45')}>{hint}</span>
      ) : null}
    </div>
  );
}

export function SelectField({
  label,
  name,
  value,
  onChange,
  options,
  missing,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  missing?: boolean | undefined;
}) {
  const id = `app-${name}`;
  return (
    <div style={s('display:flex;flex-direction:column')}>
      <label htmlFor={id} style={s(LABEL)}>
        {label}
        {missing ? <span style={s('color:var(--danger);margin-left:6px')}>needed</span> : null}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        aria-invalid={missing ? true : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={s(missing ? FIELD_MISSING : FIELD)}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

/**
 * The applicant-type chooser. A radio group rather than a select: it is the one answer that decides
 * which of the two flows the agent fills, so it should be visible at a glance, not folded away.
 */
export function ApplicantTypePicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: 'owner_operator' | 'carrier' | 'company') => void;
}) {
  const options = [
    {
      value: 'owner_operator' as const,
      title: 'Owner-operator / individual',
      body: 'One person applying in their own name. Needs licence, SSN card and residential address.',
    },
    {
      value: 'carrier' as const,
      title: 'Carrier',
      body: 'A company with MC and USDOT authority. Needs EIN, business address and owners.',
    },
    {
      value: 'company' as const,
      title: 'Company without MC/DOT',
      body: 'An LLC or corporation with no operating authority. Goes to Manager Review on submit.',
    },
  ];
  const roving = useRovingRadio(
    options.map((o) => o.value),
    value as 'owner_operator' | 'carrier' | 'company' | '',
    onChange,
  );
  return (
    <div
      role="radiogroup"
      aria-label="Applicant type"
      style={s('display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))')}
    >
      {options.map((o) => {
        const active = value === o.value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            {...roving(o.value)}
            onClick={() => onChange(o.value)}
            style={s(
              `text-align:left;display:grid;gap:6px;padding:14px;border-radius:var(--radius-md);cursor:pointer;background:var(--surface);border:1px solid ${
                active ? 'var(--accent)' : 'var(--border)'
              };box-shadow:${active ? '0 0 0 1px var(--accent)' : 'none'}`,
            )}
          >
            <span style={s('display:flex;align-items:center;gap:8px;font-size:14px;font-weight:800;color:var(--text-primary)')}>
              {active ? <Icon name="check" size={15} color="var(--accent)" strokeWidth={2.4} /> : null}
              {o.title}
            </span>
            <span style={s('font-size:12px;color:var(--text-muted);line-height:1.5')}>{o.body}</span>
          </button>
        );
      })}
    </div>
  );
}

/**
 * The red/green state, stated in words.
 *
 * Colour alone would fail anyone who cannot distinguish it, and "4 items outstanding" is more
 * actionable than a red dot regardless.
 */
export function GateBanner({
  complete,
  missing,
  submitted,
}: {
  complete: boolean;
  missing: Array<{ field: string; label: string }>;
  submitted: boolean;
}) {
  if (submitted && complete) {
    return (
      <div
        role="status"
        style={s(
          'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:var(--radius-md);background:var(--intent-success-bg);border:1px solid var(--intent-success-bd)',
        )}
      >
        <Icon name="check" size={18} color="var(--success)" strokeWidth={2.4} />
        <span style={s('font-size:13px;font-weight:700;color:var(--text-primary)')}>
          Released to Verification — underwriting is under way.
        </span>
      </div>
    );
  }
  if (complete) {
    return (
      <div
        role="status"
        style={s(
          'display:flex;align-items:center;gap:10px;padding:12px 14px;border-radius:var(--radius-md);background:var(--intent-success-bg);border:1px solid var(--intent-success-bd)',
        )}
      >
        <Icon name="check" size={18} color="var(--success)" strokeWidth={2.4} />
        <span style={s('font-size:13px;font-weight:700;color:var(--text-primary)')}>
          Everything needed is here. Submit to release it to Verification.
        </span>
      </div>
    );
  }
  return (
    <div
      role="status"
      style={s(
        'display:grid;gap:8px;padding:12px 14px;border-radius:var(--radius-md);background:var(--intent-danger-bg);border:1px solid var(--intent-danger-bd)',
      )}
    >
      <div style={s('display:flex;align-items:center;gap:10px')}>
        <Icon name="warn" size={18} color="var(--danger)" strokeWidth={2.2} />
        <span style={s('font-size:13px;font-weight:800;color:var(--text-primary)')}>
          {missing.length} item{missing.length === 1 ? '' : 's'} still needed before Verification can start
        </span>
      </div>
      <ul style={s('margin:0;padding-left:28px;display:grid;gap:3px')}>
        {missing.slice(0, 6).map((m) => (
          <li key={m.field} style={s('font-size:12px;color:var(--text-secondary);line-height:1.5')}>
            {m.label}
          </li>
        ))}
        {missing.length > 6 ? (
          <li style={s('font-size:12px;color:var(--text-muted)')}>and {missing.length - 6} more…</li>
        ) : null}
      </ul>
    </div>
  );
}
