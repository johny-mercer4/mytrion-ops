import { useEffect, useRef, useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import {
  updateUserAccess,
  type AccessUserRow,
  type MytrionAccessMode,
  type UserAccessPatch,
} from '../../api/mytrionAccess';
import { XIcon } from '../../components/icons';
import { useModalFocus } from '../_shared/useModalFocus';
import { BillingAccessModeField } from './BillingAccessModeField';
import { RadioToggleGroup, type RadioOption } from './RadioToggleGroup';
import s from './admin.module.css';

type Mode = 'custom' | 'all';

const label = (id: MytrionId): string => MYTRIONS[id]?.title ?? id;

/** Mutually exclusive, so it belongs to the radiogroup pattern — two aria-pressed chips would
    announce two independent toggles that can both be off. */
const MODE_OPTIONS: ReadonlyArray<RadioOption<Mode>> = [
  { value: 'custom', label: 'Specific Mytrions' },
  { value: 'all', label: 'All Mytrions' },
];

/**
 * Edit one worker's Mytrion access override (username-level). Overrides profile + role defaults.
 * Billing supports Read-only vs Full access.
 */
export function UserAccessForm({
  row,
  onClose,
  onSaved,
}: {
  row: AccessUserRow;
  /** Kept for call-site compatibility (view-as picker may return later). */
  roster: AccessUserRow[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const ov = row.override;
  /**
   * Seeded from the RESOLVED value, not the override row: a profile/role marker admin holds
   * all-access with no override of their own, so reading `ov` alone opened them in "Specific
   * Mytrions" — and Save then wrote the explicit `false` that strips their admin.
   */
  const initialMode: Mode = (ov?.allDepartmentAccess ?? row.effective.allDepartmentAccess)
    ? 'all'
    : 'custom';
  const [mode, setMode] = useState<Mode>(initialMode);
  /** Not editable here, so it is round-tripped on save — see the patch below. */
  const denied: MytrionId[] = ov?.deniedMytrions ?? [];
  const deniedSet = new Set<MytrionId>(denied);
  const [allowed, setAllowed] = useState<Set<MytrionId>>(
    // Filtered by the denies: the resolver subtracts them after the allowed list (Step 5), so a
    // stored `allowedMytrions` entry that is also denied grants nothing. Lighting its chip promised
    // access the worker does not have — and made an untouched save look like it re-granted it.
    new Set((ov?.allowedMytrions ?? row.effective.accessibleMytrions).filter((id) => !deniedSet.has(id))),
  );
  const [home, setHome] = useState<MytrionId | ''>(ov?.homeMytrion ?? row.effective.homeMytrion ?? '');
  const [billingMode, setBillingMode] = useState<MytrionAccessMode>(
    ov?.mytrionAccessModes?.billing ?? row.effective.mytrionAccessModes?.billing ?? 'full',
  );
  const [active, setActive] = useState<boolean>(ov?.active ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirmDemote, setConfirmDemote] = useState(false);

  const panelRef = useModalFocus<HTMLDivElement>();
  const downOnBackdrop = useRef(false);

  // Escape closes — but never mid-save, which would hide the outcome of a write already in flight.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !busy) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [busy, onClose]);

  const toggle = (id: MytrionId) =>
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const pickMode = (next: Mode) => {
    setMode(next);
    // Going back to All Mytrions withdraws the demotion the confirmation was asking about.
    setConfirmDemote(false);
  };

  const homeOptions = mode === 'all' ? MYTRION_ORDER : MYTRION_ORDER.filter((id) => allowed.has(id));
  const showBillingMode = mode === 'custom' && allowed.has('billing');
  /**
   * An inherited all-access grant can be MASKED in `effective`: the resolver downgrades a
   * non-break-glass all-dept grant to an explicit department grant whenever a deny list exists
   * (`enforceableAllDept = allDept && (breakGlass || denied.length === 0)`), so a marker-profile /
   * profile-default / role-default admin with one denied Mytrion reports `allDepartmentAccess:false`
   * and opens in 'custom'. Infer it from the shape instead — every Mytrion accessible or denied means
   * the underlying grant was all-access — otherwise Save silently leaves that grant in place.
   */
  const inheritsAllAccess =
    initialMode === 'all' ||
    (denied.length > 0 &&
      MYTRION_ORDER.every((id) => deniedSet.has(id) || row.effective.accessibleMytrions.includes(id)));
  /** The LAST_ADMIN rail only fires when NO other all-access user is left, so this asks first. */
  const demotesAllAccess = mode === 'custom' && inheritsAllAccess;
  const losesAdmin = row.effective.accessibleMytrions.includes('admin') && !allowed.has('admin');

  async function save() {
    setBusy(true);
    setError('');
    try {
      const nextAllowed = mode === 'custom' ? MYTRION_ORDER.filter((id) => allowed.has(id)) : null;
      const mytrionAccessModes =
        mode === 'all'
          ? // 'all' hides the Billing read/full control, so there is no edit to send — clearing it
            // would silently promote a stored Read-only Billing grant to Full.
            (ov?.mytrionAccessModes ?? {})
          : (nextAllowed?.includes('billing') ?? false)
            ? { billing: billingMode }
            : {};
      const patch: UserAccessPatch = {
        userName: row.name,
        email: row.email,
        profileName: row.profile,
        active,
        allowedMytrions: nextAllowed,
        /**
         * The endpoint is a full-row replace, not a patch: every key it does not receive is written
         * back as empty. Neither list is editable from this form, so they have to be round-tripped —
         * otherwise setting a Home Mytrion erases the worker's denies and their View-as grants. A
         * chip the admin explicitly checked is the exception: keeping its deny would have the
         * resolver subtract the grant that was just submitted, so only denies for still-unchecked
         * Mytrions survive (an untouched custom save changes nothing, since denied chips open off).
         */
        deniedMytrions: mode === 'custom' ? denied.filter((id) => !allowed.has(id)) : denied,
        viewAsUserIds: ov?.viewAsUserIds ?? [],
        /**
         * Never `null` (inherit) next to an explicit `allowedMytrions`: the server builds the final
         * set as `allDept ? ALL_MYTRIONS : allowed`, so an inherited `true` — from an ADMIN marker
         * profile, a profile default or a role default — discards the list the admin just submitted
         * and the restriction silently evaporates. Custom mode therefore always pins `false`. The
         * marker admin the tri-state was protecting is already safe: `initialMode` reads from
         * `row.effective`, so they open (and re-save) in 'all', and any demotion that is not
         * obvious from the panel goes through the confirm step below first.
         */
        allDepartmentAccess: mode === 'all',
        homeMytrion: home || (nextAllowed?.length === 1 ? nextAllowed[0]! : null),
        mytrionAccessModes,
      };
      await updateUserAccess(row.zohoUserId, patch);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // Back to the editable form so the failure — a 409 LAST_ADMIN in particular — is read before
      // anything else is clicked.
      setConfirmDemote(false);
      setBusy(false);
    }
  }

  return (
    <div
      className={s.modalBackdrop}
      onMouseDown={(e) => {
        // Origin check: a text drag started inside the panel and released out here also fires a click
        // on the backdrop, and losing every RBAC edit to that is not a dismissal the user asked for.
        downOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        if (!busy && downOnBackdrop.current && e.target === e.currentTarget) onClose();
      }}
    >
      <div
        ref={panelRef}
        className={`${s.modal} ${s.accessModal}`}
        role="dialog"
        aria-modal="true"
        aria-label={`Access for ${row.name ?? row.zohoUserId}`}
      >
        <div className={s.modalHead}>
          <div>
            <span className={s.cardTitle}>{row.name ?? row.zohoUserId}</span>
            <div className={s.deptText} style={{ marginTop: 4 }}>
              {[row.profile, row.role].filter(Boolean).join(' · ') || 'No profile / role'}
            </div>
          </div>
          <button
            type="button"
            className={s.iconBtn}
            onClick={onClose}
            aria-label="Close"
            disabled={busy}
            data-focus-skip=""
          >
            <XIcon size={12} />
          </button>
        </div>

        <div className={s.accessFormBody}>
          <p className={s.noticeNote}>
            Per-user override replaces profile + role defaults for this worker. Billing can be
            Read-only or Full access.
          </p>

          <div className={s.profileModeRow}>
            <RadioToggleGroup
              label="Mytrion access scope"
              value={mode}
              options={MODE_OPTIONS}
              onChange={pickMode}
            />
          </div>

          {mode === 'custom' && (
            <div className={s.profileChipGrid}>
              {MYTRION_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`${s.filterChip} ${allowed.has(id) ? s.filterChipOn : ''}`}
                  aria-pressed={allowed.has(id)}
                  onClick={() => toggle(id)}
                >
                  {/* The gradient is the chip's only on-state and forced-colors mode drops it, so the
                      grant needs a glyph too. Fixed width: a check that changes the chip's size
                      re-flows the whole grid on every toggle. */}
                  <span aria-hidden="true" style={{ display: 'inline-block', width: '1.05em' }}>
                    {allowed.has(id) ? '✓' : ''}
                  </span>
                  {label(id)}
                </button>
              ))}
            </div>
          )}
          {mode === 'all' && (
            <p className={s.noticeNote}>Full Mytrions — this worker will see every workspace.</p>
          )}

          {showBillingMode ? <BillingAccessModeField value={billingMode} onChange={setBillingMode} /> : null}

          <label className={s.field}>
            <span className={s.fieldLabel}>Home Mytrion (auto-route on sign-in)</span>
            <select
              className={s.select}
              value={home}
              onChange={(e) => setHome(e.target.value as MytrionId | '')}
            >
              <option value="">Default (picker, or the single accessible one)</option>
              {homeOptions.map((id) => (
                <option key={id} value={id}>
                  {label(id)}
                </option>
              ))}
            </select>
          </label>

          <label className={s.accessCheckRow}>
            <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
            <span>Override active</span>
          </label>

          {error && (
            <p className={s.errorNote} role="alert">
              {error}
            </p>
          )}

          {confirmDemote && (
            <p className={s.errorNote} role="alert">
              {/* Wording has to hold for the masked case too — a deny list narrows the grant, so
                  "has every Mytrion" would be plainly false on screen next to 11 lit chips. */}
              {row.name ?? row.zohoUserId} holds an all-access grant
              {row.effective.allDepartmentAccess
                ? ''
                : ` (narrowed to ${row.effective.accessibleMytrions.length} Mytrions by a deny list)`}
              . Saving Specific Mytrions replaces it with the {allowed.size}{' '}
              {allowed.size === 1 ? 'Mytrion' : 'Mytrions'} checked here
              {losesAdmin ? ', which removes the Admin workspace and every admin route with it' : ''}.
            </p>
          )}

          <div className={s.accessModalActions}>
            <button type="button" className={s.ghostBtn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            {/* Confirmed in-panel rather than through ConfirmDialog: a second dialog nested under this
                one fights it for focus, and the answer is one click either way — pick All Mytrions
                again to withdraw. The inline size matches the row, which only sizes ghost/primary. */}
            {confirmDemote ? (
              <button
                type="button"
                className={s.dangerBtn}
                style={{ height: 34, padding: '0 var(--space-4)', fontSize: 'var(--text-sm)' }}
                onClick={() => void save()}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Remove all-access'}
              </button>
            ) : (
              <button
                type="button"
                className={s.primaryBtn}
                onClick={() => {
                  if (demotesAllAccess) setConfirmDemote(true);
                  else void save();
                }}
                disabled={busy}
              >
                {busy ? 'Saving…' : 'Save access'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
