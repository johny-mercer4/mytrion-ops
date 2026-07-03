import { useCallback, useEffect, useRef, useState } from 'react';
import { listAgents, type AgentUser } from '../api/agents';
import { useImpersonation } from '../context/ImpersonationProvider';
import { SearchIcon, SwitchIcon, XIcon } from './icons';
import styles from './ActAsPicker.module.css';

/**
 * Admin "act as agent" control (TopBar, admin-only). Picks an active Sales-profile CRM user so the
 * whole app runs as that rep (backend owner-scoped data + the AI agent). When acting, shows a banner
 * with an Exit. The picker fetch runs as the real admin (listAgents → impersonate:false).
 */
export function ActAsPicker() {
  const { actingAs, setActingAs } = useImpersonation();
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [showAll, setShowAll] = useState(false);
  const loadedRef = useRef(false);

  const load = useCallback(async (all: boolean) => {
    setLoading(true);
    setError(null);
    try {
      setAgents(await listAgents(all));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load agents.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      void load(false);
    }
  }, [open, load]);

  if (actingAs) {
    return (
      <div className={styles.banner}>
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
    <div className={styles.wrap}>
      <button type="button" className={styles.trigger} onClick={() => setOpen((o) => !o)}>
        <SwitchIcon size={13} />
        Act as agent
      </button>
      {open && (
        <div className={styles.menu} role="listbox">
          <div className={styles.searchRow}>
            <SearchIcon size={13} />
            <input
              className={styles.search}
              placeholder="Search sales agents…"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>
          {loading && <div className={styles.state}>Loading agents…</div>}
          {error && <div className={styles.stateErr}>{error}</div>}
          {!loading && !error && filtered.length === 0 && (
            <div className={styles.state}>
              No {showAll ? '' : 'sales '}agents found.
              {!showAll && (
                <button
                  type="button"
                  className={styles.link}
                  onClick={() => {
                    setShowAll(true);
                    void load(true);
                  }}
                >
                  Show all users
                </button>
              )}
            </div>
          )}
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
        </div>
      )}
    </div>
  );
}
