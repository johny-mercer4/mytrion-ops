/**
 * "Test as" — pick a Zoho user and run the next chat turns under THEIR authority.
 *
 * Scoped to the chat only (see ./testAs.ts): the rest of Mytrion Admin keeps running as you, so you
 * can probe Horizon's RBAC without re-scoping the Knowledge Base or the database browsers.
 *
 * The client only ever names WHO to test as. The backend resolves that id against the CRM directory
 * and applies the target's own department grant, so what comes back is bounded by the target's real
 * authority — not by anything this component sends.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listAgents, type AgentUser } from '../../api/agents';
import { SearchIcon, ViewAsIcon, XIcon } from '../../components/icons';
import { getChatTestAs, setChatTestAs, type ChatTestAs } from './testAs';
import styles from './TestAsPicker.module.css';

const SKELETON_ROWS = 5;

export function TestAsPicker({ onChange }: { onChange?: (next: ChatTestAs | null) => void }) {
  const [target, setTarget] = useState<ChatTestAs | null>(() => getChatTestAs());
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const loadedRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setAgents(await listAgents(true));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load users.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      void load();
    }
  }, [open, load]);

  const apply = (next: ChatTestAs | null): void => {
    setChatTestAs(next);
    setTarget(next);
    setOpen(false);
    onChange?.(next);
  };

  if (target) {
    return (
      <div className={styles.active}>
        <span className={styles.dot} aria-hidden="true" />
        <span className={styles.activeLabel}>
          Testing as <strong className={styles.who}>{target.name}</strong>
          {target.profile ? <span className={styles.meta}>{target.profile}</span> : null}
        </span>
        <button
          type="button"
          className={styles.exit}
          onClick={() => apply(null)}
          title="Stop testing as this user — back to your own access"
        >
          <XIcon size={11} />
          Exit
        </button>
      </div>
    );
  }

  const s = q.trim().toLowerCase();
  const filtered = s
    ? agents.filter(
        (a) =>
          (a.name ?? '').toLowerCase().includes(s) ||
          (a.email ?? '').toLowerCase().includes(s) ||
          (a.profile ?? '').toLowerCase().includes(s),
      )
    : agents;

  return (
    <div className={styles.wrap}>
      <button
        type="button"
        className={styles.trigger}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        title="Run chat turns as another Zoho user to test RBAC"
      >
        <ViewAsIcon size={12} />
        Test as
      </button>
      {open && (
        <div className={styles.menu} role="listbox" aria-busy={loading} aria-label="Zoho users">
          <div className={styles.searchRow}>
            <SearchIcon size={12} />
            <input
              className={styles.search}
              placeholder={loading ? 'Loading Zoho users…' : 'Search name, profile, email…'}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              autoFocus
            />
          </div>

          {error ? <div className={styles.stateErr}>{error}</div> : null}

          {/* One loader for this region: skeleton rows only, never a spinner on top of them. */}
          {loading && !error ? (
            <div className={styles.options} role="status" aria-label="Loading Zoho users">
              {Array.from({ length: SKELETON_ROWS }, (_, i) => (
                <div key={i} className={styles.skelRow} aria-hidden="true">
                  <span className={styles.skelName} style={{ width: i % 2 === 0 ? '56%' : '44%' }} />
                  <span className={styles.skelMeta} style={{ width: i % 2 === 0 ? '70%' : '62%' }} />
                </div>
              ))}
            </div>
          ) : null}

          {!loading && !error && filtered.length === 0 ? (
            <div className={styles.state}>
              {agents.length === 0 ? 'No Zoho users available.' : `No user matches “${q.trim()}”.`}
            </div>
          ) : null}

          {!loading && !error && filtered.length > 0 ? (
            <div className={styles.options}>
              {filtered.map((a) => (
                <button
                  key={a.zohoUserId}
                  type="button"
                  role="option"
                  aria-selected="false"
                  className={styles.option}
                  onClick={() =>
                    apply({
                      zohoUserId: a.zohoUserId,
                      name: a.name ?? a.zohoUserId,
                      ...(a.profile ? { profile: a.profile } : {}),
                      ...(a.role ? { role: a.role } : {}),
                    })
                  }
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
