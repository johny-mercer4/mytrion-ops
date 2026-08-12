import { useMemo, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import type {
  PermissionSetAssignment,
  PermissionSetRosterEntry,
} from '../../api/permissionSets';
import s from './admin.module.css';

/**
 * Who holds a permission set.
 *
 * This was a wall of ~120 name chips, capped at 60 — so it was simultaneously overwhelming and
 * INCOMPLETE: the people past the cap could not be assigned at all, with nothing on screen saying so.
 * A roster this size is a list with a search box, which is the pattern User Management already uses
 * for the same data.
 *
 * Assigned people stay pinned at the top rather than sorted in among the candidates: the question
 * "who has this?" is asked far more often than "who could have this?", and it must be answerable
 * without reading 120 rows.
 */
export function PermissionSetAssignees({
  assignees,
  roster,
  busyId,
  onAdd,
  onRemove,
}: {
  assignees: PermissionSetAssignment[];
  roster: PermissionSetRosterEntry[];
  /** The zohoUserId currently in flight, so only that row shows a pending state. */
  busyId: string | null;
  onAdd: (entry: PermissionSetRosterEntry) => void;
  onRemove: (assignment: PermissionSetAssignment) => void;
}) {
  const [query, setQuery] = useState('');

  const assignedIds = useMemo(
    () => new Set(assignees.map((a) => a.zohoUserId)),
    [assignees],
  );

  const q = query.trim().toLowerCase();
  const matches = (name: string | null, email: string | null, id: string): boolean =>
    !q || [name, email, id].filter(Boolean).join(' ').toLowerCase().includes(q);

  const shownAssignees = assignees.filter((a) => matches(a.userName, a.email, a.zohoUserId));
  const candidates = roster.filter(
    (r) => !assignedIds.has(r.zohoUserId) && matches(r.name, r.email, r.zohoUserId),
  );

  return (
    <div className={s.psField}>
      <label className={s.search}>
        <SearchIcon size={14} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={`Search ${roster.length} people by name or email…`}
        />
      </label>

      {assignees.length === 0 ? (
        <p className={s.sub} style={{ margin: 0 }}>
          Nobody yet — a set has no effect until it is assigned to someone.
        </p>
      ) : (
        <div className={s.psList}>
          <div className={s.psListHead}>
            <span>Assigned · {assignees.length}</span>
          </div>
          {shownAssignees.map((a) => (
            <div key={a.zohoUserId} className={s.psListRow}>
              <span className={s.cellStack}>
                {/* Two workers can share a display name, so the email is what tells them apart —
                    shown, not just searchable, because this row is a permissions decision. */}
                <span className={s.docTitle}>{a.userName ?? a.zohoUserId}</span>
                <span className={s.cellSub}>{a.email ?? a.zohoUserId}</span>
              </span>
              <button
                type="button"
                className={s.miniBtn}
                disabled={busyId === a.zohoUserId}
                onClick={() => onRemove(a)}
              >
                {busyId === a.zohoUserId ? 'Removing…' : 'Remove'}
              </button>
            </div>
          ))}
          {shownAssignees.length === 0 && (
            <div className={s.psListRow}>
              <span className={s.sub} style={{ margin: 0 }}>
                No assignee matches “{query}”.
              </span>
            </div>
          )}
        </div>
      )}

      <div className={s.psList}>
        <div className={s.psListHead}>
          <span>Add someone · {candidates.length} available</span>
        </div>
        {/* The list scrolls rather than paginating: an admin looking for one name wants to type it,
            and the search above is the real navigation. The cap that used to hide the tail is gone. */}
        <div className={s.psListScroll}>
          {candidates.map((r) => (
            <div key={r.zohoUserId} className={s.psListRow}>
              <span className={s.cellStack}>
                <span className={s.docTitle}>{r.name ?? r.zohoUserId}</span>
                <span className={s.cellSub}>{r.email ?? r.zohoUserId}</span>
              </span>
              <button
                type="button"
                className={s.miniBtn}
                disabled={busyId === r.zohoUserId}
                onClick={() => onAdd(r)}
              >
                {busyId === r.zohoUserId ? 'Adding…' : 'Assign'}
              </button>
            </div>
          ))}
          {candidates.length === 0 && (
            <div className={s.psListRow}>
              <span className={s.sub} style={{ margin: 0 }}>
                {q
                  ? `Nobody left matching “${query}”.`
                  : 'Everyone on the roster already holds this set.'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
