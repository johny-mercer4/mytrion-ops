/**
 * Open Pool — claimable retention cases (status p1_open_pool). Agents select rows and
 * request assignment to themselves (Phase 1 restarts; assignment_count caps at 3).
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { useLoad } from '../../../_shared/useLoad';
import {
  claimOpenPoolCase,
  loadOpenPoolCases,
  quietCaption,
  type RetentionCaseRow,
} from '../retentionData';
import { subscribeRetentionLive } from '../retentionLiveBus';

type SortKey = 'carrierId' | 'companyName' | 'daysInactive' | 'gallons90d' | 'assignmentCount';

const poolGrid =
  'display:grid;grid-template-columns:44px 40px 118px 1.6fr 1.1fr 1.05fr 90px 80px 1.1fr;gap:10px;align-items:center';

export function PoolTab() {
  const { pushToast } = useSales();
  const feed = useLoad(() => loadOpenPoolCases(), []);
  const [cases, setCases] = useState<RetentionCaseRow[]>([]);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [sort, setSort] = useState<{ key: SortKey | null; dir: 'asc' | 'desc' }>({
    key: null,
    dir: 'asc',
  });
  const [modalOpen, setModalOpen] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [spin, setSpin] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (feed.data?.cases) setCases(feed.data.cases);
  }, [feed.data?.cases]);

  const refresh = (): void => {
    setSpin(true);
    feed.reload();
    clearTimeout(spinTimer.current);
    spinTimer.current = setTimeout(() => setSpin(false), 900);
  };

  useEffect(
    () =>
      subscribeRetentionLive((payload) => {
        if (payload.type === 'retention.pool.opened') refresh();
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const toggle = (id: string): void =>
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));

  const toggleAll = (): void => {
    const ids = filtered.map((c) => c.id);
    setSelected((sel) => (ids.length > 0 && ids.every((id) => sel.includes(id)) ? [] : ids));
  };

  const filtered = useMemo(() => {
    const q = search.toLowerCase();
    let rows = cases.slice();
    if (q) {
      rows = rows.filter((c) =>
        `${c.carrierId} ${c.companyName ?? ''} ${c.agentName ?? ''}`.toLowerCase().includes(q),
      );
    }
    if (sort.key) {
      const k = sort.key;
      const dir = sort.dir === 'desc' ? -1 : 1;
      rows = rows.slice().sort((a, b) => {
        const va = a[k] ?? '';
        const vb = b[k] ?? '';
        if (typeof va === 'number' && typeof vb === 'number') return va < vb ? -dir : va > vb ? dir : 0;
        return String(va).toLowerCase() < String(vb).toLowerCase()
          ? -dir
          : String(va).toLowerCase() > String(vb).toLowerCase()
            ? dir
            : 0;
      });
    }
    return rows;
  }, [cases, search, sort]);

  const toggleSort = (k: SortKey): void =>
    setSort((cur) => ({ key: k, dir: cur.key === k && cur.dir === 'asc' ? 'desc' : 'asc' }));

  const arrow = (k: SortKey): string =>
    sort.key === k ? (sort.dir === 'desc' ? '▼' : '▲') : '';

  const submitClaim = async (): Promise<void> => {
    if (!confirm || submitting || selected.length === 0) return;
    setSubmitting(true);
    const ids = selected.slice();
    let ok = 0;
    const errors: string[] = [];
    let pending = 0;
    for (const id of ids) {
      try {
        const res = await claimOpenPoolCase(id);
        if (res.pendingApproval) pending += 1;
        else ok += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Failed');
      }
    }
    setSubmitting(false);
    setModalOpen(false);
    setConfirm(false);
    setSelected([]);
    feed.reload();
    if (ok > 0) {
      pushToast('Claimed', `${ok} deal${ok !== 1 ? 's' : ''} assigned to you — Phase 1 restarted`);
    }
    if (pending > 0) {
      pushToast(
        'Claim requested',
        `${pending} awaiting deal-owner approve (auto-approves in 1 BD)`,
      );
    }
    if (errors.length > 0) {
      pushToast('Some claims failed', errors[0] ?? 'Could not claim');
    }
  };

  const allChecked =
    filtered.length > 0 && filtered.every((c) => selected.includes(c.id));
  const stop = (e: MouseEvent): void => e.stopPropagation();
  const closeX = <Icon name="close" size={15} strokeWidth={2.4} />;

  return (
    <>
      <div className="ss-fu" style={s('display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:480px')}>
        <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:14px;flex-wrap:wrap')}>
          <div>
            <div style={s('font-family:Rajdhani,sans-serif;font-weight:700;font-size:22px;letter-spacing:.04em;text-transform:uppercase')}>Open Pool</div>
            <div style={s('font-size:13px;color:var(--muted);margin-top:2px')}>
              Request a claim — owner approves (or auto in 1 BD). Needs 10+ days inactive · max 3
              agents · 3 BD per assignment.
            </div>
          </div>
          <div style={s('display:flex;align-items:center;gap:8px')}>
            <button
              type="button"
              disabled={!selected.length}
              onClick={() => {
                if (!selected.length) return;
                setModalOpen(true);
                setConfirm(false);
              }}
              className={selected.length ? 'ss-btn-p' : undefined}
              style={s(
                selected.length
                  ? 'height:38px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:7px'
                  : 'height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13px;cursor:not-allowed;display:flex;align-items:center;gap:7px',
              )}
            >
              <Icon name="assign" size={15} strokeWidth={2.2} />
              Request claim{selected.length ? ` (${selected.length})` : ''}
            </button>
            <button
              type="button"
              onClick={refresh}
              aria-label="Refresh"
              className="ss-ico-btn"
              style={s('width:38px;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}
            >
              <Icon name="refresh" size={16} style={s(spin || feed.loading ? 'animation:ss-spin .9s linear infinite' : '')} />
            </button>
          </div>
        </div>

        <div style={s('display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px')}>
          <Stat label="Available" value={String(cases.length)} col="var(--ok)" />
          <Stat label="Selected" value={String(selected.length)} col="var(--accent)" />
        </div>

        <div style={s('display:flex;gap:10px;margin-bottom:10px')}>
          <div style={s('flex:1;position:relative')}>
            <Icon name="search" size={15} style={s('position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--muted)')} />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search company, carrier ID, or agent…"
              className="ss-in"
              style={s('width:100%;height:38px;padding:0 14px 0 35px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px')}
            />
          </div>
        </div>

        {feed.error && (
          <div style={s('padding:12px;margin-bottom:10px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 30%,var(--border));color:var(--danger);font-size:13px')}>
            {feed.error}
          </div>
        )}

        <div style={s('flex:1;min-height:0;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:hidden;display:flex;flex-direction:column;box-shadow:var(--shadow-sm)')}>
          <div className="ss-scroll" style={s('flex:1;overflow:auto')}>
            <div style={s('min-width:980px')}>
              <div style={s(`${poolGrid};position:sticky;top:0;z-index:5;padding:11px 15px;background:var(--alt);border-bottom:1px solid var(--border);font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)`)}>
                <span style={s('display:flex;align-items:center;justify-content:center')}>
                  <input type="checkbox" checked={allChecked} onChange={toggleAll} style={s('width:15px;height:15px;cursor:pointer;accent-color:var(--accent)')} />
                </span>
                <span>#</span>
                <span onClick={() => toggleSort('carrierId')} style={s('cursor:pointer')}>Carrier {arrow('carrierId')}</span>
                <span onClick={() => toggleSort('companyName')} style={s('cursor:pointer')}>Company {arrow('companyName')}</span>
                <span>Quiet</span>
                <span>Last txn</span>
                <span onClick={() => toggleSort('gallons90d')} style={s('cursor:pointer')}>Gallons {arrow('gallons90d')}</span>
                <span onClick={() => toggleSort('assignmentCount')} style={s('cursor:pointer')}>Cycle {arrow('assignmentCount')}</span>
                <span>Owner</span>
              </div>
              {filtered.map((c, i) => {
                const on = selected.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    style={s(`${poolGrid};padding:11px 15px;border-top:1px solid var(--border2);font-size:13px;cursor:pointer;background:${on ? 'rgba(var(--accent-rgb),.10)' : 'transparent'};border-left:3px solid ${on ? 'var(--accent)' : 'transparent'}`)}
                  >
                    <span style={s('display:flex;align-items:center;justify-content:center')}>
                      <input type="checkbox" checked={on} onClick={stop} onChange={() => toggle(c.id)} style={s('width:15px;height:15px;cursor:pointer;accent-color:var(--accent)')} />
                    </span>
                    <span style={s("font-family:'JetBrains Mono',monospace;color:var(--muted);font-size:11px")}>{i + 1}</span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:12px")}>{c.carrierId}</span>
                    <span style={s('font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>{c.companyName || '—'}</span>
                    <span style={s('font-size:12px;color:var(--warn)')}>{quietCaption(c)}</span>
                    <span style={s('font-size:12px;color:var(--muted)')}>
                      {c.lastTransactionAt
                        ? new Date(c.lastTransactionAt).toLocaleDateString('en-US', {
                            month: 'short',
                            day: 'numeric',
                            year: 'numeric',
                          })
                        : '—'}
                    </span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px")}>
                      {c.gallons90d != null ? Math.round(c.gallons90d).toLocaleString() : '—'}
                    </span>
                    <span style={s('font-size:12px;font-weight:700')}>{c.assignmentCount}/3</span>
                    <span style={s('font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                      {c.agentName || '—'}
                    </span>
                  </div>
                );
              })}
              {filtered.length === 0 && !feed.loading && (
                <div style={s('padding:50px 20px;text-align:center;color:var(--muted);font-size:13px')}>
                  {feed.error ? 'Could not load Open Pool.' : 'No deals in the Open Pool right now.'}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {modalOpen && (
        <div
          onClick={() => {
            if (!submitting) setModalOpen(false);
          }}
          style={s('position:fixed;inset:0;z-index:140;background:rgba(3,7,14,.6);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}
        >
          <div
            onClick={stop}
            style={s('width:100%;max-width:460px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}
          >
            <div style={s('padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px')}>
              <div style={s('width:38px;height:38px;border-radius:var(--radius-md);background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                <Icon name="assign" size={19} />
              </div>
              <div style={s('flex:1')}>
                <div style={s('font-size:16px;font-weight:700')}>Claim {selected.length} deal(s)</div>
                <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>Assign selected Open Pool deals to yourself</div>
              </div>
              <button
                type="button"
                onClick={() => {
                  if (!submitting) setModalOpen(false);
                }}
                className="ss-ico-btn"
                style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}
              >
                {closeX}
              </button>
            </div>
            <div style={s('padding:18px 22px')}>
              <label style={s('display:flex;align-items:flex-start;gap:11px;padding:14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);cursor:pointer')}>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirm(e.target.checked)}
                  style={s('width:16px;height:16px;margin-top:1px;accent-color:var(--accent);cursor:pointer')}
                />
                <span style={s('font-size:13px;color:var(--text2);line-height:1.5')}>
                  I confirm claiming <strong style={s('color:var(--accent)')}>{selected.length}</strong> deal(s).
                  Phase 1 restarts under my ownership (counts toward the 3-agent Open Pool limit).
                </span>
              </label>
            </div>
            <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:10px')}>
              <button
                type="button"
                disabled={submitting}
                onClick={() => setModalOpen(false)}
                style={s('flex:1;height:42px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-weight:700;font-size:13px;cursor:pointer')}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!confirm || submitting}
                onClick={() => void submitClaim()}
                className={confirm && !submitting ? 'ss-btn-p' : undefined}
                style={s(
                  confirm && !submitting
                    ? 'flex:1;height:42px;border-radius:var(--radius-md);border:none;background:linear-gradient(120deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:700;font-size:13px;cursor:pointer'
                    : 'flex:1;height:42px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--muted);font-weight:700;font-size:13px;cursor:not-allowed',
                )}
              >
                {submitting ? 'Claiming…' : 'Submit claim'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function Stat({ label, value, col }: { label: string; value: string; col: string }) {
  return (
    <span style={s(`display:inline-flex;align-items:center;gap:6px;padding:5px 11px;border-radius:99px;background:color-mix(in srgb,${col} 12%,transparent);font-size:12px;font-weight:700;color:${col}`)}>
      <span style={s(`width:7px;height:7px;border-radius:50%;background:${col}`)} />
      {value} {label}
    </span>
  );
}
