import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  cancelInvitation,
  listInvitations,
  listRegisteredCompanies,
  revokeRegistration,
  type CarrierInvitation,
  type RegisteredCompany,
} from '../../api/carrierUsers';
import { BuildingIcon, PersonIcon, PlusIcon, RefreshIcon, RevokeIcon, SearchIcon, XIcon } from '../../components/icons';
import { CarrierInvitations } from './CarrierInvitations';
import { CarrierUserForm, type InviteDraft } from './CarrierUserForm';
import { copyToClipboard } from './carrierUserUtil';
import { ConfirmDialog } from './ConfirmDialog';
import { Pager, PAGE_SIZE } from './Pager';
import { adminToast } from './toast';
import { TableSkeleton } from '@/components/mytrion/table-skeleton';
import s from './admin.module.css';

/** Title and blurb for each sub-item — the sidebar names the section, the header names the view. */
const VIEWS = {
  registered: {
    title: 'Registered companies',
    sub: 'Owners and drivers who finished signing in inside the mini-app.',
  },
  invitations: {
    title: 'Invitations',
    sub: 'Every registration link generated — live, redeemed, or spent.',
  },
} as const;

/** Bar width per column — uneven, tracking the shape of real rows: a company name, a pill, an id,
 * a @handle, a date, a button. */
const REG_SKELETON = ['62%', '76px', '54%', '68%', '58%', '52px'] as const;

/** A destructive action held until the admin confirms it. */
interface PendingConfirm {
  title: string;
  body: string;
  confirmLabel: string;
  cancelLabel: string;
  run: () => Promise<void>;
}

interface CarrierGroup {
  key: string;
  carrierId: string | null;
  companyName: string | null;
  owner: RegisteredCompany | null;
  drivers: RegisteredCompany[];
}

/**
 * Carrier User Management — generates Telegram invite links for owners and drivers (no
 * login/password; the bot's mini-app handles sign-in). The registered tree is who's actually
 * FINISHED registering (registered_mini_app_companies) — a sent invite that was never opened
 * doesn't show up there; see Audit Log for invite-generation history.
 *
 * `view` picks which table the sidebar sub-item is asking for. Both live in this one component so
 * the confirm dialog, the busy row, and the invite form are shared rather than duplicated — and so
 * switching sub-items doesn't refetch either list.
 */
export function CarrierUsers({ view = 'registered' }: { view?: 'registered' | 'invitations' }) {
  const [registrations, setRegistrations] = useState<RegisteredCompany[]>([]);
  const [loading, setLoading] = useState(true);
  // Load failures only. An action's outcome is transient and belongs in a toast; a table that
  // failed to load is a standing condition the admin has to be able to read and retry.
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [draft, setDraft] = useState<InviteDraft | null>(null);
  const [formKey, setFormKey] = useState(0);
  const [invitations, setInvitations] = useState<CarrierInvitation[]>([]);
  const [invLoading, setInvLoading] = useState(true);
  const [invError, setInvError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [regPage, setRegPage] = useState(1);
  const [pending, setPending] = useState<PendingConfirm | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);

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

  async function runPending() {
    if (!pending || confirmBusy) return;
    try {
      setConfirmBusy(true);
      await pending.run();
    } finally {
      setConfirmBusy(false);
      setPending(null);
    }
  }

  function askRevoke(id: string, label: string) {
    setPending({
      title: `Revoke ${label}'s access?`,
      body: `They lose the mini-app immediately. There's no un-revoke here — reconnecting them means generating a fresh invite.`,
      confirmLabel: 'Revoke access',
      cancelLabel: 'Keep access',
      run: () => revoke(id, label),
    });
  }

  function askCancel(inv: CarrierInvitation) {
    setPending({
      title: 'Cancel this invite?',
      body: `The link stops working the moment you confirm, and it can't be brought back — ${
        inv.companyName ?? 'this company'
      } would need a new one.`,
      confirmLabel: 'Cancel invite',
      cancelLabel: 'Keep invite',
      run: () => cancel(inv.id),
    });
  }

  /** Seed the form from a spent invite, remounting it so the draft actually takes. */
  function reissue(inv: CarrierInvitation) {
    setDraft({
      profile: inv.profile,
      carrierId: inv.carrierId ?? '',
      applicationId: inv.applicationId ?? '',
      companyName: inv.companyName ?? '',
      cardId: inv.cardId ?? '',
      driverName: inv.driverName ?? '',
    });
    setFormKey((k) => k + 1);
    setShowForm(true);
  }

  function openBlankForm() {
    setDraft(null);
    setFormKey((k) => k + 1);
    setShowForm(true);
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
  const pagedGroups = filtered.slice((regPageSafe - 1) * PAGE_SIZE, regPageSafe * PAGE_SIZE);

  // The header's Refresh acts on whichever table is on screen.
  const refreshing = view === 'invitations' ? invLoading : loading;
  const refresh = () => void (view === 'invitations' ? loadInvitations() : load());

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      {/* One header per view. The page used to stack two — the module title over the table's own
          title, each with its own subtitle and its own button on a separate row — and the module
          title only repeated what the sidebar already says. It's an eyebrow now. */}
      <div className={s.head}>
        <div>
          <div className={s.eyebrow}>Carrier User Management</div>
          <h2 className={s.h2}>{VIEWS[view].title}</h2>
          <p className={s.sub}>{VIEWS[view].sub}</p>
        </div>
        <div className={s.inlineRow}>
          <button type="button" className={s.ghostBtn} disabled={refreshing} onClick={refresh}>
            <RefreshIcon />
            {refreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          {showForm ? (
            // "Close", not "Cancel" — the rows below have a Cancel that kills an invite, and one
            // screen shouldn't spend the same word on two different outcomes.
            <button type="button" className={s.ghostBtn} onClick={() => setShowForm(false)}>
              <XIcon size={11} /> Close
            </button>
          ) : (
            <button type="button" className={s.primaryBtn} onClick={openBlankForm}>
              <PlusIcon size={14} />
              New registration link
            </button>
          )}
        </div>
      </div>

      {showForm && (
        <CarrierUserForm
          key={formKey}
          onInviteCreated={() => void loadInvitations()}
          {...(draft ? { initial: draft } : {})}
        />
      )}

      {view === 'invitations' ? (
        <CarrierInvitations
          invitations={invitations}
          loading={invLoading}
          error={invError}
          busyId={busyId}
          onRefresh={() => void loadInvitations()}
          onCopy={(url) => void copyInvite(url)}
          onCancel={askCancel}
          onReissue={reissue}
        />
      ) : (
        <>
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
        {/* Counts companies, matching what the table actually lists — the old chip counted raw
            registration rows against a table grouped by company. */}
        <span className={s.chipMeta}>
          {filtered.length === groups.length ? `${groups.length} companies` : `${filtered.length} of ${groups.length}`}
        </span>
      </label>

      <div className={s.tableScroll}>
        <div className={s.table} role="table" aria-label="Registered carrier companies" aria-busy={loading}>
        <div className={`${s.tHead} ${s.tCarrier}`} role="row">
          <span role="columnheader">Company</span>
          <span role="columnheader">Type</span>
          <span role="columnheader">Carrier</span>
          <span role="columnheader">Telegram</span>
          <span role="columnheader">Registered</span>
          <span role="columnheader">Actions</span>
        </div>
          {loading && (
            <>
              <span className={s.srOnly} role="status">
                Loading registered companies…
              </span>
              <TableSkeleton widths={REG_SKELETON} rowClassName={s.tRow} colsClassName={s.tCarrier} />
            </>
          )}
        {!loading &&
          pagedGroups.map((g) => (
            // rowgroup keeps the owner and its drivers a valid subtree of the table.
            <div key={g.key} className={s.tGroup} role="rowgroup">
              <div className={`${s.tRow} ${s.tCarrier} ${g.owner?.status === 'revoked' ? s.tRowRevoked : ''}`} role="row">
                <span className={s.cellStack} role="cell">
                  <span className={s.docTitle}>{g.companyName ?? '(unnamed company)'}</span>
                  {!g.owner && <span className={s.cellSub}>Owner hasn't registered yet</span>}
                </span>
                <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }} role="cell">
                  {g.owner && (
                    <span className={`${s.pill} ${g.owner.companyType === 'fleet-manager' ? s.pillInfo : s.pillNeutral}`}>
                      {g.owner.companyType === 'fleet-manager' ? <BuildingIcon size={11} /> : <PersonIcon size={11} />}
                      {g.owner.companyType === 'fleet-manager' ? 'Company owner' : 'Owner-operator'}
                    </span>
                  )}
                  {g.owner?.status === 'revoked' && <span className={`${s.pill} ${s.pillBad}`}>Revoked</span>}
                </span>
                <span className={s.mono} role="cell">
                  {g.carrierId ?? '—'}
                </span>
                <span className={s.cellSub} role="cell">
                  {g.owner ? `@${g.owner.telegramUsername ?? g.owner.telegramUserId}` : '—'}
                </span>
                <span className={s.cellSub} role="cell" title={g.owner ? new Date(g.owner.createdAt).toLocaleString() : ''}>
                  {g.owner ? new Date(g.owner.createdAt).toLocaleDateString() : '—'}
                </span>
                <span role="cell">
                  {g.owner && g.owner.status === 'active' && (
                    <button
                      type="button"
                      className={`${s.miniBtn} ${s.miniDanger}`}
                      disabled={busyId === g.owner.id}
                      onClick={() => g.owner && askRevoke(g.owner.id, g.companyName ?? 'This owner')}
                    >
                      <RevokeIcon />
                      Revoke
                    </button>
                  )}
                </span>
              </div>
              {g.drivers.map((d) => (
                <div
                  key={d.id}
                  className={`${s.tRow} ${s.tCarrier} ${d.status === 'revoked' ? s.tRowRevoked : ''}`}
                  role="row"
                >
                  <span className={s.cellStack} style={{ paddingLeft: 'var(--space-4)' }} role="cell">
                    <span className={s.docTitle}>{d.driverName ?? 'Driver'}</span>
                    <span className={s.cellSub}>card {d.cardId ?? '?'}</span>
                  </span>
                  <span style={{ display: 'flex', gap: 'var(--space-2)', flexWrap: 'wrap' }} role="cell">
                    <span className={`${s.pill} ${s.pillNeutral}`}>
                      <PersonIcon size={11} />
                      Driver
                    </span>
                    {d.status === 'revoked' && <span className={`${s.pill} ${s.pillBad}`}>Revoked</span>}
                  </span>
                  <span className={s.mono} role="cell">
                    {d.carrierId ?? '—'}
                  </span>
                  <span className={s.cellSub} role="cell">
                    @{d.telegramUsername ?? d.telegramUserId}
                  </span>
                  <span className={s.cellSub} role="cell" title={new Date(d.createdAt).toLocaleString()}>
                    {new Date(d.createdAt).toLocaleDateString()}
                  </span>
                  <span role="cell">
                    {d.status === 'active' && (
                      <button
                        type="button"
                        className={`${s.miniBtn} ${s.miniDanger}`}
                        disabled={busyId === d.id}
                        onClick={() => askRevoke(d.id, d.driverName ?? 'This driver')}
                      >
                        <RevokeIcon />
                        Revoke
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ))}
          {!loading && filtered.length === 0 && (
            <div className={s.none} role="row">
              <span role="cell">
                {registrations.length === 0
                  ? 'No one has registered yet. Use New registration link to invite an owner or driver.'
                  : 'No companies match your filter.'}
              </span>
            </div>
          )}
        </div>
      </div>
      {!loading && <Pager page={regPageSafe} total={filtered.length} onChange={setRegPage} />}
        </>
      )}

      {pending && (
        <ConfirmDialog
          title={pending.title}
          body={pending.body}
          confirmLabel={pending.confirmLabel}
          cancelLabel={pending.cancelLabel}
          busy={confirmBusy}
          onConfirm={() => void runPending()}
          onCancel={() => setPending(null)}
        />
      )}
    </div>
  );
}
