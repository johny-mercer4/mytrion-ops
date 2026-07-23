import { useCallback, useEffect, useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import { listProfileDefaults, updateProfileDefault, type ProfileDefault } from '../../api/mytrionAccess';
import s from './admin.module.css';

const label = (id: MytrionId): string => MYTRIONS[id]?.title ?? id;

/** Per-profile default Mytrion access. Layered with role defaults; per-user override still wins. */
export function ProfileDefaults() {
  const [profiles, setProfiles] = useState<ProfileDefault[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setProfiles(await listProfileDefaults());
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
        Profile defaults apply to every worker with that Zoho CRM profile. Specific Mytrion = full
        access to that Mytrion. Role defaults add on top; per-user overrides still win.
      </p>
      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}
      {loading && profiles.length === 0 ? (
        <div className={s.profileGrid} aria-busy="true">
          <span className={s.srOnly} role="status">
            Loading profile defaults…
          </span>
          <div className={s.skelCard} />
          <div className={s.skelCard} />
          <div className={s.skelCard} />
          <div className={s.skelCard} />
        </div>
      ) : (
        <div className={s.profileGrid}>
          {profiles.map((p) => (
            <ProfileCard key={p.profileKey} profile={p} onSaved={load} />
          ))}
        </div>
      )}
    </>
  );
}

function ProfileCard({ profile, onSaved }: { profile: ProfileDefault; onSaved: () => void }) {
  const [mode, setMode] = useState<'custom' | 'all'>(profile.allDepartmentAccess ? 'all' : 'custom');
  const [allowed, setAllowed] = useState<Set<MytrionId>>(new Set(profile.allowedMytrions));
  const [home, setHome] = useState<MytrionId | ''>(profile.homeMytrion ?? '');
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

  async function save() {
    setBusy(true);
    setErr('');
    try {
      await updateProfileDefault(profile.profileKey, {
        profileName: profile.profileName,
        allowedMytrions: mode === 'all' ? [...MYTRION_ORDER] : MYTRION_ORDER.filter((id) => allowed.has(id)),
        allDepartmentAccess: mode === 'all',
        homeMytrion: home || null,
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
        <span className={s.cardTitle}>{profile.profileName}</span>
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
