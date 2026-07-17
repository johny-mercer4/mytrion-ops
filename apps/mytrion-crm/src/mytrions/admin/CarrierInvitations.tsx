/**
 * The invitations table — every link ever generated, not just the live ones. Split out of
 * CarrierUsers to keep both files under the size cap; the parent still owns the confirm dialog and
 * the form, so cancelling and reissuing are handed back up as callbacks.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CarrierInvitation } from '../../api/carrierUsers';
import { BuildingIcon, PersonIcon, SearchIcon } from '../../components/icons';
import {
  INVITE_STATUS_LABEL,
  expiresSoon,
  inviteStatus,
  isLiveInvite,
  relativeTime,
  type InviteStatus,
} from './carrierUserUtil';
import { Pager, PAGE_SIZE } from './Pager';
import { RadioToggleGroup } from './RadioToggleGroup';
import s from './admin.module.css';

const INV_COLS = { gridTemplateColumns: '2fr 1fr 1fr 1fr 1.1fr 1.1fr' } as const;

type StatusFilter = InviteStatus | 'all';

const FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'redeemed', label: 'Redeemed' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

const PILL_CLASS: Record<InviteStatus, string> = {
  redeemed: 'pillGood',
  pending: 'pillInfo',
  expired: 'pillBad',
  cancelled: 'pillNeutral',
};

export function CarrierInvitations({
  invitations,
  loading,
  error,
  busyId,
  onRefresh,
  onCopy,
  onCancel,
  onReissue,
}: {
  invitations: CarrierInvitation[];
  loading: boolean;
  error: string;
  busyId: string | null;
  onRefresh: () => void;
  onCopy: (url: string) => void;
  onCancel: (inv: CarrierInvitation) => void;
  onReissue: (inv: CarrierInvitation) => void;
}) {
  const [status, setStatus] = useState<StatusFilter>('all');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invitations.filter((inv) => {
      if (status !== 'all' && inviteStatus(inv) !== status) return false;
      if (!q) return true;
      return [inv.companyName ?? '', inv.carrierId ?? '', inv.applicationId ?? '', inv.driverName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [invitations, status, query]);

  useEffect(() => {
    setPage(1);
  }, [status, query]);

  const pageSafe = Math.min(page, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const paged = filtered.slice((pageSafe - 1) * PAGE_SIZE, pageSafe * PAGE_SIZE);

  return (
    <>
      {error && (
        <p className={s.errorNote} role="alert">
          {error}{' '}
          <button type="button" className={s.linkBtn} onClick={onRefresh}>
            Retry
          </button>
        </p>
      )}

      <RadioToggleGroup label="Filter by status" value={status} onChange={setStatus} options={FILTERS} />

      <label className={s.search}>
        <SearchIcon size={14} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter — company, carrier id, driver…"
        />
        <span className={s.chipMeta}>
          {filtered.length === invitations.length
            ? `${invitations.length} total`
            : `${filtered.length} of ${invitations.length}`}
        </span>
      </label>

      <div className={s.table} role="table" aria-label="Carrier invitations">
        <div className={s.tHead} style={INV_COLS} role="row">
          <span role="columnheader">Company</span>
          <span role="columnheader">Type</span>
          <span role="columnheader">Carrier</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Expires</span>
          <span role="columnheader">Actions</span>
        </div>
        {loading && (
          <div className={s.none} role="row">
            <span role="cell">Loading invitations…</span>
          </div>
        )}
        {!loading &&
          paged.map((inv) => {
            const st = inviteStatus(inv);
            const live = isLiveInvite(inv);
            const soon = expiresSoon(inv);
            return (
              <div key={inv.id} className={s.tRow} style={INV_COLS} role="row">
                <span className={s.cellStack} role="cell">
                  <span className={s.docTitle}>{inv.companyName ?? '(unnamed company)'}</span>
                  {inv.profile === 'driver' && <span className={s.cellSub}>driver · card {inv.cardId ?? '?'}</span>}
                </span>
                <span role="cell">
                  <span className={`${s.pill} ${s.pillNeutral}`}>
                    {inv.profile === 'owner' ? <BuildingIcon size={11} /> : <PersonIcon size={11} />}
                    {inv.profile === 'owner' ? 'Owner' : 'Driver'}
                  </span>
                </span>
                <span className={s.mono} role="cell">
                  {inv.carrierId ?? inv.applicationId ?? '—'}
                </span>
                <span role="cell">
                  <span className={`${s.pill} ${s[PILL_CLASS[st]]}`}>{INVITE_STATUS_LABEL[st]}</span>
                </span>
                {/* Relative first, absolute in the tooltip: "in 4 hours" is the thing the agent is
                    actually deciding on. Once a link is redeemed or cancelled its expiry stops
                    meaning anything, and a countdown next to "Redeemed" just reads as still-live. */}
                <span className={s.cellSub} role="cell" title={new Date(inv.expiresAt).toLocaleString()}>
                  {st === 'redeemed' || st === 'cancelled' ? '—' : relativeTime(inv.expiresAt)}
                  {soon && ' ⚠'}
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-2)' }} role="cell">
                  {live ? (
                    <>
                      <button type="button" className={s.miniBtn} onClick={() => onCopy(inv.inviteUrl)}>
                        Copy
                      </button>
                      <button
                        type="button"
                        className={`${s.miniBtn} ${s.miniDanger}`}
                        disabled={busyId === inv.id}
                        onClick={() => onCancel(inv)}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    st !== 'redeemed' && (
                      // A spent link used to leave a dead row with nothing to do. There's no
                      // resend/extend endpoint, so the honest action is to seed a fresh one.
                      <button type="button" className={s.miniBtn} onClick={() => onReissue(inv)}>
                        New link
                      </button>
                    )
                  )}
                </span>
              </div>
            );
          })}
        {!loading && filtered.length === 0 && (
          <div className={s.none} role="row">
            <span role="cell">
              {invitations.length === 0 ? 'No invitations yet.' : 'No invitations match this filter.'}
            </span>
          </div>
        )}
      </div>
      {!loading && <Pager page={pageSafe} total={filtered.length} onChange={setPage} />}
    </>
  );
}
