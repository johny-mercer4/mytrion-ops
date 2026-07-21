/**
 * Open Pool — claimable retention cases (status p1_open_pool). Agents request a claim;
 * Customer Service approves (or 1 BD auto). Pending self-claims stay visible.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ChangeEvent, MouseEvent } from 'react';
import { useUserContext } from '@/context/UserContextProvider';
import { s } from '../dc';
import { Icon } from '../icons';
import { useSales } from '../ctx';
import { useLoad } from '../../../_shared/useLoad';
import { RetentionHero, RetentionPoolMetrics, fmtGal } from '../RetentionBoardUi';
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

function isPendingSelf(c: RetentionCaseRow, selfId: string | undefined): boolean {
  return (
    c.statusCode === 'p1_pool_claim_pending' &&
    !!selfId &&
    c.pendingClaimantZohoUserId === selfId
  );
}

export function PoolTab({ onAvailableCount }: { onAvailableCount?: (n: number) => void }) {
  const { pushToast } = useSales();
  const user = useUserContext();
  const selfId = user.userId && user.userId !== 'dev-user' ? user.userId : undefined;
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

  const claimable = useMemo(
    () => cases.filter((c) => c.statusCode === 'p1_open_pool'),
    [cases],
  );

  useEffect(() => {
    if (!feed.loading) onAvailableCount?.(claimable.length);
  }, [claimable.length, feed.loading, onAvailableCount]);

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

  const toggle = (id: string): void => {
    const row = cases.find((c) => c.id === id);
    if (!row || row.statusCode !== 'p1_open_pool') return;
    setSelected((sel) => (sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]));
  };

  const toggleAll = (): void => {
    const ids = filtered.filter((c) => c.statusCode === 'p1_open_pool').map((c) => c.id);
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
    for (const id of ids) {
      try {
        await claimOpenPoolCase(id);
        ok += 1;
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
      pushToast(
        'Claim requested',
        `${ok} deal${ok !== 1 ? 's' : ''} awaiting Customer Service approval (1 BD auto)`,
      );
    }
    if (errors.length > 0) {
      pushToast('Some requests failed', errors[0] ?? 'Could not request claim');
    }
  };

  const selectableFiltered = filtered.filter((c) => c.statusCode === 'p1_open_pool');
  const allChecked =
    selectableFiltered.length > 0 &&
    selectableFiltered.every((c) => selected.includes(c.id));
  const stop = (e: MouseEvent): void => e.stopPropagation();
  const closeX = <Icon name="close" size={15} strokeWidth={2.4} />;

  const poolGallons = useMemo(
    () => claimable.reduce((sum, c) => sum + (c.gallons90d ?? 0), 0),
    [claimable],
  );
  const avgQuietDays = useMemo(() => {
    const days = claimable
      .map((c) => c.daysInactive)
      .filter((d): d is number => typeof d === 'number' && d >= 0);
    if (days.length === 0) return null;
    return Math.round(days.reduce((a, b) => a + b, 0) / days.length);
  }, [claimable]);

  return (
    <>
      <div className="ss-fu" style={s('display:flex;flex-direction:column;height:calc(100vh - 150px);min-height:480px')}>
        <div style={s('margin-bottom:14px')}>
          <RetentionHero
            title="Open Pool"
            sub="Request a claim — Customer Service approves (1 BD auto). Needs 10+ days inactive · max 3 agents."
            actions={
              <>
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
                  style={s(
                    'width:38px;height:38px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center',
                  )}
                >
                  <Icon
                    name="refresh"
                    size={16}
                    style={s(spin || feed.loading ? 'animation:ss-spin .9s linear infinite' : '')}
                  />
                </button>
              </>
            }
          >
            {!feed.loading || claimable.length > 0 ? (
              <RetentionPoolMetrics
                available={claimable.length}
                selected={selected.length}
                gallons={poolGallons}
                avgQuietDays={avgQuietDays}
              />
            ) : null}
          </RetentionHero>
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
                const pending = isPendingSelf(c, selfId);
                const claimableRow = c.statusCode === 'p1_open_pool';
                const on = selected.includes(c.id);
                return (
                  <div
                    key={c.id}
                    onClick={() => toggle(c.id)}
                    style={s(
                      `${poolGrid};padding:11px 15px;border-top:1px solid var(--border2);font-size:13px;cursor:${claimableRow ? 'pointer' : 'default'};background:${pending ? 'rgba(var(--warn-rgb,245,158,11),.08)' : on ? 'rgba(var(--accent-rgb),.10)' : 'transparent'};border-left:3px solid ${pending ? 'var(--warn)' : on ? 'var(--accent)' : 'transparent'};opacity:${claimableRow || pending ? '1' : '.85'}`,
                    )}
                  >
                    <span style={s('display:flex;align-items:center;justify-content:center')}>
                      {claimableRow ? (
                        <input
                          type="checkbox"
                          checked={on}
                          onClick={stop}
                          onChange={() => toggle(c.id)}
                          style={s('width:15px;height:15px;cursor:pointer;accent-color:var(--accent)')}
                        />
                      ) : (
                        <span style={s('width:15px;height:15px')} />
                      )}
                    </span>
                    <span style={s("font-family:'JetBrains Mono',monospace;color:var(--muted);font-size:11px")}>{i + 1}</span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-weight:600;font-size:12px")}>{c.carrierId}</span>
                    <span style={s('font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                      {c.companyName || '—'}
                      {pending ? (
                        <span
                          style={s(
                            'margin-left:8px;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--warn);border:1px solid color-mix(in srgb,var(--warn) 40%,var(--border));border-radius:999px;padding:2px 7px;vertical-align:middle',
                          )}
                        >
                          Pending CS
                        </span>
                      ) : null}
                    </span>
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
                      {c.gallons90d != null ? fmtGal(c.gallons90d) : '—'}
                    </span>
                    <span style={s('font-size:12px;font-weight:700')}>{c.assignmentCount}/3</span>
                    <span style={s('font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                      {pending ? 'Awaiting CS' : c.agentName || '—'}
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
                <div style={s('font-size:16px;font-weight:700')}>Request claim · {selected.length}</div>
                <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
                  Customer Service reviews — 1 BD auto-approve if no action
                </div>
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
                  I request claim on <strong style={s('color:var(--accent)')}>{selected.length}</strong> deal(s).
                  After CS approval, Phase 1 restarts under my ownership (counts toward the 3-agent limit).
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
                {submitting ? 'Requesting…' : 'Submit request'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
