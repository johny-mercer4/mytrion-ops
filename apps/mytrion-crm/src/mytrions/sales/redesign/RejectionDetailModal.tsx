/**
 * Rejection report detail — the row is a summary, this is the whole decline.
 *
 * Built on the shared `DetailSheet` so it inherits the module's modal chrome (scrim, accent rail,
 * ESC/backdrop close, header/footer rhythm) rather than re-inventing a dialog.
 *
 * The point of this view is to answer "why was this card declined, and what did the driver already
 * get told?" without opening Zoho Desk — so the automated SMS is surfaced as first-class content, and
 * the raw EFS string is kept verbatim at the bottom for support escalation.
 */
import { DetailSheet } from './dataCenterSheet';
import { s } from './dc';
import { Icon } from './icons';
import type { RejectionVM } from './dataCenterLive';

/** Decline codes we can name. Anything else falls back to the code alone. */
const ERROR_TITLE: Record<string, string> = {
  '3': 'Fraud / inactive card',
  '12': 'Manual entry blocked',
  '17': 'Invalid PIN or unit number',
  '18': 'Item not allowed',
  '25': 'Limit exceeded',
  '110': 'Invalid PIN',
  '787': 'Inactive or zero balance',
};

/** Hue per decline family — fraud reads danger, policy limits read warn, the rest are neutral. */
function accentFor(r: RejectionVM): string {
  if (r.isFraud || r.errorCode === '3') return 'var(--danger)';
  if (r.errorCode === '25' || r.errorCode === '787') return 'var(--orange)';
  return 'var(--accent)';
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  if (!value || value === '—') return null;
  return (
    <div style={s('display:flex;gap:14px;padding:9px 0;border-bottom:1px dashed var(--border2)')}>
      <span style={s('flex:0 0 132px;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
        {label}
      </span>
      <span style={s(`flex:1;min-width:0;font-size:14px;word-break:break-word${mono ? ";font-family:var(--font-mono);font-size:13px" : ''}`)}>
        {value}
      </span>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: string }) {
  return (
    <span style={s(`display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${tone} 15%,transparent);border:1px solid color-mix(in srgb,${tone} 34%,transparent);color:${tone}`)}>
      {text}
    </span>
  );
}

export function RejectionDetailModal({ row, onClose }: { row: RejectionVM; onClose: () => void }) {
  const accent = accentFor(row);
  const title = ERROR_TITLE[row.errorCode] ?? (row.errorText || 'Card declined');

  return (
    <DetailSheet
      accent={accent}
      ariaLabel={`Rejection report — ${row.company}`}
      title={title}
      subtitle={`${row.company} · #${row.number}`}
      avatar={
        <div style={s(`width:42px;height:42px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${accent} 15%,transparent);color:${accent}`)}>
          <Icon name="ban" size={20} strokeWidth={1.9} />
        </div>
      }
      badges={
        <div style={s('display:flex;gap:7px;flex-wrap:wrap')}>
          {row.errorCode ? <Chip text={`Error ${row.errorCode}`} tone={accent} /> : null}
          {row.isFraud ? <Chip text="Fraud" tone="var(--danger)" /> : null}
          {/* In-network matters because it changes the advice given to the driver. */}
          <Chip
            text={row.isNetwork ? 'In network' : 'Out of network'}
            tone={row.isNetwork ? 'var(--ok)' : 'var(--muted)'}
          />
          {row.paymentType ? <Chip text={row.paymentType} tone="var(--violet)" /> : null}
        </div>
      }
      onClose={onClose}
      /* ModalFooter is the edit-oriented footer (save/cancel/call); a rejection report is read-only,
         so it gets a single Close action rather than a disabled edit affordance. */
      footer={
        <div style={s('padding:12px 20px;display:flex;justify-content:flex-end')}>
          <button
            type="button"
            onClick={onClose}
            style={s('height:38px;padding:0 20px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:14px;cursor:pointer;font-family:inherit')}
          >
            Close
          </button>
        </div>
      }
    >
      <div style={s('display:flex;flex-direction:column;gap:18px')}>
        {row.automatedResponse ? (
          /* Lead with what the driver was already told — it is the first thing an agent needs before
             calling them, and the only part of this record the customer has seen. */
          <div style={s(`padding:14px 16px;border-radius:var(--radius-md);background:color-mix(in srgb,${accent} 8%,transparent);border:1px solid color-mix(in srgb,${accent} 26%,transparent)`)}>
            <div style={s('display:flex;align-items:center;gap:8px;margin-bottom:7px;font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
              <Icon name="chat" size={14} />
              Sent to the driver
            </div>
            <div style={s('font-size:14px;line-height:1.55')}>{row.automatedResponse}</div>
          </div>
        ) : null}

        <div>
          <div style={s('font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px')}>
            Decline
          </div>
          <Row label="Reason" value={row.errorText} />
          <Row label="Card" value={row.cardLast4 ? `•••• ${row.cardLast4}` : ''} mono />
          <Row label="Driver" value={row.driverName} />
          <Row label="Reported" value={row.occurredAtLong} />
        </div>

        <div>
          <div style={s('font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px')}>
            Where
          </div>
          <Row label="Location" value={row.location} />
          <Row label="Station" value={row.station} />
        </div>

        <div>
          <div style={s('font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:4px')}>
            Account
          </div>
          <Row label="Company" value={row.company} />
          <Row label="Carrier" value={row.number} mono />
          <Row label="Owned by" value={row.agentName} />
        </div>

        {row.errorRaw && row.errorRaw !== row.errorText ? (
          <details>
            <summary style={s('cursor:pointer;font-size:12px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:var(--muted)')}>
              Raw EFS response
            </summary>
            {/* Verbatim, unparsed — this is what support quotes back to EFS. */}
            <div style={s("margin-top:9px;padding:11px 13px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2);font-family:var(--font-mono);font-size:12.5px;word-break:break-all;color:var(--text2)")}>
              {row.errorRaw}
            </div>
          </details>
        ) : null}
      </div>
    </DetailSheet>
  );
}
