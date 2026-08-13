/**
 * Client Management — generate Telegram registration links for owner / manager / driver.
 * Owner/manager share the no-card path; driver needs an active owner + one fuel card.
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import { maskCard } from './autoLive';
import { isMiniAppPilotAgent } from './miniAppPilot';

import {
  createCarrierInvitation,
  getCarrierRegistrations,
  listCards,
  listSupportBotChats,
  resolvePasswordReset,
  revokeRegistration,
  searchClients,
  setSupportBotChat,
  type CarrierProfile,
  type DwhCard,
  type PasswordResetRequest,
  type RegisteredCompany,
} from '@/api/carrierUsers';
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import { ApiError } from '@/api/transport';
import { copyToClipboard } from '@/mytrions/admin/carrierUserUtil';

import {
  friendlyManageError,
  ManageSection,
  MANAGE_FIELD,
  MANAGE_LABEL,
} from './clientManageUi';
import { s } from './dc';
import { Icon } from './icons';
import { useSales } from './ctx';

export function ClientManagePanel({
  carrierId,
  companyName,
  clientStatus,
}: {
  carrierId: string;
  companyName: string;
  clientStatus: 'active' | 'attention' | 'debtor';
}) {
  const { pushToast } = useSales();
  const [profile, setProfile] = useState<CarrierProfile>('owner');
  const [cardId, setCardId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  // owner + manager share the no-card fleet path; driver is the per-card path.
  const isOwnerLike = profile === 'owner' || profile === 'manager';
  const isDriver = profile === 'driver';
  const profileLabel = profile === 'owner' ? 'Owner' : profile === 'manager' ? 'Manager' : 'Driver';

  const [cards, setCards] = useState<DwhCard[] | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsError, setCardsError] = useState('');

  const [owner, setOwner] = useState<RegisteredCompany | null | undefined>(undefined);
  const [managers, setManagers] = useState<RegisteredCompany[]>([]);
  const [drivers, setDrivers] = useState<RegisteredCompany[]>([]);
  const [pendingResets, setPendingResets] = useState<PasswordResetRequest[]>([]);
  const [regsBusy, setRegsBusy] = useState(false);
  const [regsError, setRegsError] = useState('');
  const [regsTick, setRegsTick] = useState(0);
  const [managerName, setManagerName] = useState('');
  const [revokeBusyId, setRevokeBusyId] = useState<string | null>(null);
  const [resetBusyId, setResetBusyId] = useState<string | null>(null);
  const [resetPassword, setResetPassword] = useState('');
  const [resetTargetId, setResetTargetId] = useState<string | null>(null);

  // Support-bot group id — manual bind (before owner registers) or re-point.
  const [botChatId, setBotChatId] = useState('');
  const [botChatSaved, setBotChatSaved] = useState<string | null>(null);
  const [botChatBusy, setBotChatBusy] = useState(false);
  const [botChatMsg, setBotChatMsg] = useState('');

  // Deal owner from DWH — stamped on invites (not the worker who clicked Generate).
  const [dealOwner, setDealOwner] = useState<{ name: string; zohoUserId: string | null } | null>(null);

  const prevProfile = useRef(profile);

  useEffect(() => {
    if (prevProfile.current === profile) return;
    prevProfile.current = profile;
    setCardId('');
    setDriverName('');
    setManagerName('');
    setInviteUrl('');
  }, [profile]);

  useEffect(() => {
    setCards(null);
    setCardsError('');
    setCardId('');
    const cid = carrierId.trim();
    if (!cid) {
      setCardsBusy(false);
      return;
    }
    setCardsBusy(true);
    const ac = new AbortController();
    void listCards(cid, 100, ac.signal)
      .then(setCards)
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setCardsError(friendlyManageError(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setCardsBusy(false);
      });
    return () => ac.abort();
  }, [carrierId]);

  useEffect(() => {
    setDealOwner(null);
    const cid0 = carrierId.trim();
    if (cid0) {
      void searchClients(cid0, 15)
        .then((clients) => {
          const mine = clients.find((c) => c.carrierId === cid0);
          if (mine?.ownerName) setDealOwner({ name: mine.ownerName, zohoUserId: mine.ownerZohoUserId });
        })
        .catch(() => undefined); // best-effort — fallback below still stamps someone sensible
    }
    setBotChatSaved(null);
    setBotChatId('');
    setBotChatMsg('');
    const cid = carrierId.trim();
    if (!cid) return;
    void listSupportBotChats()
      .then((chats) => {
        const mine = chats.find((c) => c.carrierId === cid);
        if (mine) {
          setBotChatSaved(mine.chatId);
          setBotChatId(mine.chatId);
        }
      })
      .catch(() => undefined); // read is best-effort — the input still works for a fresh set
  }, [carrierId]);

  async function saveBotChat(): Promise<void> {
    const cid = carrierId.trim();
    const chat = botChatId.trim();
    if (!cid || !chat || botChatBusy) return;
    if (!/^-?\d{5,20}$/.test(chat)) {
      setBotChatMsg('Group id must be numeric (e.g. -1003926878773).');
      return;
    }
    setBotChatBusy(true);
    setBotChatMsg('');
    try {
      await setSupportBotChat(chat, cid);
      setBotChatSaved(chat);
      setBotChatMsg('Saved — bot answers this group within ~5 minutes.');
    } catch (e) {
      setBotChatMsg(e instanceof ApiError && e.status === 403 ? 'Admin access required to map bot groups.' : friendlyManageError(e));
    } finally {
      setBotChatBusy(false);
    }
  }

  useEffect(() => {
    setOwner(undefined);
    setManagers([]);
    setDrivers([]);
    setPendingResets([]);
    setRegsError('');
    const cid = carrierId.trim();
    if (!cid) {
      setRegsBusy(false);
      return;
    }
    setRegsBusy(true);
    const ac = new AbortController();
    void getCarrierRegistrations(cid, ac.signal)
      .then((res) => {
        if (ac.signal.aborted) return;
        setOwner(res.owner);
        setManagers(res.managers ?? []);
        setDrivers(res.drivers ?? []);
        setPendingResets(res.pendingResets ?? []);
      })
      .catch((e: unknown) => {
        if (!ac.signal.aborted) setRegsError(friendlyManageError(e));
      })
      .finally(() => {
        if (!ac.signal.aborted) setRegsBusy(false);
      });
    return () => ac.abort();
  }, [carrierId, regsTick]);

  const ownerReady = owner != null && owner.status === 'active';
  const takenCardIds = useMemo(
    () => new Set(drivers.map((d) => d.cardId).filter((id): id is string => Boolean(id))),
    [drivers],
  );
  const availableCards = useMemo(
    () => (cards ?? []).filter((c) => c.cardId && !takenCardIds.has(c.cardId)),
    [cards, takenCardIds],
  );

  // If owner disappears (or never existed), kick out of Driver profile.
  useEffect(() => {
    if (profile === 'driver' && owner === null) setProfile('owner');
  }, [profile, owner]);

  const cardCount = cards?.length ?? null;
  const companyType =
    cardCount === null || cardCount === 0 ? null : cardCount === 1 ? 'owner-operator' : 'fleet-manager';

  // Rollout gate, not a permission: the mini-app is live for the pilot agents only, and the
  // `/carrier-invitations` route says the same thing. Rendering the form for everyone else would
  // offer a link that comes back 403.
  const pilotAgent = isMiniAppPilotAgent();
  const inviteEligible = clientStatus === 'active';
  const isManager = profile === 'manager';
  const valid =
    inviteEligible &&
    (profile === 'owner'
      ? carrierId.trim().length > 0
      : isManager
        ? carrierId.trim().length > 0 && managerName.trim().length > 0
        : ownerReady &&
          carrierId.trim().length > 0 &&
          cardId.trim().length > 0 &&
          driverName.trim().length > 0);

  let blocker = '';
  if (!inviteEligible) {
    blocker =
      clientStatus === 'debtor'
        ? 'Registration links are unavailable while this client is a debtor.'
        : 'Registration links are only available for active clients.';
  } else if (!carrierId.trim()) {
    blocker = 'This client has no carrier id — cannot generate a link.';
  } else if (isManager && !managerName.trim()) {
    blocker = "Enter the manager's name — it becomes their login.";
  } else if (isDriver && !ownerReady) {
    blocker = 'Register the owner first — then invite drivers per card.';
  } else if (isDriver && !cardId.trim()) {
    blocker = 'Pick the carrier card number this driver is for.';
  } else if (isDriver && !driverName.trim()) {
    blocker = "Enter the driver's name.";
  }

  async function generateInvite(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    if (isDriver && !ownerReady) {
      pushToast('Owner required', 'Register the owner user before inviting a driver.');
      return;
    }
    setBusy(true);
    try {
      const actingAs = getImpersonation();
      const worker = getSession()?.worker;
      const agentName = dealOwner?.name || actingAs?.name?.trim() || worker?.userName?.trim() || undefined;
      const agentZohoUserId = dealOwner?.zohoUserId?.trim() || actingAs?.zohoUserId?.trim() || worker?.zohoUserId?.trim() || undefined;
      const res = await createCarrierInvitation({
        profile,
        carrierId: carrierId.trim(),
        ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
        ...(isDriver && cardId.trim() ? { cardId: cardId.trim() } : {}),
        ...(isDriver && driverName.trim() ? { driverName: driverName.trim() } : {}),
        ...(isManager && managerName.trim() ? { driverName: managerName.trim() } : {}),
        ...(agentName ? { agentName } : {}),
        ...(agentZohoUserId ? { agentZohoUserId } : {}),
      });
      setInviteUrl(res.inviteUrl);
      pushToast('Link ready', `${profileLabel} registration link generated.`);
      setRegsTick((n) => n + 1);
    } catch (err: unknown) {
      pushToast("Couldn't generate", err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function copyLink() {
    if (!inviteUrl) return;
    const ok = await copyToClipboard(inviteUrl);
    pushToast(ok ? 'Copied' : "Couldn't copy", ok ? 'Registration link on clipboard.' : 'Copy the link manually.');
  }

  const ownerStatusLabel = regsBusy
    ? 'Checking owner…'
    : regsError
      ? 'Could not check owner'
      : ownerReady
        ? 'Owner registered'
        : 'No owner user yet';

  const profileHint =
    profile === 'owner'
      ? 'Company name becomes their login.'
      : profile === 'manager'
        ? 'Manager name becomes their login. Regenerating replaces a pending link.'
        : 'Tied to one card — last 6 digits become their login.';

  function profileBtnStyle(active: boolean, enabled = true): string {
    return `flex:1;height:38px;border-radius:var(--radius-md);border:1px solid ${active ? 'var(--accent)' : 'var(--border)'};background:${active ? 'rgba(var(--accent-rgb),.12)' : 'var(--surface)'};color:${active ? 'var(--accent)' : 'var(--text2)'};font-weight:700;font-size:14px;cursor:${enabled ? 'pointer' : 'default'};opacity:${enabled ? '1' : '.45'}`;
  }

  return (
    <form onSubmit={(e) => void generateInvite(e)} style={s('display:flex;flex-direction:column;gap:14px')}>
      {/* 1 — Client identity */}
      <ManageSection title="Client">
        <div style={s('font-size:15px;font-weight:700')}>{companyName || '—'}</div>
        <div style={s("font-size:13px;color:var(--text2);font-family:var(--font-mono);margin-top:3px")}>
          Carrier {carrierId || '—'}
          {companyType ? ` · ${companyType}` : ''}
        </div>
        {!inviteEligible && (
          <div style={s('margin-top:10px;font-size:13px;font-weight:700;color:var(--warn)')}>
            {clientStatus === 'debtor'
              ? 'Debtor — registration links are blocked.'
              : 'Inactive — registration links are blocked.'}
          </div>
        )}
        <div style={s('margin-top:10px;display:flex;flex-wrap:wrap;gap:8px 14px;font-size:13px')}>
          <span style={s(`font-weight:700;color:${ownerReady ? 'var(--ok)' : 'var(--warn)'}`)}>
            {ownerStatusLabel}
            {ownerReady && owner?.telegramUsername ? ` · @${owner.telegramUsername}` : ''}
          </span>
          {dealOwner && (
            <span style={s('color:var(--text2)')}>
              Sales agent: <b style={s('color:var(--text)')}>{dealOwner.name}</b>
            </span>
          )}
        </div>
      </ManageSection>

      {/* 2 — Primary: profile + generate link. Pilot agents only — see `miniAppPilot`. */}
      {pilotAgent ? (
      <ManageSection title="Registration link" hint={profileHint}>
        <span style={s(MANAGE_LABEL)}>Profile</span>
        <div style={s('display:flex;gap:8px')}>
          <button type="button" onClick={() => setProfile('owner')} style={s(profileBtnStyle(profile === 'owner'))}>
            Owner
          </button>
          <button
            type="button"
            onClick={() => setProfile('manager')}
            title="Owner-equivalent fleet access, no card"
            style={s(profileBtnStyle(profile === 'manager'))}
          >
            Manager
          </button>
          <button
            type="button"
            onClick={() => {
              if (!ownerReady) {
                pushToast('Owner user required', 'Register the owner user first, then invite drivers for each card.');
                return;
              }
              setProfile('driver');
            }}
            disabled={!ownerReady}
            title={ownerReady ? 'Driver under this owner user' : 'Requires an active owner user'}
            style={s(profileBtnStyle(profile === 'driver', ownerReady))}
          >
            Driver
          </button>
        </div>

        {isManager && (
          <div style={s('margin-top:12px')}>
            <span style={s(MANAGE_LABEL)}>Manager name</span>
            <input
              value={managerName}
              onChange={(e) => setManagerName(e.target.value.slice(0, 200))}
              placeholder="Unique name — used as login"
              style={s(MANAGE_FIELD)}
            />
          </div>
        )}

        {isDriver && ownerReady && (
          <div style={s('margin-top:12px;display:flex;flex-direction:column;gap:12px')}>
            <div>
              <span style={s(MANAGE_LABEL)}>Card number</span>
              {cardsBusy && <div style={s('font-size:13px;color:var(--muted)')}>Loading cards…</div>}
              {cardsError && <div style={s('font-size:13px;color:var(--danger)')}>{cardsError}</div>}
              {!cardsBusy && !cardsError && availableCards.length === 0 && (
                <div style={s('font-size:13px;color:var(--muted)')}>
                  {(cards?.length ?? 0) === 0
                    ? 'No active cards on this carrier.'
                    : 'Every active card already has a driver.'}
                </div>
              )}
              {availableCards.length > 0 && (
                <select value={cardId} onChange={(e) => setCardId(e.target.value)} style={s(MANAGE_FIELD)}>
                  <option value="">Select a card number…</option>
                  {availableCards.map((c) => (
                    <option key={c.cardId ?? c.cardNumber ?? ''} value={c.cardId ?? ''}>
                      {(c.cardNumber ? maskCard(c.cardNumber) : c.cardId || '—') + (c.status ? ` · ${c.status}` : '')}
                    </option>
                  ))}
                </select>
              )}
            </div>
            <div>
              <span style={s(MANAGE_LABEL)}>Driver name</span>
              <input
                value={driverName}
                onChange={(e) => setDriverName(e.target.value)}
                placeholder="Full name"
                style={s(MANAGE_FIELD)}
              />
            </div>
          </div>
        )}

        {isDriver && !ownerReady && (
          <div style={s('margin-top:12px;font-size:13px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
            Generate an owner link first. Driver unlocks after the owner registers.
          </div>
        )}

        {blocker && (isOwnerLike || (isDriver && ownerReady)) && (
          <div style={s('margin-top:12px;font-size:13px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
            {blocker}
          </div>
        )}

        {/* Do not render an invitation action for debtors/inactive clients. The API enforces the
            same rule; omitting the control keeps the UI from suggesting that an override exists. */}
        {inviteEligible && (isOwnerLike || ownerReady) && (
          <button
            type="submit"
            disabled={busy || !valid}
            className="ss-btn-p"
            style={s(`margin-top:14px;width:100%;height:40px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:14px;cursor:${busy || !valid ? 'default' : 'pointer'};opacity:${busy || !valid ? '.55' : '1'};display:flex;align-items:center;justify-content:center;gap:8px`)}
          >
            <Icon name="link" size={16} color="#fff" />
            {busy ? 'Generating…' : 'Generate registration link'}
          </button>
        )}

        {inviteUrl && (
          <div style={s('margin-top:12px;padding:12px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)')}>
            <div style={s('font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700')}>
              Ready to share
            </div>
            <div style={s("font-size:13px;font-family:var(--font-mono);color:var(--text2);margin-top:8px;word-break:break-all;line-height:1.45")}>
              {inviteUrl}
            </div>
            <button
              type="button"
              onClick={() => void copyLink()}
              style={s('margin-top:10px;height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:700;font-size:13px;cursor:pointer;display:inline-flex;align-items:center;gap:7px')}
            >
              <Icon name="copy" size={14} />
              Copy link
            </button>
          </div>
        )}
      </ManageSection>
      ) : (
        <ManageSection title="Registration link">
          <div style={s('font-size:13px;color:var(--text2)')}>
            Client registration is with the mini-app pilot agents for now. Existing mini-app users
            below keep working.
          </div>
        </ManageSection>
      )}

      {/* 3 — Registered users */}
      <ManageSection title="Registered users" hint="Remove cuts off mini-app access immediately.">
        {regsBusy && (
          <div style={s('font-size:13px;color:var(--muted);padding:4px 0')}>Loading…</div>
        )}
        {regsError && <div style={s('font-size:13px;color:var(--danger);margin-bottom:8px')}>{regsError}</div>}
        {!regsBusy && !owner && managers.length === 0 && drivers.length === 0 ? (
          <div style={s('font-size:13px;color:var(--muted);padding:4px 0')}>
            No registered users yet.
          </div>
        ) : (
          [
            ...(owner ? [owner] : []),
            ...managers,
            ...drivers,
          ].map((u) => (
            <div
              key={u.id}
              style={s('display:flex;align-items:center;gap:10px;padding:10px 0;border-top:1px solid var(--border2)')}
            >
              <div style={s('flex:1;min-width:0')}>
                <div style={s('font-size:14px;font-weight:700')}>
                  {u.profile === 'owner'
                    ? u.companyName || 'Owner'
                    : u.driverName || (u.profile === 'manager' ? 'Manager' : 'Driver')}
                </div>
                <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
                  {u.profile}
                  {u.telegramUsername ? ` · @${u.telegramUsername}` : ''}
                  {u.cardId ? ` · card …${u.cardId.slice(-6)}` : ''}
                </div>
              </div>
              <button
                type="button"
                disabled={revokeBusyId === u.id}
                onClick={() => {
                  if (!window.confirm(`Remove ${u.profile} access? They will be logged out immediately.`)) return;
                  setRevokeBusyId(u.id);
                  void revokeRegistration(u.id)
                    .then(() => {
                      pushToast('Removed', `${u.profile} access revoked.`);
                      setRegsTick((n) => n + 1);
                    })
                    .catch((err: unknown) => {
                      pushToast("Couldn't remove", err instanceof Error ? err.message : String(err));
                    })
                    .finally(() => setRevokeBusyId(null));
                }}
                style={s(`height:32px;padding:0 12px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 40%,var(--border));background:color-mix(in srgb,var(--danger) 10%,transparent);color:var(--danger);font-weight:700;font-size:12px;cursor:pointer;opacity:${revokeBusyId === u.id ? '.5' : '1'}`)}
              >
                {revokeBusyId === u.id ? '…' : 'Remove'}
              </button>
            </div>
          ))
        )}
      </ManageSection>

      {/* 4 — Pending password resets */}
      <ManageSection title="Pending password resets" hint="Set a new password when a mini-app user forgets theirs.">
        {pendingResets.length === 0 ? (
          <div style={s('font-size:13px;color:var(--muted);padding:4px 0')}>
            No pending reset requests.
          </div>
        ) : (
          pendingResets.map((r) => (
            <div key={r.id} style={s('padding:10px 0;border-top:1px solid var(--border2)')}>
              <div style={s('font-size:14px;font-weight:700')}>{r.login} · {r.profile}</div>
              {r.note && <div style={s('font-size:12px;color:var(--text2);margin-top:4px')}>{r.note}</div>}
              {resetTargetId === r.id ? (
                <div style={s('display:flex;gap:8px;margin-top:8px')}>
                  <input
                    type="password"
                    value={resetPassword}
                    onChange={(e) => setResetPassword(e.target.value)}
                    placeholder="New password (min 4)"
                    style={s(`${MANAGE_FIELD};flex:1`)}
                  />
                  <button
                    type="button"
                    disabled={resetBusyId === r.id || resetPassword.length < 4}
                    onClick={() => {
                      setResetBusyId(r.id);
                      void resolvePasswordReset(r.id, resetPassword)
                        .then(() => {
                          pushToast('Password updated', `${r.login} can log in with the new password.`);
                          setResetTargetId(null);
                          setResetPassword('');
                          setRegsTick((n) => n + 1);
                        })
                        .catch((err: unknown) => {
                          pushToast("Couldn't reset", err instanceof Error ? err.message : String(err));
                        })
                        .finally(() => setResetBusyId(null));
                    }}
                    style={s('height:36px;padding:0 12px;border-radius:var(--radius-md);border:none;background:var(--accent);color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer')}
                  >
                    Save
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => { setResetTargetId(r.id); setResetPassword(''); }}
                  style={s('margin-top:8px;height:32px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--accent);background:rgba(var(--accent-rgb),.12);color:var(--accent);font-weight:700;font-size:12px;cursor:pointer')}
                >
                  Set new password
                </button>
              )}
            </div>
          ))
        )}
      </ManageSection>

      {/* 5 — Support bot (secondary) */}
      <ManageSection title="Support bot group" hint={botChatSaved ? `Bound: ${botChatSaved}` : 'Optional Telegram group id for the support bot.'}>
        <div style={s('display:flex;gap:8px')}>
          <input
            value={botChatId}
            onChange={(e) => setBotChatId(e.target.value)}
            placeholder="-1003926878773"
            style={s("flex:1;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);padding:0 10px;font-family:var(--font-mono);font-size:14px")}
          />
          <button
            type="button"
            onClick={() => void saveBotChat()}
            disabled={botChatBusy || !botChatId.trim() || botChatId.trim() === botChatSaved}
            style={s(`height:38px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--accent);background:rgba(var(--accent-rgb),.12);color:var(--accent);font-weight:700;font-size:14px;cursor:pointer;opacity:${botChatBusy || !botChatId.trim() || botChatId.trim() === botChatSaved ? '.5' : '1'}`)}
          >
            {botChatBusy ? 'Saving…' : botChatSaved ? 'Update' : 'Save'}
          </button>
        </div>
        {botChatMsg && <div style={s('margin-top:8px;font-size:13px;color:var(--warn)')}>{botChatMsg}</div>}
      </ManageSection>
    </form>
  );
}
