/**
 * Prefill, principals, and the form-level error — split from applicationIntake so the
 * orchestrator stays under the file cap. Behaviour is unchanged: suggestions fill the
 * FORM only, principals write through the same exclusive path as Save.
 */
import { s } from './dc';
import { Icon } from './icons';
import { Section } from './applicationFields';
import { BTN_DISABLED, BTN_PRIMARY, BTN_PRIMARY_BUSY } from './createTicketShared';
import type {
  ApplicationDetail,
  PrefillResult,
  PrefillSuggestion,
  VerificationApplicantType,
} from '@/api/verificationFlow';
import { prefillMatchLine } from './applicationIntakeState';

export function PrefillPanel({
  result,
  applicantType,
  applied,
  locked,
  onApply,
}: {
  result: PrefillResult;
  applicantType: VerificationApplicantType | null;
  applied: Set<string>;
  locked: boolean;
  onApply: (s: PrefillSuggestion) => void;
}) {
  const match = result.match;
  if (!match) return null;
  const outstanding = result.suggestions.filter((sg) => !applied.has(sg.field));
  return (
    <section className="ss-vf-intake-panel">
      <div className="ss-vf-intake-panel-head">
        <div className="ss-vf-intake-panel-copy">
          <Icon name="verification" size={15} strokeWidth={2.2} />
          <span className="ss-vf-intake-panel-title">Found in carrier records</span>
          <span className="ss-vf-intake-panel-meta">{prefillMatchLine(match, applicantType)}</span>
        </div>
        {outstanding.length > 1 && !locked ? (
          <button
            type="button"
            onClick={() => outstanding.forEach(onApply)}
            className="ss-vf-intake-text-btn"
          >
            Use all {outstanding.length}
          </button>
        ) : null}
      </div>
      <div className="ss-vf-intake-prefill-list">
        {result.suggestions.map((sg) => {
          const done = applied.has(sg.field);
          return (
            <div key={sg.field} className="ss-vf-intake-prefill-row">
              <span className="ss-vf-intake-prefill-lbl" title={sg.label}>{sg.label}</span>
              <span className="ss-vf-intake-prefill-val" title={sg.value}>
                {sg.value}
              </span>
              {done ? (
                <span className="ss-vf-intake-prefill-done">Added</span>
              ) : (
                <button
                  type="button"
                  disabled={locked}
                  onClick={() => onApply(sg)}
                  className="ss-vf-intake-text-btn"
                  style={s(`cursor:${locked ? 'not-allowed' : 'pointer'};color:${locked ? 'var(--muted)' : 'var(--accent-text)'}`)}
                >
                  Use
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div role="alert" className="ss-vf-intake-error">
      <Icon name="warn" size={17} color="var(--danger)" strokeWidth={2.2} />
      <span>{message}</span>
    </div>
  );
}

export function PrincipalsSection({
  detail,
  missing,
  locked,
  adding,
  busy,
  error,
  value,
  onValue,
  onAdd,
  onRemove,
}: {
  detail: ApplicationDetail | null;
  missing: boolean;
  locked: boolean;
  adding: boolean;
  busy: boolean;
  error: string | null;
  value: string;
  onValue: (v: string) => void;
  onAdd: () => void | Promise<void>;
  onRemove: (id: string) => void | Promise<void>;
}) {
  const principals = detail?.principals ?? [];
  return (
    <Section title="Owners / principals" hint="At least one for a company applicant.">
      <div style={s('grid-column:1/-1;display:grid;gap:10px')}>
        {principals.length === 0 ? (
          <p className={missing ? 'ss-vf-intake-empty is-needed' : 'ss-vf-intake-empty'}>
            {missing ? 'At least one owner or principal is needed.' : 'None added yet.'}
          </p>
        ) : (
          <ul className="ss-vf-intake-list">
            {principals.map((p) => (
              <li key={p.id} className="ss-vf-intake-list-row">
                <span className="ss-vf-intake-list-name">{p.fullName}</span>
                {!locked ? (
                  <button
                    type="button"
                    onClick={() => void onRemove(p.id)}
                    disabled={busy}
                    className="ss-slot-act"
                    data-tone="danger"
                    aria-label={`Remove ${p.fullName}`}
                  >
                    Remove
                  </button>
                ) : null}
              </li>
            ))}
          </ul>
        )}
        {!locked ? (
          <div style={s('display:flex;gap:10px;flex-wrap:wrap')}>
            <input
              aria-label="Owner or principal full name"
              placeholder="Full name"
              value={value}
              onChange={(e) => onValue(e.currentTarget.value)}
              className="ss-vf-intake-input"
              style={s('flex:1 1 220px')}
            />
            <button
              type="button"
              onClick={() => void onAdd()}
              disabled={value.trim().length === 0 || busy}
              aria-busy={adding || undefined}
              style={s(
                adding
                  ? BTN_PRIMARY_BUSY
                  : value.trim().length === 0 || busy
                    ? BTN_DISABLED
                    : BTN_PRIMARY,
              )}
            >
              {adding ? (
                <>
                  <Icon name="spinner" size={15} className="ss-spin" />
                  Adding…
                </>
              ) : (
                'Add'
              )}
            </button>
          </div>
        ) : null}
        {error ? (
          <span role="alert" className="ss-vf-intake-inline-err">
            <Icon name="warn" size={13} strokeWidth={2.3} />
            {error}
          </span>
        ) : null}
      </div>
    </Section>
  );
}
