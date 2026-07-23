/**
 * Client Management — generate Telegram registration links for owner / manager / driver.
 * Owner and manager share the no-card fleet path (manager = owner-equivalent access, no card).
 * Driver is a child of the owner: only available after an active owner registration exists,
 * and each driver is tied to one carrier fuel card (by card number).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  createCarrierInvitation,
  getCarrierRegistrations,
  listCards,
  listSupportBotChats,
  searchClients,
  setSupportBotChat,
  type CarrierProfile,
  type DwhCard,
  type RegisteredCompany,
} from '@/api/carrierUsers';
import { getImpersonation } from '@/api/impersonation';
import { getSession } from '@/api/session';
import { ApiError } from '@/api/transport';
import { copyToClipboard } from '@/mytrions/admin/carrierUserUtil';

import { s } from './dc';
import { Icon } from './icons';
import { useSales } from './ctx';

/**
 * Distinguish a data-warehouse outage from a real ownership denial so the Manage panel doesn't
 * read "no cards" when the warehouse is down. The reads are gated by assertCarrierOwned (DWH probe),
 * which surfaces 502 DWH_ERROR / 503 DWH_UNCONFIGURED vs a 403 RBAC "not your client".
 */
function friendlyManageError(e: unknown): string {
  if (e instanceof ApiError) {
    if (e.code === 'DWH_ERROR' || e.status === 502) return 'Data warehouse temporarily unavailable — try again shortly.';
    if (e.code === 'DWH_UNCONFIGURED' || e.status === 503) return 'Card data is unavailable right now (warehouse not configured).';
    if (e.status === 403) return "This carrier isn't in your client list.";
  }
  return e instanceof Error ? e.message : String(e);
}

export function ClientManagePanel({
  carrierId,
  companyName,
}: {
  carrierId: string;
  companyName: string;
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
  const [drivers, setDrivers] = useState<RegisteredCompany[]>([]);
  const [regsBusy, setRegsBusy] = useState(false);
  const [regsError, setRegsError] = useState('');
  const [regsTick, setRegsTick] = useState(0);

  // Support-bot group mapping (2026-07-23, owner ask): show the STATIC Telegram group id bound to
  // this carrier and let an admin set/edit it — the manual counterpart of the bot's auto-bind
  // (needed when the group should be wired BEFORE any owner registration, or re-pointed).
  const [botChatId, setBotChatId] = useState('');
  const [botChatSaved, setBotChatSaved] = useState<string | null>(null);
  const [botChatBusy, setBotChatBusy] = useState(false);
  const [botChatMsg, setBotChatMsg] = useState('');

  // Deal owner = the SALES AGENT the client must see in the mini-app (2026-07-23, owner ask).
  // Before: invites stamped whoever clicked Generate (actingAs/worker) — wrong person whenever an
  // admin or a colleague generated the link. The DWH deal row is the source of truth; the
  // logged-in worker stays only as the fallback for deals with no resolvable owner.
  const [dealOwner, setDealOwner] = useState<{ name: string; zohoUserId: string | null } | null>(null);

  const prevProfile = useRef(profile);

  useEffect(() => {
    if (prevProfile.current === profile) return;
    prevProfile.current = profile;
    setCardId('');
    setDriverName('');
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
      setBotChatMsg('Group id must be numeric (e.g. -1003926878773 — from the group\'s info or @getidsbot).');
      return;
    }
    setBotChatBusy(true);
    setBotChatMsg('');
    try {
      await setSupportBotChat(chat, cid);
      setBotChatSaved(chat);
      setBotChatMsg('Saved — the bot answers this group within ~5 minutes.');
    } catch (e) {
      setBotChatMsg(e instanceof ApiError && e.status === 403 ? 'Admin access required to map bot groups.' : friendlyManageError(e));
    } finally {
      setBotChatBusy(false);
    }
  }

  useEffect(() => {
    setOwner(undefined);
    setDrivers([]);
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
        setDrivers(res.drivers);
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

  const valid = isOwnerLike
    ? carrierId.trim().length > 0
    : ownerReady
      && carrierId.trim().length > 0
      && cardId.trim().length > 0
      && driverName.trim().length > 0;

  const blocker = !valid
    ? !carrierId.trim()
      ? 'This client has no carrier id — cannot generate a link.'
      : isDriver && !ownerReady
        ? 'Register the owner user first — drivers can only be created under an active owner user.'
        : isDriver && !cardId.trim()
          ? 'Pick the carrier card number this driver is for.'
          : isDriver && !driverName.trim()
            ? "Enter the driver's name."
            : ''
    : '';

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
        ...(agentName ? { agentName } : {}),
        ...(agentZohoUserId ? { agentZohoUserId } : {}),
      });
      setInviteUrl(res.inviteUrl);
      pushToast('Link ready', `${profileLabel} registration link generated.`);
      if (isOwnerLike) setRegsTick((n) => n + 1);
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

  const field = 'width:100%;height:36px;padding:0 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:13px;outline:none;box-sizing:border-box';
  const label = 'font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em;font-weight:700;margin-bottom:6px;display:block';
  const tile = 'padding:14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)';

  const ownerStatusLabel = regsBusy
    ? 'Checking owner user…'
    : regsError
      ? 'Could not check owner user'
      : ownerReady
        ? 'Owner user registered'
        : 'No owner user yet';

  return (
    <form onSubmit={(e) => void generateInvite(e)} style={s('display:flex;flex-direction:column;gap:16px')}>
      <div style={s(tile)}>
        <div style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Client</div>
        <div style={s('font-size:14px;font-weight:700;margin-top:5px')}>{companyName || '—'}</div>
        <div style={s("font-size:12px;color:var(--text2);font-family:'JetBrains Mono',monospace;margin-top:3px")}>
          Carrier {carrierId || '—'}
          {companyType ? ` · ${companyType}` : ''}
        </div>
        {dealOwner && (
          <div style={s('margin-top:4px;font-size:12px;color:var(--text2)')}>
            Sales agent: <b>{dealOwner.name}</b> — stamped on the registration link; the client sees this name in the mini-app.
          </div>
        )}
        <div style={s(`margin-top:10px;font-size:12px;font-weight:700;color:${ownerReady ? 'var(--ok)' : 'var(--warn)'}`)}>
          {ownerStatusLabel}
          {ownerReady && owner?.telegramUsername ? ` · @${owner.telegramUsername}` : ''}
        </div>
      </div>

      <div style={s(tile)}>
        <span style={s(label)}>Support bot group</span>
        <div style={s('display:flex;gap:8px')}>
          <input
            value={botChatId}
            onChange={(e) => setBotChatId(e.target.value)}
            placeholder="-1003926878773"
            style={s("flex:1;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);padding:0 10px;font-family:'JetBrains Mono',monospace;font-size:13px")}
          />
          <button
            type="button"
            onClick={() => void saveBotChat()}
            disabled={botChatBusy || !botChatId.trim() || botChatId.trim() === botChatSaved}
            style={s(`height:38px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--accent);background:rgba(var(--accent-rgb),.12);color:var(--accent);font-weight:700;font-size:13px;cursor:pointer;opacity:${botChatBusy || !botChatId.trim() || botChatId.trim() === botChatSaved ? '.5' : '1'}`)}
          >
            {botChatBusy ? 'Saving…' : botChatSaved ? 'Update' : 'Save'}
          </button>
        </div>
        <div style={s('margin-top:7px;font-size:12px;color:var(--text2)')}>
          {botChatSaved
            ? `Bound: ${botChatSaved} — the support bot answers this Telegram group.`
            : 'Optional: paste the Telegram group id to wire the support bot BEFORE the owner registers. Otherwise the group binds itself on the registered owner\'s first message.'}
        </div>
        {botChatMsg && <div style={s('margin-top:5px;font-size:12px;color:var(--warn)')}>{botChatMsg}</div>}
      </div>

      <div>
        <span style={s(label)}>Profile</span>
        <div style={s('display:flex;gap:8px')}>
          <button
            type="button"
            onClick={() => setProfile('owner')}
            style={s(`flex:1;height:38px;border-radius:var(--radius-md);border:1px solid ${profile === 'owner' ? 'var(--accent)' : 'var(--border)'};background:${profile === 'owner' ? 'rgba(var(--accent-rgb),.12)' : 'var(--alt)'};color:${profile === 'owner' ? 'var(--accent)' : 'var(--text2)'};font-weight:700;font-size:13px;cursor:pointer`)}
          >
            Owner
          </button>
          <button
            type="button"
            onClick={() => setProfile('manager')}
            title="Owner-equivalent fleet access, no card assigned"
            style={s(`flex:1;height:38px;border-radius:var(--radius-md);border:1px solid ${profile === 'manager' ? 'var(--accent)' : 'var(--border)'};background:${profile === 'manager' ? 'rgba(var(--accent-rgb),.12)' : 'var(--alt)'};color:${profile === 'manager' ? 'var(--accent)' : 'var(--text2)'};font-weight:700;font-size:13px;cursor:pointer`)}
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
            style={s(`flex:1;height:38px;border-radius:var(--radius-md);border:1px solid ${profile === 'driver' ? 'var(--accent)' : 'var(--border)'};background:${profile === 'driver' ? 'rgba(var(--accent-rgb),.12)' : 'var(--alt)'};color:${profile === 'driver' ? 'var(--accent)' : 'var(--text2)'};font-weight:700;font-size:13px;cursor:${ownerReady ? 'pointer' : 'default'};opacity:${ownerReady ? '1' : '.45'}`)}
          >
            Driver
          </button>
        </div>
        <div style={s('font-size:12px;color:var(--muted);margin-top:8px;line-height:1.45')}>
          {profile === 'owner'
            ? 'Owner user link — fleet access for all cards. Drivers unlock after this owner user finishes registration.'
            : profile === 'manager'
              ? 'Manager link — owner-equivalent fleet access, no card assigned. For a company manager who needs full visibility without a driver card.'
              : 'Driver user link — child of the owner user, tied to one carrier card number.'}
        </div>
      </div>

      {isDriver && ownerReady && (
        <>
          <div>
            <span style={s(label)}>Card number</span>
            {cardsBusy && <div style={s('font-size:12px;color:var(--muted)')}>Loading cards…</div>}
            {cardsError && <div style={s('font-size:12px;color:var(--danger)')}>{cardsError}</div>}
            {!cardsBusy && !cardsError && availableCards.length === 0 && (
              <div style={s('font-size:12px;color:var(--muted)')}>
                {(cards?.length ?? 0) === 0
                  ? 'No active cards on this carrier.'
                  : 'Every active card already has a driver.'}
              </div>
            )}
            {availableCards.length > 0 && (
              <select
                value={cardId}
                onChange={(e) => setCardId(e.target.value)}
                style={s(field)}
              >
                <option value="">Select a card number…</option>
                {availableCards.map((c) => (
                  <option key={c.cardId ?? c.cardNumber ?? ''} value={c.cardId ?? ''}>
                    {(c.cardNumber || c.cardId || '—') + (c.status ? ` · ${c.status}` : '')}
                  </option>
                ))}
              </select>
            )}
            {drivers.length > 0 && (
              <div style={s('font-size:11px;color:var(--muted);margin-top:8px;line-height:1.4')}>
                {drivers.length} driver{drivers.length === 1 ? '' : 's'} already on cards
                {drivers
                  .filter((d) => d.cardId)
                  .slice(0, 4)
                  .map((d) => {
                    const num = cards?.find((c) => c.cardId === d.cardId)?.cardNumber ?? d.cardId;
                    return ` · ${num}${d.driverName ? ` (${d.driverName})` : ''}`;
                  })
                  .join('')}
                {drivers.length > 4 ? '…' : ''}
              </div>
            )}
          </div>
          <div>
            <span style={s(label)}>Driver name</span>
            <input
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="Full name"
              style={s(field)}
            />
          </div>
        </>
      )}

      {isDriver && !ownerReady && (
        <div style={s('font-size:12px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
          Generate the owner user registration link first. After the owner user registers in Telegram, Driver unlocks so you can invite per card number.
        </div>
      )}

      {blocker && isOwnerLike && (
        <div style={s('font-size:12px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
          {blocker}
        </div>
      )}
      {blocker && isDriver && ownerReady && (
        <div style={s('font-size:12px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
          {blocker}
        </div>
      )}

      {(isOwnerLike || ownerReady) && (
        <button
          type="submit"
          disabled={busy || !valid}
          className="ss-btn-p"
          style={s(`height:40px;border:none;border-radius:var(--radius-md);background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:${busy || !valid ? 'default' : 'pointer'};opacity:${busy || !valid ? '.55' : '1'};display:flex;align-items:center;justify-content:center;gap:8px`)}
        >
          <Icon name="link" size={16} color="#fff" />
          {busy ? 'Generating…' : 'Generate registration link'}
        </button>
      )}

      {inviteUrl && (
        <div style={s(tile)}>
          <div style={s('font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em')}>Registration link</div>
          <div style={s("font-size:12px;font-family:'JetBrains Mono',monospace;color:var(--text2);margin-top:8px;word-break:break-all;line-height:1.45")}>{inviteUrl}</div>
          <button
            type="button"
            onClick={() => void copyLink()}
            style={s('margin-top:12px;height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:12px;cursor:pointer;display:inline-flex;align-items:center;gap:7px')}
          >
            <Icon name="copy" size={14} />
            Copy link
          </button>
        </div>
      )}
    </form>
  );
}
