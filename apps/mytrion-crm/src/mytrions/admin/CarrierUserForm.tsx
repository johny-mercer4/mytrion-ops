import { useEffect, useState, type FormEvent } from 'react';
import {
  createCarrierInvitation,
  listCards,
  searchClients,
  searchOperators,
  type CarrierProfile,
  type DwhCard,
  type DwhClient,
  type DwhOperator,
} from '../../api/carrierUsers';
import { BuildingIcon, PersonIcon, SearchIcon, SendArrowIcon } from '../../components/icons';
import { copyToClipboard } from './carrierUserUtil';
import s from './admin.module.css';

/**
 * The "New carrier user" form — both owners and drivers are provisioned as a Telegram invite
 * link now, no login/password anywhere: the bot's mini-app handles sign-in on open. Step 2 (pick
 * a client from the DWH directory, or enter carrier/application id manually) is shared by both
 * profiles; a driver additionally picks the one active fuel card the invite is for, listed
 * straight from servercrm.
 */
export function CarrierUserForm({
  onInviteCreated,
  onError,
}: {
  onInviteCreated: (inviteUrl: string) => void;
  onError: (message: string) => void;
}) {
  const [profile, setProfile] = useState<CarrierProfile>('owner');
  const [picked, setPicked] = useState<DwhClient | null>(null);
  const [manual, setManual] = useState(false);
  const [carrierId, setCarrierId] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [cardId, setCardId] = useState('');
  const [driverName, setDriverName] = useState('');
  const [busy, setBusy] = useState(false);
  const [inviteUrl, setInviteUrl] = useState('');

  const isOwner = profile === 'owner';

  // Reset everything tied to "which client" when switching profile — a driver invite under the
  // wrong owner's carrier would be a real mistake, not just a UI nicety.
  useEffect(() => {
    setPicked(null);
    setManual(false);
    setCarrierId('');
    setApplicationId('');
    setCompanyName('');
    setCardId('');
    setDriverName('');
    setInviteUrl('');
  }, [profile]);

  // ── DWH client search: debounced, newest applications first. Shared by owner + driver. ──
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<DwhClient[] | null>(null);
  const [clientBusy, setClientBusy] = useState(false);
  const [clientError, setClientError] = useState('');
  useEffect(() => {
    if (picked || manual) return;
    const q = clientQuery.trim();
    if (q.length < 2) {
      setClientResults(null);
      setClientError('');
      return;
    }
    setClientBusy(true);
    const timer = setTimeout(() => {
      searchClients(q, 15)
        .then((clients) => {
          setClientResults(clients);
          setClientError('');
        })
        .catch((e: unknown) => setClientError(e instanceof Error ? e.message : String(e)))
        .finally(() => setClientBusy(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [clientQuery, picked, manual]);

  function pickClient(c: DwhClient) {
    setPicked(c);
    setCarrierId(c.carrierId ?? '');
    setApplicationId(c.applicationId ?? '');
    setCompanyName(c.companyName ?? '');
    setClientResults(null);
    setClientQuery('');
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
  useEffect(() => {
    setOperator(undefined);
    if (!isOwner) return;
    const cid = carrierId.trim();
    if (!cid) return;
    setOperatorBusy(true);
    const timer = setTimeout(() => {
      searchOperators(cid, 5)
        .then((ops) => setOperator(ops.find((o) => o.carrierId === cid) ?? null))
        .catch(() => setOperator(null))
        .finally(() => setOperatorBusy(false));
    }, 300);
    return () => clearTimeout(timer);
  }, [carrierId, isOwner]);

  // ── active fuel cards for the picked carrier — owners just need the COUNT (company-type
  // detection: 1 = owner-operator, 2+ = fleet-manager, no explicit field for this exists in
  // servercrm/DWH); a driver picks ONE specific card from the same list. ──
  const [cards, setCards] = useState<DwhCard[] | null>(null);
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardManual, setCardManual] = useState(false);
  useEffect(() => {
    setCards(null);
    setCardManual(false);
    setCardId('');
    const cid = carrierId.trim();
    if (!cid) return;
    setCardsBusy(true);
    listCards(cid)
      .then(setCards)
      .catch(() => setCards([]))
      .finally(() => setCardsBusy(false));
  }, [carrierId]);
  const cardCount = cards?.length ?? null;
  // 0 cards is undetermined, not "owner-operator" — mirrors the backend's own detection rule
  // (src/modules/carrier/inviteService.ts) so the preview never shows the picked-a-type message
  // and the "no active cards" warning at the same time.
  const companyType =
    cardCount === null || cardCount === 0 ? null : cardCount === 1 ? 'owner-operator' : 'fleet-manager';

  const hasTie = carrierId.trim().length > 0 || applicationId.trim().length > 0;
  const valid = isOwner ? hasTie : hasTie && cardId.trim().length > 0 && driverName.trim().length > 0;

  const blocker = !valid
    ? !hasTie
      ? 'Pick a client (or enter a carrier / application id manually).'
      : !isOwner && !cardId.trim()
        ? 'Pick the card this driver is for.'
        : !isOwner && !driverName.trim()
          ? "Enter the driver's name."
          : ''
    : '';

  async function generateInvite(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    try {
      const res = await createCarrierInvitation({
        profile,
        ...(carrierId.trim() ? { carrierId: carrierId.trim() } : {}),
        ...(applicationId.trim() ? { applicationId: applicationId.trim() } : {}),
        ...(companyName.trim() ? { companyName: companyName.trim() } : {}),
        ...(!isOwner && cardId.trim() ? { cardId: cardId.trim() } : {}),
        ...(!isOwner && driverName.trim() ? { driverName: driverName.trim() } : {}),
      });
      setInviteUrl(res.inviteUrl);
      copyToClipboard(res.inviteUrl);
      onInviteCreated(res.inviteUrl);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${s.card} ${s.cardPad} ${s.formSteps}`} onSubmit={(e) => void generateInvite(e)}>
      {/* Step 1 — account type */}
      <div className={s.formStep}>
        <div className={s.eyebrow}>Account type</div>
        <div className={s.toggleRow} role="radiogroup" aria-label="Account type">
          <button type="button" role="radio" aria-checked={isOwner} className={`${s.toggle} ${isOwner ? s.toggleOn : ''}`} onClick={() => setProfile('owner')}>
            <BuildingIcon size={13} />
            Owner
          </button>
          <button type="button" role="radio" aria-checked={!isOwner} className={`${s.toggle} ${!isOwner ? s.toggleOn : ''}`} onClick={() => setProfile('driver')}>
            <PersonIcon size={13} />
            Driver
          </button>
        </div>
        <p className={s.fieldHint}>
          {isOwner
            ? 'Owner-operator (one card, drives it themself) or fleet-manager (multiple drivers/cards) — auto-detected below.'
            : 'One driver, tied to one specific card.'}
        </p>
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

        {!picked && !manual && (
          <>
            <div style={{ position: 'relative' }}>
              <label className={s.search} style={{ margin: 0 }}>
                <SearchIcon size={14} />
                <input
                  className={s.searchInput}
                  value={clientQuery}
                  onChange={(e) => setClientQuery(e.target.value)}
                  placeholder="Search your clients — company name, carrier id, or application id"
                  autoComplete="off"
                />
                {clientBusy && <span className={s.chipMeta}>searching…</span>}
              </label>
              {clientResults && (
                <div className={s.clientPick} role="listbox" aria-label="Matching clients">
                  {clientResults.map((c, i) => (
                    <button
                      key={`${c.carrierId ?? ''}:${c.applicationId ?? ''}:${i}`}
                      type="button"
                      role="option"
                      aria-selected="false"
                      className={s.clientPickRow}
                      onClick={() => pickClient(c)}
                    >
                      <span className={s.docTitle}>{c.companyName ?? '(unnamed deal)'}</span>
                      <span className={s.checkMeta}>
                        {c.carrierId ? `carrier ${c.carrierId}` : 'no carrier yet'}
                        {c.applicationId ? ` · app ${c.applicationId}` : ''}
                        {c.applicationDate ? ` · applied ${c.applicationDate}` : ''}
                        {c.stage ? ` · ${c.stage}` : ''}
                      </span>
                    </button>
                  ))}
                  {clientResults.length === 0 && <div className={s.none}>No clients match.</div>}
                </div>
              )}
            </div>
            {clientError && <p className={s.errorNote}>{clientError}</p>}
            <p className={s.fieldHint}>
              Newest applications first.{' '}
              <button type="button" className={s.linkBtn} onClick={() => setManual(true)}>
                Enter the details manually instead
              </button>
            </p>
          </>
        )}

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
            {!operatorBusy && operator && (
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
            {!operatorBusy && operator === null && (
              <span className={s.cellSub}>No existing servercrm login for this carrier.</span>
            )}
          </div>
        )}

        {isOwner && carrierId.trim() && (
          <div className={s.pickedCard}>
            {cardsBusy && <span className={s.chipMeta}>checking active cards…</span>}
            {!cardsBusy && companyType && (
              <div className={s.cellStack}>
                <span className={`${s.pill} ${companyType === 'fleet-manager' ? s.pillInfo : s.pillNeutral}`}>
                  {companyType === 'fleet-manager' ? (
                    <>
                      <BuildingIcon size={11} />
                      Fleet manager
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
            {!cardsBusy && cardCount === 0 && (
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
                    {cardsBusy ? 'Loading cards…' : cards && cards.length > 0 ? 'Choose a card…' : 'No active cards found'}
                  </option>
                  {cards?.map((c) => (
                    <option key={c.cardId} value={c.cardId ?? ''}>
                      {c.cardNumber ? `•••• ${c.cardNumber.slice(-4)}` : c.cardId} — {c.status ?? '?'}
                      {c.cardType ? ` · ${c.cardType}` : ''}
                    </option>
                  ))}
                </select>
                <span className={s.fieldHint}>
                  From servercrm — no driver name lives on the card, so pick by number.{' '}
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
        {!isOwner && carrierId.trim() && (
          <div className={s.field}>
            <span className={s.fieldLabel}>Driver name</span>
            <input
              className={s.input}
              value={driverName}
              onChange={(e) => setDriverName(e.target.value)}
              placeholder="e.g. Akmal Karimov"
              maxLength={200}
            />
            <span className={s.fieldHint}>Who drives this card — shown on the fleet roster.</span>
          </div>
        )}
        {!isOwner && !carrierId.trim() && (
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
          <button type="submit" className={s.primaryBtn} disabled={!valid || busy}>
            <SendArrowIcon size={13} />
            {busy ? 'Generating…' : 'Generate registration link'}
          </button>
          {blocker && <span className={s.fieldHint}>{blocker}</span>}
        </div>
      )}
    </form>
  );
}
