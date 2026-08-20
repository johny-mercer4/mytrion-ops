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
import { useState, type ReactNode } from 'react';
import { useRovingRadio } from '../../_shared/useRovingRadio';
import { s } from './dc';
import { Skel } from './SalesPage';
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
  'font-size:var(--ss-text-xs);font-weight:700;color:var(--text-muted);margin-bottom:8px;letter-spacing:.02em';
const FIELD_BOX =
  'width:100%;min-height:44px;padding:0 14px;border-radius:var(--radius-md);background:var(--surface);color:var(--text-primary);font-size:var(--ss-text-md)';
const FIELD = `${FIELD_BOX};border:1px solid var(--border)`;
/** A field the server says is outstanding gets a visible edge, not just a colour. */
const FIELD_MISSING = `${FIELD_BOX};border:1px solid var(--danger);box-shadow:0 0 0 1px var(--danger)`;
/**
 * Handed over. A read-only field must LOOK unavailable — `readOnly` alone renders identically to an
 * editable input, so an agent types into it, nothing happens, and the form looks broken rather than
 * finished. Flat surface, dimmed text, default cursor; still selectable, because copying an EIN out
 * of a submitted application is a thing agents do all day.
 */
const FIELD_READONLY = `${FIELD_BOX};border:1px solid var(--border-subtle);background:var(--alt);color:var(--text2);cursor:default`;

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
    <section className="ss-vf-intake-section">
      <div>
        <h3 className="ss-vf-intake-heading">{title}</h3>
        {hint ? <p className="ss-vf-intake-hint">{hint}</p> : null}
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
  readOnly,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  missing?: boolean | undefined;
  readOnly?: boolean | undefined;
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
        {missing && !readOnly ? (
          <span style={s('color:var(--danger);margin-left:6px')}> needed</span>
        ) : null}
      </label>
      <input
        id={id}
        name={name}
        type={type}
        value={value}
        placeholder={readOnly ? '—' : (placeholder ?? '')}
        maxLength={maxLength ?? undefined}
        inputMode={inputMode ?? 'text'}
        readOnly={readOnly ?? false}
        aria-invalid={missing && !readOnly ? true : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={s(readOnly ? FIELD_READONLY : missing ? FIELD_MISSING : FIELD)}
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
  readOnly,
}: {
  label: string;
  name: string;
  value: string;
  onChange: (v: string) => void;
  options: ReadonlyArray<{ value: string; label: string }>;
  missing?: boolean | undefined;
  readOnly?: boolean | undefined;
}) {
  const id = `app-${name}`;
  return (
    <div style={s('display:flex;flex-direction:column')}>
      <label htmlFor={id} style={s(LABEL)}>
        {label}
        {missing && !readOnly ? (
          <span style={s('color:var(--danger);margin-left:6px')}> needed</span>
        ) : null}
      </label>
      <select
        id={id}
        name={name}
        value={value}
        /* `disabled`, not `readOnly` — a select has no read-only state, and a disabled one still
           shows its chosen option, which is all a handed-over application needs it to do. */
        disabled={readOnly ?? false}
        aria-invalid={missing && !readOnly ? true : undefined}
        onChange={(e) => onChange(e.currentTarget.value)}
        style={s(readOnly ? FIELD_READONLY : missing ? FIELD_MISSING : FIELD)}
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
 *
 * TWO options, matching the SOP's two flows and the words both desks now use. The old third card,
 * "Company without MC/DOT", asked the agent to classify themselves by a fact the case already
 * knows — whether an MC or USDOT is on file — and the two desks read the resulting value
 * differently. A company is a company; whether it holds authority is answered by the MC and USDOT
 * fields a few rows below, not by which card was clicked.
 *
 * The Zoho poller no longer guesses either: when the Deal does not state a Business_Type of Sole
 * Proprietorship / Natural Person and carries no authority number, it leaves the type unset and
 * this picker is where a human who has spoken to the applicant answers.
 */
export function ApplicantTypePicker({
  value,
  onChange,
  pending = false,
  disabled = false,
}: {
  value: string;
  onChange: (v: 'owner_operator' | 'carrier') => void;
  /**
   * The choice is being written.
   *
   * This is the slowest click on the intake form — several statements against a database in Oregon,
   * and setting a type always changes the missing-field list so the gate must be re-derived and
   * stored. The form used to set a `busy` flag that the picker could not read and the first-choice
   * branch never rendered, so an agent clicked a card and got a still, silent page for a second or
   * more. Now the card they clicked says so.
   */
  pending?: boolean;
  disabled?: boolean;
}) {
  const options = [
    {
      value: 'owner_operator' as const,
      title: 'Owner-Operator / Individual',
      body: 'Licence, SSN card and residential address.',
    },
    {
      value: 'carrier' as const,
      title: 'Carrier (Company)',
      body: 'EIN, business address and owners.',
    },
  ];
  /**
   * Which card was clicked, so a FIRST choice can report too.
   *
   * On the first-choice branch nothing is selected yet, so `pending && active` would light neither
   * card — the exact case the agent complained about. The click is remembered locally; `value`
   * takes over the moment the server answers.
   */
  const [clicked, setClicked] = useState<string | null>(null);
  const pick = (v: 'owner_operator' | 'carrier'): void => {
    setClicked(v);
    onChange(v);
  };
  const roving = useRovingRadio(
    options.map((o) => o.value),
    value as 'owner_operator' | 'carrier' | '',
    pick,
  );
  return (
    <div
      role="radiogroup"
      aria-label="Applicant type"
      style={s('display:grid;gap:10px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))')}
    >
      {options.map((o) => {
        const active = value === o.value;
        /* The card the agent clicked is the one that reports. Only ONE spinner can appear here, and
           it is on the card whose choice is being written — not on both, and not on the page. */
        const working = pending && (value === '' ? clicked === o.value : active);
        const off = disabled || pending;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            aria-busy={working || undefined}
            disabled={off}
            {...roving(o.value)}
            onClick={() => pick(o.value)}
            style={s(
              `text-align:left;display:grid;gap:6px;padding:14px;border-radius:var(--radius-md);cursor:${
                off ? (working ? 'wait' : 'not-allowed') : 'pointer'
              };background:var(--surface);border:1px solid ${
                active ? 'var(--accent)' : 'var(--border)'
              };box-shadow:${active ? '0 0 0 1px var(--accent)' : 'none'};opacity:${
                off && !active ? '.6' : '1'
              };transition:opacity .15s,border-color .15s`,
            )}
          >
            <span style={s('display:flex;align-items:center;gap:8px;font-size:var(--ss-text-md);font-weight:800;color:var(--text-primary)')}>
              {working ? (
                <Icon name="spinner" size={15} color="var(--accent)" className="ss-spin" />
              ) : active ? (
                <Icon name="check" size={15} color="var(--accent)" strokeWidth={2.4} />
              ) : null}
              {o.title}
            </span>
            <span style={s('font-size:var(--ss-text-sm);color:var(--text-muted);line-height:1.5')}>{o.body}</span>
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
  awaitingSave = false,
}: {
  complete: boolean;
  missing: Array<{ field: string; label: string }>;
  submitted: boolean;
  /** Local values filled the red list; Submit still waits on the server after Save. */
  awaitingSave?: boolean;
}) {
  if (submitted && complete) {
    return (
      <div role="status" className="ss-vf-gate is-ok">
        <Icon name="check" size={18} color="var(--success)" strokeWidth={2.4} />
        <span className="ss-vf-gate-title">With Verification</span>
      </div>
    );
  }
  if (complete) {
    return (
      <div role="status" className="ss-vf-gate is-ok">
        <Icon name="check" size={18} color="var(--success)" strokeWidth={2.4} />
        <span className="ss-vf-gate-title">Ready to submit</span>
      </div>
    );
  }
  if (awaitingSave) {
    return (
      <div role="status" className="ss-vf-gate">
        <Icon name="warn" size={18} color="var(--warn)" strokeWidth={2.2} />
        <span className="ss-vf-gate-title">Save to update Verification</span>
      </div>
    );
  }
  return (
    <div role="status" className="ss-vf-gate is-needed">
      <div className="ss-vf-gate-row">
        <Icon name="warn" size={18} color="var(--danger)" strokeWidth={2.2} />
        <span className="ss-vf-gate-title">
          {missing.length} item{missing.length === 1 ? '' : 's'} still needed
        </span>
      </div>
      <ul className="ss-vf-gate-list">
        {missing.slice(0, 6).map((m) => (
          <li key={m.field}>{m.label}</li>
        ))}
        {missing.length > 6 ? <li>and {missing.length - 6} more…</li> : null}
      </ul>
    </div>
  );
}

/**
 * The FORM, before it arrives — the applicant-type branch only.
 *
 * Mirrors the real blocks in the real order (field sections, then the document slots, then the
 * actions) so nothing jumps when the data replaces it. Mounted while the type write is in flight,
 * where only the form BELOW the picker is still to come; the case's own cold load is a different
 * shape and draws the four `.va-*` panels instead — see `applicationIntake`.
 *
 * ONE `aria-busy` region. Everything inside is `aria-hidden`, so a screen reader hears "Loading
 * application" once rather than reading out forty empty boxes.
 */
export function IntakeSkeleton() {
  return (
    <div
      style={s('display:grid;gap:20px')}
      aria-busy="true"
      aria-label="Loading application"
      role="status"
    >
      <div aria-hidden="true" style={s('display:grid;gap:20px')}>
        {[0, 1].map((section) => (
          <div key={section} style={s('display:grid;gap:14px')}>
            <div style={s('display:grid;gap:6px')}>
              <Skel w="180px" h="15px" />
              <Skel w="62%" h="12px" />
            </div>
            <div
              style={s(
                'display:grid;gap:14px;grid-template-columns:repeat(auto-fit,minmax(min(240px,100%),1fr))',
              )}
            >
              {[0, 1, 2, 3].map((field) => (
                <div key={field} style={s('display:flex;flex-direction:column;gap:8px')}>
                  <Skel w="46%" h="11px" />
                  <Skel w="100%" h="44px" />
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* The document slots, at the height they really render. */}
        <div style={s('display:grid;gap:14px')}>
          <Skel w="140px" h="15px" />
          <div style={s('display:grid;gap:8px')}>
            {[0, 1, 2].map((slot) => (
              <Skel key={slot} w="100%" h="52px" />
            ))}
          </div>
        </div>

        <div style={s('display:flex;gap:12px')}>
          <Skel w="168px" h="46px" />
          <Skel w="196px" h="46px" />
        </div>
      </div>
    </div>
  );
}
