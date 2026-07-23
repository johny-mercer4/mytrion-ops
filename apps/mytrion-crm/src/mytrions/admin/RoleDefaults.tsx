import { useCallback, useEffect, useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import {
  listRoleDefaults,
  updateRoleDefault,
  type MytrionAccessMode,
  type RoleDefault,
} from '../../api/mytrionAccess';
import { BillingAccessModeField } from './BillingAccessModeField';
import s from './admin.module.css';

const label = (id: MytrionId): string => MYTRIONS[id]?.title ?? id;

/**
 * Per-role default Mytrion access (Zoho CRM role). Layered on top of profile defaults; a per-user
 * override still wins. Billing supports Read-only vs Full access.
 */
export function RoleDefaults() {
  const [roles, setRoles] = useState<RoleDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setRoles(await listRoleDefaults());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <>
      <p className={s.noticeNote} style={{ marginBottom: '0.75rem' }}>
        Role defaults apply to every worker with that Zoho CRM role. They add to profile defaults
        (union). For Billing, set Read-only or Full access. Per-user overrides still win.
      </p>
      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}
      {loading && roles.length === 0 ? (
        <div className={s.profileGrid} aria-busy="true">
          <span className={s.srOnly} role="status">
            Loading role defaults…
          </span>
          <div className={s.skelCard} />
          <div className={s.skelCard} />
          <div className={s.skelCard} />
          <div className={s.skelCard} />
        </div>
      ) : roles.length === 0 ? (
        <div className={s.none}>No Zoho roles found on the roster yet.</div>
      ) : (
        <div className={s.profileGrid}>
          {roles.map((r) => (
            <RoleCard key={r.roleKey} role={r} onSaved={load} />
          ))}
        </div>
      )}
    </>
  );
}

function RoleCard({ role, onSaved }: { role: RoleDefault; onSaved: () => void }) {
  const [mode, setMode] = useState<'custom' | 'all'>(role.allDepartmentAccess ? 'all' : 'custom');
  const [allowed, setAllowed] = useState<Set<MytrionId>>(new Set(role.allowedMytrions));
  const [home, setHome] = useState<MytrionId | ''>(role.homeMytrion ?? '');
  const [billingMode, setBillingMode] = useState<MytrionAccessMode>(
    role.mytrionAccessModes?.billing ?? 'full',
  );
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  const toggle = (id: MytrionId) =>
    setAllowed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const homeOptions = mode === 'all' ? MYTRION_ORDER : MYTRION_ORDER.filter((id) => allowed.has(id));
  const showBillingMode = mode === 'custom' && allowed.has('billing');

  async function save() {
    setBusy(true);
    setErr('');
    try {
      const nextAllowed =
        mode === 'all' ? [...MYTRION_ORDER] : MYTRION_ORDER.filter((id) => allowed.has(id));
      const mytrionAccessModes =
        mode === 'custom' && nextAllowed.includes('billing') ? { billing: billingMode } : {};
      await updateRoleDefault(role.roleKey, {
        roleName: role.roleName,
        allowedMytrions: nextAllowed,
        allDepartmentAccess: mode === 'all',
        homeMytrion: home || (nextAllowed.length === 1 ? nextAllowed[0]! : null),
        mytrionAccessModes,
        active: true,
      });
      onSaved();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={s.card}>
      <div className={s.cardHead}>
        <span className={s.cardTitle}>{role.roleName}</span>
        {role.configured === false ? (
          <span className={`${s.pill} ${s.pillInfo}`}>not configured</span>
        ) : role.active ? (
          <span className={`${s.pill} ${s.pillGood}`}>active</span>
        ) : (
          <span className={`${s.pill} ${s.pillWarn}`}>inactive</span>
        )}
      </div>
      <div className={s.profileCardBody}>
        <div className={s.profileModeRow}>
          {(['custom', 'all'] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`${s.filterChip} ${mode === m ? s.filterChipOn : ''}`}
              onClick={() => setMode(m)}
            >
              {m === 'custom' ? 'Specific Mytrions' : 'All Mytrions'}
            </button>
          ))}
        </div>
        {mode === 'custom' && (
          <div className={s.profileChipGrid}>
            {MYTRION_ORDER.map((id) => (
              <button
                key={id}
                type="button"
                className={`${s.filterChip} ${allowed.has(id) ? s.filterChipOn : ''}`}
                onClick={() => toggle(id)}
              >
                {label(id)}
              </button>
            ))}
          </div>
        )}
        {mode === 'all' && (
          <p className={s.noticeNote}>Full Mytrions — every department workspace (write access).</p>
        )}
        {showBillingMode ? <BillingAccessModeField value={billingMode} onChange={setBillingMode} /> : null}
        <label className={s.field}>
          <span className={s.fieldLabel}>Home Mytrion (auto-route)</span>
          <select className={s.select} value={home} onChange={(e) => setHome(e.target.value as MytrionId | '')}>
            <option value="">Default (picker / single)</option>
            {homeOptions.map((id) => (
              <option key={id} value={id}>
                {label(id)}
              </option>
            ))}
          </select>
        </label>
        {err && (
          <p className={s.errorNote} role="alert">
            {err}
          </p>
        )}
        <div className={s.profileActions}>
          <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>
  );
}
