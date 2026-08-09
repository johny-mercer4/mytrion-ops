import { Badge, s } from './dc';
import { Icon } from './icons';
import { cardStatusBadge } from './AutoPicklist';
import { fmtDate, type CardLastUsedRow, type LimitUpdateResult } from './autoLive';
import { badge } from './salesData';

const mono = "font-family:var(--font-mono)";

function sourceLabel(row: CardLastUsedRow): { text: string; color: string } {
  if (row.source === 'efs') return { text: 'LIVE EFS', color: 'var(--ok)' };
  if (row.source === 'dwh') return { text: 'DWH HISTORY', color: 'var(--cyan)' };
  return { text: 'NO USAGE', color: 'var(--muted)' };
}

function recencyLabel(row: CardLastUsedRow): string {
  if (!row.lastUsed) return 'Never used';
  if (row.daysSinceLastUse === 0) return 'Used today';
  if (row.daysSinceLastUse === 1) return 'Used yesterday';
  if (row.daysSinceLastUse != null) return `${row.daysSinceLastUse} days ago`;
  return fmtDate(row.lastUsed);
}

export function AutoCardLastUsedPanel({ rows }: { rows: CardLastUsedRow[] }) {
  const sorted = [...rows].sort((a, b) => {
    if (a.lastUsed && !b.lastUsed) return -1;
    if (!a.lastUsed && b.lastUsed) return 1;
    return String(b.lastUsed ?? '').localeCompare(String(a.lastUsed ?? ''));
  });
  return (
    <div style={s('display:flex;flex-direction:column;gap:10px')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px')}>
        <div>
          <div style={s('font-family:var(--font-head);font-size:var(--ss-text-lg);font-weight:700;text-transform:uppercase;letter-spacing:.03em')}>Card activity</div>
          <div style={s('font-size:var(--ss-text-xs);color:var(--muted);margin-top:2px')}>Live EFS status with the best available last-use history.</div>
        </div>
        <Badge vm={badge(`${rows.length} CARD${rows.length === 1 ? '' : 'S'}`, 'var(--accent)')} />
      </div>
      {sorted.map((row) => {
        const source = sourceLabel(row);
        return (
          <div
            key={row.cardNumber}
            className="ss-row-h"
            style={s('display:grid;grid-template-columns:minmax(150px,1.15fr) minmax(150px,1fr) auto;gap:14px;align-items:center;padding:14px 16px;border:1px solid var(--border);border-radius:var(--radius-md);background:var(--surface)')}
          >
            <div style={s('display:flex;align-items:center;gap:11px;min-width:0')}>
              <div style={s('width:36px;height:36px;border-radius:var(--radius-md);background:rgba(var(--accent-rgb),.1);color:var(--accent);display:flex;align-items:center;justify-content:center;flex-shrink:0')}>
                <Icon name="card" size={18} />
              </div>
              <div>
                <div style={s(`${mono};font-size:var(--ss-text-sm);font-weight:800`)}>•••• {row.cardNumber.slice(-4)}</div>
                <div style={s('margin-top:5px')}><Badge vm={cardStatusBadge(row.status)} /></div>
              </div>
            </div>
            <div>
              <div style={s('display:flex;align-items:center;gap:6px;font-size:var(--ss-text-sm);font-weight:700;color:var(--text)')}>
                <Icon name="calendar" size={15} color="var(--muted)" />
                {row.lastUsed ? fmtDate(row.lastUsed) : 'No recorded use'}
              </div>
              <div style={s('display:flex;align-items:center;gap:6px;margin-top:5px;font-size:var(--ss-text-2xs);color:var(--muted)')}>
                <Icon name="clock" size={13} />
                {recencyLabel(row)}
                {row.transactions != null ? ` · ${row.transactions} txn${row.transactions === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            <Badge vm={badge(source.text, source.color)} />
          </div>
        );
      })}
    </div>
  );
}

export function AutoLimitUpdatePanel({ result }: { result: LimitUpdateResult }) {
  const deltaSign = result.direction === 'increase' ? '+' : '−';
  const color = result.direction === 'increase' ? 'var(--ok)' : 'var(--danger)';
  return (
    <div style={s('padding:20px;border:1px solid color-mix(in srgb,var(--ok) 35%,var(--border));border-radius:var(--radius-md);background:linear-gradient(135deg,color-mix(in srgb,var(--ok) 10%,var(--surface)),var(--surface))')}>
      <div style={s('display:flex;align-items:center;justify-content:space-between;gap:12px')}>
        <div style={s('display:flex;align-items:center;gap:11px')}>
          <div style={s('width:42px;height:42px;border-radius:var(--radius-md);background:color-mix(in srgb,var(--ok) 14%,transparent);color:var(--ok);display:flex;align-items:center;justify-content:center')}>
            <Icon name="fuel" size={21} />
          </div>
          <div>
            <div style={s('font-size:var(--ss-text-2xs);font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>{result.limitId} gallon limit</div>
            <div style={s(`${mono};font-size:var(--ss-text-sm);font-weight:700;margin-top:3px`)}>Card •••• {result.cardNumber.slice(-4)}</div>
          </div>
        </div>
        <Badge vm={badge('CONFIRMED BY EFS', 'var(--ok)')} />
      </div>
      <div style={s('display:grid;grid-template-columns:1fr auto 1fr;gap:16px;align-items:center;margin-top:20px')}>
        <div>
          <div style={s('font-size:var(--ss-text-2xs);color:var(--muted);text-transform:uppercase;font-weight:700')}>Previous</div>
          <div style={s(`${mono};font-size:var(--ss-text-xl);font-weight:800;margin-top:4px`)}>{result.previousLimit.toLocaleString()} gal</div>
        </div>
        <div style={s(`font-size:var(--ss-text-lg);font-weight:900;color:${color}`)}>→</div>
        <div style={s('text-align:right')}>
          <div style={s('font-size:var(--ss-text-2xs);color:var(--muted);text-transform:uppercase;font-weight:700')}>New limit</div>
          <div style={s(`${mono};font-size:var(--ss-text-2xl);font-weight:900;margin-top:4px;color:var(--ok)`)}>{result.newLimit.toLocaleString()} gal</div>
        </div>
      </div>
      <div style={s(`margin-top:14px;padding-top:12px;border-top:1px solid var(--border2);font-size:var(--ss-text-xs);color:${color};font-weight:800`)}>
        {deltaSign}{result.delta.toLocaleString()} gallons applied to the existing limit
      </div>
    </div>
  );
}
