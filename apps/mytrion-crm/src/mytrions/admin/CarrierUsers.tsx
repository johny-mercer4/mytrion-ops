import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelInvitation,
  listInvitations,
  listRegisteredCompanies,
  revokeRegistration,
  type CarrierInvitation,
  type RegisteredCompany,
} from '../../api/carrierUsers';
import { BuildingIcon, PersonIcon, PlusIcon, SearchIcon, XIcon } from '../../components/icons';
import { CarrierUserForm } from './CarrierUserForm';
import { copyToClipboard } from './carrierUserUtil';
import { adminToast } from './toast';
import s from './admin.module.css';

const COLS = { gridTemplateColumns: '2fr 1.1fr 1fr 1.2fr 1fr .9fr' } as const;
const INV_COLS = { gridTemplateColumns: '2fr 1fr 1fr 1fr 1.1fr .9fr' } as const;
const PAGE_SIZE = 10;

interface CarrierGroup {
  key: string;
  carrierId: string | null;
  companyName: string | null;
  owner: RegisteredCompany | null;
  drivers: RegisteredCompany[];
}

/** Prev/Next pager shared by both tables below — hides itself when everything fits on one page. */
function Pager({ page, total, onChange }: { page: number; total: number; onChange: (page: number) => void }) {
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  if (totalPages <= 1) return null;
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 'var(--space-3)', padding: 'var(--space-3) 0' }}>
      <span className={s.chipMeta}>
        Page {page} of {totalPages} · {total} total
      </span>
      <button type="button" className={s.ghostBtn} disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Prev
      </button>
      <button type="button" className={s.ghostBtn} disabled={page >= totalPages} onClick={() => onChange(page + 1)}>
        Next
      </button>
    </div>
  );
}

/**
 * Carrier User Management — generates Telegram invite links for owners and drivers (no
 * login/password; the bot's mini-app handles sign-in). The table below is a tree of who's
 * actually FINISHED registering (registered_mini_app_companies) — a sent invite that was never
 * opened doesn't show up here; see Audit Log for invite-generation history.
 */
export function CarrierUsers() {
  const [registrations, setRegistrations] = useState<RegisteredCompany[]>([]);
  const [loading, setLoading] = useState(true);
  // Load failures only. An action's outcome is transient and belongs in a toast; a table that
  // failed to load is a standing condition the admin has to be able to read and retry.
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [invitations, setInvitations] = useState<CarrierInvitation[]>([]);
  const [invLoading, setInvLoading] = useState(true);
  const [invError, setInvError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regPage, setRegPage] = useState(1);
  const [invPage, setInvPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRegistrations(await listRegisteredCompanies());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  const loadInvitations = useCallback(async () => {
    setInvLoading(true);
    setInvError('');
    try {
      setInvitations(await listInvitations());
    } catch (e) {
      setInvError(e instanceof Error ? e.message : String(e));
    } finally {
      setInvLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadInvitations();
  }, [load, loadInvitations]);

  async function revoke(id: string, label: string) {
    if (!window.confirm(`Revoke ${label}'s access? This can't be undone from here — they'd need a new invite to reconnect.`)) return;
    setBusyId(id);
    try {
      await revokeRegistration(id);
      adminToast.success('Access revoked', `${label} can no longer open the mini-app.`);
      await load();
    } catch (e) {
      adminToast.error('Revoke failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  async function cancel(id: string) {
    setBusyId(id);
    try {
      await cancelInvitation(id);
      adminToast.success('Invite cancelled', 'The link no longer works.');
      await loadInvitations();
    } catch (e) {
      adminToast.error('Cancel failed', e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  /** The link is only reachable from this row, so a failed copy has to hand it back somehow —
   * hence the URL in the toast body, and long enough on screen to select it. */
  async function copyInvite(url: string) {
    if (await copyToClipboard(url)) adminToast.success('Invite link copied');
    else adminToast.error('Copy failed — select the link below', url, 15000);
  }

  // Group into a tree: one row per carrier (the owner/operator), drivers nested beneath it. A
  // driver whose owner hasn't registered yet still gets its own group (owner: null) rather than
  // being silently dropped.
  const groups = useMemo(() => {
    const byKey = new Map<string, CarrierGroup>();
    for (const r of registrations) {
      const key = r.carrierId ?? r.applicationId ?? r.id;
      let group = byKey.get(key);
      if (!group) {
        group = { key, carrierId: r.carrierId, companyName: null, owner: null, drivers: [] };
        byKey.set(key, group);
      }
      if (r.profile === 'owner') {
        group.owner = r;
        group.companyName ??= r.companyName;
      } else {
        group.drivers.push(r);
        group.companyName ??= r.companyName;
      }
    }
    for (const group of byKey.values()) {
      group.drivers.sort((a, b) => Number(a.status === 'revoked') - Number(b.status === 'revoked'));
    }
    return [...byKey.values()].sort((a, b) => (a.companyName ?? '').localeCompare(b.companyName ?? ''));
  }, [registrations]);

  const filtered = groups.filter((g) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    const haystack = [g.companyName ?? '', g.carrierId ?? '', g.owner?.telegramUsername ?? '', ...g.drivers.map((d) => d.telegramUsername ?? '')]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  });

  // Reset to page 1 whenever the filter narrows/widens the result set — otherwise a search could
  // land on a now-out-of-range page and render nothing.
  useEffect(() => {
    setRegPage(1);
  }, [query]);

  // Clamp to the last page that still exists: cancelling the only invite on page 2 drops the list
  // to one page, and an unclamped page 2 renders an empty table with no pager left to escape it.
  const regPageSafe = Math.min(regPage, Math.max(1, Math.ceil(filtered.length / PAGE_SIZE)));
  const invPageSafe = Math.min(invPage, Math.max(1, Math.ceil(invitations.length / PAGE_SIZE)));
  const pagedGroups = filtered.slice((regPageSafe - 1) * PAGE_SIZE, regPageSafe * PAGE_SIZE);
  const pagedInvitations = invitations.slice((invPageSafe - 1) * PAGE_SIZE, invPageSafe * PAGE_SIZE);

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Carrier User Management</h2>
          <p className={s.sub}>Generate Telegram registration links — company owners see every card, drivers see one.</p>
        </div>
        {showForm ? (
          <button type="button" className={s.ghostBtn} onClick={() => setShowForm(false)}>
            <XIcon size={11} /> Cancel
          </button>
        ) : (
          <button type="button" className={s.primaryBtn} onClick={() => setShowForm(true)}>
            <PlusIcon size={14} />
            New registration link
          </button>
        )}
      </div>

      {showForm && <CarrierUserForm onInviteCreated={() => void loadInvitations()} />}

      {error && (
        <p className={s.errorNote} role="alert">
          {error}{' '}
          <button type="button" className={s.linkBtn} onClick={() => void load()}>
            Retry
          </button>
        </p>
      )}

      <label className={s.search}>
        <SearchIcon size={14} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter — company, carrier id, telegram username…"
        />
        <span className={s.chipMeta}>
          {registrations.length} registered
        </span>
      </label>

      <div className={s.table}>
        <div className={s.tHead} style={COLS}>
          <span>Company</span>
          <span>Type</span>
          <span>Carrier</span>
          <span>Telegram</span>
          <span>Registered</span>
          <span>Actions</span>
        </div>
        {loading && <div className={s.none}>Loading registered companies…</div>}
        {!loading &&
          pagedGroups.map((g) => (
            <div key={g.key}>
              <div className={s.tRow} style={COLS}>
                <span className={s.cellStack}>
                  <span className={s.docTitle}>{g.companyName ?? '(unnamed company)'}</span>
                  {!g.owner && <span className={s.cellSub}>Owner hasn't registered yet</span>}
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                  {g.owner && (
                    <span className={`${s.pill} ${g.owner.companyType === 'fleet-manager' ? s.pillInfo : s.pillNeutral}`}>
                      {g.owner.companyType === 'fleet-manager' ? <BuildingIcon size={11} /> : <PersonIcon size={11} />}
                      {g.owner.companyType === 'fleet-manager' ? 'Company owner' : 'Owner-operator'}
                    </span>
                  )}
                  {g.owner?.status === 'revoked' && <span className={`${s.pill} ${s.pillBad}`}>Revoked</span>}
                </span>
                <span className={s.mono}>{g.carrierId ?? '—'}</span>
                <span className={s.cellSub}>{g.owner ? `@${g.owner.telegramUsername ?? g.owner.telegramUserId}` : '—'}</span>
                <span className={s.cellSub}>{g.owner ? new Date(g.owner.createdAt).toLocaleDateString() : '—'}</span>
                <span>
                  {g.owner && g.owner.status === 'active' && (
                    <button
                      type="button"
                      className={`${s.miniBtn} ${s.miniDanger}`}
                      disabled={busyId === g.owner.id}
                      onClick={() => g.owner && void revoke(g.owner.id, g.companyName ?? 'This owner')}
                    >
                      Revoke
                    </button>
                  )}
                </span>
              </div>
              {g.drivers.map((d) => (
                <div key={d.id} className={s.tRow} style={{ ...COLS, opacity: d.status === 'revoked' ? 0.55 : 1 }}>
                  <span className={s.cellStack} style={{ paddingLeft: 'var(--space-4)' }}>
                    <span className={s.docTitle}>↳ {d.driverName ?? 'Driver'}</span>
                    <span className={s.cellSub}>card {d.cardId ?? '?'}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
                    <span className={`${s.pill} ${s.pillNeutral}`}>
                      <PersonIcon size={11} />
                      Driver
                    </span>
                    {d.status === 'revoked' && <span className={`${s.pill} ${s.pillBad}`}>Revoked</span>}
                  </span>
                  <span className={s.mono}>{d.carrierId ?? '—'}</span>
                  <span className={s.cellSub}>@{d.telegramUsername ?? d.telegramUserId}</span>
                  <span className={s.cellSub}>{new Date(d.createdAt).toLocaleDateString()}</span>
                  <span>
                    {d.status === 'active' && (
                      <button
                        type="button"
                        className={`${s.miniBtn} ${s.miniDanger}`}
                        disabled={busyId === d.id}
                        onClick={() => void revoke(d.id, d.driverName ?? 'This driver')}
                      >
                        Revoke
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
        {!loading && filtered.length === 0 && (
          <div className={s.none}>
            {registrations.length === 0 ? 'No registered companies yet — generate an invite link above.' : 'No companies match your filter.'}
          </div>
        )}
      </div>
      {!loading && <Pager page={regPageSafe} total={filtered.length} onChange={setRegPage} />}

      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Pending invitations</h2>
          <p className={s.sub}>Links generated but not yet (or no longer) redeemed.</p>
        </div>
      </div>

      {invError && (
        <p className={s.errorNote} role="alert">
          {invError}{' '}
          <button type="button" className={s.linkBtn} onClick={() => void loadInvitations()}>
            Retry
          </button>
        </p>
      )}

      <div className={s.table}>
        <div className={s.tHead} style={INV_COLS}>
          <span>Company</span>
          <span>Type</span>
          <span>Carrier</span>
          <span>Status</span>
          <span>Expires</span>
          <span>Actions</span>
        </div>
        {invLoading && <div className={s.none}>Loading invitations…</div>}
        {!invLoading &&
          pagedInvitations.map((inv) => {
            const isExpired = inv.status === 'pending' && new Date(inv.expiresAt).getTime() < Date.now();
            const displayStatus = isExpired ? 'expired' : inv.status;
            const pillClass = displayStatus === 'redeemed' ? s.pillGood : displayStatus === 'pending' ? s.pillInfo : s.pillNeutral;
            return (
              <div key={inv.id} className={s.tRow} style={INV_COLS}>
                <span className={s.cellStack}>
                  <span className={s.docTitle}>{inv.companyName ?? '(unnamed company)'}</span>
                  {inv.profile === 'driver' && <span className={s.cellSub}>driver · card {inv.cardId ?? '?'}</span>}
                </span>
                <span>
                  <span className={`${s.pill} ${s.pillNeutral}`}>
                    {inv.profile === 'owner' ? <BuildingIcon size={11} /> : <PersonIcon size={11} />}
                    {inv.profile === 'owner' ? 'Owner' : 'Driver'}
                  </span>
                </span>
                <span className={s.mono}>{inv.carrierId ?? inv.applicationId ?? '—'}</span>
                <span>
                  <span className={`${s.pill} ${pillClass}`}>{displayStatus}</span>
                </span>
                <span className={s.cellSub}>{new Date(inv.expiresAt).toLocaleString()}</span>
                <span style={{ display: 'flex', gap: 'var(--space-2)' }}>
                  {inv.status === 'pending' && !isExpired && (
                    <>
                      <button type="button" className={s.miniBtn} onClick={() => void copyInvite(inv.inviteUrl)}>
                        Copy
                      </button>
                      <button
                        type="button"
                        className={`${s.miniBtn} ${s.miniDanger}`}
                        disabled={busyId === inv.id}
                        onClick={() => void cancel(inv.id)}
                      >
                        Cancel
                      </button>
                    </>
                  )}
                </span>
              </div>
            );
          })}
        {!invLoading && invitations.length === 0 && <div className={s.none}>No invitations yet.</div>}
      </div>
      {!invLoading && <Pager page={invPageSafe} total={invitations.length} onChange={setInvPage} />}
    </div>
  );
}
