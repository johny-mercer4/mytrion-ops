import { useState } from 'react';
import { requestBlob } from '@/api/transport';
import { maskCard, type CardLookupRow } from './autoLive';
import { s } from './dc';
import { deliverBlob } from './txnExportLibs';
import { AUTO_BUSY_LABEL } from './autoControls';

type Format = 'pdf' | 'xlsx';

function statusColor(status: string): string {
  const value = status.toLowerCase();
  if (value.includes('active') && !value.includes('inactive')) return 'var(--ok)';
  if (value.includes('hold') || value.includes('fraud')) return 'var(--warn)';
  return 'var(--muted)';
}

async function downloadCardLookup(
  carrierId: string,
  companyName: string,
  format: Format,
): Promise<void> {
  const query = new URLSearchParams({ carrierId, companyName, format });
  const blob = await requestBlob(`/sales/cards/report?${query.toString()}`, {
    timeoutMs: 60_000,
  });
  const date = new Date().toISOString().slice(0, 10);
  deliverBlob(blob, `Octane_Card_Lookup_${date}.${format}`);
}

export function AutoCardLookupPanel({
  carrierId,
  companyName,
  rows,
}: {
  carrierId: string;
  companyName: string;
  rows: CardLookupRow[];
}) {
  const [busy, setBusy] = useState<Format | null>(null);
  const [message, setMessage] = useState<{
    tone: 'ok' | 'error';
    text: string;
  } | null>(null);

  const download = (format: Format): void => {
    if (busy) return;
    setBusy(format);
    setMessage(null);
    downloadCardLookup(carrierId, companyName, format)
      .then(() => setMessage({ tone: 'ok', text: `${format.toUpperCase()} downloaded.` }))
      .catch((error: unknown) => setMessage({
        tone: 'error',
        text: error instanceof Error ? error.message : 'Download failed.',
      }))
      .finally(() => setBusy(null));
  };

  return (
    <div style={s('display:flex;flex-direction:column;gap:12px')}>
      <div style={s('display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:10px')}>
        <div>
          <div style={s('font-size:var(--ss-text-sm);font-weight:800;color:var(--text)')}>{rows.length} live card{rows.length === 1 ? '' : 's'}</div>
          <div style={s('font-size:var(--ss-text-2xs);color:var(--muted);margin-top:3px')}>Use the card actions in Automations to activate, deactivate, update limits, or change unit/driver details.</div>
        </div>
        <div style={s('display:flex;gap:8px')}>
          <button type="button" disabled={busy !== null} onClick={() => download('pdf')} className="ss-auto-result-btn-sec" style={s('height:36px;padding:0 14px;font-size:var(--ss-text-xs)')}>
            {busy === 'pdf' ? AUTO_BUSY_LABEL : 'Download PDF Report'}
          </button>
          <button type="button" disabled={busy !== null} onClick={() => download('xlsx')} className="ss-auto-result-btn-sec" style={s('height:36px;padding:0 14px;font-size:var(--ss-text-xs)')}>
            {busy === 'xlsx' ? AUTO_BUSY_LABEL : 'Download Excel Report'}
          </button>
        </div>
      </div>
      {message && (
        <div style={s(`padding:10px 12px;border-radius:var(--radius-md);font-size:var(--ss-text-xs);color:var(--${message.tone === 'ok' ? 'ok' : 'danger'});background:color-mix(in srgb,var(--${message.tone === 'ok' ? 'ok' : 'danger'}) 10%,transparent);border:1px solid color-mix(in srgb,var(--${message.tone === 'ok' ? 'ok' : 'danger'}) 28%,transparent)`)}>
          {message.text}
        </div>
      )}
      <div className="ss-scroll" data-table-scroller style={s('overflow:auto;border:1px solid var(--border);border-radius:var(--radius-md)')}>
        <div style={s('min-width:940px')}>
          <div style={s('display:grid;grid-template-columns:1.05fr 1.35fr .75fr .85fr 1.45fr .8fr .9fr .7fr;gap:8px;padding:11px 13px;background:var(--surface-2);font-size:var(--ss-text-badge);font-weight:800;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
            {['Card ID', 'Card #', 'Unit', 'Driver ID', 'Driver Name', 'X-Ref', 'Status', 'Override'].map((header) => <span key={header}>{header}</span>)}
          </div>
          {rows.map((row, index) => (
            <div key={`${row.cardId}-${row.cardNumber}-${index}`} className="ss-row-h" style={s('display:grid;grid-template-columns:1.05fr 1.35fr .75fr .85fr 1.45fr .8fr .9fr .7fr;gap:8px;padding:11px 13px;border-top:1px solid var(--border2);font-size:var(--ss-text-xs);align-items:center')}>
              <span style={s("font-family:var(--font-mono)")}>{row.cardId || '—'}</span>
              <span style={s("font-family:var(--font-mono);font-weight:700")}>{maskCard(row.cardNumber)}</span>
              <span>{row.unit || '—'}</span>
              <span>{row.driverId || '—'}</span>
              <span>{row.driverName || '—'}</span>
              <span>{row.xRef || '—'}</span>
              <span style={s(`font-weight:800;color:${statusColor(row.status)}`)}>{row.status || '—'}</span>
              <span>{row.override || 'No'}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
