import { useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import {
  updateUserAccess,
  type AccessUserRow,
  type MytrionAccessMode,
  type UserAccessPatch,
} from '../../api/mytrionAccess';
import { XIcon } from '../../components/icons';
import { BillingAccessModeField } from './BillingAccessModeField';
import s from './admin.module.css';

type Mode = 'custom' | 'all';

const label = (id: MytrionId): string => MYTRIONS[id]?.title ?? id;

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
  const initialMode: Mode = ov?.allDepartmentAccess ? 'all' : 'custom';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [allowed, setAllowed] = useState<Set<MytrionId>>(
    new Set(ov?.allowedMytrions ?? row.effective.accessibleMytrions),
  );
  const [home, setHome] = useState<MytrionId | ''>(ov?.homeMytrion ?? row.effective.homeMytrion ?? '');
  const [billingMode, setBillingMode] = useState<MytrionAccessMode>(
    ov?.mytrionAccessModes?.billing ?? row.effective.mytrionAccessModes?.billing ?? 'full',
  );
  const [active, setActive] = useState<boolean>(ov?.active ?? true);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const toggle = (id: MytrionId) =>
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const homeOptions = mode === 'all' ? MYTRION_ORDER : MYTRION_ORDER.filter((id) => allowed.has(id));
  const showBillingMode = mode === 'custom' && allowed.has('billing');

  async function save() {
    setBusy(true);
    setError('');
    try {
      const nextAllowed = mode === 'custom' ? MYTRION_ORDER.filter((id) => allowed.has(id)) : null;
      const mytrionAccessModes =
        mode === 'custom' && (nextAllowed?.includes('billing') ?? false)
          ? { billing: billingMode }
          : {};
      const patch: UserAccessPatch = {
        userName: row.name,
        email: row.email,
        profileName: row.profile,
        active,
        allowedMytrions: nextAllowed,
        allDepartmentAccess: mode === 'all' ? true : false,
        homeMytrion: home || (nextAllowed?.length === 1 ? nextAllowed[0]! : null),
        mytrionAccessModes,
      };
      await updateUserAccess(row.zohoUserId, patch);
      onSaved();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  }

  return (
    <div
      className={s.modalBackdrop}
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
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
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close">
            <XIcon size={12} />
          </button>
        </div>

        <div className={s.accessFormBody}>
          <p className={s.noticeNote}>
            Per-user override replaces profile + role defaults for this worker. Billing can be
            Read-only or Full access.
          </p>

          <div className={s.profileModeRow}>
            {(['custom', 'all'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`${s.filterChip} ${mode === m ? s.filterChipOn : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'custom' ? 'Specific Mytrions' : 'All Mytrions'}
              </button>
            ))}
          </div>

          {mode === 'custom' && (
            <div className={s.profileChipGrid}>
              {MYTRION_ORDER.map((id) => (
                <button
                  key={id}
                  type="button"
                  className={`${s.filterChip} ${allowed.has(id) ? s.filterChipOn : ''}`}
                  onClick={() => toggle(id)}
                >
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

          <div className={s.accessModalActions}>
            <button type="button" className={s.ghostBtn} onClick={onClose} disabled={busy}>
              Cancel
            </button>
            <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy}>
              {busy ? 'Saving…' : 'Save access'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
