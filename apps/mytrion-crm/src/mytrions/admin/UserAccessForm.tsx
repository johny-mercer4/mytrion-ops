import { useMemo, useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import { updateUserAccess, type AccessUserRow, type UserAccessPatch } from '../../api/mytrionAccess';
import { XIcon } from '../../components/icons';
import s from './admin.module.css';

/** inherit = use the profile default; custom = an explicit allow-list; all = see everything. */
type Mode = 'inherit' | 'custom' | 'all';

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
  const initialMode: Mode = ov?.allDepartmentAccess ? 'all' : ov?.allowedMytrions != null ? 'custom' : 'inherit';
  const [mode, setMode] = useState<Mode>(initialMode);
  const [allowed, setAllowed] = useState<Set<MytrionId>>(
    new Set(ov?.allowedMytrions ?? row.effective.accessibleMytrions),
  );
  const [home, setHome] = useState<MytrionId | ''>(ov?.homeMytrion ?? row.effective.homeMytrion ?? '');
  const [active, setActive] = useState<boolean>(ov?.active ?? true);
  const [viewAs, setViewAs] = useState<Set<string>>(new Set(ov?.viewAsUserIds ?? []));
  const [viewAsQuery, setViewAsQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  // Candidate view-as targets: everyone except this user. Admin targets are excluded — a granted
  // view-as of an admin would be refused server-side (no privilege escalation), so don't offer it.
  const viewAsCandidates = useMemo(() => {
    const q = viewAsQuery.trim().toLowerCase();
    return roster
      .filter((r) => r.zohoUserId !== row.zohoUserId && !r.effective.allDepartmentAccess)
      .filter((r) => !q || [r.name, r.profile].filter(Boolean).join(' ').toLowerCase().includes(q));
  }, [roster, row.zohoUserId, viewAsQuery]);

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
        viewAsUserIds: [...viewAs],
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
      <div className={s.modal} role="dialog" aria-modal="true" aria-label={`Access for ${row.name ?? row.zohoUserId}`}>
        <div className={s.modalHead}>
          <span className={s.cardTitle}>{row.name ?? row.zohoUserId}</span>
          <button type="button" className={s.iconBtn} onClick={onClose} aria-label="Close">
            <XIcon size={12} />
          </button>
        </div>
        <p className={s.sub}>
          Profile <strong>{row.profile ?? '—'}</strong> — the profile default applies unless you override it here.
        </p>

        <div className={s.chipRow}>
          {(['inherit', 'custom', 'all'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${s.filterChip} ${mode === m ? s.filterChipOn : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'inherit' ? 'Inherit profile' : m === 'custom' ? 'Custom list' : 'All Mytrions'}
            </button>
          ))}
        </div>

        {mode === 'custom' && (
          <div className={s.chipRow}>
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
        {mode === 'inherit' && (
          <p className={s.sub}>
            Effective now:{' '}
            {row.effective.allDepartmentAccess
              ? 'All Mytrions'
              : row.effective.accessibleMytrions.map(label).join(', ') || 'none'}
          </p>
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

        <div className={s.field}>
          <span className={s.fieldLabel}>Can “View as” these users (targeted impersonation)</span>
          <input
            className={s.input}
            value={viewAsQuery}
            onChange={(e) => setViewAsQuery(e.target.value)}
            placeholder="Search users to grant view-as…"
          />
          {viewAs.size > 0 && (
            <p className={s.fieldHint}>
              {viewAs.size} user{viewAs.size === 1 ? '' : 's'} selected — this worker will get a “View as” picker.
            </p>
          )}
          <div className={s.chipRow}>
            {viewAsCandidates.slice(0, 40).map((r) => (
              <button
                key={r.zohoUserId}
                type="button"
                className={`${s.filterChip} ${viewAs.has(r.zohoUserId) ? s.filterChipOn : ''}`}
                onClick={() =>
                  setViewAs((prev) => {
                    const next = new Set(prev);
                    if (next.has(r.zohoUserId)) next.delete(r.zohoUserId);
                    else next.add(r.zohoUserId);
                    return next;
                  })
                }
              >
                {r.name ?? r.zohoUserId}
              </button>
            ))}
            {viewAsCandidates.length === 0 && <span className={s.deptText}>No matching users.</span>}
          </div>
        </div>

        <label className={s.toggleRow}>
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          <span>Override active</span>
        </label>

        {error && (
          <p className={s.errorNote} role="alert">
            {error}
          </p>
        )}

        <div className={s.modalActions}>
          <button type="button" className={s.ghostBtn} onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save access'}
          </button>
        </div>
      </div>
    </div>
  );
}
