/**
 * Client Management — generate Telegram registration links for owner / driver.
 * Driver is a child of the owner: only available after an active owner registration exists,
 * and each driver is tied to one carrier fuel card (by card number).
 */
import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';

import {
  createCarrierInvitation,
  getCarrierRegistrations,
  listCards,
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

  const isOwner = profile === 'owner';

  const [cards, setCards] = useState<DwhCard[] | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsError, setCardsError] = useState('');

  const [owner, setOwner] = useState<RegisteredCompany | null | undefined>(undefined);
  const [drivers, setDrivers] = useState<RegisteredCompany[]>([]);
  const [regsBusy, setRegsBusy] = useState(false);
  const [regsError, setRegsError] = useState('');
  const [regsTick, setRegsTick] = useState(0);

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

  const valid = isOwner
    ? carrierId.trim().length > 0
    : ownerReady
      && carrierId.trim().length > 0
      && cardId.trim().length > 0
      && driverName.trim().length > 0;

  const blocker = !valid
    ? !carrierId.trim()
      ? 'This client has no carrier id — cannot generate a link.'
      : !isOwner && !ownerReady
        ? 'Register the owner user first — drivers can only be created under an active owner user.'
        : !isOwner && !cardId.trim()
          ? 'Pick the carrier card number this driver is for.'
          : !isOwner && !driverName.trim()
            ? "Enter the driver's name."
            : ''
    : '';

  async function generateInvite(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    if (!isOwner && !ownerReady) {
      pushToast('Owner required', 'Register the owner user before inviting a driver.');
      return;
    }
    setBusy(true);
    try {
      const actingAs = getImpersonation();
      const worker = getSession()?.worker;
      const agentName = actingAs?.name?.trim() || worker?.userName?.trim() || undefined;
      const agentZohoUserId = actingAs?.zohoUserId?.trim() || worker?.zohoUserId?.trim() || undefined;
      const res = await createCarrierInvitation({
        profile,
        carrierId: carrierId.trim(),
        ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
        ...(!isOwner && cardId.trim() ? { cardId: cardId.trim() } : {}),
        ...(!isOwner && driverName.trim() ? { driverName: driverName.trim() } : {}),
        ...(agentName ? { agentName } : {}),
        ...(agentZohoUserId ? { agentZohoUserId } : {}),
      });
      setInviteUrl(res.inviteUrl);
      pushToast('Link ready', `${isOwner ? 'Owner' : 'Driver'} registration link generated.`);
      if (isOwner) setRegsTick((n) => n + 1);
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
        <div style={s(`margin-top:10px;font-size:12px;font-weight:700;color:${ownerReady ? 'var(--ok)' : 'var(--warn)'}`)}>
          {ownerStatusLabel}
          {ownerReady && owner?.telegramUsername ? ` · @${owner.telegramUsername}` : ''}
        </div>
      </div>

      <div>
        <span style={s(label)}>Profile</span>
        <div style={s('display:flex;gap:8px')}>
          <button
            type="button"
            onClick={() => setProfile('owner')}
            style={s(`flex:1;height:38px;border-radius:var(--radius-md);border:1px solid ${isOwner ? 'var(--accent)' : 'var(--border)'};background:${isOwner ? 'rgba(var(--accent-rgb),.12)' : 'var(--alt)'};color:${isOwner ? 'var(--accent)' : 'var(--text2)'};font-weight:700;font-size:13px;cursor:pointer`)}
          >
            Owner
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
            style={s(`flex:1;height:38px;border-radius:var(--radius-md);border:1px solid ${!isOwner ? 'var(--accent)' : 'var(--border)'};background:${!isOwner ? 'rgba(var(--accent-rgb),.12)' : 'var(--alt)'};color:${!isOwner ? 'var(--accent)' : 'var(--text2)'};font-weight:700;font-size:13px;cursor:${ownerReady ? 'pointer' : 'default'};opacity:${ownerReady ? '1' : '.45'}`)}
          >
            Driver
          </button>
        </div>
        <div style={s('font-size:12px;color:var(--muted);margin-top:8px;line-height:1.45')}>
          {isOwner
            ? 'Owner user link — fleet access for all cards. Drivers unlock after this owner user finishes registration.'
            : 'Driver user link — child of the owner user, tied to one carrier card number.'}
        </div>
      </div>

      {!isOwner && ownerReady && (
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

      {!isOwner && !ownerReady && (
        <div style={s('font-size:12px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
          Generate the owner user registration link first. After the owner user registers in Telegram, Driver unlocks so you can invite per card number.
        </div>
      )}

      {blocker && isOwner && (
        <div style={s('font-size:12px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
          {blocker}
        </div>
      )}
      {blocker && !isOwner && ownerReady && (
        <div style={s('font-size:12px;color:var(--warn);padding:10px 12px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--warn) 12%,transparent);border:1px solid color-mix(in srgb,var(--warn) 28%,var(--border))')}>
          {blocker}
        </div>
      )}

      {(isOwner || ownerReady) && (
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
