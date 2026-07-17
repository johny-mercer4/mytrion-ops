import { useCallback, useEffect, useMemo, useState } from 'react';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import { MYTRIONS, type MytrionId } from '../../access/mytrions.config';
import { listAccessUsers, type AccessUserRow } from '../../api/mytrionAccess';
import { SearchIcon } from '../../components/icons';
import s from './admin.module.css';
import { ProfileDefaults } from './ProfileDefaults';
import { UserAccessForm } from './UserAccessForm';

const USER_SKELETON = ['52%', '70px', '64%', '48%', '44px'] as const;

export function mytrionLabel(id: MytrionId): string {
  return MYTRIONS[id]?.title ?? id;
}

/** Admin — Internal User Management: which Zoho worker can access which Mytrion (DB-authoritative). */
export function UserManagement() {
  const [view, setView] = useState<'users' | 'profiles'>('users');
  const [rows, setRows] = useState<AccessUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AccessUserRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listAccessUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'users') void load();
  }, [view, load]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.name, r.email, r.profile].filter(Boolean).join(' ').toLowerCase().includes(q),
    );
  }, [rows, query]);

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>User Management</h2>

        </div>
      </div>

      <div className={s.chipRow}>
        <button
          type="button"
          className={`${s.filterChip} ${view === 'users' ? s.filterChipOn : ''}`}
          onClick={() => setView('users')}
        >
          Users
        </button>
        <button
          type="button"
          className={`${s.filterChip} ${view === 'profiles' ? s.filterChipOn : ''}`}
          onClick={() => setView('profiles')}
        >
          Profile Defaults
        </button>
      </div>

      {view === 'profiles' ? (
        <ProfileDefaults />
      ) : (
        <>
          <label className={s.search}>
            <SearchIcon size={14} />
            <input
              className={s.searchInput}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search users by name, email, profile…"
            />
          </label>

          {error && (
            <p className={s.errorNote} role="alert">
              {error}
            </p>
          )}

          <div className={s.table} aria-busy={loading && rows.length === 0}>
            <div className={`${s.tHead} ${s.tUsers}`}>
              <span>User</span>
              <span>Profile</span>
              <span>Accessible Mytrions</span>
              <span>Home</span>
              <span className={s.right}>Edit</span>
            </div>
            {loading && rows.length === 0 && (
              <>
                <span className={s.srOnly} role="status">
                  Loading users…
                </span>
                <TableSkeleton widths={USER_SKELETON} rowClassName={s.tRow} colsClassName={s.tUsers} />
              </>
            )}
            {!loading &&
              visible.map((r) => (
              <div key={r.zohoUserId} className={`${s.tRow} ${s.tUsers}`}>
                <span className={s.docCell}>
                  <span className={s.docTitle}>{r.name ?? r.zohoUserId}</span>
                </span>
                <span className={s.deptText}>{r.profile ?? '—'}</span>
                <span className={s.chipRow}>
                  {r.effective.allDepartmentAccess ? (
                    <span className={`${s.pill} ${s.pillGood}`}>All access</span>
                  ) : r.effective.accessibleMytrions.length ? (
                    r.effective.accessibleMytrions.map((id) => (
                      <span key={id} className={s.modeChip}>
                        {mytrionLabel(id)}
                      </span>
                    ))
                  ) : (
                    <span className={s.deptText}>none</span>
                  )}
                  {r.override && <span className={`${s.pill} ${s.pillInfo}`}>override</span>}
                </span>
                <span className={s.deptText}>
                  {r.effective.homeMytrion ? mytrionLabel(r.effective.homeMytrion) : '—'}
                </span>
                <span className={s.right}>
                  <button type="button" className={s.miniBtn} onClick={() => setEditing(r)}>
                    Edit
                  </button>
                </span>
              </div>
            ))}
            {!loading && visible.length === 0 && <div className={s.none}>No users match.</div>}
          </div>
        </>
      )}

      {editing && (
        <UserAccessForm
          row={editing}
          roster={rows}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            void load();
          }}
        />
      )}
    </div>
  );
}
