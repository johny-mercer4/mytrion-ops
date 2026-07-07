import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createCarrierUser,
  deleteCarrierUser,
  listCarrierUsers,
  populateCarrier,
  updateCarrierUser,
  type CarrierProfile,
  type CarrierUser,
} from '../../api/carrierUsers';
import { listAgents, type AgentUser } from '../../api/agents';
import { PlusIcon, SearchIcon } from '../../components/icons';
import s from './admin.module.css';

const COLS = { gridTemplateColumns: '1.2fr 0.7fr 1fr 0.8fr 1fr 1fr 0.7fr 1.5fr' } as const;

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Carrier User Management — login/password accounts that give CARRIER COMPANIES access to
 * Mytrion Ops (audience 'customer'; future Telegram mini-app + the /client page).
 * Owner (fleet): tied to the carrier/application id — sees every card of the carrier.
 * Driver: child of an owner, tied to ONE card (the card carries the limits). Accounts can
 * be provisioned on the application id alone; the carrier id is populated later.
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
    return [u.carrierId ?? '', u.applicationId ?? '', u.login, u.agentName ?? '', u.profile, u.cardId ?? '']
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
      setNotice(`New password for ${u.login}: ${password} — copy it now; it is not stored in plain text.`);
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
        setNotice(`Carrier ${carrierId} populated on ${res.count} account(s) under ${u.applicationId}.`);
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
          <p className={s.sub}>
            Owner (fleet) accounts see every card of the carrier; Driver accounts are tied to one
            card. Provision on the application id alone and populate the carrier id later.
          </p>
        </div>
        <button type="button" className={s.primaryBtn} onClick={() => setShowForm((v) => !v)}>
          <PlusIcon size={14} />
          {showForm ? 'Close form' : 'New carrier user'}
        </button>
      </div>

      {showForm && (
        <CreateForm
          owners={owners}
          onCreated={(user, password) => {
            setUsers((prev) => [user, ...prev]);
            setTotal((t) => t + 1);
            setShowForm(false);
            setNotice(
              `Created ${user.profile} ${user.login}${user.carrierId ? ` (carrier ${user.carrierId})` : user.applicationId ? ` (application ${user.applicationId})` : ''}. Password: ${password} — share it securely; it is not retrievable later.`,
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
          placeholder="Search by carrier id, application, login, card, agent…"
        />
        <span className={s.chipMeta}>
          {total} account{total === 1 ? '' : 's'}
        </span>
      </label>

      <div className={s.table}>
        <div className={s.tHead} style={COLS}>
          <span>Login</span>
          <span>Profile</span>
          <span>Carrier Id</span>
          <span>Application</span>
          <span>Card / Parent</span>
          <span>Agent (Zoho user)</span>
          <span className={s.right}>Status</span>
          <span className={s.right}>Actions</span>
        </div>
        {loading && <div className={s.none}>Loading carrier users…</div>}
        {!loading &&
          filtered.map((u) => (
            <div key={u.id} className={s.tRow} style={COLS}>
              <span className={s.docTitle}>{u.login}</span>
              <span>
                <span className={`${s.pill} ${u.profile === 'owner' ? s.pillInfo : s.pillNeutral}`}>
                  {u.profile === 'owner' ? 'Owner' : 'Driver'}
                </span>
              </span>
              <span className={s.mono}>
                {u.carrierId ?? (
                  <button type="button" className={s.miniBtn} onClick={() => void setCarrier(u)}>
                    Set carrier…
                  </button>
                )}
              </span>
              <span className={s.mono}>{u.applicationId ?? '—'}</span>
              <span className={s.mono}>
                {u.profile === 'driver'
                  ? `${u.cardId ?? 'no card'} · ↳ ${byId.get(u.parentUserId ?? '')?.login ?? u.parentUserId ?? '?'}`
                  : '—'}
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
          ))}
        {!loading && filtered.length === 0 && (
          <div className={s.none}>
            {users.length === 0 ? 'No carrier users yet — create the first owner.' : 'No accounts match your search.'}
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
  const [carrierId, setCarrierId] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [parentUserId, setParentUserId] = useState('');
  const [cardId, setCardId] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [agentName, setAgentName] = useState('');
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [busy, setBusy] = useState(false);

  // Resolve the Zoho user id from whatever is currently typed/picked — computed at submit
  // time (not inside onChange) so it survives late agent-list loads and case differences.
  const norm = (v: string) => v.trim().toLowerCase();
  const agentHit = useMemo(
    () =>
      agents.find(
        (a) => norm(a.name ?? '') === norm(agentName) || a.zohoUserId === agentName.trim(),
      ),
    [agents, agentName],
  );

  // Zoho agent picker (session-only endpoint) — degrade to manual entry when unavailable.
  useEffect(() => {
    let alive = true;
    listAgents(false)
      .then((res) => alive && setAgents(res))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const isOwner = profile === 'owner';
  const valid =
    login.trim().length >= 3 &&
    password.length >= 8 &&
    (isOwner
      ? carrierId.trim().length > 0 || applicationId.trim().length > 0
      : parentUserId.length > 0);

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy || !valid) return;
    setBusy(true);
    try {
      const res = await createCarrierUser({
        profile,
        ...(isOwner && carrierId.trim() ? { carrierId: carrierId.trim() } : {}),
        ...(isOwner && applicationId.trim() ? { applicationId: applicationId.trim() } : {}),
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
    <form className={`${s.card} ${s.cardPad}`} onSubmit={(e) => void submit(e)}>
      <span className={s.cardTitle}>New carrier user</span>

      <div className={s.chipRow} style={{ margin: 'var(--space-3) 0 0' }} role="radiogroup" aria-label="Profile">
        <button
          type="button"
          role="radio"
          aria-checked={isOwner}
          className={`${s.filterChip} ${isOwner ? s.filterChipOn : ''}`}
          onClick={() => setProfile('owner')}
        >
          Owner (fleet — all cards)
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={!isOwner}
          className={`${s.filterChip} ${!isOwner ? s.filterChipOn : ''}`}
          onClick={() => setProfile('driver')}
        >
          Driver (one card, child of an owner)
        </button>
      </div>

      <div className={s.formGrid}>
        {isOwner ? (
          <>
            <div className={s.field}>
              <span className={s.fieldLabel}>Carrier Id (blank if not a carrier yet)</span>
              <input className={`${s.input} ${s.mono}`} value={carrierId} onChange={(e) => setCarrierId(e.target.value)} placeholder="5758544" />
            </div>
            <div className={s.field}>
              <span className={s.fieldLabel}>Application Id (the unique key pre-carrier)</span>
              <input className={`${s.input} ${s.mono}`} value={applicationId} onChange={(e) => setApplicationId(e.target.value)} placeholder="APP-1024 — at least one of the two" />
            </div>
          </>
        ) : (
          <>
            <div className={s.field}>
              <span className={s.fieldLabel}>Parent owner *</span>
              <select className={s.select} value={parentUserId} onChange={(e) => setParentUserId(e.target.value)}>
                <option value="">Choose the fleet account…</option>
                {owners.map((o) => (
                  <option key={o.id} value={o.id}>
                    {o.login} {o.carrierId ? `· carrier ${o.carrierId}` : o.applicationId ? `· app ${o.applicationId}` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div className={s.field}>
              <span className={s.fieldLabel}>Card Id (assignable later)</span>
              <input className={`${s.input} ${s.mono}`} value={cardId} onChange={(e) => setCardId(e.target.value)} placeholder="the driver's card" />
            </div>
          </>
        )}
        <div className={s.field}>
          <span className={s.fieldLabel}>Login *</span>
          <input className={s.input} value={login} onChange={(e) => setLogin(e.target.value)} placeholder={isOwner ? 'acme.owner' : 'acme.driver1'} required minLength={3} autoComplete="off" />
        </div>
        <div className={s.field}>
          <span className={s.fieldLabel}>Password * (shown once on create)</span>
          <div className={s.inlineRow}>
            <input className={`${s.input} ${s.mono}`} value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required autoComplete="new-password" />
            <button type="button" className={s.miniBtn} onClick={() => setPassword(generatePassword())}>
              Generate
            </button>
          </div>
        </div>
        <div className={s.field}>
          <span className={s.fieldLabel}>Agent name (Zoho user)</span>
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
        </div>
      </div>

      <button type="submit" className={s.primaryBtn} style={{ alignSelf: 'flex-start' }} disabled={!valid || busy}>
        {busy ? 'Creating…' : `Create ${isOwner ? 'owner' : 'driver'}`}
      </button>
    </form>
  );
}
