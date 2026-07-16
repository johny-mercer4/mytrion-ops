import { useCallback, useEffect, useState } from 'react';
import { MYTRIONS, MYTRION_ORDER, type MytrionId } from '../../access/mytrions.config';
import { listProfileDefaults, updateProfileDefault, type ProfileDefault } from '../../api/mytrionAccess';
import s from './admin.module.css';

const label = (id: MytrionId): string => MYTRIONS[id]?.title ?? id;

/** Per-profile default Mytrion access. A worker inherits this unless a per-user override changes it. */
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
      <p className={s.sub}>
        Default Mytrion access per Zoho profile — a worker with this profile gets this access unless a
        per-user override changes it. Seeded on first load; edit and save any profile.
      </p>
      {error && (
        <p className={s.errorNote} role="alert">
          {error}
        </p>
      )}
      <div className={s.grid2}>
        {profiles.map((p) => (
          <ProfileCard key={p.profileKey} profile={p} onSaved={load} />
        ))}
      </div>
      {loading && profiles.length === 0 && <div className={s.none}>Loading profile defaults…</div>}
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
      <div className={s.cardPad}>
        <div className={s.chipRow}>
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
          <div className={s.chipRow}>
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
        <button type="button" className={s.primaryBtn} onClick={() => void save()} disabled={busy}>
          {busy ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}
