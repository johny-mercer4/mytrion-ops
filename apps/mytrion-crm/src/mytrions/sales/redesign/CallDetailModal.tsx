/**
 * Call Hub detail — DetailSheet chrome with redial + Data Center jump.
 */
import { clickToDial } from '@/components/ringcentral/ringcentralDial';
import type { CallHubItem } from '@/api/callHub';
import { DetailSheet } from './dataCenterSheet';
import { s } from './dc';
import { Icon } from './icons';
import { useSales } from './ctx';

const SOURCE_TONE: Record<CallHubItem['source'], string> = {
  mytrion: 'var(--accent)',
  zoho: 'var(--ok)',
  gong: 'var(--violet)',
};

function friendly(value: string): string {
  return value.replaceAll('_', ' ');
}

function formatWhen(iso: string): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(d);
}

function formatDuration(seconds: number | null): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return '—';
  const m = Math.floor(seconds / 60);
  const sRem = Math.round(seconds % 60);
  return `${m}:${String(sRem).padStart(2, '0')}`;
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div style={s('padding:12px 14px;border-radius:var(--radius-md);background:var(--alt);border:1px solid var(--border2)')}>
      <div style={s('font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
        {label}
      </div>
      <div style={s('margin-top:6px;font-size:14px;font-weight:650;color:var(--text);line-height:1.45;word-break:break-word')}>
        {value || '—'}
      </div>
    </div>
  );
}

function Chip({ text, tone }: { text: string; tone: string }) {
  return (
    <span
      style={s(
        `display:inline-flex;align-items:center;gap:5px;padding:3px 10px;border-radius:99px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;background:color-mix(in srgb,${tone} 15%,transparent);border:1px solid color-mix(in srgb,${tone} 34%,transparent);color:${tone}`,
      )}
    >
      {text}
    </span>
  );
}

export function CallDetailModal({ call, onClose }: { call: CallHubItem; onClose: () => void }) {
  const { go } = useSales();
  const accent = SOURCE_TONE[call.source];
  const title = call.subject?.trim() || call.result || call.direction || 'Call';

  return (
    <DetailSheet
      accent={accent}
      ariaLabel={`Call — ${title}`}
      title={title}
      subtitle={formatWhen(call.startedAt)}
      avatar={
        <div
          style={s(
            `width:42px;height:42px;border-radius:var(--radius-md);flex-shrink:0;display:flex;align-items:center;justify-content:center;background:color-mix(in srgb,${accent} 15%,transparent);color:${accent}`,
          )}
        >
          <Icon name="callHub" size={20} strokeWidth={1.9} />
        </div>
      }
      badges={
        <div style={s('display:flex;gap:7px;flex-wrap:wrap')}>
          <Chip text={call.source} tone={accent} />
          <Chip
            text={friendly(call.status)}
            tone={call.status === 'answered' ? 'var(--ok)' : call.status === 'missed' ? 'var(--danger)' : 'var(--muted)'}
          />
        </div>
      }
      onClose={onClose}
      footer={
        <div style={s('padding:12px 20px;display:flex;flex-wrap:wrap;justify-content:flex-end;gap:8px')}>
          {call.phone ? (
            <button
              type="button"
              onClick={() => {
                clickToDial(call.phone);
              }}
              style={s(
                'height:38px;padding:0 16px;border-radius:var(--radius-md);border:none;background:linear-gradient(140deg,var(--accent),var(--accent-2));color:var(--on-accent);font-weight:750;font-size:14px;cursor:pointer;font-family:inherit;display:inline-flex;align-items:center;gap:7px',
              )}
            >
              <Icon name="calls" size={14} /> Redial
            </button>
          ) : null}
          {call.linked ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                go(call.linked?.type === 'retention_case' ? 'retention' : 'records');
              }}
              style={s(
                'height:38px;padding:0 16px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--alt);color:var(--text);font-weight:750;font-size:14px;cursor:pointer;font-family:inherit',
              )}
            >
              Open {friendly(call.linked.type)}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            style={s(
              'height:38px;padding:0 18px;border-radius:var(--radius-md);border:1px solid var(--border);background:var(--surface);color:var(--text);font-weight:700;font-size:14px;cursor:pointer;font-family:inherit',
            )}
          >
            Close
          </button>
        </div>
      }
    >
      <div style={s('display:flex;flex-direction:column;gap:18px')}>
        <div style={s('display:grid;grid-template-columns:1fr 1fr;gap:10px')}>
          <Field label="Direction" value={call.direction} />
          <Field label="Status" value={friendly(call.status)} />
          <Field label="Phone" value={call.phone || '—'} />
          <Field label="Duration" value={formatDuration(call.durationSeconds)} />
          <Field label="Source" value={call.source} />
          <Field label="When" value={formatWhen(call.startedAt)} />
        </div>
        {call.result ? (
          <div>
            <div style={s('font-size:12px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted);margin-bottom:8px')}>
              Result
            </div>
            <p style={s('margin:0;padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--surface);color:var(--text2);font-size:14px;line-height:1.55')}>
              {call.result}
            </p>
          </div>
        ) : null}
        {call.linked ? (
          <div style={s('padding:14px 16px;border-radius:var(--radius-md);border:1px solid var(--border2);background:var(--alt)')}>
            <div style={s('font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:var(--muted)')}>
              Linked record
            </div>
            <div style={s('margin-top:6px;font-weight:700')}>
              {friendly(call.linked.type)}
              {call.linked.label ? ` · ${call.linked.label}` : ''}
            </div>
            <div style={s("margin-top:4px;font-family:'JetBrains Mono',monospace;font-size:12px;color:var(--muted)")}>
              {call.linked.id}
            </div>
          </div>
        ) : null}
      </div>
    </DetailSheet>
  );
}
