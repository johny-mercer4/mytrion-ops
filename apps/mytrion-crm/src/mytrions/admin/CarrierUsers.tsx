import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createCarrierUser,
  deleteCarrierUser,
  listCarrierUsers,
  populateCarrier,
  searchClients,
  updateCarrierUser,
  type CarrierProfile,
  type CarrierUser,
  type DwhClient,
} from '../../api/carrierUsers';
import { listAgents, type AgentUser } from '../../api/agents';
import { PlusIcon, SearchIcon, XIcon } from '../../components/icons';
import s from './admin.module.css';

const COLS = { gridTemplateColumns: '1.5fr 0.75fr 1.05fr 1.05fr 1fr 0.7fr 1.35fr' } as const;

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

function copyToClipboard(text: string): void {
  try {
    void navigator.clipboard?.writeText(text);
  } catch {
    /* clipboard unavailable — the value is still shown in the notice */
  }
}

/**
 * Carrier User Management — login/password accounts that give CARRIER COMPANIES access to
 * Mytrion Ops (audience 'customer'; future Telegram mini-app + the /client page).
 * Owner (fleet): tied to the carrier/application id — sees every card of the carrier.
 * Driver: child of an owner, tied to ONE card. Owners are provisioned by PICKING a client
 * from the DWH directory (manual entry is the fallback).
 */
export function CarrierUsers() {
  const [users, setUsers] = useState<CarrierUser[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await listCarrierUsers({ limit: 200 });
      setUsers(res.users);
      setTotal(res.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const byId = useMemo(() => new Map(users.map((u) => [u.id, u])), [users]);
  const owners = useMemo(() => users.filter((u) => u.profile === 'owner'), [users]);

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [u.companyName ?? '', u.carrierId ?? '', u.applicationId ?? '', u.login, u.agentName ?? '', u.profile, u.cardId ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  async function toggleStatus(u: CarrierUser) {
    try {
      const next = u.status === 'active' ? 'disabled' : 'active';
      const res = await updateCarrierUser(u.id, { status: next });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
      if (u.profile === 'owner' && next === 'disabled') {
        setNotice(`Owner ${u.login} disabled — its drivers can no longer sign in.`);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function resetPassword(u: CarrierUser) {
    const password = generatePassword();
    if (!window.confirm(`Reset the password for "${u.login}"? The new password will be shown once.`)) return;
    try {
      await updateCarrierUser(u.id, { password });
      copyToClipboard(password);
      setNotice(`New password for ${u.login}: ${password} — copied to your clipboard. It is not stored in plain text.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  /** Back-fill the carrier id — for the whole application family when one exists. */
  async function setCarrier(u: CarrierUser) {
    const carrierId = window.prompt(
      u.applicationId
        ? `Carrier id for application ${u.applicationId} (back-fills every account under it):`
        : `Carrier id for ${u.login}:`,
    )?.trim();
    if (!carrierId) return;
    try {
      if (u.applicationId) {
        const res = await populateCarrier(u.applicationId, carrierId);
        setNotice(`Carrier ${carrierId} populated on ${res.count} account(s) under application ${u.applicationId}.`);
      } else {
        await updateCarrierUser(u.id, { carrierId });
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function setCard(u: CarrierUser) {
    const cardId = window.prompt(`Card for driver ${u.login} (the RBAC tie + limits):`, u.cardId ?? '')?.trim();
    if (cardId === undefined || cardId === '') return;
    try {
      const res = await updateCarrierUser(u.id, { cardId });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function remove(u: CarrierUser) {
    if (!window.confirm(`Delete carrier user "${u.login}"? Their login stops working immediately.`)) return;
    try {
      await deleteCarrierUser(u.id);
      setUsers((prev) => prev.filter((x) => x.id !== u.id));
      setTotal((t) => t - 1);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div className={`${s.panel} ${s.panelWide}`}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Carrier User Management</h2>
          <p className={s.sub}>Give carrier companies login access — fleet owners see every card, drivers see one.</p>
        </div>
        {showForm ? (
          <button type="button" className={s.ghostBtn} onClick={() => setShowForm(false)}>
            <XIcon size={11} /> Cancel
          </button>
        ) : (
          <button type="button" className={s.primaryBtn} onClick={() => setShowForm(true)}>
            <PlusIcon size={14} />
            New carrier user
          </button>
        )}
      </div>

      {showForm && (
        <CreateForm
          owners={owners}
          onCreated={(user, password) => {
            setUsers((prev) => [user, ...prev]);
            setTotal((t) => t + 1);
            setShowForm(false);
            copyToClipboard(password);
            setNotice(
              `Created ${user.profile} "${user.login}"${user.companyName ? ` for ${user.companyName}` : ''}. Password: ${password} — copied to your clipboard; it cannot be retrieved later.`,
            );
          }}
          onError={(msg) => setError(msg)}
        />
      )}

      {notice && (
        <p className={s.noticeNote} role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}

      <label className={s.search}>
        <SearchIcon size={14} />
        <input
          className={s.searchInput}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Filter accounts — company, carrier id, application id, login, card…"
        />
        <span className={s.chipMeta}>
          {total} account{total === 1 ? '' : 's'}
        </span>
      </label>

      <div className={s.table}>
        <div className={s.tHead} style={COLS}>
          <span>Account</span>
          <span>Profile</span>
          <span>Carrier · App</span>
          <span>Card · Parent</span>
          <span>Agent</span>
          <span className={s.right}>Status</span>
          <span className={s.right}>Actions</span>
        </div>
        {loading && <div className={s.none}>Loading carrier users…</div>}
        {!loading &&
          filtered.map((u) => {
            const companyLine = u.companyName ?? (u.profile === 'driver' ? byId.get(u.parentUserId ?? '')?.companyName : null);
            return (
              <div key={u.id} className={s.tRow} style={COLS}>
                <span className={s.cellStack}>
                  <span className={s.docTitle}>{u.login}</span>
                  <span className={s.cellSub}>{companyLine ?? 'no company on file'}</span>
                </span>
                <span>
                  <span className={`${s.pill} ${u.profile === 'owner' ? s.pillInfo : s.pillNeutral}`}>
                    {u.profile === 'owner' ? 'Owner' : 'Driver'}
                  </span>
                </span>
                <span className={s.cellStack}>
                  <span className={s.mono}>
                    {u.carrierId ?? (
                      <button type="button" className={s.miniBtn} onClick={() => void setCarrier(u)}>
                        Set carrier…
                      </button>
                    )}
                  </span>
                  <span className={`${s.cellSub} ${s.mono}`}>{u.applicationId ? `app ${u.applicationId}` : ' '}</span>
                </span>
                <span className={s.cellStack}>
                  {u.profile === 'driver' ? (
                    <>
                      <span className={s.mono}>{u.cardId ?? 'no card yet'}</span>
                      <span className={s.cellSub}>↳ {byId.get(u.parentUserId ?? '')?.login ?? u.parentUserId ?? '?'}</span>
                    </>
                  ) : (
                    <span className={s.cellSub}>—</span>
                  )}
                </span>
                <span className={s.deptText}>{u.agentName ?? '—'}</span>
                <span className={s.right}>
                  <span className={`${s.pill} ${u.status === 'active' ? s.pillGood : s.pillBad}`}>
                    <span className={s.dot} />
                    {u.status === 'active' ? 'Active' : 'Disabled'}
                  </span>
                </span>
                <span className={`${s.right} ${s.rowActions}`}>
                  {u.profile === 'driver' && (
                    <button type="button" className={s.miniBtn} onClick={() => void setCard(u)}>
                      Card
                    </button>
                  )}
                  <button type="button" className={s.miniBtn} onClick={() => void resetPassword(u)}>
                    Reset pw
                  </button>
                  <button type="button" className={s.miniBtn} onClick={() => void toggleStatus(u)}>
                    {u.status === 'active' ? 'Disable' : 'Enable'}
                  </button>
                  <button type="button" className={`${s.miniBtn} ${s.miniDanger}`} onClick={() => void remove(u)}>
                    Delete
                  </button>
                </span>
              </div>
            );
          })}
        {!loading && filtered.length === 0 && (
          <div className={s.none}>
            {users.length === 0 ? (
              <span className={s.emptyCta}>
                No carrier users yet.
                <button type="button" className={s.primaryBtn} onClick={() => setShowForm(true)}>
                  <PlusIcon size={13} /> Create the first owner
                </button>
              </span>
            ) : (
              'No accounts match your filter.'
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateForm({
  owners,
  onCreated,
  onError,
}: {
  owners: CarrierUser[];
  onCreated: (user: CarrierUser, password: string) => void;
  onError: (message: string) => void;
}) {
  const [profile, setProfile] = useState<CarrierProfile>('owner');
  const [picked, setPicked] = useState<DwhClient | null>(null);
  const [manual, setManual] = useState(false);
  const [carrierId, setCarrierId] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [parentUserId, setParentUserId] = useState('');
  const [cardId, setCardId] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [agentName, setAgentName] = useState('');
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [busy, setBusy] = useState(false);

  // Zoho agent picker (session-only endpoint) — degrades to manual entry when unavailable.
  useEffect(() => {
    let alive = true;
    listAgents(false)
      .then((res) => alive && setAgents(res))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // Resolve the Zoho user id at submit time so late agent-list loads still match.
  const norm = (v: string) => v.trim().toLowerCase();
  const agentHit = useMemo(
    () => agents.find((a) => norm(a.name ?? '') === norm(agentName) || a.zohoUserId === agentName.trim()),
    [agents, agentName],
  );

  // ── DWH client search (owners): debounced, newest applications first ──────────────
  const [clientQuery, setClientQuery] = useState('');
  const [clientResults, setClientResults] = useState<DwhClient[] | null>(null);
  const [clientBusy, setClientBusy] = useState(false);
  const [clientError, setClientError] = useState('');
  useEffect(() => {
    if (profile !== 'owner' || picked || manual) return;
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
  }, [clientQuery, profile, picked, manual]);

  function pickClient(c: DwhClient) {
    setPicked(c);
    setCarrierId(c.carrierId ?? '');
    setApplicationId(c.applicationId ?? '');
    setCompanyName(c.companyName ?? '');
    if (c.ownerZohoUserId) {
      const hit = agents.find((a) => a.zohoUserId === c.ownerZohoUserId);
      if (hit?.name) setAgentName(hit.name);
    }
    setClientResults(null);
    setClientQuery('');
  }

  function clearClient() {
    setPicked(null);
    setCarrierId('');
    setApplicationId('');
    setCompanyName('');
  }

  const isOwner = profile === 'owner';
  const hasTie = carrierId.trim().length > 0 || applicationId.trim().length > 0;
  const valid =
    login.trim().length >= 3 && password.length >= 8 && (isOwner ? hasTie : parentUserId.length > 0);

  const blocker = !valid
    ? isOwner && !hasTie
      ? 'Pick a client (or enter a carrier / application id manually).'
      : !isOwner && !parentUserId
        ? 'Choose the fleet account this driver belongs to.'
        : login.trim().length < 3
          ? 'Login needs at least 3 characters.'
          : password.length < 8
            ? 'Password needs at least 8 characters.'
            : ''
    : '';

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    try {
      const res = await createCarrierUser({
        profile,
        ...(isOwner && carrierId.trim() ? { carrierId: carrierId.trim() } : {}),
        ...(isOwner && applicationId.trim() ? { applicationId: applicationId.trim() } : {}),
        ...(isOwner && companyName.trim() ? { companyName: companyName.trim() } : {}),
        ...(!isOwner ? { parentUserId } : {}),
        ...(!isOwner && cardId.trim() ? { cardId: cardId.trim() } : {}),
        login: login.trim(),
        password,
        ...(agentName.trim() ? { agentName: agentHit?.name ?? agentName.trim() } : {}),
        ...(agentHit ? { agentZohoUserId: agentHit.zohoUserId } : {}),
      });
      onCreated(res.user, password);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={`${s.card} ${s.cardPad} ${s.formSteps}`} onSubmit={(e) => void submit(e)}>
      {/* Step 1 — account type */}
      <div className={s.formStep}>
        <div className={s.eyebrow}>Step 1 · Account type</div>
        <div className={s.toggleRow} role="radiogroup" aria-label="Account type">
          <button type="button" role="radio" aria-checked={isOwner} className={`${s.toggle} ${isOwner ? s.toggleOn : ''}`} onClick={() => setProfile('owner')}>
            Owner
          </button>
          <button type="button" role="radio" aria-checked={!isOwner} className={`${s.toggle} ${!isOwner ? s.toggleOn : ''}`} onClick={() => setProfile('driver')}>
            Driver
          </button>
        </div>
        <p className={s.fieldHint}>
          {isOwner
            ? 'The fleet account — sees every card of the carrier.'
            : 'Belongs to an owner and sees one card only (with that card’s limits).'}
        </p>
      </div>

      {/* Step 2 — who it's for */}
      <div className={s.formStep}>
        <div className={s.eyebrow}>{isOwner ? 'Step 2 · Which client' : 'Step 2 · Which fleet + card'}</div>

        {isOwner && picked && (
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

        {isOwner && !picked && !manual && (
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

        {isOwner && !picked && manual && (
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

        {!isOwner && (
          <div className={s.formGrid}>
            <div className={s.field}>
              <span className={s.fieldLabel}>Fleet account (owner)</span>
              <select className={s.select} value={parentUserId} onChange={(e) => setParentUserId(e.target.value)}>
                <option value="">Choose…</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.login}
                    {o.companyName ? ` — ${o.companyName}` : o.carrierId ? ` — carrier ${o.carrierId}` : ''}
                  </option>
                ))}
              </select>
              <span className={s.fieldHint}>The driver inherits this fleet's company access.</span>
            </div>
            <div className={s.field}>
              <span className={s.fieldLabel}>Card Id</span>
              <input className={`${s.input} ${s.mono}`} value={cardId} onChange={(e) => setCardId(e.target.value)} placeholder="optional — assign later" />
              <span className={s.fieldHint}>The one card this driver can see.</span>
            </div>
          </div>
        )}
      </div>

      {/* Step 3 — credentials */}
      <div className={s.formStep}>
        <div className={s.eyebrow}>Step 3 · Credentials</div>
        <div className={s.formGrid}>
          <div className={s.field}>
            <span className={s.fieldLabel}>Login</span>
            <input className={s.input} value={login} onChange={(e) => setLogin(e.target.value)} placeholder={isOwner ? 'acme.owner' : 'acme.driver1'} minLength={3} autoComplete="off" />
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>Password</span>
            <div className={s.inlineRow}>
              <input className={`${s.input} ${s.mono}`} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} autoComplete="new-password" />
              <button type="button" className={s.miniBtn} onClick={() => setPassword(generatePassword())}>
                Generate
              </button>
            </div>
            <span className={s.fieldHint}>Shown (and copied) once on create — share it securely.</span>
          </div>
          <div className={s.field}>
            <span className={s.fieldLabel}>Octane agent</span>
            <input
              className={s.input}
              value={agentName}
              onChange={(e) => setAgentName(e.target.value)}
              placeholder={agents.length > 0 ? 'Pick or type…' : 'e.g. Rep Riley'}
              list="carrier-agents"
            />
            <datalist id="carrier-agents">
              {agents.map((a) => (
                <option key={a.zohoUserId} value={a.name ?? a.zohoUserId} />
              ))}
            </datalist>
            <span className={s.fieldHint}>{isOwner ? 'Filled from the picked client’s deal owner.' : 'Optional.'}</span>
          </div>
        </div>
      </div>

      <div className={s.inlineRow}>
        <button type="submit" className={s.primaryBtn} disabled={!valid || busy}>
          {busy ? 'Creating…' : `Create ${isOwner ? 'owner' : 'driver'}`}
        </button>
        {blocker && <span className={s.fieldHint}>{blocker}</span>}
      </div>
    </form>
  );
}
