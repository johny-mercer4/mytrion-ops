/**
 * The invitations table — every link ever generated, not just the live ones. Split out of
 * CarrierUsers to keep both files under the size cap; the parent still owns the confirm dialog and
 * the form, so cancelling and reissuing are handed back up as callbacks.
 */
import { useEffect, useMemo, useState } from 'react';
import type { CarrierInvitation } from '../../api/carrierUsers';
import { AlertIcon, BanIcon, BuildingIcon, CopyIcon, PersonIcon, PlusIcon, SearchIcon } from '../../components/icons';
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
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import s from './admin.module.css';

type StatusFilter = InviteStatus | 'all';

const FILTERS: ReadonlyArray<{ value: StatusFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'redeemed', label: 'Redeemed' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

/** Bar width per column, tracking real rows: company, pill, id, status pill, expiry, actions. */
const INV_SKELETON = ['58%', '64px', '52%', '54%', '70px', '46%', '96px'] as const;

/**
 * Status colour tracks what the status means, and the two dead ends are not the same thing:
 * expired lapsed on its own (amber — nobody did anything wrong, and a fresh link fixes it), while
 * cancelled is someone deliberately killing the link (red). They were the wrong way round, with
 * cancelled rendered in neutral grey as if it were a category rather than a termination.
 */
const PILL_CLASS: Record<InviteStatus, string> = {
  pending: 'pillInfo', // live, waiting on the carrier
  redeemed: 'pillGood', // the job the link existed to do
  expired: 'pillWarn', // lapsed on its own
  cancelled: 'pillBad', // revoked by hand
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
  /**
   * Every status in this table is derived from the clock — a pending invite lapses on its own — and
   * nothing else here re-renders on a timer, so a link that died with the tab open kept its Pending
   * pill, its stale countdown, and a live Copy button the admin would then send to a carrier.
   *
   * Paused while hidden: a background interval is throttled anyway, and the visibilitychange
   * handler is what makes the first paint after refocus correct rather than a minute behind.
   */
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    let timer: number | undefined;
    const stop = () => {
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    };
    const start = () => {
      stop();
      setNow(Date.now());
      timer = window.setInterval(() => setNow(Date.now()), 60_000);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return invitations.filter((inv) => {
      if (status !== 'all' && inviteStatus(inv, now) !== status) return false;
      if (!q) return true;
      return [inv.companyName ?? '', inv.carrierId ?? '', inv.applicationId ?? '', inv.driverName ?? '']
        .join(' ')
        .toLowerCase()
        .includes(q);
    });
  }, [invitations, status, query, now]);

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
          // Named explicitly: the count chip inside this label would otherwise BE the input's
          // accessible name ("87 total"), and it changes on every keystroke.
          aria-label="Filter invitations"
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter — company, carrier id, driver…"
        />
        <span className={s.chipMeta}>
          {filtered.length === invitations.length
            ? `${invitations.length} total`
            : `${filtered.length} of ${invitations.length}`}
        </span>
      </label>

      <div className={s.tableScroll}>
        <div className={s.table} role="table" aria-label="Carrier invitations" aria-busy={loading}>
        <div className={`${s.tHead} ${s.tInvite}`} role="row">
          <span role="columnheader">Company</span>
          <span role="columnheader">Type</span>
          <span role="columnheader">Carrier</span>
          <span role="columnheader">Agent</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Expires</span>
          <span role="columnheader">Actions</span>
        </div>
          {loading && (
            <>
              <span className={s.srOnly} role="status">
                Loading invitations…
              </span>
              <TableSkeleton widths={INV_SKELETON} rowClassName={s.tRow} colsClassName={s.tInvite} />
            </>
          )}
        {!loading &&
          paged.map((inv) => {
            const st = inviteStatus(inv, now);
            const live = isLiveInvite(inv, now);
            const soon = expiresSoon(inv, now);
            return (
              <div key={inv.id} className={`${s.tRow} ${s.tInvite}`} role="row">
                <span className={s.cellStack} role="cell">
                  <span className={s.docTitle}>{inv.companyName ?? '(unnamed company)'}</span>
                  {inv.profile === 'driver' && <span className={s.cellSub}>driver · card {inv.cardId ?? '?'}</span>}
                  {inv.profile === 'manager' && <span className={s.cellSub}>manager · owner-level access</span>}
                </span>
                <span role="cell">
                  <span className={`${s.pill} ${s.pillNeutral}`}>
                    {inv.profile === 'driver' ? <PersonIcon size={11} /> : <BuildingIcon size={11} />}
                    {inv.profile === 'owner' ? 'Owner' : inv.profile === 'manager' ? 'Manager' : 'Driver'}
                  </span>
                </span>
                <span className={s.mono} role="cell">
                  {inv.carrierId ?? inv.applicationId ?? '—'}
                </span>
                {/* Sales agent column (2026-07-23, owner ask): who this registration link belongs
                    to — the invite already carried agent_name; nothing rendered it. */}
                <span className={s.cellSub} role="cell" title={inv.agentZohoUserId ?? undefined}>
                  {inv.agentName ?? '—'}
                </span>
                <span role="cell">
                  <span className={`${s.pill} ${s[PILL_CLASS[st]]}`}>{INVITE_STATUS_LABEL[st]}</span>
                </span>
                {/* Relative first, absolute in the tooltip: "in 4 hours" is the thing the agent is
                    actually deciding on. Once a link is redeemed or cancelled its expiry stops
                    meaning anything, and a countdown next to "Redeemed" just reads as still-live. */}
                {/* Amber once it's inside its last day — the same colour "Expired" will turn into,
                    so the warning and the outcome it predicts read as one scale. The icon carries
                    it too: colour alone would leave the urgency invisible to anyone who can't see
                    the hue. */}
                <span
                  className={`${s.cellSub} ${soon ? s.cellWarn : ''}`}
                  role="cell"
                  title={new Date(inv.expiresAt).toLocaleString()}
                >
                  {st === 'redeemed' || st === 'cancelled' ? '—' : relativeTime(inv.expiresAt, now)}
                  {soon && <AlertIcon />}
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-2)' }} role="cell">
                  {live ? (
                    <>
                      <button type="button" className={s.miniBtn} onClick={() => onCopy(inv.inviteUrl)}>
                        <CopyIcon />
                        Copy
                      </button>
                      <button
                        type="button"
                        className={`${s.miniBtn} ${s.miniDanger}`}
                        disabled={busyId === inv.id}
                        onClick={() => onCancel(inv)}
                      >
                        <BanIcon />
                        Cancel
                      </button>
                    </>
                  ) : (
                    st !== 'redeemed' && (
                      // A spent link used to leave a dead row with nothing to do. There's no
                      // resend/extend endpoint, so the honest action is to seed a fresh one — and
                      // it's named for the control it opens, not invented as a second synonym.
                      <button type="button" className={s.miniBtn} onClick={() => onReissue(inv)}>
                        <PlusIcon size={10} />
                        New registration link
                      </button>
                    )
                  )}
                </span>
              </div>
            );
          })}
          {/* Suppressed while the load error stands: no list ever arrived, so "no invitations yet"
              would be a claim about data we don't have. */}
          {!loading && !error && filtered.length === 0 && (
            <div className={s.none} role="row">
              <span role="cell">
                {invitations.length === 0
                  ? 'No invitations yet. Use New registration link to create one.'
                  : 'No invitations match this filter.'}
              </span>
            </div>
          )}
        </div>
      </div>
      {!loading && <Pager page={pageSafe} total={filtered.length} onChange={setPage} />}
    </>
  );
}
