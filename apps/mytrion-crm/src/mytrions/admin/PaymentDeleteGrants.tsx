import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import {
  getPaymentDeleteGrants,
  grantPaymentDelete,
  revokePaymentDelete,
  type PaymentDeleteGrant,
  type PaymentDeleteGrantsSnapshot,
  type PaymentDeleteRosterEntry,
} from '../../api/paymentDeleteGrants';
import { refreshWorkerFromMe } from '../../api/auth';
import { Avatar, Button, ErrorState } from '@/ds';
import { AccessIcon } from '../../components/icons';
import { useUserContext } from '../../context/UserContextProvider';
import { initials } from '../../lib/initials';
import { relativeTime } from './logsShared';
import { adminToast } from './toast';
import s from './admin.module.css';

/**
 * Admin → Access → Delete Access. Who besides an admin may hard-delete a manually-entered Chase
 * transaction (Transactions tab, unmapped rows only — see TransactionModal's Delete button). Admins
 * always have it; this list is the ADDITIONAL, explicit, named allow-list.
 *
 * One snapshot GET (grants + roster with `granted` precomputed), granular POST/DELETE per person —
 * same shape as PermissionSetAssignees, kept as its own small component rather than reused: a
 * delete-grant is a flat (person, source) row, not a named reusable set someone opens/edits, so the
 * set-picker layer above PermissionSetAssignees does not apply here.
 *
 * Granting/revoking YOURSELF re-pulls /auth/me immediately: the session's canDeleteChaseTransactions
 * hint is otherwise only re-checked on mount and on window focus, so a same-tab self-grant looked
 * like it silently did nothing until the tab lost and regained focus.
 */
export function PaymentDeleteGrants() {
  const user = useUserContext();
  const [snapshot, setSnapshot] = useState<PaymentDeleteGrantsSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** The one person currently being granted or revoked, so only their row shows a pending state. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setSnapshot(await getPaymentDeleteGrants('chase'));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load delete access');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const grantsByUser = useMemo(() => {
    const map = new Map<string, PaymentDeleteGrant>();
    for (const g of snapshot?.grants ?? []) map.set(g.zohoUserId, g);
    return map;
  }, [snapshot]);

  async function grant(entry: PaymentDeleteRosterEntry): Promise<void> {
    setBusyId(entry.zohoUserId);
    try {
      const created = await grantPaymentDelete(entry.zohoUserId, 'chase');
      setSnapshot((prev) =>
        prev
          ? {
              grants: [...prev.grants, created],
              roster: prev.roster.map((r) => (r.zohoUserId === entry.zohoUserId ? { ...r, granted: true } : r)),
            }
          : prev,
      );
      adminToast.success('Delete access granted', entry.name ?? entry.zohoUserId);
      if (entry.zohoUserId === user.userId) void refreshWorkerFromMe();
    } catch (err) {
      adminToast.error('Could not grant', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  async function revoke(entry: PaymentDeleteRosterEntry): Promise<void> {
    setBusyId(entry.zohoUserId);
    try {
      await revokePaymentDelete(entry.zohoUserId, 'chase');
      setSnapshot((prev) =>
        prev
          ? {
              grants: prev.grants.filter((g) => g.zohoUserId !== entry.zohoUserId),
              roster: prev.roster.map((r) => (r.zohoUserId === entry.zohoUserId ? { ...r, granted: false } : r)),
            }
          : prev,
      );
      adminToast.success('Delete access revoked', entry.name ?? entry.zohoUserId);
      if (entry.zohoUserId === user.userId) void refreshWorkerFromMe();
    } catch (err) {
      adminToast.error('Could not revoke', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  const roster = snapshot?.roster ?? [];
  const q = query.trim().toLowerCase();
  const matches = (r: PaymentDeleteRosterEntry): boolean =>
    !q || [r.name, r.email, r.zohoUserId].filter(Boolean).join(' ').toLowerCase().includes(q);

  const granted = useMemo(() => roster.filter((r) => r.granted && matches(r)), [roster, q]);
  const candidates = useMemo(() => roster.filter((r) => !r.granted && matches(r)), [roster, q]);

  function personRow(r: PaymentDeleteRosterEntry, action: 'grant' | 'revoke'): ReactNode {
    const isMe = r.zohoUserId === user.userId;
    const grantRecord = action === 'revoke' ? grantsByUser.get(r.zohoUserId) : undefined;
    return (
      <div key={r.zohoUserId} className={s.psListRow}>
        <span className={s.psPersonCell}>
          <Avatar initials={initials(r.name ?? r.zohoUserId)} size="sm" />
          <span className={s.cellStack}>
            <span className={s.docTitle}>
              {r.name ?? r.zohoUserId}
              {isMe && <span className={s.psYouTag}> · You</span>}
            </span>
            <span className={s.cellSub}>{r.email ?? r.zohoUserId}</span>
            {grantRecord && (
              <span className={s.cellSub} title={new Date(grantRecord.createdAt).toLocaleString()}>
                Granted by {grantRecord.grantedBy ?? 'unknown'} · {relativeTime(grantRecord.createdAt)}
              </span>
            )}
          </span>
        </span>
        <button
          type="button"
          className={action === 'revoke' ? `${s.miniBtn} ${s.miniDanger}` : s.miniBtn}
          disabled={busyId === r.zohoUserId}
          onClick={() => void (action === 'revoke' ? revoke(r) : grant(r))}
        >
          {busyId === r.zohoUserId
            ? action === 'revoke'
              ? 'Revoking…'
              : 'Granting…'
            : action === 'revoke'
              ? 'Revoke'
              : 'Grant'}
        </button>
      </div>
    );
  }

  function skeletonRow(key: number): ReactNode {
    return (
      <div key={key} className={s.psListRow} aria-hidden="true">
        <span className={s.psPersonCell}>
          <span className={`${s.psSkelRow} ${s.psSkelAvatar}`} />
          <span className={s.cellStack}>
            <span className={`${s.psSkelRow} ${s.psSkelTitle}`} />
            <span className={`${s.psSkelRow} ${s.psSkelText}`} />
          </span>
        </span>
        <span className={`${s.psSkelRow} ${s.psSkelBtn}`} />
      </div>
    );
  }

  const header = (
    <div className={s.head}>
      <div>
        <div className={s.eyebrow}>Access &amp; RBAC</div>
        <h2 className={s.h2}>Delete Access — Chase Transactions</h2>
        <p className={s.sub}>Who besides an admin may delete a manually-entered, unmapped Chase transaction.</p>
      </div>
    </div>
  );

  const notice = (
    <p className={s.noticeNote}>
      <AccessIcon /> Admins always have this — there is nothing to grant them. Add someone below only
      when they are not already an admin.
    </p>
  );

  if (error) {
    return (
      <div className={`${s.panel} ${s.panelWide}`}>
        {header}
        {notice}
        <ErrorState
          title="Could not load delete access"
          description={`${error} — this screen only reads; nothing has changed.`}
          primaryAction={
            <Button variant="primary" onClick={() => void load()}>
              Retry
            </Button>
          }
        />
      </div>
    );
  }

  if (snapshot === null) {
    return (
      <div className={`${s.panel} ${s.panelWide}`}>
        {header}
        {notice}
        <div className={s.psField}>
          <span className={s.srOnly} role="status">
            Loading delete access…
          </span>
          <div className={`${s.psSkelRow} ${s.psSkelTitle}`} style={{ height: 36, width: '100%' }} aria-hidden="true" />
          <div className={s.psList} aria-hidden="true">
            <div className={s.psListHead}>
              <span className={`${s.psSkelRow} ${s.psSkelText}`} style={{ height: 10, width: 90 }} />
            </div>
            {[0, 1, 2].map(skeletonRow)}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      {header}
      {notice}
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

        {granted.length === 0 ? (
          <p className={s.sub} style={{ margin: 0 }}>
            {q ? `Nobody granted matches “${query}”.` : 'Nobody besides admins has delete access yet.'}
          </p>
        ) : (
          <div className={s.psList}>
            <div className={s.psListHead}>
              <span>Granted · {granted.length}</span>
            </div>
            {granted.map((r) => personRow(r, 'revoke'))}
          </div>
        )}
      </div>

      <div className={s.psList}>
        <div className={s.psListHead}>
          <span>Add someone · {candidates.length} available</span>
        </div>
        <div className={s.psListScroll}>
          {candidates.map((r) => personRow(r, 'grant'))}
          {candidates.length === 0 && (
            <div className={s.psListRow}>
              <span className={s.sub} style={{ margin: 0 }}>
                {q ? `Nobody left matching “${query}”.` : 'Everyone on the roster already has delete access.'}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
