/**
 * Data Center → Money Codes — own draws list + safe void (zoho-octane self-service parity).
 * Codes are never shown; delivery is via the carrier mobile app.
 */
import { useCallback, useDeferredValue, useEffect, useState } from 'react';
import type { MoneyCodeRequestRow } from '@/api/touchpointTypes';
import { callTouchpoint } from '@/api/touchpoints';
import { useSales } from './ctx';
import { s } from './dc';
import { Icon } from './icons';

type StatusFilter = 'all' | 'ISSUED' | 'VOIDED' | 'USED';

const PAGE_SIZE = 25;

function fmtUsd(v: unknown): string {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n)) return '—';
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtWhen(v: unknown): string {
  if (typeof v !== 'string' || !v) return '—';
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function statusTone(status: string): string {
  const u = status.toUpperCase();
  if (u === 'ISSUED') return 'var(--accent)';
  if (u === 'USED') return 'var(--ok)';
  if (u === 'VOIDED') return 'var(--muted)';
  return 'var(--muted)';
}

function amountOf(row: MoneyCodeRequestRow): unknown {
  return row.code_total ?? row.money_code_amount;
}

export function MoneyCodesView({ search }: { search: string }) {
  const { pushToast } = useSales();
  const deferredSearch = useDeferredValue(search);
  const [rows, setRows] = useState<MoneyCodeRequestRow[]>([]);
  const [page, setPage] = useState(1);
  const [more, setMore] = useState(false);
  const [status, setStatus] = useState<StatusFilter>('all');
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [voidTarget, setVoidTarget] = useState<MoneyCodeRequestRow | null>(null);
  const [voidReason, setVoidReason] = useState('');
  const [voidBusy, setVoidBusy] = useState(false);

  const load = useCallback(
    async (opts: { page: number; append: boolean; status: StatusFilter; search: string }) => {
      if (opts.append) setLoadingMore(true);
      else {
        setLoading(true);
        setError(null);
      }
      try {
        const res = await callTouchpoint('money_code.list', {
          page: opts.page,
          limit: PAGE_SIZE,
          ...(opts.search.trim() ? { search: opts.search.trim() } : {}),
          ...(opts.status !== 'all' ? { status: opts.status } : {}),
        });
        const next = Array.isArray(res.data) ? res.data : [];
        setRows((prev) => {
          if (!opts.append) return next;
          const seen = new Set(prev.map((r) => String(r.id)));
          return [...prev, ...next.filter((r) => !seen.has(String(r.id)))];
        });
        setMore(res.more_records === true);
        setPage(opts.page);
      } catch (e) {
        const msg = e instanceof Error ? e.message : 'Failed to load money codes';
        if (!opts.append) {
          setError(msg);
          setRows([]);
        } else {
          pushToast('Load failed', msg);
        }
      } finally {
        setLoading(false);
        setLoadingMore(false);
      }
    },
    [pushToast],
  );

  useEffect(() => {
    void load({ page: 1, append: false, status, search: deferredSearch });
  }, [load, status, deferredSearch]);

  const onVoid = async (): Promise<void> => {
    if (!voidTarget || voidBusy) return;
    setVoidBusy(true);
    try {
      const res = await callTouchpoint('money_code.void', {
        requestId: Number(voidTarget.id),
        ...(voidReason.trim() ? { reason: voidReason.trim() } : {}),
      });
      const freed = fmtUsd(amountOf(voidTarget));
      setRows((prev) =>
        prev.map((r) => {
          if (String(r.id) !== String(voidTarget.id) || !res.record) return r;
          // Preserve list aggregates; void payload is a code-stripped row without them.
          const next: MoneyCodeRequestRow = { ...r, ...res.record };
          if (r.code_total !== undefined) next.code_total = r.code_total;
          if (r.batch_rows !== undefined) next.batch_rows = r.batch_rows;
          if (r.invoice_ids !== undefined) next.invoice_ids = r.invoice_ids;
          if (res.record.has_code === undefined && r.has_code !== undefined) next.has_code = r.has_code;
          if (res.record.notified_at === undefined && r.notified_at !== undefined) {
            next.notified_at = r.notified_at;
          }
          if (res.record.notify_error === undefined && r.notify_error !== undefined) {
            next.notify_error = r.notify_error;
          }
          return next;
        }),
      );
      const oc = res.outcome ?? '';
      if (oc === 'voided' || oc === 'never_issued_voided') {
        pushToast('Code voided', `${freed} returned to the carrier's available limit`);
      } else if (oc === 'already_voided_synced') {
        pushToast('Records synced', 'Already voided in EFS — limit freed');
      } else if (oc === 'used_not_voided') {
        pushToast('Already redeemed', 'Marked Used — redeemed codes cannot be voided');
      } else {
        pushToast('Updated', res.message || 'Request updated');
      }
      setVoidTarget(null);
      setVoidReason('');
    } catch (e) {
      pushToast('Could not void', e instanceof Error ? e.message : 'Nothing was changed — try again');
    } finally {
      setVoidBusy(false);
    }
  };

  const filters: Array<[StatusFilter, string]> = [
    ['all', 'All'],
    ['ISSUED', 'Issued'],
    ['VOIDED', 'Voided'],
    ['USED', 'Used'],
  ];

  return (
    <div style={s('display:flex;flex-direction:column;gap:12px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:10px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:13px;font-weight:700')}>My money codes</div>
          <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
            Own draws only · code values are never shown (sent to the carrier app)
          </div>
        </div>
        <div style={s('display:inline-flex;padding:3px;gap:2px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt)')}>
          {filters.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setStatus(id)}
              className={status === id ? 'ss-ret-tab is-on' : 'ss-ret-tab'}
              style={s('height:30px;padding:0 12px')}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading && (
        <div style={s('display:flex;flex-direction:column;align-items:center;gap:12px;padding:48px 20px')}>
          <span
            style={s(
              'width:34px;height:34px;border-radius:50%;border:3px solid var(--border);border-top-color:var(--accent);animation:ss-spin .8s linear infinite',
            )}
          />
          <span style={s('font-size:13px;color:var(--muted)')}>Loading money codes…</span>
        </div>
      )}

      {!loading && error && (
        <div style={s('padding:36px 20px;text-align:center;color:var(--danger);font-size:13px')}>{error}</div>
      )}

      {!loading && !error && rows.length === 0 && (
        <div style={s('padding:40px 20px;text-align:center;color:var(--muted);font-size:13px;line-height:1.55')}>
          No money codes yet. Draw one from <strong style={s('color:var(--text2)')}>Automations → Money Code</strong>.
        </div>
      )}

      {!loading && !error && rows.length > 0 && (
        <div
          style={s(
            'border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);overflow:hidden;box-shadow:var(--shadow-sm)',
          )}
        >
          <div className="ss-scroll" style={s('overflow:auto')}>
            <div style={s('min-width:960px')}>
              <div
                style={s(
                  "display:grid;grid-template-columns:1.5fr 100px 100px 1.2fr 90px 110px 120px 90px;gap:10px;padding:11px 15px;background:var(--alt);border-bottom:1px solid var(--border);font-size:10px;font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted);position:sticky;top:0;z-index:2",
                )}
              >
                <span>Company</span>
                <span>Carrier</span>
                <span style={s('text-align:right')}>Amount</span>
                <span>Reason</span>
                <span>Unit</span>
                <span>Issued</span>
                <span>Status</span>
                <span />
              </div>
              {rows.map((row) => {
                const st = String(row.status || '—').toUpperCase();
                const canVoid = st === 'ISSUED';
                return (
                  <div
                    key={String(row.id)}
                    style={s(
                      'display:grid;grid-template-columns:1.5fr 100px 100px 1.2fr 90px 110px 120px 90px;gap:10px;align-items:center;padding:12px 15px;border-top:1px solid var(--border2);font-size:13px',
                    )}
                  >
                    <span style={s('font-weight:700;overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                      {row.company_name || '—'}
                    </span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)")}>
                      {row.carrier_id ?? '—'}
                    </span>
                    <span
                      style={s(
                        "text-align:right;font-family:'JetBrains Mono',monospace;font-size:12px;font-weight:700",
                      )}
                    >
                      {fmtUsd(amountOf(row))}
                    </span>
                    <span style={s('font-size:12px;color:var(--text2);overflow:hidden;text-overflow:ellipsis;white-space:nowrap')}>
                      {row.moneycode_reason || '—'}
                    </span>
                    <span style={s("font-family:'JetBrains Mono',monospace;font-size:12px")}>
                      {row.unit_number || '—'}
                    </span>
                    <span style={s('font-size:11px;color:var(--muted)')}>{fmtWhen(row.created_at)}</span>
                    <span>
                      <span
                        style={s(
                          `display:inline-flex;padding:2px 8px;border-radius:99px;font-size:10px;font-weight:800;background:color-mix(in srgb,${statusTone(st)} 14%,transparent);color:${statusTone(st)}`,
                        )}
                      >
                        {st}
                      </span>
                      {row.has_code === false && st === 'ISSUED' ? (
                        <div style={s('font-size:10px;color:var(--warn);margin-top:3px')}>No EFS issue</div>
                      ) : null}
                      {row.notify_error ? (
                        <div style={s('font-size:10px;color:var(--warn);margin-top:3px')}>Notify failed</div>
                      ) : row.notified_at ? (
                        <div style={s('font-size:10px;color:var(--ok);margin-top:3px')}>App notified</div>
                      ) : null}
                    </span>
                    <span>
                      {canVoid ? (
                        <button
                          type="button"
                          onClick={() => {
                            setVoidTarget(row);
                            setVoidReason('');
                          }}
                          style={s(
                            'height:28px;padding:0 10px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 35%,var(--border));background:transparent;color:var(--danger);font-weight:700;font-size:11px;cursor:pointer',
                          )}
                        >
                          Void
                        </button>
                      ) : (
                        <span style={s('font-size:11px;color:var(--faint)')}>—</span>
                      )}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
          {more && (
            <div style={s('padding:12px;border-top:1px solid var(--border);display:flex;justify-content:center')}>
              <button
                type="button"
                disabled={loadingMore}
                onClick={() => void load({ page: page + 1, append: true, status, search: deferredSearch })}
                style={s(
                  `height:34px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-weight:700;font-size:12px;cursor:${loadingMore ? 'wait' : 'pointer'};display:inline-flex;align-items:center;gap:8px`,
                )}
              >
                {loadingMore && (
                  <Icon name="refresh" size={14} style={s('animation:ss-spin .9s linear infinite')} />
                )}
                Load more
              </button>
            </div>
          )}
        </div>
      )}

      {voidTarget && (
        <div
          role="presentation"
          onClick={() => {
            if (!voidBusy) setVoidTarget(null);
          }}
          style={s(
            'position:fixed;inset:0;z-index:150;background:rgba(3,7,14,.55);backdrop-filter:blur(3px);display:flex;align-items:center;justify-content:center;padding:24px',
          )}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Void money code"
            onClick={(e) => e.stopPropagation()}
            style={s(
              'width:100%;max-width:420px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border);border-top:3px solid var(--danger);box-shadow:var(--shadow);overflow:hidden',
            )}
          >
            <div style={s('padding:16px 18px;border-bottom:1px solid var(--border)')}>
              <div style={s('font-size:15px;font-weight:700')}>Void money code</div>
              <div style={s('font-size:12px;color:var(--muted);margin-top:4px;line-height:1.45')}>
                {voidTarget.company_name || 'Carrier'} · {fmtUsd(amountOf(voidTarget))} · frees the
                limit if not already redeemed
              </div>
            </div>
            <div style={s('padding:16px 18px')}>
              <input
                value={voidReason}
                onChange={(e) => setVoidReason(e.target.value)}
                placeholder="Optional void reason…"
                className="ss-in"
                style={s(
                  'width:100%;height:36px;padding:0 10px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-size:12px',
                )}
              />
            </div>
            <div style={s('padding:12px 18px;border-top:1px solid var(--border);display:flex;gap:10px')}>
              <button
                type="button"
                disabled={voidBusy}
                onClick={() => setVoidTarget(null)}
                style={s(
                  'flex:1;height:40px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text2);font-weight:700;font-size:13px;cursor:pointer',
                )}
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={voidBusy}
                onClick={() => void onVoid()}
                style={s(
                  `flex:1;height:40px;border-radius:var(--radius-md);border:1px solid color-mix(in srgb,var(--danger) 40%,var(--border));background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger);font-weight:700;font-size:13px;cursor:${voidBusy ? 'wait' : 'pointer'};display:inline-flex;align-items:center;justify-content:center;gap:8px`,
                )}
              >
                {voidBusy && (
                  <Icon name="refresh" size={14} style={s('animation:ss-spin .9s linear infinite')} />
                )}
                {voidBusy ? 'Voiding…' : 'Confirm void'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
