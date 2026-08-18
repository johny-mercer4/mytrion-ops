import { useCallback, useEffect, useMemo, useState } from 'react';
import { Search as SearchIcon } from 'lucide-react';
import {
  getPaymentDeleteGrants,
  grantPaymentDelete,
  revokePaymentDelete,
  type PaymentDeleteRosterEntry,
} from '../../api/paymentDeleteGrants';
import { Button, ErrorState } from '@/ds';
import { adminToast } from './toast';
import s from './admin.module.css';

/**
 * Admin → Delete Access. Who besides an admin may hard-delete a manually-entered Chase transaction
 * (Transactions tab, unmapped rows only — see TransactionModal's Delete button). Admins always have
 * it; this list is the ADDITIONAL, explicit, named allow-list.
 *
 * One snapshot GET (grants + roster with `granted` precomputed), granular POST/DELETE per person —
 * same shape as PermissionSetAssignees, kept as its own small component rather than reused: a
 * delete-grant is a flat (person, source) row, not a named reusable set someone opens/edits, so the
 * set-picker layer above PermissionSetAssignees does not apply here.
 */
export function PaymentDeleteGrants() {
  const [grantedIds, setGrantedIds] = useState<Set<string> | null>(null);
  const [roster, setRoster] = useState<PaymentDeleteRosterEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  /** The one person currently being granted or revoked, so only their row shows a pending state. */
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const snapshot = await getPaymentDeleteGrants('chase');
      setRoster(snapshot.roster);
      setGrantedIds(new Set(snapshot.grants.map((g) => g.zohoUserId)));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load delete access');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function grant(entry: PaymentDeleteRosterEntry): Promise<void> {
    setBusyId(entry.zohoUserId);
    try {
      await grantPaymentDelete(entry.zohoUserId, 'chase');
      setGrantedIds((prev) => new Set(prev).add(entry.zohoUserId));
      adminToast.success('Delete access granted', entry.name ?? entry.zohoUserId);
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
      setGrantedIds((prev) => {
        const next = new Set(prev);
        next.delete(entry.zohoUserId);
        return next;
      });
      adminToast.success('Delete access revoked', entry.name ?? entry.zohoUserId);
    } catch (err) {
      adminToast.error('Could not revoke', err instanceof Error ? err.message : undefined);
    } finally {
      setBusyId(null);
    }
  }

  const q = query.trim().toLowerCase();
  const matches = (r: PaymentDeleteRosterEntry): boolean =>
    !q || [r.name, r.email, r.zohoUserId].filter(Boolean).join(' ').toLowerCase().includes(q);

  const granted = useMemo(() => roster.filter((r) => r.granted && matches(r)), [roster, q]);
  const candidates = useMemo(() => roster.filter((r) => !r.granted && matches(r)), [roster, q]);

  const header = (
    <div className={s.head}>
      <div>
        <div className={s.eyebrow}>Access &amp; RBAC</div>
        <h2 className={s.h2}>Delete Access — Chase Transactions</h2>
        <p className={s.sub}>
          Admins can always delete an unmapped, manually-entered Chase transaction. Everyone else
          needs an explicit grant — add them here by name.
        </p>
      </div>
    </div>
  );

  if (error) {
    return (
      <div className={`${s.panel} ${s.panelWide}`}>
        {header}
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

  if (grantedIds === null) {
    return (
      <div className={`${s.panel} ${s.panelWide}`}>
        {header}
        <span className={s.srOnly} role="status">
          Loading delete access…
        </span>
      </div>
    );
  }

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      {header}
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
            Nobody besides admins has delete access yet.
          </p>
        ) : (
          <div className={s.psList}>
            <div className={s.psListHead}>
              <span>Granted · {granted.length}</span>
            </div>
            {granted.map((r) => (
              <div key={r.zohoUserId} className={s.psListRow}>
                <span className={s.cellStack}>
                  <span className={s.docTitle}>{r.name ?? r.zohoUserId}</span>
                  <span className={s.cellSub}>{r.email ?? r.zohoUserId}</span>
                </span>
                <button
                  type="button"
                  className={`${s.miniBtn} ${s.miniDanger}`}
                  disabled={busyId === r.zohoUserId}
                  onClick={() => void revoke(r)}
                >
                  {busyId === r.zohoUserId ? 'Revoking…' : 'Revoke'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={s.psList}>
        <div className={s.psListHead}>
          <span>Add someone · {candidates.length} available</span>
        </div>
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
                onClick={() => void grant(r)}
              >
                {busyId === r.zohoUserId ? 'Granting…' : 'Grant'}
              </button>
            </div>
          ))}
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
