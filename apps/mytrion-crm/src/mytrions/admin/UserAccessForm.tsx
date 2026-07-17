import { useMemo, useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import { updateUserAccess, type AccessUserRow, type UserAccessPatch } from '../../api/mytrionAccess';
import { XIcon } from '../../components/icons';
import s from './admin.module.css';

type Mode = 'custom' | 'all';

const label = (id: MytrionId): string => MYTRIONS[id]?.title ?? id;

/** Edit one worker's Mytrion access override. Maps the tri-mode UI onto the backend patch. */
export function UserAccessForm({
  row,
  roster,
  onClose,
  onSaved,
}: {
  row: AccessUserRow;
  /** All users, for the "can view as" target picker. */
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

  const homeOptions =
    mode === 'all'
      ? MYTRION_ORDER
      : mode === 'custom'
        ? MYTRION_ORDER.filter((id) => allowed.has(id))
        : row.effective.accessibleMytrions;

  async function save() {
    setBusy(true);
    setError('');
    try {
      const patch: UserAccessPatch = {
        userName: row.name,
        email: row.email,
        profileName: row.profile,
        active,
        allowedMytrions: mode === 'custom' ? MYTRION_ORDER.filter((id) => allowed.has(id)) : null,
        allDepartmentAccess: mode === 'all' ? true : mode === 'custom' ? false : null,
        homeMytrion: home || null,

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
      <div className={`${s.modal} ${s.accessModal}`} role="dialog" aria-modal="true" aria-label={`Access for ${row.name ?? row.zohoUserId}`}>
        <div className={s.modalHead}>
          <span className={s.cardTitle}>{row.name ?? row.zohoUserId}</span>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close">
            <XIcon size={12} />
          </button>
        </div>

        <div className={s.accessFormBody}>


          <div className={s.profileModeRow}>
            {(['custom', 'all'] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={`${s.filterChip} ${mode === m ? s.filterChipOn : ''}`}
                onClick={() => setMode(m)}
              >
                {m === 'custom' ? 'Custom list' : 'All Mytrions'}
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
            <p className={s.noticeNote}>This worker will see EVERY Mytrion (all-department access).</p>
          )}


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
