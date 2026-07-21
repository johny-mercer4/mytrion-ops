import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import {
  createCarrierInvitation,
  listCards,
  searchOperators,
  type CarrierProfile,
  type DwhCard,
  type DwhClient,
  type DwhOperator,
} from '../../api/carrierUsers';
import { getImpersonation } from '../../api/impersonation';
import { getSession } from '../../api/session';
import { BuildingIcon, PersonIcon, SendArrowIcon } from '../../components/icons';
import { copyToClipboard } from './carrierUserUtil';
import { ClientCombobox } from './ClientCombobox';
import { RadioToggleGroup } from './RadioToggleGroup';
import { adminToast } from './toast';
import s from './admin.module.css';

/** Seed values for a fresh link — used to reissue an invite that expired or was cancelled. */
export interface InviteDraft {
  profile: CarrierProfile;
  carrierId: string;
  applicationId: string;
  companyName: string;
  cardId: string;
  driverName: string;
}

/**
 * The "New carrier user" form — both owners and drivers are provisioned as a Telegram invite
 * link now, no login/password anywhere: the bot's mini-app handles sign-in on open. Step 2 (pick
 * a client from the DWH directory, or enter carrier/application id manually) is shared by both
 * profiles; a driver additionally picks the one active fuel card the invite is for, listed
 * straight from servercrm.
 */
export function CarrierUserForm({ onInviteCreated, initial }: { onInviteCreated: () => void; initial?: InviteDraft }) {
  const [profile, setProfile] = useState<CarrierProfile>(initial?.profile ?? 'owner');
  const [picked, setPicked] = useState<DwhClient | null>(null);
  // A reissued draft opens straight into manual entry: its ids came from the dead invite, not from
  // a client the agent picked, and they need to be visible and editable.
  const [manual, setManual] = useState(Boolean(initial));
  const [carrierId, setCarrierId] = useState(initial?.carrierId ?? '');
  const [applicationId, setApplicationId] = useState(initial?.applicationId ?? '');
  const [companyName, setCompanyName] = useState(initial?.companyName ?? '');
  const [cardId, setCardId] = useState(initial?.cardId ?? '');
  const [driverName, setDriverName] = useState(initial?.driverName ?? '');
  const [ttlHours, setTtlHours] = useState(168); // 7 days — matches the backend's own default
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  // Owner-LIKE: a manager is owner-equivalent — needs only a client tie, no card. Only a driver is
  // card-bound. Every card-gating / lookup branch below keys off this, so manager == owner here.
  const isDriver = profile === 'driver';
  const isManager = profile === 'manager';
  const isOwner = !isDriver;

  // Reset everything tied to "which client" when switching profile — a driver invite under the
  // wrong owner's carrier would be a real mistake, not just a UI nicety. Keyed off the previous
  // value rather than the effect firing, so a prefilled mount doesn't wipe its own draft.
  const prevProfile = useRef(profile);
  useEffect(() => {
    if (prevProfile.current === profile) return;
    prevProfile.current = profile;
    setPicked(null);
    setManual(false);
    setCarrierId('');
    setApplicationId('');
    setCompanyName('');
    setCardId('');
    setDriverName('');
    setInviteUrl('');
  }, [profile]);

  const blockerId = `${useId()}-blocker`;

  function pickClient(c: DwhClient) {
    setPicked(c);
    setCarrierId(c.carrierId ?? '');
    setApplicationId(c.applicationId ?? '');
    setCompanyName(c.companyName ?? '');
  }

  function clearClient() {
    setPicked(null);
    setCarrierId('');
    setApplicationId('');
    setCompanyName('');
  }

  // ── servercrm operator lookup (owners): once a carrier id is known, show whether servercrm
  // already has a login on file — informational only (no login field to bind it into; the
  // invite's mini-app handles auth) ──
  const [operator, setOperator] = useState<DwhOperator | null | undefined>(undefined); // undefined = not searched
  const [operatorBusy, setOperatorBusy] = useState(false);
  // A failed lookup must not collapse into `null`: "no login on file" is a fact about the carrier
  // that changes what the agent does next, and a network error is not that fact.
  const [operatorError, setOperatorError] = useState('');
  useEffect(() => {
    setOperator(undefined);
    setOperatorError('');
    const cid = carrierId.trim();
    if (!isOwner || !cid) {
      setOperatorBusy(false);
      return;
    }
    setOperatorBusy(true);
    const ac = new AbortController();
    const timer = setTimeout(() => {
      searchOperators(cid, 5, ac.signal)
        .then((ops) => setOperator(ops.find((o) => o.carrierId === cid) ?? null))
        .catch((e: unknown) => {
          if (!ac.signal.aborted) setOperatorError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!ac.signal.aborted) setOperatorBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [carrierId, isOwner]);

  // ── active fuel cards for the picked carrier — owners just need the COUNT (company-type
  // detection: 1 = owner-operator, 2+ = fleet-manager, no explicit field for this exists in
  // servercrm/DWH); a driver picks ONE specific card from the same list. ──
  const [cards, setCards] = useState<DwhCard[] | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardManual, setCardManual] = useState(false);
  // Same reason as operatorError: a failed card list used to land as `[]`, which reads as "this
  // carrier has no cards" — and that drives both the company-type badge and the driver's card
  // picker. Left null on failure, so cardCount/companyType stay undetermined rather than wrong.
  const [cardsError, setCardsError] = useState('');
  const [cardsReload, setCardsReload] = useState(0);
  // Same previous-value guard as the profile reset: on a prefilled mount the carrier id is already
  // set, and an unconditional clear here would drop the draft's card before the list even loads.
  const prevCarrier = useRef(carrierId);
  useEffect(() => {
    setCards(null);
    setCardsError('');
    if (prevCarrier.current !== carrierId) {
      prevCarrier.current = carrierId;
      setCardManual(false);
      setCardId('');
    }
    const cid = carrierId.trim();
    if (!cid) {
      setCardsBusy(false);
      return;
    }
    setCardsBusy(true);
    const ac = new AbortController();
    // Debounced like the lookups above: in manual entry this reruns on every keystroke of the
    // carrier id, and an unaborted list could still land after the id had moved on.
    const timer = setTimeout(() => {
      listCards(cid, 100, ac.signal)
        .then(setCards)
        .catch((e: unknown) => {
          if (!ac.signal.aborted) setCardsError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (!ac.signal.aborted) setCardsBusy(false);
        });
    }, 300);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [carrierId, cardsReload]);
  const cardCount = cards?.length ?? null;
  // 0 cards is undetermined, not "owner-operator" — mirrors the backend's own detection rule
  // (src/modules/carrier/inviteService.ts) so the preview never shows the picked-a-type message
  // and the "no active cards" warning at the same time.
  const companyType =
    cardCount === null || cardCount === 0 ? null : cardCount === 1 ? 'owner-operator' : 'fleet-manager';

  const hasTie = carrierId.trim().length > 0 || applicationId.trim().length > 0;
  // A manager needs a tie + a name (no card); a driver needs a tie + card + name; an owner just a tie.
  const valid = isDriver
    ? hasTie && cardId.trim().length > 0 && driverName.trim().length > 0
    : isManager
      ? hasTie && driverName.trim().length > 0
      : hasTie;

  const blocker = !valid
    ? !hasTie
      ? 'Pick a client (or enter a carrier / application id manually).'
      : isDriver && !cardId.trim()
        ? 'Pick the card this driver is for.'
        : (isDriver || isManager) && !driverName.trim()
          ? isManager ? "Enter the manager's name." : "Enter the driver's name."
          : ''
    : '';

  async function generateInvite(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    try {
      const actingAs = getImpersonation();
      const worker = getSession()?.worker;
      const agentName = actingAs?.name?.trim() || worker?.userName?.trim() || undefined;
      const agentZohoUserId = actingAs?.zohoUserId?.trim() || worker?.zohoUserId?.trim() || undefined;
      const res = await createCarrierInvitation({
        profile,
        ...(carrierId.trim() ? { carrierId: carrierId.trim() } : {}),
        ...(applicationId.trim() ? { applicationId: applicationId.trim() } : {}),
        ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
        ...(isDriver && cardId.trim() ? { cardId: cardId.trim() } : {}),
        ...((isDriver || isManager) && driverName.trim() ? { driverName: driverName.trim() } : {}),
        ...(agentName ? { agentName } : {}),
        ...(agentZohoUserId ? { agentZohoUserId } : {}),
        ttlHours,
      });
      setInviteUrl(res.inviteUrl);
      // The link itself is fine either way — only the clipboard hop can fail, and the field below
      // still holds it, so that's a warning rather than an error.
      if (await copyToClipboard(res.inviteUrl)) {
        adminToast.success('Registration link generated', 'Copied to your clipboard.');
      } else {
        adminToast.warning('Registration link generated', 'The clipboard was blocked — copy it from the field below.');
      }
      onInviteCreated();
    } catch (err) {
      adminToast.error('Could not generate the link', err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${s.card} ${s.cardPad} ${s.formSteps}`} onSubmit={(e) => void generateInvite(e)}>
      {/* Step 1 — account type */}
      <div className={s.formStep}>
        <div className={s.eyebrow}>Account type</div>
        <RadioToggleGroup
          label="Account type"
          value={profile}
          onChange={setProfile}
          options={[
            {
              value: 'owner',
              label: (
                <>
                  <BuildingIcon size={13} />
                  Owner
                </>
              ),
            },
            {
              value: 'manager',
              label: (
                <>
                  <BuildingIcon size={13} />
                  Manager
                </>
              ),
            },
            {
              value: 'driver',
              label: (
                <>
                  <PersonIcon size={13} />
                  Driver
                </>
              ),
            },
          ]}
        />
        <p className={s.fieldHint}>
          {profile === 'manager'
            ? 'A colleague with owner-level company access (fleet, drivers, finances) — no card, tied to the carrier.'
            : isOwner
              ? 'Owner-operator (one card, drives it themself) or company owner (multiple drivers/cards) — auto-detected below.'
              : 'One driver, tied to one specific card.'}
        </p>
      </div>

      {/* Step 1b — link expiry */}
      <div className={s.formStep}>
        <div className={s.eyebrow}>Link expires in</div>
        <RadioToggleGroup
          label="Link expiry"
          value={ttlHours}
          onChange={setTtlHours}
          options={[
            { value: 24, label: '24 hours' },
            { value: 72, label: '3 days' },
            { value: 168, label: '7 days' },
          ]}
        />
      </div>

      {/* Step 2 — which client */}
      <div className={s.formStep}>
        <div className={s.eyebrow}>Which client</div>

        {picked && (
          <div className={s.pickedCard}>
            <div className={s.cellStack}>
              <span className={s.docTitle}>{picked.companyName ?? '(unnamed client)'}</span>
              <span className={s.cellSub}>
                {picked.carrierId ? `carrier ${picked.carrierId}` : 'no carrier yet — will be populated later'}
                {picked.applicationId ? ` · application ${picked.applicationId}` : ''}
                {picked.applicationDate ? ` · applied ${picked.applicationDate}` : ''}
                {picked.stage ? ` · ${picked.stage}` : ''}
              </span>
            </div>
            <button type="button" className={s.miniBtn} onClick={clearClient}>
              Change
            </button>
          </div>
        )}

        {!picked && !manual && <ClientCombobox onPick={pickClient} onManual={() => setManual(true)} />}

        {!picked && manual && (
          <>
            <div className={s.formGrid}>
              <div className={s.field}>
                <span className={s.fieldLabel}>Company name</span>
                <input className={s.input} value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="Acme Transport LLC" />
              </div>
              <div className={s.field}>
                <span className={s.fieldLabel}>Carrier Id</span>
                <input className={`${s.input} ${s.mono}`} value={carrierId} onChange={(e) => setCarrierId(e.target.value)} placeholder="5758544" />
              </div>
              <div className={s.field}>
                <span className={s.fieldLabel}>Application Id</span>
                <input className={`${s.input} ${s.mono}`} value={applicationId} onChange={(e) => setApplicationId(e.target.value)} placeholder="892408" />
                <span className={s.fieldHint}>At least one id — application works before the carrier exists.</span>
              </div>
            </div>
            <p className={s.fieldHint}>
              <button type="button" className={s.linkBtn} onClick={() => setManual(false)}>
                ← Back to client search
              </button>
            </p>
          </>
        )}

        {isOwner && carrierId.trim() && (
          <div className={s.pickedCard}>
            {operatorBusy && <span className={s.chipMeta}>checking servercrm for an existing login…</span>}
            {!operatorBusy && operatorError && (
              <span className={s.cellSub}>Couldn't check servercrm for an existing login — {operatorError}</span>
            )}
            {!operatorBusy && !operatorError && operator && (
              <div className={s.cellStack}>
                <span className={s.docTitle}>Existing servercrm login on file</span>
                <span className={s.cellSub}>
                  {operator.username ?? 'no username on file'}
                  {operator.ownerFirstName ? ` · ${operator.ownerFirstName} ${operator.ownerLastName ?? ''}` : ''}
                  {operator.phoneNumber ? ` · ${operator.phoneNumber}` : ''}
                  {!operator.enabled ? ' · disabled in servercrm' : ''}
                </span>
              </div>
            )}
            {!operatorBusy && !operatorError && operator === null && (
              <span className={s.cellSub}>No existing servercrm login for this carrier.</span>
            )}
          </div>
        )}

        {isOwner && carrierId.trim() && (
          <div className={s.pickedCard}>
            {cardsBusy && <span className={s.chipMeta}>checking active cards…</span>}
            {!cardsBusy && cardsError && (
              <span className={s.cellSub}>
                Couldn't read the card list — {cardsError}{' '}
                <button type="button" className={s.linkBtn} onClick={() => setCardsReload((n) => n + 1)}>
                  Retry
                </button>
              </span>
            )}
            {!cardsBusy && !cardsError && companyType && (
              <div className={s.cellStack}>
                <span className={`${s.pill} ${companyType === 'fleet-manager' ? s.pillInfo : s.pillNeutral}`}>
                  {companyType === 'fleet-manager' ? (
                    <>
                      <BuildingIcon size={11} />
                      Company owner
                    </>
                  ) : (
                    <>
                      <PersonIcon size={11} />
                      Owner-operator
                    </>
                  )}
                </span>
                <span className={s.cellSub}>
                  {cardCount} active card{cardCount === 1 ? '' : 's'} on servercrm.
                  {companyType === 'fleet-manager'
                    ? ' The mini-app will show every truck, driver, and card.'
                    : ' The mini-app will show just this one card.'}
                </span>
              </div>
            )}
            {!cardsBusy && !cardsError && cardCount === 0 && (
              <span className={s.cellSub}>No active cards found for this carrier yet.</span>
            )}
          </div>
        )}

        {!isOwner && carrierId.trim() && (
          <div className={s.field}>
            <span className={s.fieldLabel}>Card</span>
            {!cardManual ? (
              <>
                <select
                  className={s.select}
                  value={cardId}
                  onChange={(e) => setCardId(e.target.value)}
                  disabled={cardsBusy}
                >
                  <option value="">
                    {cardsBusy
                      ? 'Loading cards…'
                      : cardsError
                        ? 'Card list unavailable'
                        : cards && cards.length > 0
                          ? 'Choose a card…'
                          : 'No active cards found'}
                  </option>
                  {cards?.map((c) => (
                    <option key={c.cardId} value={c.cardId ?? ''}>
                      {c.cardNumber ? `•••• ${c.cardNumber.slice(-4)}` : c.cardId} — {c.status ?? '?'}
                    </option>
                  ))}
                </select>
                <span className={s.fieldHint}>
                  {cardsError ? (
                    <>
                      Couldn't read the card list — {cardsError}{' '}
                      <button type="button" className={s.linkBtn} onClick={() => setCardsReload((n) => n + 1)}>
                        Retry
                      </button>{' '}
                    </>
                  ) : (
                    'From servercrm — no driver name lives on the card, so pick by number. '
                  )}
                  <button type="button" className={s.linkBtn} onClick={() => setCardManual(true)}>
                    Enter a card id manually
                  </button>
                </span>
              </>
            ) : (
              <>
                <input className={`${s.input} ${s.mono}`} value={cardId} onChange={(e) => setCardId(e.target.value)} placeholder="card id" />
                <span className={s.fieldHint}>
                  The one card this driver can see.{' '}
                  <button type="button" className={s.linkBtn} onClick={() => setCardManual(false)}>
                    Back to card list
                  </button>
                </span>
              </>
            )}
          </div>
        )}
        {(isDriver || isManager) && carrierId.trim() && (
          <div className={s.field}>
            <span className={s.fieldLabel}>{isManager ? 'Manager name' : 'Driver name'}</span>
            <input
              className={s.input}
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="e.g. Akmal Karimov"
              maxLength={200}
            />
            <span className={s.fieldHint}>
              {isManager ? 'Who this manager is — shown on the roster and to the support bot.' : 'Who drives this card — shown on the fleet roster.'}
            </span>
          </div>
        )}
        {isDriver && !carrierId.trim() && (
          <p className={s.fieldHint}>Pick the client above first — the card list comes from their carrier.</p>
        )}
      </div>

      <p className={s.fieldHint}>
        No login/password — the {isOwner ? 'owner' : 'driver'} opens this link in Telegram, and the mini-app handles sign-in.
      </p>

      {inviteUrl ? (
        <div className={s.inlineRow}>
          <input className={`${s.input} ${s.mono}`} readOnly value={inviteUrl} onFocus={(e) => e.currentTarget.select()} />
          <button type="button" className={s.ghostBtn} onClick={() => copyToClipboard(inviteUrl)}>
            Copy
          </button>
          <button type="button" className={s.ghostBtn} onClick={() => setInviteUrl('')}>
            Generate another
          </button>
        </div>
      ) : (
        <div className={s.inlineRow}>
          {/* Enabled even when invalid: a disabled button is unfocusable, so a screen reader user
              could never reach the reason it was disabled. submit is gated in generateInvite. */}
          <button
            type="submit"
            className={s.primaryBtn}
            disabled={busy}
            aria-disabled={!valid}
            aria-describedby={blockerId}
          >
            <SendArrowIcon size={13} />
            {busy ? 'Generating…' : 'Generate registration link'}
          </button>
          <span className={s.fieldHint} id={blockerId} role="status">
            {blocker}
          </span>
        </div>
      )}
    </form>
  );
}
