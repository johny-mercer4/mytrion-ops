/**
 * Admin "View as" for the Sales shell only. Stored under the `sales` Mytrion slot — does not
 * propagate to `/main` or other Mytrions. Admin-only (shell gates on isAdmin).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { listAgents, type AgentUser } from '@/api/agents';
import { useImpersonation } from '@/context/ImpersonationProvider';
import { s } from './dc';
import { Icon } from './icons';


function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .map((w) => w[0])
      .slice(0, 2)
      .join('')
      .toUpperCase() || '?'
  );
}

export function ViewAsPicker() {
  const { actingAs, setActingAs } = useImpersonation();
  const [open, setOpen] = useState(false);
  const [agents, setAgents] = useState<AgentUser[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const loadedRef = useRef(false);
  const blurTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

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
    if (open && !loadedRef.current) {
      loadedRef.current = true;
      void load();
    }
  }, [open, load]);

  useEffect(
    () => () => {
      if (blurTimer.current) clearTimeout(blurTimer.current);
    },
    [],
  );

  // ── Active impersonation: banner + exit ──────────────────────────────────
  if (actingAs) {
    return (
      <div
        role="status"
        aria-live="polite"
        style={s(
          'display:flex;align-items:center;gap:9px;height:32px;padding:0 6px 0 12px;border-radius:99px;background:color-mix(in srgb,var(--accent) 14%,transparent);border:1px solid color-mix(in srgb,var(--accent) 40%,transparent)',
        )}
      >
        <span
          style={s(
            'display:flex;align-items:center;justify-content:center;width:18px;height:18px;border-radius:50%;background:var(--accent);color:#fff',
          )}
        >
          <Icon name="user" size={10} strokeWidth={2.5} />
        </span>
        <span style={s('font-size:9.5px;font-weight:800;letter-spacing:.08em;color:var(--accent)')}>ADMIN VIEW</span>
        <span style={s('font-size:13px;font-weight:700;color:var(--text);max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
          {actingAs.name}
        </span>
        <button
          type="button"
          onClick={() => setActingAs(null)}
          title="Exit — return to your own view"
          aria-label="Exit admin view"
          className="ss-ico-btn"
          style={s(
            'display:flex;align-items:center;gap:4px;height:24px;padding:0 9px;border-radius:99px;border:none;background:var(--surface);color:var(--text2);font-size:9.5px;font-weight:800;letter-spacing:.06em;cursor:pointer',
          )}
        >
          <Icon name="close" size={9} strokeWidth={3} />
          EXIT
        </button>
      </div>
    );
  }

  // ── No impersonation: compact search picker ──────────────────────────────
  const term = q.trim().toLowerCase();
  const filtered = term
    ? agents.filter((a) => (a.name ?? '').toLowerCase().includes(term) || (a.email ?? '').toLowerCase().includes(term))
    : agents;

  return (
    <div style={s('display:flex;align-items:center;gap:9px')}>
      <span style={s('font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>View as</span>
      <div style={s('position:relative')}>
        <div
          style={s(
            'display:flex;align-items:center;gap:7px;height:32px;padding:0 11px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);min-width:210px',
          )}
        >
          <Icon name={loading ? 'spinner' : 'search'} size={13} color="var(--muted)" {...(loading ? { style: s('animation:ss-spin 1s linear infinite') } : {})} />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onFocus={() => setOpen(true)}
            onBlur={() => {
              blurTimer.current = setTimeout(() => setOpen(false), 140);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={loading ? 'Loading users…' : 'Search users…'}
            aria-label="Search users to view as"
            autoComplete="off"
            style={s('flex:1;min-width:0;border:none;background:none;outline:none;color:var(--text);font-size:13px')}
          />
        </div>
        {open && (
          <div
            role="listbox"
            style={s(
              'position:absolute;top:calc(100% + 6px);left:0;right:0;min-width:240px;max-height:320px;overflow-y:auto;z-index:60;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);box-shadow:var(--shadow);padding:5px',
            )}
            className="ss-scroll"
          >
            {error && <div style={s('padding:10px 12px;font-size:12px;color:var(--danger)')}>{error}</div>}

            {!error && !loading && filtered.length === 0 && (
              <div style={s('padding:10px 12px;font-size:12px;color:var(--muted)')}>No users found.</div>
            )}
            {filtered.map((a) => (
              <button
                key={a.zohoUserId}
                type="button"
                role="option"
                aria-selected="false"
                onMouseDown={(e) => {
                  e.preventDefault();
                  setActingAs({
                    zohoUserId: a.zohoUserId,
                    name: a.name ?? a.zohoUserId,
                    ...(a.profile ? { profile: a.profile } : {}),
                    ...(a.role ? { role: a.role } : {}),
                  });
                  setOpen(false);
                  setQ('');
                }}
                style={s(
                  'display:flex;align-items:center;gap:10px;width:100%;padding:8px 10px;border:none;background:none;border-radius:var(--radius-md);cursor:pointer;text-align:left',
                )}
                className="ss-vw-opt"
              >
                <span
                  style={s(
                    'flex-shrink:0;display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--accent) 16%,transparent);color:var(--accent);font-size:11px;font-weight:700',
                  )}
                >
                  {initials(a.name ?? a.zohoUserId)}
                </span>
                <span style={s('min-width:0')}>
                  <span style={s('display:block;font-size:13px;font-weight:600;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                    {a.name ?? a.zohoUserId}
                  </span>
                  <span style={s('display:block;font-size:11px;color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                    {[a.profile, a.role].filter(Boolean).join(' · ') || a.email || a.zohoUserId}
                  </span>
                </span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
