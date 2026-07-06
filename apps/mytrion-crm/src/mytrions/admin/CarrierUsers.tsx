import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  createCarrierUser,
  deleteCarrierUser,
  listCarrierUsers,
  updateCarrierUser,
  type CarrierUser,
} from '../../api/carrierUsers';
import { listAgents, type AgentUser } from '../../api/agents';
import { PlusIcon, SearchIcon } from '../../components/icons';
import s from './admin.module.css';

const COLS = { gridTemplateColumns: '0.9fr 0.9fr 1.3fr 1.1fr 1fr 0.8fr 1.2fr' } as const;

const PROFILE_PRESETS = ['Carrier Owner', 'Dispatcher', 'Accountant'];

function generatePassword(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(14);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

/**
 * Carrier User Management — login/password accounts that give CARRIER COMPANIES access to
 * Mytrion Ops (audience 'customer'; future Telegram mini-app + the /client page). Sessions
 * minted from these accounts are locked to the carrier's own data.
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
      const res = await listCarrierUsers({ limit: 100 });
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

  const filtered = users.filter((u) => {
    const q = query.trim().toLowerCase();
    if (!q) return true;
    return [u.carrierId, u.applicationId ?? '', u.login, u.agentName ?? '', u.profile ?? '']
      .join(' ')
      .toLowerCase()
      .includes(q);
  });

  async function toggleStatus(u: CarrierUser) {
    try {
      const next = u.status === 'active' ? 'disabled' : 'active';
      const res = await updateCarrierUser(u.id, { status: next });
      setUsers((prev) => prev.map((x) => (x.id === u.id ? res.user : x)));
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
    <div className={s.panel}>
      <div className={s.head}>
        <div>
          <h2 className={s.h2}>Carrier User Management</h2>
          <p className={s.sub}>
            Login/password access to Mytrion Ops for carrier companies (Telegram mini-app ready).
          </p>
        </div>
        <button type="button" className={s.primaryBtn} onClick={() => setShowForm((v) => !v)}>
          <PlusIcon size={14} />
          {showForm ? 'Close form' : 'New carrier user'}
        </button>
      </div>

      {showForm && (
        <CreateForm
          onCreated={(user, password) => {
            setUsers((prev) => [user, ...prev]);
            setTotal((t) => t + 1);
            setShowForm(false);
            setNotice(
              `Created ${user.login} (carrier ${user.carrierId}). Password: ${password} — share it securely; it is not retrievable later.`,
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
          placeholder="Search by carrier id, login, agent…"
        />
        <span className={s.chipMeta}>
          {total} account{total === 1 ? '' : 's'}
        </span>
      </label>

      <div className={s.table}>
        <div className={s.tHead} style={COLS}>
          <span>Carrier Id</span>
          <span>Application Id</span>
          <span>Login</span>
          <span>Agent (Zoho user)</span>
          <span>Profile</span>
          <span className={s.right}>Status</span>
          <span className={s.right}>Actions</span>
        </div>
        {loading && <div className={s.none}>Loading carrier users…</div>}
        {!loading &&
          filtered.map((u) => (
            <div key={u.id} className={s.tRow} style={COLS}>
              <span className={s.mono}>{u.carrierId}</span>
              <span className={s.mono}>{u.applicationId ?? '—'}</span>
              <span className={s.docTitle}>{u.login}</span>
              <span className={s.deptText}>{u.agentName ?? '—'}</span>
              <span className={s.deptText}>{u.profile ?? '—'}</span>
              <span className={s.right}>
                <span className={`${s.pill} ${u.status === 'active' ? s.pillGood : s.pillBad}`}>
                  <span className={s.dot} />
                  {u.status === 'active' ? 'Active' : 'Disabled'}
                </span>
              </span>
              <span className={`${s.right} ${s.rowActions}`}>
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
            {users.length === 0 ? 'No carrier users yet — create the first one.' : 'No accounts match your search.'}
          </div>
        )}
      </div>
    </div>
  );
}

function CreateForm({
  onCreated,
  onError,
}: {
  onCreated: (user: CarrierUser, password: string) => void;
  onError: (message: string) => void;
}) {
  const [carrierId, setCarrierId] = useState('');
  const [applicationId, setApplicationId] = useState('');
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState(generatePassword());
  const [agentName, setAgentName] = useState('');
  const [profile, setProfile] = useState(PROFILE_PRESETS[0] ?? '');
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

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const res = await createCarrierUser({
        carrierId: carrierId.trim(),
        ...(applicationId.trim() ? { applicationId: applicationId.trim() } : {}),
        login: login.trim(),
        password,
        ...(agentName.trim() ? { agentName: agentHit?.name ?? agentName.trim() } : {}),
        ...(agentHit ? { agentZohoUserId: agentHit.zohoUserId } : {}),
        ...(profile.trim() ? { profile: profile.trim() } : {}),
      });
      onCreated(res.user, password);
    } catch (err) {
      onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  const valid = carrierId.trim().length > 0 && login.trim().length >= 3 && password.length >= 8;

  return (
    <form className={`${s.card} ${s.cardPad}`} onSubmit={(e) => void submit(e)}>
      <span className={s.cardTitle}>New carrier user</span>
      <div className={s.formGrid}>
        <div className={s.field}>
          <span className={s.fieldLabel}>Carrier Id *</span>
          <input className={`${s.input} ${s.mono}`} value={carrierId} onChange={(e) => setCarrierId(e.target.value)} placeholder="5758544" required />
        </div>
        <div className={s.field}>
          <span className={s.fieldLabel}>Application Id</span>
          <input className={`${s.input} ${s.mono}`} value={applicationId} onChange={(e) => setApplicationId(e.target.value)} placeholder="APP-1024 (optional)" />
        </div>
        <div className={s.field}>
          <span className={s.fieldLabel}>Login *</span>
          <input className={s.input} value={login} onChange={(e) => setLogin(e.target.value)} placeholder="acme.owner" required minLength={3} autoComplete="off" />
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
        <div className={s.field}>
          <span className={s.fieldLabel}>Profile</span>
          <input className={s.input} value={profile} onChange={(e) => setProfile(e.target.value)} list="carrier-profiles" />
          <datalist id="carrier-profiles">
            {PROFILE_PRESETS.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </div>
      </div>
      <button type="submit" className={s.primaryBtn} style={{ alignSelf: 'flex-start' }} disabled={!valid || busy}>
        {busy ? 'Creating…' : 'Create carrier user'}
      </button>
    </form>
  );
}
