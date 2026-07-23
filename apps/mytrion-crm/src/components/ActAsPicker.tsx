import { useCallback, useEffect, useRef, useState } from 'react';
import { listAgents, type AgentUser } from '../api/agents';
import { useImpersonation } from '../context/ImpersonationProvider';
import { SearchIcon, ViewAsIcon, XIcon } from './icons';
import styles from './ActAsPicker.module.css';

const SKELETON_ROWS = 6;

/**
 * "View as" control (TopBar). Scoped to the current Mytrion only (see api/impersonation.ts) —
 * does not apply on `/main` or other Mytrions. Admins (no `targets`) pick via listAgents; a granted
 * NON-admin gets an explicit `targets` list. When acting, shows a banner with Exit.
 */
export function ActAsPicker({
  targets,
  placement = 'default',
}: {
  targets?: AgentUser[];
  /** `sidebar` — full-width trigger; menu opens upward (CS / Billing footers). */
  placement?: 'default' | 'sidebar';
}) {
  const { actingAs, setActingAs } = useImpersonation();
  const scoped = targets !== undefined; // non-admin: a fixed, granted target list
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentUser[]>(targets ?? []);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const loadedRef = useRef(false);
  const wrapClass =
    placement === 'sidebar' ? `${styles.wrap} ${styles.wrapSidebar}` : styles.wrap;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      // All active CRM users — search filters client-side (no Sales-only default).
      setAgents(await listAgents(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (scoped) return; // targets supplied (non-admin) — nothing to fetch
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      void load();
    }
  }, [open, load, scoped]);

  if (actingAs) {
    return (
      <div className={`${styles.banner}${placement === 'sidebar' ? ` ${styles.bannerSidebar}` : ''}`}>
        <span className={styles.dot} aria-hidden="true" />
        Acting as <strong className={styles.who}>{actingAs.name}</strong>
        <button type="button" className={styles.exit} onClick={() => setActingAs(null)} title="Exit — back to admin">
          <XIcon size={12} />
          Exit
        </button>
      </div>
    );
  }

  const s = q.trim().toLowerCase();
  const filtered = s
    ? agents.filter((a) => (a.name ?? '').toLowerCase().includes(s) || (a.email ?? '').toLowerCase().includes(s))
    : agents;

  return (
    <div className={wrapClass}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)}>
        <ViewAsIcon size={13} />
        View as
      </button>
      {open && (
        <div
          className={`${styles.menu}${placement === 'sidebar' ? ` ${styles.menuUp}` : ''}`}
          role="listbox"
          aria-busy={loading}
        >
          <div className={styles.searchRow}>
            <SearchIcon size={13} />
            <input
              className={styles.search}
              placeholder={loading ? 'Loading users…' : 'Search users…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>

          {error && <div className={styles.stateErr}>{error}</div>}
          {loading && !error ? (
            <div className={styles.options} role="status" aria-label="Loading users">
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <div key={i} className={styles.optionSkel} aria-hidden="true">
                  <span className={`${styles.skelBar} ${styles.skelName}`} style={{ width: i % 2 === 0 ? '58%' : '46%' }} />
                  <span className={`${styles.skelBar} ${styles.skelMeta}`} style={{ width: i % 2 === 0 ? '72%' : '64%' }} />
                </div>
              ))}
            </div>
          ) : null}
          {!loading && !error && filtered.length === 0 && (
            <div className={styles.state}>
              {scoped ? 'No users available to view as.' : 'No users found.'}
            </div>
          )}
          {!loading && !error && filtered.length > 0 ? (
            <div className={styles.options}>
              {filtered.map((a) => (
                <button
                  key={a.zohoUserId}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className={styles.option}
                  onClick={() => {
                    setActingAs({
                      zohoUserId: a.zohoUserId,
                      name: a.name ?? a.zohoUserId,
                      ...(a.profile ? { profile: a.profile } : {}),
                      ...(a.role ? { role: a.role } : {}),
                    });
                    setOpen(false);
                  }}
                >
                  <span className={styles.optName}>{a.name ?? a.zohoUserId}</span>
                  <span className={styles.optMeta}>
                    {[a.profile, a.role].filter(Boolean).join(' · ') || a.email || a.zohoUserId}
                  </span>
                </button>
              ))}
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
