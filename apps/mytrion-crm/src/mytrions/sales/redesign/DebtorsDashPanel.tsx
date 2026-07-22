/**
 * Debtors dashboard — self-service Client Invoices block parity
 * (search, Hard only, summary strip, expandable invoice cards).
 */
import { useState, type ReactNode } from 'react';
import { s } from './dc';
import { useLoad } from './live';
import {
  debtorsSummary,
  filterDebtors,
  loadDebtorsRaw,
  type DebtorCard,
} from './dashDebtorsData';
import { dbtFormatDate, dbtFormatMoney, dbtFormatPeriod, dbtFormatStatus } from './dashFormat';

function statusTone(status: string): string {
  const x = status.toLowerCase();
  if (x === 'pending') return 'var(--orange)';
  if (x === 'partially_paid' || x === 'partial') return 'var(--accent)';
  if (x === 'rejected') return 'var(--danger)';
  return 'var(--muted)';
}

function DebtorRow({
  debtor,
  open,
  onToggle,
}: {
  debtor: DebtorCard;
  open: boolean;
  onToggle: () => void;
}): ReactNode {
  const title = debtor.companyName || debtor.dealName || '—';
  return (
    <div
      style={s(
        `padding:16px 18px;border-radius:var(--radius-md);background:var(--surface);border:1px solid ${
          debtor.isHardDebtor
            ? 'color-mix(in srgb,var(--danger) 35%,var(--border))'
            : 'var(--border)'
        };box-shadow:var(--shadow-sm)`,
      )}
    >
      <div style={s('display:flex;align-items:flex-start;justify-content:space-between;gap:16px')}>
        <div style={s('min-width:0;flex:1')}>
          <div style={s('font-size:15.5px;font-weight:700')}>{title}</div>
          <div style={s('display:flex;flex-wrap:wrap;gap:8px;margin-top:5px;font-size:12px;color:var(--muted)')}>
            {debtor.companyName && debtor.dealName && debtor.companyName !== debtor.dealName ? (
              <span>{debtor.dealName}</span>
            ) : null}
            {debtor.carrierId ? (
              <span style={s("font-family:'JetBrains Mono',monospace")}>ID #{debtor.carrierId}</span>
            ) : null}
            {debtor.stage ? <span>{debtor.stage}</span> : null}
          </div>
          <div style={s('display:flex;flex-wrap:wrap;gap:6px;margin-top:8px')}>
            {debtor.isHardDebtor ? (
              <span
                style={s(
                  'display:inline-flex;align-items:center;gap:4px;padding:3px 8px;border-radius:99px;background:color-mix(in srgb,var(--danger) 14%,transparent);color:var(--danger);font-size:11px;font-weight:800',
                )}
              >
                Hard · {debtor.maxDebtDays}d
              </span>
            ) : debtor.maxDebtDays > 0 ? (
              <span
                style={s(
                  'padding:3px 8px;border-radius:99px;background:var(--raised);color:var(--muted);font-size:11px;font-weight:700',
                )}
              >
                {debtor.maxDebtDays}d overdue
              </span>
            ) : null}
            <span
              style={s(
                `padding:3px 8px;border-radius:99px;background:color-mix(in srgb,${statusTone(debtor.worstStatus)} 14%,transparent);color:${statusTone(debtor.worstStatus)};font-size:11px;font-weight:700`,
              )}
            >
              {dbtFormatStatus(debtor.worstStatus)}
            </span>
          </div>
        </div>
        <div style={s('text-align:right;flex-shrink:0')}>
          <div
            style={s(
              `font-family:'JetBrains Mono',monospace;font-weight:700;font-size:22px;color:${debtor.isHardDebtor ? 'var(--danger)' : 'var(--text)'}`,
            )}
          >
            {dbtFormatMoney(debtor.totalRemaining)}
          </div>
          <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:2px')}>
            Owed today
          </div>
          <div style={s('font-size:11px;color:var(--faint);margin-top:4px')}>
            {dbtFormatMoney(debtor.totalPaid)} paid · {dbtFormatMoney(debtor.totalOwed)} total
          </div>
        </div>
      </div>

      <button
        type="button"
        onClick={onToggle}
        style={s(
          'margin-top:14px;width:100%;display:flex;align-items:center;justify-content:space-between;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--alt);color:var(--text2);font-size:13px;font-weight:700;cursor:pointer',
        )}
      >
        <span>
          {debtor.invoiceCount} invoice{debtor.invoiceCount === 1 ? '' : 's'}
        </span>
        <span style={s(`transition:transform .15s;transform:rotate(${open ? 180 : 0}deg)`)}>▾</span>
      </button>

      {open && (
        <div style={s('margin-top:8px;display:flex;flex-direction:column;gap:6px')}>
          {debtor.invoices.map((inv) => (
            <div
              key={inv.invoiceId || `${inv.createDate}-${inv.remaining}`}
              style={s(
                'display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--surface);flex-wrap:wrap',
              )}
            >
              <div style={s('display:flex;flex-direction:column;gap:2px;min-width:0')}>
                <span style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px")}>
                  #{inv.invoiceId || '—'}
                </span>
                <span style={s('font-size:12px;color:var(--muted)')}>
                  {dbtFormatPeriod(inv.dateFrom, inv.dateTo)}
                </span>
                <span style={s('font-size:11px;color:var(--faint)')}>
                  Created {dbtFormatDate(inv.createDate)}
                </span>
              </div>
              <div style={s('display:flex;align-items:center;gap:8px;flex-wrap:wrap;justify-content:flex-end')}>
                {inv.debtDays > 0 ? (
                  <span
                    style={s(
                      `font-family:'JetBrains Mono',monospace;font-size:11px;font-weight:800;color:${inv.debtDays >= 15 ? 'var(--danger)' : 'var(--orange)'}`,
                    )}
                  >
                    {inv.debtDays}d
                  </span>
                ) : null}
                <span
                  style={s(
                    `padding:2px 7px;border-radius:99px;font-size:11px;font-weight:700;color:${statusTone(inv.status)};background:color-mix(in srgb,${statusTone(inv.status)} 12%,transparent)`,
                  )}
                >
                  {dbtFormatStatus(inv.status)}
                </span>
                <span style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:13px")}>
                  {dbtFormatMoney(inv.remaining)}
                </span>
                <span style={s('font-size:11px;color:var(--faint)')}>of {dbtFormatMoney(inv.total)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function DebtorsDashPanel() {
  const load = useLoad(loadDebtorsRaw, []);
  const [search, setSearch] = useState('');
  const [hardOnly, setHardOnly] = useState(false);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  if (load.loading && !load.data) {
    return <div style={s('text-align:center;padding:56px 20px;color:var(--muted);font-size:13px')}>Loading debtors…</div>;
  }
  if (load.error && !load.data) {
    return (
      <div style={s('text-align:center;padding:56px 20px;color:var(--danger);font-size:13px')}>
        {load.error}
        <div style={s('margin-top:12px')}>
          <button type="button" onClick={load.reload} style={s('padding:8px 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;cursor:pointer')}>
            Retry
          </button>
        </div>
      </div>
    );
  }
  const raw = load.data;
  if (!raw) return null;

  const filtered = filterDebtors(raw.debtors, search);
  const visible = hardOnly ? filtered.filter((d) => d.isHardDebtor) : filtered;
  const summary = debtorsSummary(filtered);

  return (
    <div style={s('display:flex;flex-direction:column;gap:14px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap')}>
        <div>
          <div style={s('font-size:15px;font-weight:800')}>Client Invoices</div>
          <div style={s('font-size:12px;color:var(--muted);margin-top:2px')}>
            Outstanding balances · 2+ days overdue
          </div>
        </div>
        <button
          type="button"
          onClick={load.reload}
          disabled={load.loading}
          style={s(
            'height:34px;padding:0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);font-weight:700;font-size:12px;cursor:pointer;color:var(--text2)',
          )}
        >
          {load.loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      <div style={s('display:flex;flex-wrap:wrap;align-items:center;gap:8px')}>
        <div style={s('position:relative;flex:1;min-width:220px')}>
          <input
            value={search}
            onChange={(e) => setSearch(e.currentTarget.value)}
            placeholder="Search by Carrier ID, deal, or company…"
            className="ss-in"
            style={s(
              'width:100%;height:38px;padding:0 36px 0 14px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-size:13px',
            )}
          />
          {search ? (
            <button
              type="button"
              onClick={() => setSearch('')}
              style={s(
                'position:absolute;right:8px;top:50%;transform:translateY(-50%);border:none;background:transparent;color:var(--muted);cursor:pointer;font-weight:700',
              )}
            >
              ✕
            </button>
          ) : null}
        </div>
        <button
          type="button"
          onClick={() => setHardOnly((v) => !v)}
          style={s(
            `display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 14px;border-radius:99px;border:1px solid ${hardOnly ? 'var(--danger)' : 'var(--border)'};background:${hardOnly ? 'color-mix(in srgb,var(--danger) 12%,transparent)' : 'var(--surface)'};color:${hardOnly ? 'var(--danger)' : 'var(--muted)'};font-size:12px;font-weight:800;cursor:pointer`,
          )}
        >
          Hard only
          {summary.hardCount ? (
            <span style={s('font-family:JetBrains Mono,monospace;font-size:11px')}>{summary.hardCount}</span>
          ) : null}
        </button>
      </div>

      {filtered.length > 0 && (
        <div
          style={s(
            'display:grid;grid-template-columns:repeat(4,1fr);gap:10px;padding:14px;border-radius:var(--radius-md);background:var(--surface);border:1px solid var(--border)',
          )}
        >
          {[
            { label: 'Total Outstanding', val: dbtFormatMoney(summary.totalRemaining), col: 'var(--danger)' },
            { label: 'Pending', val: String(summary.pendingCount), col: 'var(--text)' },
            { label: 'Partial', val: String(summary.partialCount), col: 'var(--text)' },
            { label: 'Hard (15+ days)', val: String(summary.hardCount), col: 'var(--danger)' },
          ].map((c) => (
            <div key={c.label}>
              <div style={s(`font-family:'JetBrains Mono',monospace;font-weight:700;font-size:18px;color:${c.col}`)}>
                {c.val}
              </div>
              <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted);margin-top:3px')}>
                {c.label}
              </div>
            </div>
          ))}
        </div>
      )}

      {filtered.length === 0 && !search && !hardOnly && (
        <div style={s('text-align:center;padding:48px 20px;color:var(--muted)')}>
          <div style={s('font-size:14px;font-weight:700;color:var(--ok)')}>No outstanding balances</div>
          <div style={s('font-size:13px;margin-top:4px')}>No clients are 2+ days overdue.</div>
        </div>
      )}
      {filtered.length > 0 && visible.length === 0 && (
        <div style={s('text-align:center;padding:40px 20px;color:var(--muted);font-size:13px')}>
          {hardOnly
            ? 'No hard debtors right now — nothing 15+ days overdue.'
            : 'No debtors match the current search.'}
        </div>
      )}

      <div style={s('display:flex;flex-direction:column;gap:10px')}>
        {visible.map((d) => (
          <DebtorRow
            key={d.id}
            debtor={d}
            open={!!expanded[d.id]}
            onToggle={() => setExpanded((prev) => ({ ...prev, [d.id]: !prev[d.id] }))}
          />
        ))}
      </div>

      {filtered.length > 0 && (
        <div
          style={s(
            'display:flex;align-items:center;justify-content:center;gap:28px;padding:16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt)',
          )}
        >
          <div style={s('text-align:center')}>
            <div style={s("font-family:'JetBrains Mono',monospace;font-weight:700;font-size:20px")}>
              {filtered.length}
            </div>
            <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>
              Active Debtors
            </div>
          </div>
          <div style={s('width:1px;height:36px;background:var(--border)')} />
          <div style={s('text-align:center')}>
            <div
              style={s(
                `font-family:'JetBrains Mono',monospace;font-weight:700;font-size:20px;color:${summary.largestDebt > 0 ? 'var(--danger)' : 'var(--text)'}`,
              )}
            >
              {dbtFormatMoney(summary.largestDebt)}
            </div>
            <div style={s('font-size:11px;font-weight:700;letter-spacing:.04em;text-transform:uppercase;color:var(--muted)')}>
              Largest Debt
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
