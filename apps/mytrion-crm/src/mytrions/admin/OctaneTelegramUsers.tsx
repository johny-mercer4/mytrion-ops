import { useCallback, useEffect, useMemo, useState } from 'react';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import {
  listOctaneTelegramUsers,
  matchesOctaneTelegramUser,
  type OctaneTelegramUserRow,
} from '../../api/octaneTelegramUsers';
import { SearchIcon, UsersIcon } from '../../components/icons';
import s from './admin.module.css';
import tg from './OctaneTelegramUsers.module.css';

const SKELETON = ['36%', '22%', '18%', '20%', '16%'] as const;

function formatLogin(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString();
}

function handleFor(username: string | null): string {
  if (!username) return '—';
  return username.startsWith('@') ? username : `@${username}`;
}

/** Admin — workers who have opened Horizon in Telegram after Zoho login. */
export function OctaneTelegramUsers() {
  const [rows, setRows] = useState<OctaneTelegramUserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRows(await listOctaneTelegramUsers());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(
    () => rows.filter((r) => matchesOctaneTelegramUser(r, query)),
    [rows, query],
  );

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Octane Telegram Users</h2>
          <p className={s.sub}>
            Workers linked after Zoho sign-in in the Horizon Mini App. Search by name, Zoho id, or
            Telegram handle.
          </p>
        </div>
        {loading && rows.length > 0 && (
          <span className={`${s.pill} ${s.pillInfo}`} role="status">
            <span className={s.spinner} />
            Refreshing
          </span>
        )}
      </div>

      <label className={`${s.search} ${s.searchTall}`}>
        <SearchIcon size={16} />
        <input
          className={`${s.searchInput} ${tg.searchInput}`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search users…"
          aria-label="Search Octane Telegram users"
          autoComplete="off"
          spellCheck={false}
        />
      </label>

      {error ? (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      ) : null}

      <div className={s.table} data-table-scroller aria-busy={loading}>
        <div className={`${s.tHead} ${tg.tTelegram}`}>
          <span>User name</span>
          <span>Zoho User Id</span>
          <span>Telegram user id</span>
          <span>Telegram user name</span>
          <span>Last login</span>
        </div>
        {loading && rows.length === 0 ? (
          <>
            <span className={s.srOnly} role="status">
              Loading Octane Telegram users…
            </span>
            <TableSkeleton widths={SKELETON} rowClassName={s.tRow} colsClassName={tg.tTelegram} />
          </>
        ) : null}
        {rows.length > 0 &&
          visible.map((r) => (
            <div key={`${r.zohoUserId}:${r.telegramUserId}`} className={`${s.tRow} ${tg.tTelegram}`}>
              <span className={s.cellStack}>
                <span className={s.docTitle} title={r.userName ?? r.zohoUserId}>
                  {r.userName ?? '—'}
                </span>
                <span className={s.cellSub}>{handleFor(r.telegramUsername)}</span>
              </span>
              <span className={s.deptText} title={r.zohoUserId}>
                {r.zohoUserId}
              </span>
              <span className={s.deptText} title={r.telegramUserId}>
                {r.telegramUserId}
              </span>
              <span className={s.deptText}>{handleFor(r.telegramUsername)}</span>
              <span className={s.deptText} title={formatLogin(r.lastLoginAt)}>
                {formatLogin(r.lastLoginAt)}
              </span>
            </div>
          ))}
        {!loading && rows.length === 0 ? (
          <div className={s.emptyState}>
            <span className={s.emptyIcon} aria-hidden>
              <UsersIcon size={20} />
            </span>
            <p className={s.emptyTitle}>No linked workers yet</p>
            <p className={s.emptyBody}>
              A row appears when a worker signs in with Zoho inside the Horizon Mini App.
            </p>
          </div>
        ) : null}
        {!loading && rows.length > 0 && visible.length === 0 ? (
          <div className={s.emptyState}>
            <p className={s.emptyTitle}>No matches</p>
            <p className={s.emptyBody}>Nothing in this list matches “{query.trim()}”.</p>
          </div>
        ) : null}
      </div>
    </div>
  );
}
