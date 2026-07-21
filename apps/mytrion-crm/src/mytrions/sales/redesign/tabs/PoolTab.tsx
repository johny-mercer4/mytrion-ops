/**
 * Open Pool — other agents' retention cases in p1_open_pool (never your own former deals).
 * Claim request (reason required) → CS approve (or 1 BD auto) → Zoho ownership → p1_new.
 * Processing rows (p1_pool_claim_pending) are locked for other agents.
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

type ClaimModal =
  | { mode: 'single'; caseId: string }
  | { mode: 'bulk'; caseIds: string[] }
  | null;

const poolGrid =
  'display:grid;grid-template-columns:44px 40px 118px 1.6fr 1.1fr 1.05fr 90px 80px 1.1fr;gap:10px;align-items:center';

function isProcessing(c: RetentionCaseRow): boolean {
  return c.statusCode === 'p1_pool_claim_pending';
}

function isPendingSelf(c: RetentionCaseRow, selfId: string | undefined): boolean {
  return isProcessing(c) && !!selfId && c.pendingClaimantZohoUserId === selfId;
}

function statusLabel(c: RetentionCaseRow, selfId: string | undefined): string {
  if (isPendingSelf(c, selfId)) return 'Your request pending';
  if (isProcessing(c)) return 'Processing';
  return 'Available';
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
  const [claimModal, setClaimModal] = useState<ClaimModal>(null);
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [spin, setSpin] = useState(false);
  const spinTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!feed.data?.cases) return;
    const rows = feed.data.cases.filter(
      (c) => !selfId || c.poolOwnerZohoUserId !== selfId || isPendingSelf(c, selfId),
    );
    setCases(rows);
  }, [feed.data?.cases, selfId]);

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
        if (
          payload.type === 'retention.pool.opened' ||
          payload.type === 'retention.claim_request' ||
          payload.type === 'retention.claim_approved' ||
          payload.type === 'retention.claim_declined'
        ) {
          refresh();
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const openClaimModal = (modal: Exclude<ClaimModal, null>): void => {
    setClaimModal(modal);
    setReason('');
    setConfirm(false);
  };

  const closeClaimModal = (): void => {
    if (submitting) return;
    setClaimModal(null);
    setReason('');
    setConfirm(false);
  };

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
        `${c.carrierId} ${c.companyName ?? ''}`.toLowerCase().includes(q),
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

  const claimIds = claimModal
    ? claimModal.mode === 'single'
      ? [claimModal.caseId]
      : claimModal.caseIds
    : [];

  const singleSummary =
    claimModal?.mode === 'single'
      ? cases.find((c) => c.id === claimModal.caseId) ?? null
      : null;

  const reasonOk = reason.trim().length > 0;
  const canSubmit = confirm && reasonOk && !submitting && claimIds.length > 0;

  const submitClaim = async (): Promise<void> => {
    if (!canSubmit) return;
    setSubmitting(true);
    const ids = claimIds.slice();
    const sharedReason = reason.trim();
    let ok = 0;
    const errors: string[] = [];
    for (const id of ids) {
      try {
        await claimOpenPoolCase(id, sharedReason);
        ok += 1;
      } catch (e) {
        errors.push(e instanceof Error ? e.message : 'Failed');
      }
    }
    setSubmitting(false);
    setClaimModal(null);
    setReason('');
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
            sub="Other agents' deals — claim with a reason; CS approves (1 BD auto). Unclaimed 3 BD → Retention. Max 3 agents fail → CITI. Processing rows locked."
            actions={
              <>
                <button
                  type="button"
                  disabled={!selected.length}
                  onClick={() => {
                    if (!selected.length) return;
                    openClaimModal({ mode: 'bulk', caseIds: selected.slice() });
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
              placeholder="Search company or carrier ID…"
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
                <span>Status</span>
              </div>
              {filtered.map((c, i) => {
                const pendingSelf = isPendingSelf(c, selfId);
                const processing = isProcessing(c);
                const claimableRow = c.statusCode === 'p1_open_pool';
                const on = selected.includes(c.id);
                const status = statusLabel(c, selfId);
                return (
                  <div
                    key={c.id}
                    onClick={() => {
                      if (!claimableRow) return;
                      openClaimModal({ mode: 'single', caseId: c.id });
                    }}
                    style={s(
                      `${poolGrid};padding:11px 15px;border-top:1px solid var(--border2);font-size:13px;cursor:${claimableRow ? 'pointer' : 'default'};background:${pendingSelf || processing ? 'rgba(var(--warn-rgb,245,158,11),.08)' : on ? 'rgba(var(--accent-rgb),.10)' : 'transparent'};border-left:3px solid ${pendingSelf || processing ? 'var(--warn)' : on ? 'var(--accent)' : 'transparent'};opacity:${claimableRow || pendingSelf ? '1' : '.85'}`,
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
                    <span>
                      <span
                        style={s(
                          `display:inline-block;font-size:10px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;border-radius:999px;padding:3px 8px;border:1px solid ${
                            processing
                              ? 'color-mix(in srgb,var(--warn) 40%,var(--border));color:var(--warn)'
                              : 'color-mix(in srgb,var(--ok) 35%,var(--border));color:var(--ok)'
                          }`,
                        )}
                      >
                        {status}
                      </span>
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

      {claimModal && (
        <div
          onClick={closeClaimModal}
          style={s('position:fixed;inset:0;z-index:140;background:rgba(3,7,14,.6);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px')}
        >
          <div
            onClick={stop}
            style={s('width:100%;max-width:480px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--accent);box-shadow:var(--shadow);animation:ss-pop .22s cubic-bezier(.2,0,0,1) both;overflow:hidden')}
          >
            <div style={s('padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:11px')}>
              <div style={s('width:38px;height:38px;border-radius:var(--radius-md);background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                <Icon name="assign" size={19} />
              </div>
              <div style={s('flex:1')}>
                <div style={s('font-size:16px;font-weight:700')}>
                  {claimModal.mode === 'single'
                    ? `Request claim · ${singleSummary?.companyName || singleSummary?.carrierId || 'deal'}`
                    : `Request claim · ${claimIds.length}`}
                </div>
                <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
                  Reason required · Customer Service reviews — 1 BD auto-approve
                </div>
              </div>
              <button
                type="button"
                onClick={closeClaimModal}
                className="ss-ico-btn"
                style={s('width:30px;height:30px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);cursor:pointer;display:flex;align-items:center;justify-content:center')}
              >
                {closeX}
              </button>
            </div>
            <div style={s('padding:18px 22px;display:flex;flex-direction:column;gap:14px')}>
              {singleSummary ? (
                <div style={s('padding:12px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);font-size:12px;color:var(--text2);line-height:1.55')}>
                  <div>
                    <strong style={s('color:var(--text)')}>{singleSummary.companyName || '—'}</strong>
                    {' · '}
                    {singleSummary.carrierId}
                  </div>
                  <div>
                    Quiet {quietCaption(singleSummary)} · Cycle {singleSummary.assignmentCount}/3 ·{' '}
                    {singleSummary.gallons90d != null ? `${fmtGal(singleSummary.gallons90d)} gal` : '—'}
                  </div>
                </div>
              ) : null}
              <div>
                <label style={s('display:block;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-bottom:6px')}>
                  Why are you claiming?{claimModal.mode === 'bulk' ? ' (shared)' : ''}
                </label>
                <textarea
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  maxLength={2000}
                  rows={3}
                  placeholder="Brief reason for CS…"
                  className="ss-in"
                  style={s('width:100%;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px;resize:vertical;min-height:72px')}
                />
              </div>
              <label style={s('display:flex;align-items:flex-start;gap:11px;padding:14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);cursor:pointer')}>
                <input
                  type="checkbox"
                  checked={confirm}
                  onChange={(e: ChangeEvent<HTMLInputElement>) => setConfirm(e.target.checked)}
                  style={s('width:16px;height:16px;margin-top:1px;accent-color:var(--accent);cursor:pointer')}
                />
                <span style={s('font-size:13px;color:var(--text2);line-height:1.5')}>
                  Are you sure? After CS approval, this lands in Kanban <strong style={s('color:var(--accent)')}>New</strong> under my ownership (counts toward the 3-agent limit).
                </span>
              </label>
            </div>
            <div style={s('padding:14px 22px;border-top:1px solid var(--border);display:flex;gap:10px')}>
              <button
                type="button"
                disabled={submitting}
                onClick={closeClaimModal}
                style={s('flex:1;height:42px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-weight:700;font-size:13px;cursor:pointer')}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={!canSubmit}
                onClick={() => void submitClaim()}
                className={canSubmit ? 'ss-btn-p' : undefined}
                style={s(
                  canSubmit
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
