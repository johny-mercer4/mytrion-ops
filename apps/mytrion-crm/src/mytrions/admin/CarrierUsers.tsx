import { useCallback, useEffect, useMemo, useState } from 'react';
import { listRegisteredCompanies, type RegisteredCompany } from '../../api/carrierUsers';
import { BuildingIcon, PersonIcon, PlusIcon, SearchIcon, XIcon } from '../../components/icons';
import { CarrierUserForm } from './CarrierUserForm';
import s from './admin.module.css';

const COLS = { gridTemplateColumns: '2fr 1.1fr 1fr 1.2fr 1fr' } as const;

interface CarrierGroup {
  key: string;
  carrierId: string | null;
  companyName: string | null;
  owner: RegisteredCompany | null;
  drivers: RegisteredCompany[];
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
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [query, setQuery] = useState('');
  const [showForm, setShowForm] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

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

      {showForm && (
        <CarrierUserForm
          onInviteCreated={() => setNotice('Registration link generated and copied to your clipboard.')}
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
        </div>
        {loading && <div className={s.none}>Loading registered companies…</div>}
        {!loading &&
          filtered.map((g) => (
            <div key={g.key}>
              <div className={s.tRow} style={COLS}>
                <span className={s.cellStack}>
                  <span className={s.docTitle}>{g.companyName ?? '(unnamed company)'}</span>
                  {!g.owner && <span className={s.cellSub}>Owner hasn't registered yet</span>}
                </span>
                <span>
                  {g.owner && (
                    <span className={`${s.pill} ${g.owner.companyType === 'fleet-manager' ? s.pillInfo : s.pillNeutral}`}>
                      {g.owner.companyType === 'fleet-manager' ? <BuildingIcon size={11} /> : <PersonIcon size={11} />}
                      {g.owner.companyType === 'fleet-manager' ? 'Company owner' : 'Owner-operator'}
                    </span>
                  )}
                </span>
                <span className={s.mono}>{g.carrierId ?? '—'}</span>
                <span className={s.cellSub}>{g.owner ? `@${g.owner.telegramUsername ?? g.owner.telegramUserId}` : '—'}</span>
                <span className={s.cellSub}>{g.owner ? new Date(g.owner.createdAt).toLocaleDateString() : '—'}</span>
              </div>
              {g.drivers.map((d) => (
                <div key={d.id} className={s.tRow} style={COLS}>
                  <span className={s.cellStack} style={{ paddingLeft: 'var(--space-4)' }}>
                    <span className={s.docTitle}>↳ {d.driverName ?? 'Driver'}</span>
                    <span className={s.cellSub}>card {d.cardId ?? '?'}</span>
                  </span>
                  <span>
                    <span className={`${s.pill} ${s.pillNeutral}`}>
                      <PersonIcon size={11} />
                      Driver
                    </span>
                  </span>
                  <span className={s.mono}>{d.carrierId ?? '—'}</span>
                  <span className={s.cellSub}>@{d.telegramUsername ?? d.telegramUserId}</span>
                  <span className={s.cellSub}>{new Date(d.createdAt).toLocaleDateString()}</span>
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
    </div>
  );
}
